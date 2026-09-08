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

// Shared between the NORMAL prompt and the LARGE_INVOICE header-only prompt —
// both need correct issuer/recipient identification; only NORMAL also asks
// for line_items. Factored out so the two prompts can never drift apart on
// this logic. See lib/document-dedup.ts-style rationale comments below for
// why LARGE_INVOICE exists at all (2026-09-08 MAX_TOKENS incidents).
const ROLE_IDENTIFICATION_RULES = `ROLE IDENTIFICATION RULES — apply these carefully before setting supplier_name and customer_name:

1. ISSUER/SUPPLIER (emisor/proveedor) is the company that:
   - Appears in the document HEADER with its logo, full address, phone, web, and fiscal registration data
   - Is listed near fields like "Razón Social:", "Emisor:", "Proveedor:", "CIF/NIF:" in the header section
   - Is NOT inside any labeled block such as "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Dirección de entrega"

2. RECIPIENT/CUSTOMER (receptor/cliente) is the company that:
   - Appears inside a block explicitly labeled: "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Dirección de envío"
   - Even if the same name appears elsewhere, a name INSIDE a "Cliente:" or "Centro:" block is ALWAYS the recipient

3. CRITICAL: A company name inside a "Cliente:", "Centro:", or "Destinatario:" block is NEVER the issuer/supplier, even if it appears multiple times elsewhere in the document.

4. If a company has a prominent header position with logo/web/phone/address, that company is the issuer regardless of other mentions.

5. supplier_name must be the ISSUER (header company). customer_name must be the RECIPIENT (Cliente/Centro block).`;

function buildAccountOwnerContextBlock(ctx?: CompanyContext): string {
  return ctx
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
}

function buildExtractionPrompt(ctx?: CompanyContext): string {
  const contextBlock = buildAccountOwnerContextBlock(ctx);

  return `You are a document data extraction system. Extract structured data from this document.
Support multilingual documents (Spanish, English, French, German, Italian, Portuguese).
${contextBlock}
${ROLE_IDENTIFICATION_RULES}

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
// LARGE_INVOICE mode — two-pass extraction for documents that overflow the
// normal single-call JSON (see extractWithGeminiAdaptive below for the
// selection/fallback logic). Header-only and lines-only prompts, each with
// its own tight token budget, instead of one JSON response that has to fit
// header + every line simultaneously.
// ---------------------------------------------------------------------------

/**
 * Same header fields as buildExtractionPrompt(), deliberately WITHOUT
 * line_items — asking for everything except the potentially-huge line
 * array is what keeps this pass's output small and fast regardless of how
 * many products/services the invoice actually has.
 */
function buildHeaderOnlyPrompt(ctx?: CompanyContext): string {
  const contextBlock = buildAccountOwnerContextBlock(ctx);

  return `You are a document data extraction system. Extract ONLY the header/summary fields from this document — do NOT extract individual line items, they will be requested separately.
Support multilingual documents (Spanish, English, French, German, Italian, Portuguese).
${contextBlock}
${ROLE_IDENTIFICATION_RULES}

Rules:
- Do NOT hallucinate or invent values. If a field is not found, use null or empty string.
- Dates must be in YYYY-MM-DD format when possible. If only partial date is found, normalize it.
- All monetary amounts must be numbers (not strings).
- document_type: "invoice" if it is a tax invoice (factura), "delivery_note" if it is a delivery note / albaran / albarán / bon de livraison / Lieferschein (NOT a fiscal document), "cash_register" if it is a daily TPV/cash closure report, "unknown" if unclear.
- delivery_note_number: the delivery note number if document_type is "delivery_note", otherwise null.
- invoice_type: "received" if this is an invoice received from a supplier, "issued" if sent to a customer. Use "received" for delivery_note documents.
- subtotal/tax_amount/total_amount: the document's TOTALS as printed (not a sum you compute from lines — you are not seeing the lines in this pass).
- extraction_confidence: a number between 0 and 1 indicating overall extraction quality.
- needs_review: true if confidence < 0.7 or if critical fields are missing.
- issuer_name/issuer_tax_id: exact company name/tax ID found in the document header/logo area.
- recipient_name/recipient_tax_id: exact company name/tax ID found inside a Cliente/Centro/Destinatario block.

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure — do NOT include a line_items field:
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
  "recipient_tax_id": null
}`;
}

/**
 * The ONLY fields InvoiceLine actually persists today (description,
 * quantity, unit_price, tax_rate, total_amount) — deliberately matches
 * InvoiceLineItem exactly, no more. No supplier/customer/dates/reasoning
 * repeated here, which is the whole point: this pass's output scales only
 * with the number of real lines, not with header field count too.
 */
const LARGE_INVOICE_LINES_PROMPT = `You are looking at an invoice/receipt document. Extract ONLY the individual line items (products, services, fees) — do NOT extract supplier, customer, dates, or totals, they were already extracted separately.

