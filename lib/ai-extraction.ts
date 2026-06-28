// AI Invoice Extraction Service
// Supports local Ollama and external OpenAI-compatible APIs
// The AI module is purely responsible for extraction — never writes to DB

export interface InvoiceLineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  tax_rate: number | null;
  total_amount: number | null;
}

// ─── Cash Register (Cierre TPV / Cierre Caja) ────────────────────────────────

export interface CashRegisterExtraction {
  date: string;               // YYYY-MM-DD — date of the closure
  time: string | null;        // HH:MM or null
  business_name: string | null;
  terminal_id: string | null; // TPV terminal number
  batch_number: string | null;
  operation_count: number | null;
  cash_amount: number;
  card_amount: number;        // TPV/card payments
  bizum_amount: number;
  transfer_amount: number;
  other_amount: number;
  total_amount: number;
  notes: string | null;
  extraction_confidence: number;
}

export interface InvoiceExtraction {
  document_type: 'invoice' | 'delivery_note' | 'cash_register' | 'unknown';
  delivery_note_number: string | null;
  invoice_type: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  supplier_name: string;
  supplier_tax_id: string | null;
  customer_name: string;
  customer_tax_id: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  tax_rate: number | null;
  payment_method: string | null;
  category: string | null;
  notes: string | null;
  extraction_confidence: number;
  needs_review: boolean;
  line_items: InvoiceLineItem[];
  // Internal audit fields — logged during processing, not persisted to DB
  issuer_name: string | null;
  issuer_tax_id: string | null;
  recipient_name: string | null;
  recipient_tax_id: string | null;
  role_reasoning_summary: string | null;
}

export interface AIProviderConfig {
  provider: 'local' | 'external' | 'gemini';
  apiKey?: string | null;
  apiEndpoint?: string | null;
}

/** Company identity passed to Gemini as context for role determination */
export interface CompanyContext {
  name: string;
  tax_id: string;
  aliases?: string[]; // readable alias values (e.g. ["BYOU", "Cafetería BYOU"])
}

// ---------------------------------------------------------------------------
// Prompt builder — injects company context when available
// ---------------------------------------------------------------------------

