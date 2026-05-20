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
      include: { company: true, invoice: true, delivery_note: true },
    });

    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    // If retrying, delete existing records first
    if (document.invoice) {
      await prisma.invoice.delete({ where: { id: document.invoice.id } });
    }
    if (document.delivery_note) {
      await prisma.deliveryNote.delete({ where: { id: document.delivery_note.id } });
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

    // Build AI provider config
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

    console.log(`[process] document_type=${extraction.document_type} confidence=${extraction.extraction_confidence}`);

    // ── DELIVERY NOTE path ─────────────────────────────────────────────────
    if (extraction.document_type === 'delivery_note') {
      const needsReview = extraction.needs_review || extraction.extraction_confidence < 0.6;
      const processingStatus = needsReview ? 'needs_review' : 'completed';

      const updatedDocument = await prisma.document.update({
        where: { id: documentId },
        data: { processing_status: processingStatus, confidence_score: extraction.extraction_confidence },
      });

      const deliveryNote = await prisma.deliveryNote.create({
        data: {
          company_id: document.company_id,
          document_id: documentId,
          supplier_name: extraction.supplier_name || 'Proveedor desconocido',
          supplier_tax_id: extraction.supplier_tax_id,
          delivery_note_number: extraction.delivery_note_number || extraction.invoice_number || 'DESCONOCIDO',
          issue_date: extraction.issue_date ? new Date(extraction.issue_date) : null,
          total_amount: extraction.total_amount > 0 ? extraction.total_amount : null,
          currency: extraction.currency || null,
          notes: extraction.notes,
          extraction_confidence: extraction.extraction_confidence,
          status: 'pending',
        },
      });

      await prisma.auditLog.create({
        data: {
          company_id: document.company_id,
          user_id: null,
          entity_type: 'delivery_note',
          entity_id: deliveryNote.id,
          action: 'create',
          new_values: JSON.stringify({ source: 'ai_extraction', document_type: 'delivery_note' }),
        },
      });

      // Try to auto-match with a pending invoice from the same supplier
      await tryAutoMatch(deliveryNote, document.company_id);

      console.log(`[process] ✅ DeliveryNote created. id=${deliveryNote.id} status=${processingStatus}`);
      return NextResponse.json({ document: updatedDocument, delivery_note: deliveryNote });
    }

    // ── INVOICE path (also handles 'unknown' with forced needs_review) ──────
    if (extraction.document_type === 'unknown') {
      extraction.needs_review = true;
    }

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

    // When an invoice arrives, check if it matches any pending delivery notes
    await tryMatchInvoiceToDeliveryNotes(invoice, document.company_id);

    // Supplier tracking + line items (received invoices only, non-fatal)
    if (finalType === 'received') {
      try {
        const supplierId = await findOrCreateSupplier(
          document.company_id,
          extraction.supplier_name || invoice.supplier_name,
          extraction.supplier_tax_id,
        );
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { supplier_id: supplierId },
        });
        if (extraction.line_items.length > 0) {
          await prisma.invoiceLine.createMany({
            data: extraction.line_items.map((item) => ({
              company_id: document.company_id,
              invoice_id: invoice.id,
              supplier_id: supplierId,
              description: item.description,
              normalized_description: normalizeDescription(item.description),
              quantity: item.quantity,
              unit_price: item.unit_price,
              tax_rate: item.tax_rate,
              total_amount: item.total_amount,
              currency: extraction.currency || 'EUR',
            })),
          });
          console.log(`[process] ${extraction.line_items.length} line_items saved for invoice ${invoice.id}`);
        }
      } catch (supplierErr: any) {
        console.error('[process] Supplier/line_items error (non-fatal):', supplierErr?.message);
      }
    }

    console.log(`[process] ✅ Invoice created. id=${invoice.id} type=${finalType} corrected=${classification.was_corrected} status=${processingStatus} confidence=${extraction.extraction_confidence}`);

    // Telegram notification is handled by the webhook caller
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