Rules:
- Extract every line from the invoice (products, services, fees), across all pages if there are several.
- Do NOT invent or estimate lines. Only include what is explicitly shown.
- quantity, unit_price, tax_rate, total_amount can be null if not visible for a line.
- description must be non-empty for each item.

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure:
{
  "line_items": [
    {
      "description": "Product or service name as shown on the document",
      "quantity": 1.0,
      "unit_price": 9.99,
      "tax_rate": 21.0,
      "total_amount": 12.09
    }
  ]
}`;

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
// Second-pass: lightweight VAT-only breakdown call
// ---------------------------------------------------------------------------

export interface VatBreakdownEntry {
  rate: number;
  base: number;
  iva: number;
}

/**
 * Makes a lightweight second Gemini call asking ONLY for the VAT breakdown
 * (base + cuota per rate) — no supplier, date, number, or line concepts.
 * Only called for invoices whose local classification (lib/iva-classification.ts)
 * couldn't resolve a rate. Single attempt, no retry loop — this is a one-shot
 * escalation (see Invoice.vat_reclassification_attempted), not a pipeline
 * that should hammer Gemini. Returns null on any error (caller treats that
 * the same as "still unresolved").
 */
export async function extractVatBreakdown(
  fileBase64: string,
  mimeType: string,
): Promise<{ breakdown: VatBreakdownEntry[] } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Mira esta factura. Extrae ÚNICAMENTE el desglose de IVA: para cada tipo de IVA presente (0%, 4%, 10% o 21%), indica la base imponible y la cuota de IVA correspondientes a ese tipo.

NO extraigas proveedor, fecha, número de factura, conceptos ni productos — solo el desglose fiscal.

Responde con JSON puro (sin markdown):
{
  "breakdown": [
    {"rate": 21, "base": 100.00, "iva": 21.00}
  ]
}

Si la factura tiene un único tipo de IVA, incluye solo una entrada. Si no puedes determinar el desglose de IVA con certeza, responde {"breakdown": []}.`;

  try {
    const body = {
      contents: [{ parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, temperature: 0 },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(`[gemini:vat-breakdown] HTTP ${response.status} — treating as unresolved`);
      return null;
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const rawBreakdown = Array.isArray(parsed?.breakdown) ? parsed.breakdown : [];
    const breakdown: VatBreakdownEntry[] = rawBreakdown
      .filter((e: any) => typeof e?.rate === 'number' && typeof e?.base === 'number' && typeof e?.iva === 'number')
      .map((e: any) => ({ rate: e.rate, base: e.base, iva: e.iva }));

    return { breakdown };
  } catch (err: any) {
    console.error('[gemini:vat-breakdown] VAT-only second pass failed:', err?.message);
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

// Marker prefix used to tag errors caused by a permanently exhausted prepaid
// balance, so callers (process/route.ts) can show a distinct message without
// re-parsing raw Gemini error text. See findings from the 2026-09-07 incident:
// a depleted-credits 429 was being retried 3x per document like a transient
// rate limit, tripling the wasted request volume for zero benefit (retrying
// never helps until billing is topped up).
export const GEMINI_BILLING_EXHAUSTED_MARKER = 'Gemini:BILLING_EXHAUSTED:';

/**
 * True only for the specific "prepaid credits are gone" flavor of 429 —
 * a permanent block that will keep returning 429 on every attempt until a
 * human tops up billing. Distinct from a transient per-minute/per-day rate
 * limit, which also returns 429 but recovers on its own.
 */
export function isBillingExhaustedError(status: number, body: string): boolean {
  if (status !== 429) return false;
  return /prepayment credits are depleted|billing#prepay|please enable billing/i.test(body);
}

export function isBillingExhaustedGeminiError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(GEMINI_BILLING_EXHAUSTED_MARKER);
}

function isGeminiRetriableError(status: number, body: string): boolean {
  if (isBillingExhaustedError(status, body)) return false; // permanent — retrying wastes calls, never helps
  if (status === 429 || status === 503) return true;
  if (body.includes('UNAVAILABLE') || body.includes('high demand') || body.includes('RESOURCE_EXHAUSTED')) return true;
  return false;
}

// Marker for a request that never got a response from Gemini in time.
// Root cause of the 2026-09-08 live incident: a specific file made Gemini's
// generateContent call hang indefinitely (no HTTP error, no response — just
// silence), which meant the process route's own maxDuration (60s) — or the
// calling webhook's — eventually SIGKILLed the function before it ever
// reached a catch block. Result: the Document stayed "processing" forever,
// no AuditLog entry, no Telegram message, and the user resent the same file
// every ~1-2 minutes for hours because nothing ever told them it failed.
// A client-side timeout turns that silent hang into a clean, fast failure.
export const GEMINI_TIMEOUT_MARKER = 'Gemini:TIMEOUT:';

// 2026-09-08: tried raising 40s -> 55s but reverted — confirmed via
// analysis that it leaves only ~5s combined budget for storage_download +
// prep + DB writes within the 60s maxDuration shared by this route AND
// the Telegram webhook that calls it synchronously (whose own clock starts
// even earlier). Too risky: a slow write or network blip could get the
// whole function SIGKILLed before reaching the catch block — the exact
// failure mode this timeout exists to prevent. These stay the DEFAULTS for
// the synchronous flow (unchanged). The async worker (Paso 0 confirmed
// ~150s is safely available there) passes larger overrides — see
// GeminiTimeoutOverrides below and app/api/jobs/process-queue/route.ts.
const GEMINI_FETCH_TIMEOUT_MS = 40_000;

/**
 * Optional per-call timeout overrides, threaded through from
 * extractInvoiceData(). Undefined/omitted fields keep today's defaults —
 * the synchronous route never passes this, so its behavior is byte-for-byte
 * unchanged. Only the async worker passes larger values.
 */
export interface GeminiTimeoutOverrides {
  normalMs?: number;
  headerMs?: number;
  linesMs?: number;
}

/**
 * fetch() with an AbortController-based timeout. Node's fetch has no
 * built-in timeout, so without this a hung Gemini response is
 * indistinguishable from a slow-but-working one until the whole serverless
 * function is killed by the platform — too late to fail cleanly.
 */
async function fetchGeminiWithTimeout(
  url: string,
  body: unknown,
  timeoutMs: number = GEMINI_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`${GEMINI_TIMEOUT_MARKER} no response after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function isGeminiTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(GEMINI_TIMEOUT_MARKER);
}

// Marker for a truncated response (finishReason=MAX_TOKENS) — the JSON was
// cut off mid-generation, guaranteed unparseable/incomplete. Distinct from
// timeout/billing so extractWithGeminiAdaptive can detect specifically this
// case and fall back to LARGE_INVOICE mode (2026-09-08) instead of just
// failing the document.
export const GEMINI_MAX_TOKENS_MARKER = 'Gemini:MAX_TOKENS:';

export function isMaxTokensGeminiError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(GEMINI_MAX_TOKENS_MARKER);
}

async function extractWithGemini(
  fileBase64: string,
  mimeType: string,
  companyContext?: CompanyContext,
  documentId?: string,
  timeoutMs: number = GEMINI_FETCH_TIMEOUT_MS,
): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  // 2026-09-08 optimization (LOCAL ONLY, not yet deployed): the previous
  // 32000 was raised twice (2000→4000 in 8e75238, 4000→32000 in edddd9e),
  // both times undocumented and both reacting to MAX_TOKENS failures,
  // without ever checking usageMetadata.thoughtsTokenCount. Real samples
  // captured 2026-09-08 show thinking alone reached 5411 tokens on an
  // ordinary 8-line invoice (67% of total tokens) — far more than the
  // visible JSON output. thinkingBudget below fixes that (validated:
  // thinking dropped 83%, latency 48%, quality unchanged on 2 real docs).
  // 8000 was too tight for dense multi-line invoices (2 real documents hit
  // MAX_TOKENS, both cut off mechanically right at the ceiling — 16000
  // gives ~2x headroom over that cut-off point while staying 2x below the
  // old 32000 ceiling. See diagnóstico 2026-09-08 for the full token study.
  const maxOutputTokens = 16000;
  const thinkingBudget = 1024;

  const fileSizeKb = Math.round((fileBase64.length * 3) / 4 / 1024);
  console.log(`[gemini:mode] normal documentId=${documentId ?? 'n/a'}`);
  console.log(`[gemini:diag] documentId=${documentId ?? 'n/a'} provider=gemini model=${model} mimeType=${mimeType} base64Length=${fileBase64.length} estimatedSizeKb=${fileSizeKb} maxOutputTokens=${maxOutputTokens} thinkingBudget=${thinkingBudget} timeoutMs=${timeoutMs} hasCompanyCtx=${!!companyContext}`);
  const callStartedAt = Date.now();

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
      thinkingConfig: { thinkingBudget },
    },
  };

  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const delayMs = GEMINI_RETRY_DELAYS_MS[attempt - 2] ?? 3000;
      console.log(`[gemini:retry] attempt=${attempt}/${GEMINI_MAX_RETRIES} waiting ${delayMs}ms before retry`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    // No try/catch around this call is intentional: a timeout (or any other
    // network-level throw) propagates immediately out of this function on
    // attempt 1 — never retried. If Gemini hung once on this exact file,
    // retrying immediately is very likely to hang again; failing fast and
    // cleanly is strictly better than burning the request's time budget.
    const response = await fetchGeminiWithTimeout(url, body, timeoutMs);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[gemini] HTTP ${response.status} attempt=${attempt}/${GEMINI_MAX_RETRIES} error body (truncated):`, errorText.slice(0, 500));

      if (isBillingExhaustedError(response.status, errorText)) {
        // Permanent block — every retry would just get the same 429 for free
        // (no tokens billed on a rejected request, but it still burns request
        // quota and wall-clock time). Fail on attempt 1, no retry.
        console.error(`[gemini] ⛔ Billing exhausted — not retrying (would waste ${GEMINI_MAX_RETRIES - attempt} more attempts for nothing)`);
        throw new Error(`${GEMINI_BILLING_EXHAUSTED_MARKER} ${errorText.slice(0, 300)}`);
      }

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
    const latencyMs = Date.now() - callStartedAt;
    console.log(`[gemini:diag] documentId=${documentId ?? 'n/a'} mode=normal candidates=${data?.candidates?.length} finishReason=${finishReason} latencyMs=${latencyMs} promptTokenCount=${usageMetadata?.promptTokenCount ?? 'n/a'} candidatesTokenCount=${usageMetadata?.candidatesTokenCount ?? 'n/a'} thoughtsTokenCount=${usageMetadata?.thoughtsTokenCount ?? 'n/a'} totalTokenCount=${usageMetadata?.totalTokenCount ?? 'n/a'}`);

    if (finishReason === 'MAX_TOKENS') {
      const inputTokens = usageMetadata?.promptTokenCount ?? 'unknown';
      const outputTokens = usageMetadata?.candidatesTokenCount ?? 'unknown';
      console.error(
        `[gemini:diag] ⚠️ finishReason=MAX_TOKENS — output truncated`,
        `documentId=${documentId ?? 'n/a'}`,
        `model=${model}`,
        `maxOutputTokens=${maxOutputTokens}`,
        `mimeType=${mimeType}`,
        `inputTokens=${inputTokens}`,
        `outputTokens=${outputTokens}`,
      );
      throw new Error(`${GEMINI_MAX_TOKENS_MARKER} La factura tiene demasiadas líneas para el límite actual de extracción.`);
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

// ---------------------------------------------------------------------------
// LARGE_INVOICE mode — header-only and lines-only Gemini calls, plus the
// adaptive wrapper that decides between NORMAL and LARGE_INVOICE.
// ---------------------------------------------------------------------------

// Deliberately tight, single-attempt, no internal retry (see
// extractWithGeminiAdaptive doc comment for why): a document that already
// overflowed NORMAL's 16000-token budget is on a best-effort fallback path
// within whatever's left of the route's 60s maxDuration, not a path that
// should spend time retrying.
const LARGE_INVOICE_HEADER_TIMEOUT_MS = 20_000;
const LARGE_INVOICE_LINES_TIMEOUT_MS = 25_000;

// Header pass: ~20 short fields, no lines — real successful NORMAL calls
// produced 483-1066 output tokens INCLUDING up to 8 lines, so header alone
// should need a small fraction of that. 2048 gives 2-4x headroom.
// thinkingBudget halved vs NORMAL's 1024: this pass is a strict subset of
// NORMAL's complexity (same role-identification reasoning, no per-line
// reasoning), so some reduction is defensible; not cut further since role
// identification is still real reasoning work.
const LARGE_INVOICE_HEADER_MAX_OUTPUT_TOKENS = 2048;
const LARGE_INVOICE_HEADER_THINKING_BUDGET = 512;

// Lines pass: the two real MAX_TOKENS documents got cut off at 7193/7201
// combined header+lines tokens with only ~790 of that spent on thinking —
// meaning ~6400+ tokens were lines alone, truncated mid-way (true total
// unknown). 12000 dedicated entirely to lines is ~1.7x that already-large
// truncation point, while staying 25% below the global 16000 ceiling and
// far below the old 32000. thinkingBudget kept at the full 1024 (not
// reduced like the header pass) because matching many rows of
// description/quantity/price/tax accurately is the most error-prone part
// of the whole pipeline — not the place to cut reasoning budget.
const LARGE_INVOICE_LINES_MAX_OUTPUT_TOKENS = 12000;
const LARGE_INVOICE_LINES_THINKING_BUDGET = 1024;

/**
 * PASADA 1 (LARGE_INVOICE): header/summary fields only, no line_items.
 * Reuses validateExtraction() unchanged — omitting line_items from the raw
 * JSON is already handled gracefully there (defaults to []).
 */
async function extractInvoiceHeaderOnly(
  fileBase64: string,
  mimeType: string,
  companyContext?: CompanyContext,
  documentId?: string,
  timeoutMs: number = LARGE_INVOICE_HEADER_TIMEOUT_MS,
): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = buildHeaderOnlyPrompt(companyContext);

  const body = {
    contents: [{ parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: LARGE_INVOICE_HEADER_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: LARGE_INVOICE_HEADER_THINKING_BUDGET },
    },
  };

  console.log(`[gemini:mode] large_invoice_header documentId=${documentId ?? 'n/a'}`);
  const callStartedAt = Date.now();

  const response = await fetchGeminiWithTimeout(url, body, timeoutMs);

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (isBillingExhaustedError(response.status, errorText)) {
      throw new Error(`${GEMINI_BILLING_EXHAUSTED_MARKER} ${errorText.slice(0, 300)}`);
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const finishReason: string = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
  const usageMetadata = data?.usageMetadata ?? null;
  const latencyMs = Date.now() - callStartedAt;
  console.log(`[gemini:diag] documentId=${documentId ?? 'n/a'} mode=large_invoice_header candidates=${data?.candidates?.length} finishReason=${finishReason} latencyMs=${latencyMs} promptTokenCount=${usageMetadata?.promptTokenCount ?? 'n/a'} candidatesTokenCount=${usageMetadata?.candidatesTokenCount ?? 'n/a'} thoughtsTokenCount=${usageMetadata?.thoughtsTokenCount ?? 'n/a'} totalTokenCount=${usageMetadata?.totalTokenCount ?? 'n/a'}`);

  if (finishReason === 'MAX_TOKENS') {
    // Header alone should never realistically hit 2048 — if it does, this
    // document is too anomalous for the fallback too. Fail cleanly, no
    // further fallback (see Fase 4: never loop).
    throw new Error(`${GEMINI_MAX_TOKENS_MARKER} La cabecera de la factura excede el límite de la pasada de cabecera.`);
  }
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    throw new Error(`Gemini API error (${finishReason}): response blocked`);
  }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error(`No content in Gemini response (finishReason=${finishReason})`);

  let rawJson: any;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw new Error('Gemini response is not valid JSON');
  }

  return validateExtraction(rawJson);
}

/**
 * PASADA 2 (LARGE_INVOICE): line_items only. Returns InvoiceLineItem[]
 * directly (not a full InvoiceExtraction) — merged with the header result
 * by mergeLargeInvoiceResult().
 */
async function extractInvoiceLinesOnly(
  fileBase64: string,
  mimeType: string,
  documentId?: string,
  timeoutMs: number = LARGE_INVOICE_LINES_TIMEOUT_MS,
): Promise<InvoiceLineItem[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: LARGE_INVOICE_LINES_PROMPT }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: LARGE_INVOICE_LINES_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: LARGE_INVOICE_LINES_THINKING_BUDGET },
    },
  };

  console.log(`[gemini:mode] large_invoice_lines documentId=${documentId ?? 'n/a'}`);
  const callStartedAt = Date.now();

  const response = await fetchGeminiWithTimeout(url, body, timeoutMs);

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (isBillingExhaustedError(response.status, errorText)) {
      throw new Error(`${GEMINI_BILLING_EXHAUSTED_MARKER} ${errorText.slice(0, 300)}`);
    }
    throw new Error(`Gemini API error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const finishReason: string = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
  const usageMetadata = data?.usageMetadata ?? null;
  const latencyMs = Date.now() - callStartedAt;
  console.log(`[gemini:diag] documentId=${documentId ?? 'n/a'} mode=large_invoice_lines candidates=${data?.candidates?.length} finishReason=${finishReason} latencyMs=${latencyMs} promptTokenCount=${usageMetadata?.promptTokenCount ?? 'n/a'} candidatesTokenCount=${usageMetadata?.candidatesTokenCount ?? 'n/a'} thoughtsTokenCount=${usageMetadata?.thoughtsTokenCount ?? 'n/a'} totalTokenCount=${usageMetadata?.totalTokenCount ?? 'n/a'}`);

  if (finishReason === 'MAX_TOKENS') {
    // Even the dedicated 12000-token lines pass overflowed — a genuinely
    // extreme document. Fail cleanly rather than attempting a 3rd pass
    // (Fase 4: bounded to exactly one LARGE_INVOICE attempt).
    throw new Error(`${GEMINI_MAX_TOKENS_MARKER} Las líneas de la factura exceden el límite de la pasada de líneas.`);
  }
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    throw new Error(`Gemini API error (${finishReason}): response blocked`);
  }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error(`No content in Gemini response (finishReason=${finishReason})`);

  let rawJson: any;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw new Error('Gemini response is not valid JSON');
  }

  return validateLineItems(rawJson.line_items);
}

/**
 * FASE 5 — merge: combines the header pass result with the lines pass
 * result into a standard InvoiceExtraction, indistinguishable downstream
 * from a NORMAL-mode result. This is what lets process/route.ts (Invoice
 * creation, classification, duplicate detection, fiscal status, audit
 * logging) stay completely untouched by LARGE_INVOICE mode.
 */
export function mergeLargeInvoiceResult(
  header: InvoiceExtraction,
  lineItems: InvoiceLineItem[],
): InvoiceExtraction {
  const merged: InvoiceExtraction = { ...header, line_items: lineItems };
  // Re-run the same review-trigger logic NORMAL mode uses — header alone
  // already covers every field it checks (line_items isn't one of them),
  // but re-running keeps this merge point the single source of truth
  // rather than trusting the header pass's own needs_review in isolation.
  merged.needs_review = shouldRequireReview(merged) || header.needs_review;
  return merged;
}

/**
 * FASE 3 — adaptive mode selection. Always tries NORMAL first (single
 * Gemini call, unchanged behavior/config from before this feature). Falls
 * back to LARGE_INVOICE — exactly once, never looping — ONLY when NORMAL's
 * failure is specifically MAX_TOKENS.
 *
 * No pre-Gemini signal (page count, file size) is used to pick
 * LARGE_INVOICE upfront: file size does NOT correlate with complexity in
 * the real data we have (the two documents that hit MAX_TOKENS were
 * 148-151KB, squarely inside the 118-205KB range of documents that
 * succeeded normally), and this project has no PDF-parsing dependency to
 * get a real page count. Inventing a KB threshold anyway would be exactly
 * the "umbral arbitrario sin explicar por qué" this was told not to do.
 * MAX_TOKENS-triggered fallback is the only signal we actually have
 * evidence for.
 *
 * All other error types (timeout, billing exhausted, 429/503, safety,
 * invalid JSON, storage) propagate unchanged — this function does not
 * touch that policy at all, satisfying Fase 4's "no mezcles MAX_TOKENS con
 * errores transitorios."
 */
async function extractWithGeminiAdaptive(
  fileBase64: string,
  mimeType: string,
  companyContext?: CompanyContext,
  documentId?: string,
  timeouts?: GeminiTimeoutOverrides,
): Promise<InvoiceExtraction> {
  try {
    return await extractWithGemini(fileBase64, mimeType, companyContext, documentId, timeouts?.normalMs);
  } catch (err) {
    if (!isMaxTokensGeminiError(err)) {
      throw err; // timeout/billing/429/503/safety/invalid-json — unchanged policy
    }

    console.warn(`[gemini:mode] documentId=${documentId ?? 'n/a'} NORMAL hit MAX_TOKENS — falling back to LARGE_INVOICE (one attempt, no further fallback)`);

    // Never retries NORMAL again — this is the only place LARGE_INVOICE is
    // triggered, and it always originates from a NORMAL attempt above.
    const header = await extractInvoiceHeaderOnly(fileBase64, mimeType, companyContext, documentId, timeouts?.headerMs);
    const lineItems = await extractInvoiceLinesOnly(fileBase64, mimeType, documentId, timeouts?.linesMs);
    return mergeLargeInvoiceResult(header, lineItems);
  }
}

/**
 * Validates/sanitizes a raw line_items array from any Gemini response —
 * shared by validateExtraction() (NORMAL mode, embedded in the full JSON)
 * and the LARGE_INVOICE lines-only pass (its own dedicated JSON shape).
 * Keeping this in one place is what lets the two modes merge into an
 * identical InvoiceLineItem[] shape without duplicating validation logic.
 */
export function validateLineItems(rawLineItems: any): InvoiceLineItem[] {
  const safeNumber = (v: any, fallback = 0): number => {
    if (v === null || v === undefined) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };
  const safeString = (v: any, fallback = ''): string => {
    if (v === null || v === undefined) return fallback;
    return String(v).trim();
  };

  const items: any[] = Array.isArray(rawLineItems) ? rawLineItems : [];
  return items
    .filter((item: any) => item && typeof item.description === 'string' && item.description.trim())
    .map((item: any) => ({
      description: safeString(item.description),
      quantity: item.quantity !== null && item.quantity !== undefined ? safeNumber(item.quantity) : null,
      unit_price: item.unit_price !== null && item.unit_price !== undefined ? safeNumber(item.unit_price) : null,
      tax_rate: item.tax_rate !== null && item.tax_rate !== undefined ? safeNumber(item.tax_rate) : null,
      total_amount: item.total_amount !== null && item.total_amount !== undefined ? safeNumber(item.total_amount) : null,
    }));
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

  const line_items: InvoiceLineItem[] = validateLineItems(raw.line_items);

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
  documentId?: string,
  timeouts?: GeminiTimeoutOverrides,
): Promise<InvoiceExtraction> {
  if (isGeminiProvider(providerConfig)) {
    return extractWithGeminiAdaptive(fileBase64, mimeType, companyContext, documentId, timeouts);
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
      // Shorter timeout than the main extraction call — this is a small,
      // specialized request (maxOutputTokens: 1024).
      const response = await fetchGeminiWithTimeout(url, body, 25_000);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (isBillingExhaustedError(response.status, text)) {
          // Permanent block — surface distinctly instead of silently
          // returning null (which the caller would otherwise misread as
          // "low-confidence screenshot" rather than "AI unavailable").
          console.error(`[gemini:cash_register] ⛔ Billing exhausted — not retrying`);
          throw new Error(`${GEMINI_BILLING_EXHAUSTED_MARKER} ${text.slice(0, 300)}`);
        }
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
      if (isBillingExhaustedGeminiError(err)) throw err; // permanent — don't swallow into the retry loop
      if (isGeminiTimeoutError(err)) throw err; // hung once on this file — retrying is likely to hang again
      console.error(`[gemini:cash_register] attempt=${attempt} error:`, err?.message);
      if (attempt === 3) return null;
    }
  }
  return null;
}