function buildExtractionPrompt(ctx?: CompanyContext): string {
  const contextBlock = ctx
    ? `
ACCOUNT OWNER CONTEXT — use this to determine invoice roles:
  Legal name: ${ctx.name}
  Tax ID (CIF/NIF): ${ctx.tax_id}${ctx.aliases && ctx.aliases.length > 0 ? `
  Known aliases: ${ctx.aliases.join(', ')}` : ''}

  - If the account owner appears as RECIPIENT/CUSTOMER → invoice_type = "received"
  - If the account owner appears as ISSUER/SUPPLIER → invoice_type = "issued"
  - Tax ID match takes priority over name match.
`
    : '';

  return `You are a document data extraction system. Extract structured data from this document.
Support multilingual documents (Spanish, English, French, German, Italian, Portuguese).
${contextBlock}
ROLE IDENTIFICATION RULES — apply these carefully before setting supplier_name and customer_name:

1. ISSUER/SUPPLIER (emisor/proveedor) is the company that:
   - Appears in the document HEADER with its logo, full address, phone, web, and fiscal registration data
   - Is listed near fields like "Razón Social:", "Emisor:", "Proveedor:", "CIF/NIF:" in the header section
   - Is NOT inside any labeled block such as "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Dirección de entrega"

2. RECIPIENT/CUSTOMER (receptor/cliente) is the company that:
   - Appears inside a block explicitly labeled: "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Dirección de envío"
   - Even if the same name appears elsewhere, a name INSIDE a "Cliente:" or "Centro:" block is ALWAYS the recipient

3. CRITICAL: A company name inside a "Cliente:", "Centro:", or "Destinatario:" block is NEVER the issuer/supplier, even if it appears multiple times elsewhere in the document.

4. If a company has a prominent header position with logo/web/phone/address, that company is the issuer regardless of other mentions.

5. supplier_name must be the ISSUER (header company). customer_name must be the RECIPIENT (Cliente/Centro block).

Rules:
- Do NOT hallucinate or invent values. If a field is not found, use null or empty string.
- Dates must be in YYYY-MM-DD format when possible. If only partial date is found, normalize it.
- All monetary amounts must be numbers (not strings).
- document_type: "invoice" if it is a tax invoice (factura), "delivery_note" if it is a delivery note / albaran / albarán / bon de livraison / Lieferschein (NOT a fiscal document), "cash_register" if it is a daily TPV/cash closure report (cierre de caja, cierre TPV, informe de lote, Z-report, X-report, batch report, liquidación del día, resumen de ventas del día), "unknown" if unclear.
- delivery_note_number: the delivery note number if document_type is "delivery_note", otherwise null.
- invoice_type: "received" if this is an invoice received from a supplier, "issued" if sent to a customer. Use "received" for delivery_note documents.
- extraction_confidence: a number between 0 and 1 indicating overall extraction quality.
- needs_review: true if confidence < 0.7 or if critical fields are missing.
- issuer_name: the exact company name found in the document header/logo area (emisor real del documento)
- issuer_tax_id: tax ID (CIF/NIF) of the issuer, or null
- recipient_name: the exact company name found inside a Cliente/Centro/Destinatario block (receptor real)
- recipient_tax_id: tax ID (CIF/NIF) of the recipient, or null
- role_reasoning_summary: one sentence explaining how you identified the issuer vs recipient

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure:
{
  "document_type": "invoice" or "delivery_note" or "cash_register" or "unknown",
  "delivery_note_number": null,
  "invoice_type": "received" or "issued",
  "invoice_number": "string or empty",
  "issue_date": "YYYY-MM-DD or empty",
  "due_date": "YYYY-MM-DD or null",
  "supplier_name": "ISSUER company name (from header/logo area — NOT from Cliente block)",
  "supplier_tax_id": "string or null",
  "customer_name": "RECIPIENT company name (from Cliente/Centro/Destinatario block)",
  "customer_tax_id": "string or null",
  "subtotal": 0.00,
  "tax_amount": 0.00,
  "total_amount": 0.00,
  "currency": "EUR",
  "tax_rate": null,
  "payment_method": null,
  "category": null,
  "notes": null,
  "extraction_confidence": 0.95,
  "needs_review": false,
  "issuer_name": "company name found in document header/logo area",
  "issuer_tax_id": null,
  "recipient_name": "company name found in Cliente/Centro/Destinatario block",
  "recipient_tax_id": null,
  "role_reasoning_summary": "brief explanation of how issuer vs recipient was determined",
  "line_items": [
    {
      "description": "Product or service name as shown on the document",
      "quantity": 1.0,
      "unit_price": 9.99,
      "tax_rate": 21.0,
      "total_amount": 12.09
    }
  ]
}

Rules for line_items:
- Extract every line from the invoice (products, services, fees).
- If no individual lines are visible, return "line_items": [].
- Do NOT invent or estimate lines. Only include what is explicitly shown.
- quantity, unit_price, tax_rate, total_amount can be null if not visible for a line.
- description must be non-empty for each item.`;
}

// ---------------------------------------------------------------------------
// Role ambiguity detection
// ---------------------------------------------------------------------------

export interface RoleAmbiguityResult {
  isSuspicious: boolean;
  reason: string | null;
  correctedSupplierName: string | null;
  correctedCustomerName: string | null;
  correctedSupplierTaxId: string | null;
  correctedCustomerTaxId: string | null;
  correctedInvoiceType: 'received' | 'issued' | null;
}

const LEGAL_SUFFIXES_RE =
  /[\s,]+(s\.?l\.?u?\.?|s\.?a\.?u?\.?|s\.?l\.?|ltd\.?|limited|inc\.?|llc\.?|gmbh|b\.?v\.?|n\.?v\.?|a\.?s\.?)\s*$/i;

