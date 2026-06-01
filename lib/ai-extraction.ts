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

export interface InvoiceExtraction {
  document_type: 'invoice' | 'delivery_note' | 'unknown';
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
}

export interface AIProviderConfig {
  provider: 'local' | 'external' | 'gemini';
  apiKey?: string | null;
  apiEndpoint?: string | null;
}

const EXTRACTION_PROMPT = `You are a document data extraction system. Extract structured data from this document.
Support multilingual documents (Spanish, English, French, German, Italian, Portuguese).

Rules:
- Do NOT hallucinate or invent values. If a field is not found, use null or empty string.
- Dates must be in YYYY-MM-DD format when possible. If only partial date is found, normalize it.
- All monetary amounts must be numbers (not strings).
- document_type: "invoice" if it is a tax invoice (factura), "delivery_note" if it is a delivery note / albaran / albarán / bon de livraison / Lieferschein (NOT a fiscal document), "unknown" if unclear.
- delivery_note_number: the delivery note number if document_type is "delivery_note", otherwise null.
- invoice_type: "received" if this is an invoice received from a supplier, "issued" if sent to a customer. Use "received" for delivery_note documents.
- extraction_confidence: a number between 0 and 1 indicating overall extraction quality.
- needs_review: true if confidence < 0.7 or if critical fields are missing.

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure:
{
  "document_type": "invoice" or "delivery_note" or "unknown",
  "delivery_note_number": null,
  "invoice_type": "received" or "issued",
  "invoice_number": "string or empty",
  "issue_date": "YYYY-MM-DD or empty",
  "due_date": "YYYY-MM-DD or null",
  "supplier_name": "string or empty",
  "supplier_tax_id": "string or null",
  "customer_name": "string or empty",
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

function isGeminiProvider(config?: AIProviderConfig): boolean {
  // Gemini is the default when API key is configured, unless forced local
  const forceLocal = process.env.FORCE_LOCAL_AI === 'true' || process.env.AI_FORCE_LOCAL === '1';
  if (forceLocal) return false;
  if (config?.provider === 'gemini') return true;
  if (config?.provider === 'local' || config?.provider === 'external') return false;
  // Default: use Gemini if key is available
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
const GEMINI_RETRY_DELAYS_MS = [1000, 3000]; // delay before attempt 2, then attempt 3

function isGeminiRetriableError(status: number, body: string): boolean {
  if (status === 429 || status === 503) return true;
  if (body.includes('UNAVAILABLE') || body.includes('high demand') || body.includes('RESOURCE_EXHAUSTED')) return true;
  return false;
}

async function extractWithGemini(
  fileBase64: string,
  mimeType: string,
): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxOutputTokens = 32000;

  // DIAG: file size + provider info
  const fileSizeKb = Math.round((fileBase64.length * 3) / 4 / 1024);
  console.log(`[gemini:diag] provider=gemini model=${model} mimeType=${mimeType} base64Length=${fileBase64.length} estimatedSizeKb=${fileSizeKb} maxOutputTokens=${maxOutputTokens}`);

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: fileBase64 } },
        { text: EXTRACTION_PROMPT },
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

    // MAX_TOKENS: output was truncated → JSON incomplete → no point retrying with same config
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

    // Blocked by safety or recitation filters — non-retriable
    if (finishReason === 'SAFETY') {
      console.error('[gemini:diag] Response blocked by SAFETY filter');
      throw new Error('Gemini API error (SAFETY): response blocked by content safety filters');
    }
    if (finishReason === 'RECITATION') {
      console.error('[gemini:diag] Response blocked by RECITATION filter');
      throw new Error('Gemini API error (RECITATION): response blocked due to recitation');
    }

    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    // DIAG: log first 500 chars of raw AI response
    console.log(`[gemini:diag] response_first_500: ${String(content ?? '').slice(0, 500)}`);

    if (!content) {
      console.error('[gemini:diag] No content in response. finishReason:', finishReason, 'Full data:', JSON.stringify(data).slice(0, 500));
      throw new Error(`No content in Gemini response (finishReason=${finishReason})`);
    }

    // DIAG: detect if Gemini wrapped JSON in markdown despite responseMimeType=application/json
    const hasMarkdownFence = content.includes('```');
    if (hasMarkdownFence) {
      console.warn('[gemini:diag] ⚠️ Response contains markdown fences — responseMimeType ignored by model');
    }

    let rawJson: any;
    try {
      rawJson = JSON.parse(content);
    } catch (parseErr) {
      // DIAG: log full 500 chars + finishReason for diagnosis
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
  // Safely coerce types
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

  // Normalize date to YYYY-MM-DD or empty
  const normalizeDate = (v: any): string => {
    if (!v) return '';
    const s = String(v).trim();
    // Try parsing
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
    // Return as-is if it looks like a date pattern
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return '';
  };

  const rawDocType = safeString(raw.document_type);
  const documentType: 'invoice' | 'delivery_note' | 'unknown' =
    ['invoice', 'delivery_note', 'unknown'].includes(rawDocType)
      ? (rawDocType as 'invoice' | 'delivery_note' | 'unknown')
      : 'invoice';

  const invoiceType = ['received', 'issued'].includes(safeString(raw.invoice_type))
    ? safeString(raw.invoice_type)
    : 'received';

  // Validate line items — reject items without a description
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
    needs_review: false, // Will be computed below
    line_items,
  };

  // Compute needs_review based on business rules
  extraction.needs_review = shouldRequireReview(extraction);

  return extraction;
}

/**
 * Determines if an extraction needs manual human review.
 */
export function shouldRequireReview(extraction: InvoiceExtraction): boolean {
  if (extraction.extraction_confidence < 0.7) return true;

  // Critical fields must be present
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
  providerConfig?: AIProviderConfig
): Promise<InvoiceExtraction> {
  // Use Gemini when available (default provider)
  if (isGeminiProvider(providerConfig)) {
    return extractWithGemini(fileBase64, mimeType);
  }

  // Fallback: OpenAI-compatible (Ollama or external)
  const { apiUrl, apiKey, model } = getProviderConfig(providerConfig);

  if (!apiKey) {
    throw new Error('No AI API key configured');
  }

  const userContent: any[] = [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
    { type: 'text', text: EXTRACTION_PROMPT },
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