// Attempt to auto-match a newly created delivery note with existing pending invoices
async function tryAutoMatch(deliveryNote: any, companyId: string) {
  try {
    if (!deliveryNote.supplier_name) return;

    const candidates = await prisma.invoice.findMany({
      where: {
        company_id: companyId,
        invoice_type: 'received',
        matched_delivery_notes: { none: {} },
        issue_date: deliveryNote.issue_date
          ? { gte: deliveryNote.issue_date }
          : undefined,
      },
      orderBy: { issue_date: 'asc' },
      take: 10,
    });

    for (const inv of candidates) {
      if (isLikelyMatch(deliveryNote, inv)) {
        await prisma.deliveryNote.update({
          where: { id: deliveryNote.id },
          data: { status: 'matched', matched_invoice_id: inv.id },
        });
        console.log(`[process] Auto-matched delivery_note=${deliveryNote.id} → invoice=${inv.id}`);
        return;
      }
    }
  } catch (err) {
    console.error('[process] tryAutoMatch error:', err);
  }
}

// When a new invoice arrives, check pending delivery notes from same supplier
async function tryMatchInvoiceToDeliveryNotes(invoice: any, companyId: string) {
  try {
    if (!invoice.supplier_name || invoice.invoice_type !== 'received') return;

    const pending = await prisma.deliveryNote.findMany({
      where: { company_id: companyId, status: 'pending' },
      orderBy: { issue_date: 'asc' },
      take: 20,
    });

    for (const dn of pending) {
      if (isLikelyMatch(dn, invoice)) {
        await prisma.deliveryNote.update({
          where: { id: dn.id },
          data: { status: 'matched', matched_invoice_id: invoice.id },
        });
        console.log(`[process] Auto-matched delivery_note=${dn.id} → invoice=${invoice.id}`);
      }
    }
  } catch (err) {
    console.error('[process] tryMatchInvoiceToDeliveryNotes error:', err);
  }
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?l\.?u?|s\.?a\.?|s\.?l\.?|ltd|gmbh|inc|srl|sl|sa)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyMatch(dn: any, inv: any): boolean {
  // Tax ID exact match — strongest signal
  if (dn.supplier_tax_id && inv.supplier_tax_id) {
    const dnTax = dn.supplier_tax_id.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const invTax = inv.supplier_tax_id.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (dnTax === invTax) return true;
  }

  // Supplier name similarity
  const dnName = normalizeName(dn.supplier_name || '');
  const invName = normalizeName(inv.supplier_name || '');
  if (dnName.length >= 5 && invName.length >= 5) {
    if (dnName.includes(invName) || invName.includes(dnName)) {
      // Amount similarity (within 5%) or no amount on delivery note
      if (!dn.total_amount) return true;
      const diff = Math.abs((dn.total_amount - inv.total_amount) / (inv.total_amount || 1));
      if (diff < 0.05) return true;
    }
  }

  return false;
}

function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function findOrCreateSupplier(
  companyId: string,
  supplierName: string,
  supplierTaxId: string | null,
): Promise<string> {
  const nameNormalized = normalizeName(supplierName);

  if (supplierTaxId) {
    const existing = await prisma.supplier.findFirst({
      where: { company_id: companyId, tax_id: supplierTaxId },
    });
    if (existing) {
      if (existing.name !== supplierName) {
        await prisma.supplier.update({
          where: { id: existing.id },
          data: { name: supplierName, name_normalized: nameNormalized },
        });
      }
      return existing.id;
    }
    const created = await prisma.supplier.create({
      data: { company_id: companyId, name: supplierName, name_normalized: nameNormalized, tax_id: supplierTaxId },
    });
    return created.id;
  }

  // No tax_id — find by normalized name
  const existing = await prisma.supplier.findFirst({
    where: { company_id: companyId, name_normalized: nameNormalized },
  });
  if (existing) return existing.id;

  const created = await prisma.supplier.create({
    data: { company_id: companyId, name: supplierName, name_normalized: nameNormalized },
  });
  return created.id;
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