function normForCmp(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(LEGAL_SUFFIXES_RE, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normTaxId(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[\s.\-]/g, '').toUpperCase();
}

function nameContains(haystack: string, needle: string): boolean {
  if (!haystack || !needle || needle.length < 3) return false;
  return haystack.includes(needle);
}

function namesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.includes(shorter);
}

function matchesCompany(
  name: string,
  taxId: string,
  company: { nameNorm: string; taxId: string; aliasNorms: string[] },
): boolean {
  if (company.taxId && taxId && company.taxId === taxId) return true;
  if (company.nameNorm && namesOverlap(company.nameNorm, name)) return true;
  if (company.aliasNorms.some(a => a.length >= 3 && nameContains(name, a))) return true;
  return false;
}

/**
 * Detects when the AI may have confused issuer and recipient roles.
 * Returns suggested corrections when possible (using issuer_name/recipient_name audit fields).
 */
export function detectRoleAmbiguity(
  extraction: InvoiceExtraction,
  company: { name: string; tax_id: string; aliases?: string[] },
): RoleAmbiguityResult {
  const noAmbiguity: RoleAmbiguityResult = {
    isSuspicious: false,
    reason: null,
    correctedSupplierName: null,
    correctedCustomerName: null,
    correctedSupplierTaxId: null,
    correctedCustomerTaxId: null,
    correctedInvoiceType: null,
  };

  const cmp = {
    nameNorm: normForCmp(company.name),
    taxId: normTaxId(company.tax_id),
    aliasNorms: (company.aliases ?? []).map(normForCmp),
  };

  const supplierNorm = normForCmp(extraction.supplier_name);
  const customerNorm = normForCmp(extraction.customer_name);
  const supplierTaxId = normTaxId(extraction.supplier_tax_id);
  const customerTaxId = normTaxId(extraction.customer_tax_id);

  const companyIsSupplier = matchesCompany(supplierNorm, supplierTaxId, cmp);
  const companyIsCustomer = matchesCompany(customerNorm, customerTaxId, cmp);

  // Case 1: same tax_id on both sides → clear data error
  if (supplierTaxId && customerTaxId && supplierTaxId === customerTaxId) {
    return {
      isSuspicious: true,
      reason: `supplier_tax_id equals customer_tax_id (${supplierTaxId}): same entity on both sides`,
      correctedSupplierName: null,
      correctedCustomerName: null,
      correctedSupplierTaxId: null,
      correctedCustomerTaxId: null,
      correctedInvoiceType: null,
    };
  }

  // Case 2: supplier == customer (normalized) → likely a duplicate extraction error
  if (supplierNorm && customerNorm && supplierNorm === customerNorm) {
    return {
      isSuspicious: true,
      reason: `supplier_name equals customer_name: "${extraction.supplier_name}"`,
      correctedSupplierName: null,
      correctedCustomerName: null,
      correctedSupplierTaxId: null,
      correctedCustomerTaxId: null,
      correctedInvoiceType: null,
    };
  }

  // Case 3: company appears as supplier — use issuer/recipient fields to check correctness
  if (companyIsSupplier) {
    const issuerNorm = normForCmp(extraction.issuer_name);
    const issuerTaxId = normTaxId(extraction.issuer_tax_id);
    const issuerMatchesCompany = issuerNorm
      ? matchesCompany(issuerNorm, issuerTaxId, cmp)
      : true; // no issuer field → trust existing

    if (!issuerMatchesCompany && issuerNorm.length >= 3) {
      // issuer_name field says the REAL issuer is someone else → role was swapped
      const suggestedType = 'received';
      return {
        isSuspicious: true,
        reason: `supplier_name matches account owner but issuer_name="${extraction.issuer_name}" is different → likely received invoice`,
        correctedSupplierName: extraction.issuer_name,
        correctedCustomerName: extraction.recipient_name || extraction.customer_name || company.name,
        correctedSupplierTaxId: extraction.issuer_tax_id,
        correctedCustomerTaxId: extraction.recipient_tax_id || extraction.customer_tax_id,
        correctedInvoiceType: suggestedType,
      };
    }

    // If company is supplier AND also customer (both sides confused)
    if (companyIsCustomer) {
      if (extraction.issuer_name && extraction.recipient_name) {
        const issNorm = normForCmp(extraction.issuer_name);
        const issMatchesOwner = matchesCompany(issNorm, normTaxId(extraction.issuer_tax_id), cmp);
        return {
          isSuspicious: true,
          reason: `Both supplier and customer match account owner. Using issuer/recipient fields for correction.`,
          correctedSupplierName: extraction.issuer_name,
          correctedCustomerName: extraction.recipient_name,
          correctedSupplierTaxId: extraction.issuer_tax_id,
          correctedCustomerTaxId: extraction.recipient_tax_id,
          correctedInvoiceType: issMatchesOwner ? 'issued' : 'received',
        };
      }
      return {
        isSuspicious: true,
        reason: 'Emisor y receptor ambiguos: ambos parecen ser la empresa propietaria',
        correctedSupplierName: null,
        correctedCustomerName: null,
        correctedSupplierTaxId: null,
        correctedCustomerTaxId: null,
        correctedInvoiceType: null,
      };
    }
  }

  return noAmbiguity;
}

