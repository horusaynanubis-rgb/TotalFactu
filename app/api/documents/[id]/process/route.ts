import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/storage';
import { extractInvoiceData, InvoiceExtraction } from '@/lib/ai-extraction';
import { sendMessage, editMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Maps validated AI extraction to database fields.
 * This is the ONLY place extraction data enters the database.
 */
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

    // If retrying, delete the existing invoice first
    if (document.invoice) {
      await prisma.invoice.delete({ where: { id: document.invoice.id } });
    }

    // Mark as processing
    await prisma.document.update({
      where: { id: documentId },
      data: { processing_status: 'processing', confidence_score: null },
    });

    // Get file from S3
    const fileUrl = await getFileUrl(document.cloud_storage_path, document.is_public);
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from storage: ${fileResponse.statusText}`);
    }
    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBase64 = Buffer.from(fileBuffer).toString('base64');

    // Build AI provider config from company settings
    const aiConfig = {
      provider: (document.company?.ai_provider || 'external') as 'local' | 'external',
      apiKey: document.company?.ai_api_key,
      apiEndpoint: document.company?.ai_api_endpoint,
    };

    // AI Extraction: returns validated structured JSON, never touches DB
    const extraction = await extractInvoiceData(
      fileBase64,
      document.mime_type,
      document.original_filename,
      aiConfig
    );

    // Backend determines final status
    const processingStatus = extraction.needs_review ? 'needs_review' : 'completed';

    // Update document with AI results
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        processing_status: processingStatus,
        confidence_score: extraction.extraction_confidence,
      },
    });

    // Map validated extraction to DB schema and save invoice
    const invoiceData = mapExtractionToInvoice(extraction, documentId, document.company_id);
    const invoice = await prisma.invoice.create({ data: invoiceData });

    // Send Telegram notification if document came from Telegram
    const globalBotToken = process.env.TELEGRAM_BOT_TOKEN;
    if (document.telegram_chat_id && globalBotToken) {
      await sendTelegramStatusUpdate(
        globalBotToken,
        document.telegram_chat_id,
        document.telegram_message_id,
        processingStatus,
        invoice
      );
    }

    return NextResponse.json({
      document: updatedDocument,
      invoice,
    });
  } catch (error: any) {
    console.error('Process document error:', error);

    // Update document to failed status
    try {
      const doc = await prisma.document.update({
        where: { id: params.id },
        data: {
          processing_status: 'failed',
          confidence_score: 0,
        },
        include: { company: true },
      });

      // Notify via Telegram on failure
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (doc.telegram_chat_id && botToken) {
        const failText = '\u274c <b>Processing failed</b>\n\n' +
          `${error?.message || 'An unexpected error occurred'}\n\n` +
          'You can retry from the dashboard or upload the file again.';
        if (doc.telegram_message_id) {
          await editMessage(botToken, doc.telegram_chat_id, doc.telegram_message_id, failText);
        } else {
          await sendMessage(botToken, doc.telegram_chat_id, failText);
        }
      }
    } catch (updateError: any) {
      console.error('Failed to update document status:', updateError);
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
      text = '\u2705 <b>Invoice processed successfully!</b>\n\n';
      text += `\ud83d\udcc4 Invoice #${invoice.invoice_number}\n`;
      text += `\ud83c\udfe2 ${invoice.supplier_name}\n`;
      text += `\ud83d\udcb0 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
      text += `\ud83d\udcc5 ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString() : 'N/A'}\n`;
      text += `\n\ud83c\udfaf Confidence: ${((invoice.extraction_confidence || 0) * 100).toFixed(0)}%`;
    } else if (status === 'needs_review') {
      text = '\u26a0\ufe0f <b>Invoice processed \u2014 needs review</b>\n\n';
      text += `\ud83d\udcc4 Invoice #${invoice.invoice_number}\n`;
      text += `\ud83d\udcb0 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
      text += `\n\ud83c\udfaf Confidence: ${((invoice.extraction_confidence || 0) * 100).toFixed(0)}%\n`;
      text += '\nPlease review in the TotalFactu dashboard.';
    }

    if (text) {
      if (messageId) {
        await editMessage(botToken, chatId, messageId, text);
      } else {
        await sendMessage(botToken, chatId, text);
      }
    }
  } catch (err) {
    console.error('Telegram status update failed:', err);
  }
}
