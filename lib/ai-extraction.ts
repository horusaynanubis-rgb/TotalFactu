// AI Invoice Extraction Service
// Supports local Ollama and external OpenAI-compatible APIs
// The AI module is purely responsible for extraction — never writes to DB

export interface InvoiceExtraction {
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
}

export interface AIProviderConfig {
  provider: 'local' | 'external' | 'gemini';
  apiKey?: string | null;
  apiEndpoint?: string | null;
}

const EXTRACTION_PROMPT = `You are an invoice data extraction system. Extract structured data from this document.
Support multilingual invoices (Spanish, English, French, German, Italian, Portuguese).

Rules:
- Do NOT hallucinate or invent values. If a field is not found, use null or empty string.
- Dates must be in YYYY-MM-DD format when possible. If only partial date is found, normalize it.
- All monetary amounts must be numbers (not strings).
- invoice_type: "received" if this is an invoice received from a supplier, "issued" if sent to a customer.
- extraction_confidence: a number between 0 and 1 indicating overall extraction quality.
- needs_review: true if confidence < 0.7 or if critical fields are missing.

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure:
{
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
  "needs_review": false
}`;

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

async function extractWithGemini(
  fileBase64: string,
  mimeType: string,
): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType, data: fileBase64 } },
        { text: EXTRACTION_PROMPT },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 2000,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  let rawJson: any;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw new Error('Gemini response is not valid JSON');
  }

  return validateExtraction(rawJson);
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

  const invoiceType = ['received', 'issued'].includes(safeString(raw.invoice_type))
    ? safeString(raw.invoice_type)
    : 'received';

  const extraction: InvoiceExtraction = {
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
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in AI response');
  }

  let rawJson: any;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw new Error('AI response is not valid JSON');
  }

  return validateExtraction(rawJson);
}