// ---------------------------------------------------------------------------
// Second-pass: lightweight role clarification call
// ---------------------------------------------------------------------------

export interface RoleClarification {
  issuer_name: string | null;
  issuer_tax_id: string | null;
  recipient_name: string | null;
  recipient_tax_id: string | null;
  invoice_type: 'received' | 'issued';
  reasoning: string | null;
}

/**
 * Makes a lightweight second Gemini call to clarify issuer/recipient roles.
 * Only called when the first-pass extraction shows suspicious role data AND
 * issuer_name/recipient_name fields were not populated in the first pass.
 * Returns null on any error (best-effort, non-fatal).
 */
export async function clarifyRolesWithGemini(
  fileBase64: string,
  mimeType: string,
  companyContext?: CompanyContext,
): Promise<RoleClarification | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contextLine = companyContext
    ? `Account owner: ${companyContext.name} (${companyContext.tax_id})${companyContext.aliases?.length ? `, aliases: ${companyContext.aliases.join(', ')}` : ''}. If account owner is RECIPIENT → invoice_type="received". If account owner is ISSUER → invoice_type="issued".`
    : '';

  const prompt = `Look at this invoice document. Answer ONLY these role questions as JSON.

RULES:
- ISSUER = company in document header/logo area (their letterhead, address, phone, logo at top)
- RECIPIENT = company in a block labeled "Cliente:", "Centro:", "Destinatario:", "Facturar a:"
- A name INSIDE a "Cliente:" or "Centro:" labeled block is ALWAYS the recipient, never the issuer
${contextLine ? `- ${contextLine}` : ''}

Respond with raw JSON only (no markdown):
{
  "issuer_name": "exact company name from document header/logo (emisor)",
  "issuer_tax_id": "CIF/NIF of issuer or null",
  "recipient_name": "exact company name from Cliente/Centro block (receptor)",
  "recipient_tax_id": "CIF/NIF of recipient or null",
  "invoice_type": "received or issued",
  "reasoning": "one sentence"
}`;

  try {
    const body = {
      contents: [{ parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512 },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(`[gemini:clarify] HTTP ${response.status} — skipping second pass`);
      return null;
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const invoiceType = parsed.invoice_type === 'issued' ? 'issued' : 'received';
    return {
      issuer_name: parsed.issuer_name ?? null,
      issuer_tax_id: parsed.issuer_tax_id ?? null,
      recipient_name: parsed.recipient_name ?? null,
      recipient_tax_id: parsed.recipient_tax_id ?? null,
      invoice_type: invoiceType,
      reasoning: parsed.reasoning ?? null,
    };
  } catch (err: any) {
    console.error('[gemini:clarify] Second-pass role clarification failed:', err?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider helpers (unchanged)
// ---------------------------------------------------------------------------

function isGeminiProvider(config?: AIProviderConfig): boolean {
  const forceLocal = process.env.FORCE_LOCAL_AI === 'true' || process.env.AI_FORCE_LOCAL === '1';
  if (forceLocal) return false;
  if (config?.provider === 'gemini') return true;
  if (config?.provider === 'local' || config?.provider === 'external') return false;
  return !!process.env.GEMINI_API_KEY;
}

function getProviderConfig(config?: AIProviderConfig): { apiUrl: string; apiKey: string; model: string } {
  const forceLocal = process.env.FORCE_LOCAL_AI === 'true' || process.env.AI_FORCE_LOCAL === '1';
  if (forceLocal) {
    const base = (process.env.OLLAMA_BASE_URL || 'http://10.6.0.5:11434/v1').replace(/\/$/, '');
    return {
      apiUrl: base + '/chat/completions',
      apiKey: process.env.OLLAMA_API_KEY || 'ollama',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
    };
  }

  if (config?.provider === 'external' && config.apiKey && config.apiEndpoint) {
    return {
      apiUrl: config.apiEndpoint.replace(/\/$/, '') + '/chat/completions',
      apiKey: config.apiKey,
      model: process.env.EXTERNAL_AI_MODEL || 'qwen2.5:14b',
    };
  }

  const base = (process.env.OLLAMA_BASE_URL || 'http://10.6.0.5:11434/v1').replace(/\/$/, '');
  return {
    apiUrl: base + '/chat/completions',
    apiKey: process.env.OLLAMA_API_KEY || 'ollama',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  };
}

// Retry configuration for transient Gemini errors (429 / 503 / UNAVAILABLE)
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_DELAYS_MS = [1000, 3000];

function isGeminiRetriableError(status: number, body: string): boolean {
  if (status === 429 || status === 503) return true;
  if (body.includes('UNAVAILABLE') || body.includes('high demand') || body.includes('RESOURCE_EXHAUSTED')) return true;
  return false;
}

async function extractWithGemini(
  fileBase64: string,
  mimeType: string,
  companyContext?: CompanyContext,
): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxOutputTokens = 32000;

  const fileSizeKb = Math.round((fileBase64.length * 3) / 4 / 1024);
  console.log(`[gemini:diag] provider=gemini model=${model} mimeType=${mimeType} base64Length=${fileBase64.length} estimatedSizeKb=${fileSizeKb} maxOutputTokens=${maxOutputTokens} hasCompanyCtx=${!!companyContext}`);

  const prompt = buildExtractionPrompt(companyContext);

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: fileBase64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens,
    },
  };

  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const delayMs = GEMINI_RETRY_DELAYS_MS[attempt - 2] ?? 3000;
      console.log(`[gemini:retry] attempt=${attempt}/${GEMINI_MAX_RETRIES} waiting ${delayMs}ms before retry`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[gemini] HTTP ${response.status} attempt=${attempt}/${GEMINI_MAX_RETRIES} error body (truncated):`, errorText.slice(0, 500));

      const retriable = isGeminiRetriableError(response.status, errorText);
      lastError = new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 300)}`);

      if (retriable && attempt < GEMINI_MAX_RETRIES) {
        continue;
      }
      throw lastError;
    }

    const data = await response.json();
    const finishReason: string = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
    const usageMetadata = data?.usageMetadata ?? null;
    console.log(`[gemini:diag] candidates=${data?.candidates?.length} finishReason=${finishReason} usage=${JSON.stringify(usageMetadata)}`);

    if (finishReason === 'MAX_TOKENS') {
      const inputTokens = usageMetadata?.promptTokenCount ?? 'unknown';
      const outputTokens = usageMetadata?.candidatesTokenCount ?? 'unknown';
      console.error(
        `[gemini:diag] ⚠️ finishReason=MAX_TOKENS — output truncated`,
        `model=${model}`,
        `maxOutputTokens=${maxOutputTokens}`,
        `mimeType=${mimeType}`,
        `inputTokens=${inputTokens}`,
        `outputTokens=${outputTokens}`,
      );
      throw new Error('Gemini:MAX_TOKENS: La factura tiene demasiadas líneas para el límite actual de extracción.');
    }

    if (finishReason === 'SAFETY') {
      console.error('[gemini:diag] Response blocked by SAFETY filter');
      throw new Error('Gemini API error (SAFETY): response blocked by content safety filters');
    }
    if (finishReason === 'RECITATION') {
      console.error('[gemini:diag] Response blocked by RECITATION filter');
      throw new Error('Gemini API error (RECITATION): response blocked due to recitation');
    }

    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`[gemini:diag] response_first_500: ${String(content ?? '').slice(0, 500)}`);

    if (!content) {
      console.error('[gemini:diag] No content in response. finishReason:', finishReason, 'Full data:', JSON.stringify(data).slice(0, 500));
      throw new Error(`No content in Gemini response (finishReason=${finishReason})`);
    }

    const hasMarkdownFence = content.includes('```');
    if (hasMarkdownFence) {
      console.warn('[gemini:diag] ⚠️ Response contains markdown fences — responseMimeType ignored by model');
    }

    let rawJson: any;
    try {
      rawJson = JSON.parse(content);
    } catch (parseErr) {
      console.error(`[gemini:diag] JSON parse FAILED finishReason=${finishReason} hasMarkdown=${hasMarkdownFence} content_first_500: ${content.slice(0, 500)}`);
      throw new Error('Gemini response is not valid JSON');
    }

    return validateExtraction(rawJson);
  }

  throw lastError;
}

