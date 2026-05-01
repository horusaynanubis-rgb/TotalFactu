import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/storage';
import { extractInvoiceData, InvoiceExtraction } from '@/lib/ai-extraction';
import { classifyInvoiceType } from '@/lib/invoice-type-classifier';
import { sendMessage, editMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function mapExtractionToInvoice(extraction: InvoiceExtraction, documentId: string, companyId: string) {
  return {
    document_id: documentId,
    company_id: companyId,
    invoice_type: extraction.invoice_type,
    invoice_number: extraction.invoice_number || 'UNKNOWN',
    issue_date: extraction.issue_date ? new Date(extraction.issue_date) : new Date(),
    due_date: extraction.due_date ? new Date(extraction.due_date) : null,
    supplier_name: extraction.supplier_name || 'Unknown Supplier',
    supplier_tax_id: extraction.supplier_tax_id,
    customer_name: extraction.customer_name || 'Unknown Customer',
    customer_tax_id: extraction.customer_tax_id,
    subtotal: extraction.subtotal,
    tax_amount: extraction.tax_amount,
    total_amount: extraction.total_amount,
    currency: extraction.currency || 'EUR',
    tax_rate: extraction.tax_rate,
    payment_method: extraction.payment_method,
    category: extraction.category,
    notes: extraction.notes,
    extraction_confidence: extraction.extraction_confidence,
    review_status: extraction.needs_review ? 'pending' : 'approved',
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const documentId = params.id;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { company: true, invoice: true },
    });

    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    // If retrying, delete existing invoice first
    if (document.invoice) {
      await prisma.invoice.delete({ where: { id: document.invoice.id } });
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { processing_status: 'processing', confidence_score: null },
    });

    // Download file from Supabase Storage and convert to base64 for Gemini inline_data
    const fileUrl = await getFileUrl(document.cloud_storage_path, document.is_public);
    console.log(`[process] documentId=${documentId} storagePath=${document.cloud_storage_path} mimeType=${document.mime_type}`);
    console.log(`[process] Signed URL obtained (length=${fileUrl.length}). Fetching file...`);

    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Error guardando archivo — storage fetch failed (${fileResponse.status} ${fileResponse.statusText})`);
    }
    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');
    console.log(`[process] File downloaded. size=${fileBuffer.byteLength} base64Length=${fileBase64.length}`);

    // Build AI provider config.
    // Only use 'external' or 'local' if the company has valid credentials for them;
    // otherwise fall back to Gemini (GEMINI_API_KEY env var).
    const companyProvider = document.company?.ai_provider;
    const hasExternalConfig =
      companyProvider === 'external' &&
      !!document.company?.ai_api_key &&
      !!document.company?.ai_api_endpoint;
    const hasLocalConfig = companyProvider === 'local';
    const resolvedProvider = hasExternalConfig ? 'external' : hasLocalConfig ? 'local' : 'gemini';

    console.log(`[process] AI provider resolved: ${resolvedProvider} (company setting: ${companyProvider})`);

    const aiConfig = {
      provider: resolvedProvider as 'local' | 'external' | 'gemini',
      apiKey: document.company?.ai_api_key,
      apiEndpoint: document.company?.ai_api_endpoint,
    };

    // AI Extraction — returns validated structured JSON, never writes to DB
    const extraction = await extractInvoiceData(
      fileBase64,
      document.mime_type,
      document.original_filename,
      aiConfig
    );

    // Post-process: verify invoice_type against company identity (AI can be wrong)
    const classification = classifyInvoiceType(extraction, {
      name: document.company.name,
      tax_id: document.company.tax_id,
    });

    const finalType    = classification.invoice_type;
    const needsReview  = classification.needs_review || extraction.needs_review;

    if (classification.was_corrected) {
      console.log(`[process] ⚠️  invoice_type corrected: ${extraction.invoice_type} → ${finalType}. Reason: ${classification.correction_reason}`);
    } else if (!classification.correction_reason && classification.needs_review && !extraction.needs_review) {
      console.log(`[process] ℹ️  invoice_type unconfirmed (no company match) — forcing needs_review`);
    }

    const processingStatus = needsReview ? 'needs_review' : 'completed';

    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        processing_status: processingStatus,
        confidence_score: extraction.extraction_confidence,
      },
    });

    const invoiceData = {
      ...mapExtractionToInvoice(extraction, documentId, document.company_id),
      invoice_type: finalType,
      review_status: needsReview ? 'pending' : 'approved',
    };
    const invoice = await prisma.invoice.create({ data: invoiceData });

    // Audit log when AI type was automatically corrected
    if (classification.was_corrected) {
      await prisma.auditLog.create({
        data: {
          company_id: document.company_id,
          user_id: null,
          entity_type: 'invoice',
          entity_id: invoice.id,
          action: 'auto_classify',
          old_values: JSON.stringify({ invoice_type: extraction.invoice_type }),
          new_values: JSON.stringify({
            invoice_type: finalType,
            reason: classification.correction_reason,
          }),
        },
      });
    }

    console.log(`[process] ✅ Invoice created. id=${invoice.id} type=${finalType} corrected=${classification.was_corrected} status=${processingStatus} confidence=${extraction.extraction_confidence}`);

    // Telegram notification is handled by the webhook caller — skip duplicate here
    // (webhook already edits the status message after receiving the process response)

    return NextResponse.json({ document: updatedDocument, invoice });
  } catch (error: any) {
    console.error('[process] ❌ Error:', error?.message);
    console.error('[process] Stack:', error?.stack);

    try {
      const doc = await prisma.document.update({
        where: { id: params.id },
        data: { processing_status: 'failed', confidence_score: 0 },
        include: { company: true },
      });

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (doc.telegram_chat_id && botToken) {
        let msg: string;
        if (error?.message?.includes('storage fetch failed')) {
          msg = '❌ <b>Error guardando archivo</b>\n\nNo se pudo acceder al archivo guardado. Inténtalo de nuevo.';
        } else if (error?.message?.includes('Gemini API error')) {
          msg = '❌ <b>Error extrayendo datos</b>\n\nLa IA no pudo procesar el archivo. Inténtalo de nuevo.';
        } else if (error?.message?.includes('No content') || error?.message?.includes('not valid JSON')) {
          msg = '⚠️ <b>No se detectó factura válida</b>\n\nGemini no encontró datos de factura. Asegúrate de que la imagen sea legible y sea una factura.';
        } else {
          msg = '❌ <b>Error al procesar la factura</b>\n\nInténtalo de nuevo o sube la factura desde el panel web.';
        }
        if (doc.telegram_message_id) {
          await editMessage(botToken, doc.telegram_chat_id, doc.telegram_message_id, msg);
        } else {
          await sendMessage(botToken, doc.telegram_chat_id, msg);
        }
      }
    } catch (updateError: any) {
      console.error('[process] Failed to update document status:', updateError);
    }

    return NextResponse.json(
      { message: `Processing failed: ${error?.message}` },
      { status: 500 }
    );
  }
}

async function sendTelegramStatusUpdate(
  botToken: string,
  chatId: string,
  messageId: number | null,
  status: string,
  invoice: any
) {
  try {
    let text = '';
    if (status === 'completed') {
      text = '✅ <b>¡Factura procesada correctamente!</b>\n\n';
      text += `📄 Factura #${invoice.invoice_number}\n`;
      text += `🏢 ${invoice.supplier_name}\n`;
      text += `💰 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
      text += `📅 ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('es-ES') : 'N/A'}\n`;
      text += `\n🎯 Confianza: ${((invoice.extraction_confidence || 0) * 100).toFixed(0)}%`;
    } else if (status === 'needs_review') {
      text = '⚠️ <b>Factura procesada — requiere revisión</b>\n\n';
      text += `📄 Factura #${invoice.invoice_number}\n`;
      text += `💰 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
      text += `\n🎯 Confianza: ${((invoice.extraction_confidence || 0) * 100).toFixed(0)}%\n`;
      text += '\nRevísala en el panel de TotalFactu.';
    }

    if (text) {
      if (messageId) {
        await editMessage(botToken, chatId, messageId, text);
      } else {
        await sendMessage(botToken, chatId, text);
      }
    }
  } catch (err) {
    console.error('[process] Telegram status update failed:', err);
  }
}
