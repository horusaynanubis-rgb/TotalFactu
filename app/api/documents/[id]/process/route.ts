import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchDocumentAsBase64 } from '@/lib/document-file';
import { extractInvoiceData, extractCashRegisterData, detectRoleAmbiguity, clarifyRolesWithGemini, InvoiceExtraction, CompanyContext } from '@/lib/ai-extraction';
import { classifyInvoiceType } from '@/lib/invoice-type-classifier';
import { sendMessage, editMessage } from '@/lib/telegram';
import { normalizeDescription } from '@/lib/supplier-analysis';
import { classifyInvoiceRate, IvaLineInput } from '@/lib/iva-classification';
import { computeFiscalStatus } from '@/lib/fiscal-status';

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
  let processingPhase = 'init';

  try {
    const documentId = params.id;

    processingPhase = 'db_load';
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { company: true, invoice: true, delivery_note: true, daily_cash_register: true },
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
    // Also clean up any DailyCashRegister created by a previous processing attempt for this document
    if (document.daily_cash_register) {
      await prisma.dailyCashRegister.delete({ where: { id: document.daily_cash_register.id } });
      console.log(`[CASH-CLOSEOUT] documentId=${documentId} Deleted stale DailyCashRegister id=${document.daily_cash_register.id} (retry cleanup)`);
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { processing_status: 'processing', confidence_score: null },
    });

    // Download file from Supabase Storage and convert to base64 for Gemini inline_data
    processingPhase = 'storage_download';
    console.log(`[process:diag] documentId=${documentId} source_channel=${document.source_channel} storagePath=${document.cloud_storage_path} stored_mimeType=${document.mime_type}`);
    const { fileBase64, effectiveMime } = await fetchDocumentAsBase64(document, 'process:diag');

    // Build AI provider config
    const companyProvider = document.company?.ai_provider;
    const hasExternalConfig =
      companyProvider === 'external' &&
      !!document.company?.ai_api_key &&
      !!document.company?.ai_api_endpoint;
    const hasLocalConfig = companyProvider === 'local';
    const resolvedProvider = hasExternalConfig ? 'external' : hasLocalConfig ? 'local' : 'gemini';
    const resolvedModel = resolvedProvider === 'gemini'
      ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17')
      : (process.env.OLLAMA_MODEL || 'qwen2.5:14b');

    // DIAG: log provider + model
    console.log(`[process:diag] provider=${resolvedProvider} model=${resolvedModel} company_ai_setting=${companyProvider ?? 'null'}`);

    const aiConfig = {
      provider: resolvedProvider as 'local' | 'external' | 'gemini',
      apiKey: document.company?.ai_api_key,
      apiEndpoint: document.company?.ai_api_endpoint,
    };

    // Fetch aliases early so they can be passed as company context to Gemini
    const companyAliases = await prisma.companyAlias.findMany({
      where: { company_id: document.company_id, active: true },
      select: { alias: true, alias_normalized: true, alias_type: true },
    });

    const companyContext: CompanyContext = {
      name: document.company.name,
      tax_id: document.company.tax_id,
      aliases: companyAliases.map(a => a.alias),
    };

    // ── Pre-screening: hint from Telegram caption keyword detection ───────────
    // If the webhook detected cash-register keywords in the caption, skip the
    // full invoice extraction and route directly to the cheaper cash-register path.
    // This avoids one heavy Gemini call AND ensures correct routing.
    const documentHint = new URL(request.url).searchParams.get('hint');
    console.log(`[TELEGRAM-DOC-TYPE] documentId=${documentId} hint=${documentHint ?? 'none'} source=${document.source_channel} mime=${effectiveMime}`);

    if (documentHint === 'cash_closeout') {
      processingPhase = 'cash_register';
      console.log(`[CASH-CLOSEOUT] documentId=${documentId} Hint-based routing — skipping invoice extraction`);
      const cashDataFromHint = await extractCashRegisterData(fileBase64, effectiveMime);
      return await handleCashRegisterResult(
        documentId, document.company_id, cashDataFromHint,
        /* fallbackTotal */ 0, prisma,
      );
    }

    // AI Extraction — returns validated structured JSON, never writes to DB
    processingPhase = 'ai_extract';
    const extraction = await extractInvoiceData(
      fileBase64,
      effectiveMime,
      document.original_filename,
      aiConfig,
      companyContext,
    );

    console.log(`[TELEGRAM-DOC-TYPE] documentId=${documentId} detected=${extraction.document_type} confidence=${extraction.extraction_confidence}`);
    console.log(`[process:roles] issuer="${extraction.issuer_name ?? 'n/a'}" recipient="${extraction.recipient_name ?? 'n/a'}" reasoning="${extraction.role_reasoning_summary ?? 'n/a'}"`);
    console.log(`[process:roles] supplier_name="${extraction.supplier_name}" customer_name="${extraction.customer_name}" invoice_type=${extraction.invoice_type}`);

    // ── CASH REGISTER path (Cierre TPV / Cierre Caja) ─────────────────────
    if (extraction.document_type === 'cash_register') {
      processingPhase = 'cash_register';
      console.log(`[CASH-CLOSEOUT] documentId=${documentId} First-pass detected cash_register — running specialized extraction`);

      // Second-pass specialized extraction for detailed TPV/cash fields
      const cashData = await extractCashRegisterData(fileBase64, effectiveMime);

      return await handleCashRegisterResult(
        documentId, document.company_id, cashData,
        extraction.total_amount, prisma,
      );
    }

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

    // ── Role ambiguity detection ───────────────────────────────────────────
    // Checks for cases where the AI confused issuer/recipient roles (e.g. BYOU
    // appearing in a "Cliente:" block but being extracted as supplier_name).
    const ambiguity = detectRoleAmbiguity(extraction, {
      name: document.company.name,
      tax_id: document.company.tax_id,
      aliases: companyAliases.map(a => a.alias),
    });

    if (ambiguity.isSuspicious) {
      console.warn(
        `[process:ambiguity] ⚠️ documentId=${document.id} filename="${document.original_filename}"`,
        `company="${document.company.name}" (${document.company.tax_id})`,
        `supplier_detected="${extraction.supplier_name}" customer_detected="${extraction.customer_name}"`,
        `issuer_field="${extraction.issuer_name ?? 'n/a'}" recipient_field="${extraction.recipient_name ?? 'n/a'}"`,
        `invoiceType=${extraction.invoice_type} reason="${ambiguity.reason}"`,
      );

      if (ambiguity.correctedSupplierName) {
        // Auto-correct using issuer/recipient audit fields from the first pass
        console.log(
          `[process:ambiguity] Auto-correcting: supplier="${ambiguity.correctedSupplierName}"`,
          `customer="${ambiguity.correctedCustomerName}" type=${ambiguity.correctedInvoiceType}`,
        );
        extraction.supplier_name = ambiguity.correctedSupplierName;
        extraction.customer_name = ambiguity.correctedCustomerName ?? extraction.customer_name;
        extraction.supplier_tax_id = ambiguity.correctedSupplierTaxId ?? extraction.supplier_tax_id;
        extraction.customer_tax_id = ambiguity.correctedCustomerTaxId ?? extraction.customer_tax_id;
        if (ambiguity.correctedInvoiceType) {
          extraction.invoice_type = ambiguity.correctedInvoiceType;
        }
      } else {
        // No correction possible from first pass — try second Gemini call
        console.log(`[process:ambiguity] No auto-correction available — attempting second-pass role clarification`);
        const clarification = await clarifyRolesWithGemini(fileBase64, effectiveMime, companyContext);
        if (clarification) {
          console.log(
            `[process:ambiguity] Second-pass result: issuer="${clarification.issuer_name}"`,
            `recipient="${clarification.recipient_name}" type=${clarification.invoice_type}`,
            `reasoning="${clarification.reasoning}"`,
          );
          if (clarification.issuer_name) {
            extraction.supplier_name = clarification.issuer_name;
            extraction.supplier_tax_id = clarification.issuer_tax_id ?? extraction.supplier_tax_id;
          }
          if (clarification.recipient_name) {
            extraction.customer_name = clarification.recipient_name;
            extraction.customer_tax_id = clarification.recipient_tax_id ?? extraction.customer_tax_id;
          }
          extraction.invoice_type = clarification.invoice_type;
          extraction.issuer_name = clarification.issuer_name;
          extraction.recipient_name = clarification.recipient_name;
        }
        // Force review regardless — human should confirm when we had to use second pass
        extraction.needs_review = true;
      }
    }

    // Post-process: verify invoice_type against company identity (AI can be wrong)
    const classification = classifyInvoiceType(extraction, {
      name: document.company.name,
      tax_id: document.company.tax_id,
      aliases: companyAliases,
    });

    // Confidence bonus when identity is confirmed via alias
    const ALIAS_CONFIDENCE_BONUS = 0.15;
    if (classification.matched_via_alias) {
      extraction.extraction_confidence = Math.min(
        extraction.extraction_confidence + ALIAS_CONFIDENCE_BONUS,
        0.95,
      );
      // Re-evaluate needs_review: if the only reason was low confidence, clear it
      if (extraction.extraction_confidence >= 0.7) {
        const hasStructuralIssues =
          !extraction.invoice_number ||
          !extraction.issue_date ||
          !extraction.supplier_name ||
          !extraction.customer_name ||
          extraction.total_amount <= 0;
        extraction.needs_review = hasStructuralIssues;
      }
      console.log(
        `[process] ✅ Alias match — confidence boosted to ${extraction.extraction_confidence.toFixed(2)}. Reason: ${classification.correction_reason}`,
      );
    }

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

    processingPhase = 'db_insert';
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

    // Fiscal VAT-classification status — independent of processing_status/
    // review_status above. Local-only (no AI call): reuses the same logic
    // lib/fiscal-summary.ts already runs at report time, just persisted now
    // so it's known at ingestion time instead of discovered at quarter-end.
    try {
      const linesForClassification: IvaLineInput[] = finalType === 'received'
        ? extraction.line_items.map((item) => ({ tax_rate: item.tax_rate, total_amount: item.total_amount }))
        : [];
      const classificationResult = classifyInvoiceRate(
        invoice.tax_rate,
        linesForClassification,
        invoice.subtotal,
        invoice.tax_amount,
      );
      const { fiscal_status, fiscal_status_reason } = computeFiscalStatus(classificationResult);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { fiscal_status, fiscal_status_reason },
      });
    } catch (fiscalStatusErr: any) {
      console.error('[process] fiscal_status classification error (non-fatal):', fiscalStatusErr?.message);
    }

    console.log(`[process] ✅ Invoice created. id=${invoice.id} type=${finalType} corrected=${classification.was_corrected} status=${processingStatus} confidence=${extraction.extraction_confidence}`);

    // Telegram notification is handled by the webhook caller
    return NextResponse.json({ document: updatedDocument, invoice });
  } catch (error: any) {
    const errorMessage: string = error?.message ?? 'Unknown error';

    console.error(
      '[process] ❌ FAILED',
      `documentId=${params.id}`,
      `phase=${processingPhase}`,
      `error=${errorMessage}`,
      '\nStack:', error?.stack,
    );

    try {
      const doc = await prisma.document.update({
        where: { id: params.id },
        data: { processing_status: 'failed', confidence_score: 0 },
        include: { company: true },
      });

      // Record structured error in AuditLog for post-mortem analysis
      await prisma.auditLog.create({
        data: {
          company_id: doc.company_id,
          user_id: null,
          entity_type: 'document',
          entity_id: params.id,
          action: 'process_error',
          new_values: JSON.stringify({
            phase: processingPhase,
            original_filename: doc.original_filename,
            source_channel: doc.source_channel,
            mime_type: doc.mime_type,
            storage_path: doc.cloud_storage_path,
            error_message: errorMessage.slice(0, 500),
            error_stack: error?.stack?.slice(0, 1000) ?? null,
          }),
        },
      }).catch((auditErr: any) => {
        console.error('[process] Failed to write AuditLog:', auditErr?.message);
      });

      // Determine user-friendly Telegram message based on phase and error type
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (doc.telegram_chat_id && botToken) {
        let msg: string;
        const isImage = doc.mime_type.startsWith('image/');

        if (processingPhase === 'storage_download' || errorMessage.includes('storage fetch failed')) {
          msg = '❌ <b>No se pudo subir el archivo</b>\n\nError al acceder al documento guardado. Inténtalo de nuevo.';
        } else if (processingPhase === 'cash_register') {
          if (errorMessage.includes('429') || errorMessage.includes('503') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('UNAVAILABLE')) {
            msg = '⏳ <b>Servicio de IA ocupado temporalmente</b>\n\nInténtalo de nuevo en unos minutos.';
          } else if (isImage) {
            msg = '⚠️ <b>No se pudo leer el cierre de caja</b>\n\nAsegúrate de enviar una foto clara del ticket de cierre, no una captura de pantalla de la aplicación TPV.\n\nPara importar datos del TPV, usa la función <b>Importar Excel TPV</b> en Caja y Cobros.';
          } else {
            msg = '❌ <b>Error al procesar el cierre de caja</b>\n\nInténtalo de nuevo o importa los datos manualmente desde Caja y Cobros.';
          }
        } else if (processingPhase === 'ai_extract') {
          if (errorMessage.includes('SAFETY') || errorMessage.includes('safety')) {
            msg = '⚠️ <b>Documento bloqueado</b>\n\nEl contenido fue bloqueado por los filtros de seguridad de la IA. Prueba con otro archivo.';
          } else if (errorMessage.includes('MAX_TOKENS') || errorMessage.includes('demasiadas líneas')) {
            msg = '⚠️ <b>Factura demasiado larga</b>\n\nLa factura tiene demasiadas líneas y no se pudo extraer completa.\n\nInténtalo desde el panel web o contacta con soporte.';
          } else if (errorMessage.includes('429') || errorMessage.includes('503') || errorMessage.includes('rate limit') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('UNAVAILABLE') || errorMessage.includes('high demand')) {
            msg = '⏳ <b>Servicio de IA ocupado temporalmente</b>\n\nEl servicio está bajo alta demanda. Inténtalo de nuevo en unos minutos.';
          } else if (errorMessage.includes('No content') || errorMessage.includes('not valid JSON') || errorMessage.includes('valid JSON')) {
            msg = isImage
              ? '⚠️ <b>No se pudo leer la factura</b>\n\nLa imagen no tiene suficiente calidad o resolución. Asegúrate de que el texto sea legible y vuelve a intentarlo como archivo si la enviaste como foto.'
              : '⚠️ <b>El documento no parece una factura</b>\n\nNo se encontraron datos de factura. Asegúrate de enviar una factura válida.';
          } else {
            msg = '❌ <b>Error extrayendo datos</b>\n\nLa IA no pudo procesar el archivo. Inténtalo de nuevo o sube la factura desde el panel web.';
          }
        } else if (processingPhase === 'db_insert') {
          msg = '⚠️ <b>Error al guardar la factura</b>\n\nLos datos se extrajeron pero no se pudieron guardar. Inténtalo de nuevo.';
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
      { message: `Processing failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// ── Cash Register result handler ───────────────────────────────────────────
// Shared logic for both hint-based and first-pass-detected cash register processing.
// Handles: low confidence (screenshot), date conflict, successful creation.
async function handleCashRegisterResult(
  documentId: string,
  companyId: string,
  cashData: import('@/lib/ai-extraction').CashRegisterExtraction | null,
  fallbackTotal: number,
  db: typeof prisma,
): Promise<NextResponse> {
  const confidence = cashData?.extraction_confidence ?? 0;
  const dateStr = cashData?.date ?? new Date().toISOString().split('T')[0];
  const dateObj = new Date(dateStr);

  const cashAmount     = cashData?.cash_amount     ?? 0;
  const cardAmount     = cashData?.card_amount     ?? fallbackTotal;
  const bizumAmount    = cashData?.bizum_amount    ?? 0;
  const transferAmount = cashData?.transfer_amount ?? 0;
  const otherAmount    = cashData?.other_amount    ?? 0;
  const totalAmount    = cashData?.total_amount    ?? (cashAmount + cardAmount + bizumAmount + transferAmount + otherAmount);

  const aiRawData = cashData ? JSON.stringify({
    time:            cashData.time,
    business_name:   cashData.business_name,
    terminal_id:     cashData.terminal_id,
    batch_number:    cashData.batch_number,
    operation_count: cashData.operation_count,
  }) : null;

  // ① Low confidence → likely a web screenshot or unreadable image
  if (!cashData || confidence < 0.25) {
    console.log(`[CASH-CLOSEOUT] documentId=${documentId} confidence=${confidence} — possible screenshot or unreadable — rejecting`);
    const failedDoc = await db.document.update({
      where: { id: documentId },
      data: { processing_status: 'failed', confidence_score: confidence },
    });
    return NextResponse.json({
      document: failedDoc,
      cash_register: { is_screenshot: true, extraction_confidence: confidence },
    });
  }

  // ② Check for existing register for this date (ANY status, ANY source)
  const existingByDate = await db.dailyCashRegister.findFirst({
    where: { company_id: companyId, date: dateObj },
  });

  const updatedDocument = await db.document.update({
    where: { id: documentId },
    data: { processing_status: 'completed', confidence_score: confidence },
  });

  if (existingByDate) {
    // Date conflict — preserve the existing register, do NOT overwrite
    console.log(`[CASH-CLOSEOUT] documentId=${documentId} DATE CONFLICT — existing id=${existingByDate.id} source=${existingByDate.source} status=${existingByDate.status} date=${dateStr}`);
    return NextResponse.json({
      document: updatedDocument,
      cash_register: {
        has_conflict:    true,
        conflict_source: existingByDate.source,
        date:            dateStr,
        cash_amount:     cashAmount,
        card_amount:     cardAmount,
        bizum_amount:    bizumAmount,
        transfer_amount: transferAmount,
        other_amount:    otherAmount,
        total_amount:    totalAmount,
        notes:           cashData.notes,
        business_name:   cashData.business_name,
        terminal_id:     cashData.terminal_id,
      },
    });
  }

  // ③ No conflict — create pending register
  const register = await db.dailyCashRegister.create({
    data: {
      company_id:      companyId,
      date:            dateObj,
      cash_amount:     cashAmount,
      card_amount:     cardAmount,
      bizum_amount:    bizumAmount,
      transfer_amount: transferAmount,
      other_amount:    otherAmount,
      total_amount:    totalAmount,
      notes:           cashData.notes ?? null,
      source:          'ai',
      status:          'pending_review',
      document_id:     documentId,
      ai_raw_data:     aiRawData,
    },
  });

  console.log(`[CASH-CLOSEOUT] documentId=${documentId} ✅ DailyCashRegister created id=${register.id} date=${dateStr} total=${totalAmount} confidence=${confidence}`);

  return NextResponse.json({
    document: updatedDocument,
    cash_register: {
      id:              register.id,
      date:            dateStr,
      cash_amount:     cashAmount,
      card_amount:     cardAmount,
      bizum_amount:    bizumAmount,
      transfer_amount: transferAmount,
      other_amount:    otherAmount,
      total_amount:    totalAmount,
      notes:           cashData.notes,
      business_name:   cashData.business_name,
      terminal_id:     cashData.terminal_id,
      has_conflict:    false,
      is_screenshot:   false,
    },
  });
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