/**
 * Validates and sanitizes the raw AI extraction output.
 * Ensures all required fields have correct types and applies business rules.
 * This function NEVER touches the database.
 */
export function validateExtraction(raw: any): InvoiceExtraction {
  const safeString = (v: any, fallback = ''): string => {
    if (v === null || v === undefined) return fallback;
    return String(v).trim();
  };

  const safeNumber = (v: any, fallback = 0): number => {
    if (v === null || v === undefined) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };

  const safeNullString = (v: any): string | null => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    return String(v).trim();
  };

  const normalizeDate = (v: any): string => {
    if (!v) return '';
    const s = String(v).trim();
    // Return ISO format as-is — no Date parsing needed, avoids UTC-offset issues
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      // Use local date parts so UTC-offset doesn't shift the day (e.g. UTC+2 "June 15 00:00" → "June 14" in UTC)
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return '';
  };

  const rawDocType = safeString(raw.document_type);
  const documentType: 'invoice' | 'delivery_note' | 'cash_register' | 'unknown' =
    ['invoice', 'delivery_note', 'cash_register', 'unknown'].includes(rawDocType)
      ? (rawDocType as 'invoice' | 'delivery_note' | 'cash_register' | 'unknown')
      : 'invoice';

  const invoiceType = ['received', 'issued'].includes(safeString(raw.invoice_type))
    ? safeString(raw.invoice_type)
    : 'received';

  const rawLineItems: any[] = Array.isArray(raw.line_items) ? raw.line_items : [];
  const line_items: InvoiceLineItem[] = rawLineItems
    .filter((item: any) => item && typeof item.description === 'string' && item.description.trim())
    .map((item: any) => ({
      description: safeString(item.description),
      quantity: item.quantity !== null && item.quantity !== undefined ? safeNumber(item.quantity) : null,
      unit_price: item.unit_price !== null && item.unit_price !== undefined ? safeNumber(item.unit_price) : null,
      tax_rate: item.tax_rate !== null && item.tax_rate !== undefined ? safeNumber(item.tax_rate) : null,
      total_amount: item.total_amount !== null && item.total_amount !== undefined ? safeNumber(item.total_amount) : null,
    }));

  const extraction: InvoiceExtraction = {
    document_type: documentType,
    delivery_note_number: safeNullString(raw.delivery_note_number),
    invoice_type: invoiceType,
    invoice_number: safeString(raw.invoice_number),
    issue_date: normalizeDate(raw.issue_date),
    due_date: raw.due_date ? normalizeDate(raw.due_date) || null : null,
    supplier_name: safeString(raw.supplier_name),
    supplier_tax_id: safeNullString(raw.supplier_tax_id),
    customer_name: safeString(raw.customer_name),
    customer_tax_id: safeNullString(raw.customer_tax_id),
    subtotal: safeNumber(raw.subtotal),
    tax_amount: safeNumber(raw.tax_amount),
    total_amount: safeNumber(raw.total_amount),
    currency: safeString(raw.currency, 'EUR').toUpperCase(),
    tax_rate: raw.tax_rate !== null && raw.tax_rate !== undefined ? safeNumber(raw.tax_rate) : null,
    payment_method: safeNullString(raw.payment_method),
    category: safeNullString(raw.category),
    notes: safeNullString(raw.notes),
    extraction_confidence: Math.max(0, Math.min(1, safeNumber(raw.extraction_confidence ?? raw.confidence_score, 0.5))),
    needs_review: false, // computed below
    line_items,
    // Audit fields
    issuer_name: safeNullString(raw.issuer_name),
    issuer_tax_id: safeNullString(raw.issuer_tax_id),
    recipient_name: safeNullString(raw.recipient_name),
    recipient_tax_id: safeNullString(raw.recipient_tax_id),
    role_reasoning_summary: safeNullString(raw.role_reasoning_summary),
  };

  extraction.needs_review = shouldRequireReview(extraction);

  return extraction;
}

/**
 * Determines if an extraction needs manual human review.
 */
export function shouldRequireReview(extraction: InvoiceExtraction): boolean {
  if (extraction.extraction_confidence < 0.7) return true;
  if (!extraction.invoice_number) return true;
  if (!extraction.issue_date) return true;
  if (!extraction.supplier_name) return true;
  if (!extraction.customer_name) return true;
  if (extraction.total_amount <= 0) return true;
  return false;
}

/**
 * Calls the AI provider to extract invoice data from a file.
 * Returns validated, structured JSON. Never writes to database.
 */
export async function extractInvoiceData(
  fileBase64: string,
  mimeType: string,
  filename: string,
  providerConfig?: AIProviderConfig,
  companyContext?: CompanyContext,
): Promise<InvoiceExtraction> {
  if (isGeminiProvider(providerConfig)) {
    return extractWithGemini(fileBase64, mimeType, companyContext);
  }

  // Fallback: OpenAI-compatible (Ollama or external)
  const { apiUrl, apiKey, model } = getProviderConfig(providerConfig);

  if (!apiKey) {
    throw new Error('No AI API key configured');
  }

  const prompt = buildExtractionPrompt(companyContext);

  const userContent: any[] = [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
    { type: 'text', text: prompt },
  ];

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: userContent }],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error(`[ai] HTTP ${response.status} error body (truncated):`, errorText.slice(0, 500));
    throw new Error(`AI API error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    console.error('[ai] No content in response. Choices:', JSON.stringify(data?.choices).slice(0, 300));
    throw new Error('No content in AI response');
  }

  let rawJson: any;
  try {
    rawJson = JSON.parse(content);
  } catch {
    console.error('[ai] Failed to parse JSON content (first 300 chars):', String(content).slice(0, 300));
    throw new Error('AI response is not valid JSON');
  }

  return validateExtraction(rawJson);
}

// ---------------------------------------------------------------------------
// Cash Register (Cierre TPV / Cierre Caja) — specialized Gemini extraction
// ---------------------------------------------------------------------------

const CASH_REGISTER_PROMPT = `You are analyzing a TPV/cash register daily closure report (cierre de caja, cierre TPV, Z-report, informe de lote, resumen ventas del día).

Extract the following data from this document. Many fields may be absent depending on the TPV model — only return fields explicitly shown.

Rules:
- date: closure date in YYYY-MM-DD format. Look for "FECHA:", "Date:", "Fecha cierre:", or any date near the totals.
- time: closure time as HH:MM or null if not shown.
- business_name: the name of the business/commerce shown on the receipt (razón social, nombre comercio).
- terminal_id: TPV terminal identifier (Nº terminal, Terminal ID, TID).
- batch_number: batch/lote number (Lote nº, Batch, Nº lote).
- operation_count: total number of operations/transactions (Nº operaciones, Transactions).
- cash_amount: total cash payments (Efectivo, Cash). Use 0 if not shown.
- card_amount: total card/TPV payments (Tarjeta, Card, TPV, Visa/MC total). Use 0 if not shown.
- bizum_amount: total Bizum payments. Use 0 if not shown.
- transfer_amount: total bank transfers. Use 0 if not shown.
- other_amount: any other payment method totals not covered above. Use 0 if not shown.
- total_amount: grand total of all collections for the day (Total, Gran Total, Total día). If not explicit, sum cash+card+bizum+transfer+other.
- notes: any relevant remarks (e.g. "Anulaciones: 3", "Lote forzado", etc.) or null.
- extraction_confidence: 0.0–1.0 confidence in the extraction quality.

Respond with raw JSON only (no markdown, no code blocks):
{
  "date": "YYYY-MM-DD",
  "time": "HH:MM or null",
  "business_name": "string or null",
  "terminal_id": "string or null",
  "batch_number": "string or null",
  "operation_count": null,
  "cash_amount": 0.00,
  "card_amount": 0.00,
  "bizum_amount": 0.00,
  "transfer_amount": 0.00,
  "other_amount": 0.00,
  "total_amount": 0.00,
  "notes": null,
  "extraction_confidence": 0.85
}`;

/**
 * Specialized Gemini extraction for TPV/cash closure reports.
 * Called after the main extraction identifies document_type === 'cash_register'.
 * Returns null on failure (non-fatal — caller falls back to summary data from main extraction).
 */
export async function extractCashRegisterData(
  fileBase64: string,
  mimeType: string,
): Promise<CashRegisterExtraction | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini:cash_register] GEMINI_API_KEY not configured — skipping specialized extraction');
    return null;
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: fileBase64 } },
        { text: CASH_REGISTER_PROMPT },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, attempt === 2 ? 1000 : 3000));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if ((response.status === 429 || response.status === 503) && attempt < 3) continue;
        console.error(`[gemini:cash_register] HTTP ${response.status} attempt=${attempt}:`, text.slice(0, 300));
        return null;
      }

      const data = await response.json();
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) return null;

      const raw = JSON.parse(content);

      const safeNum = (v: any): number => { const n = Number(v); return isNaN(n) ? 0 : Math.max(0, n); };
      const safeStr = (v: any): string | null => (v != null && String(v).trim() ? String(v).trim() : null);

      const cash     = safeNum(raw.cash_amount);
      const card     = safeNum(raw.card_amount);
      const bizum    = safeNum(raw.bizum_amount);
      const transfer = safeNum(raw.transfer_amount);
      const other    = safeNum(raw.other_amount);
      const total    = raw.total_amount ? safeNum(raw.total_amount) : cash + card + bizum + transfer + other;

      // Normalize date
      let date = '';
      if (raw.date) {
        const d = new Date(String(raw.date).trim());
        if (!isNaN(d.getTime())) date = d.toISOString().split('T')[0];
        else if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date).trim())) date = String(raw.date).trim();
      }
      if (!date) date = new Date().toISOString().split('T')[0]; // fallback to today

      const confidence = Math.max(0, Math.min(1, safeNum(raw.extraction_confidence || 0.7)));

      console.log(`[gemini:cash_register] ✅ extracted date=${date} total=${total} confidence=${confidence}`);

      return {
        date,
        time:            safeStr(raw.time),
        business_name:   safeStr(raw.business_name),
        terminal_id:     safeStr(raw.terminal_id),
        batch_number:    safeStr(raw.batch_number),
        operation_count: raw.operation_count != null ? Math.round(safeNum(raw.operation_count)) : null,
        cash_amount:     cash,
        card_amount:     card,
        bizum_amount:    bizum,
        transfer_amount: transfer,
        other_amount:    other,
        total_amount:    total,
        notes:           safeStr(raw.notes),
        extraction_confidence: confidence,
      };
    } catch (err: any) {
      console.error(`[gemini:cash_register] attempt=${attempt} error:`, err?.message);
      if (attempt === 3) return null;
    }
  }
  return null;
}
