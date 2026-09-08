/**
 * Tests for the NORMAL / LARGE_INVOICE adaptive extraction mode
 * (lib/ai-extraction.ts) — 2026-09-08 MAX_TOKENS fallback feature.
 *
 * All Gemini calls are mocked via global.fetch — NO real network calls,
 * NO real Gemini calls, per explicit instruction for this task.
 *
 * Run with: npx tsx scripts/test-gemini-adaptive-mode.ts
 */
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';

import { extractInvoiceData, validateLineItems, mergeLargeInvoiceResult, InvoiceExtraction } from '../lib/ai-extraction';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

type MockCall = { url: string; body: any };

function geminiResponse(payload: any, finishReason = 'STOP', usage: any = {}) {
  return new Response(
    JSON.stringify({
      candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(payload) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150, ...usage },
    }),
    { status: 200 },
  );
}

function maxTokensResponse() {
  return new Response(
    JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 7000, totalTokenCount: 10500, thoughtsTokenCount: 500 } }),
    { status: 200 },
  );
}

const NORMAL_HEADER_JSON = {
  document_type: 'invoice', delivery_note_number: null, invoice_type: 'received',
  invoice_number: 'F-001', issue_date: '2026-09-01', due_date: null,
  supplier_name: 'Proveedor S.L.', supplier_tax_id: 'B12345678',
  customer_name: 'Cliente S.L.', customer_tax_id: 'B87654321',
  subtotal: 100, tax_amount: 21, total_amount: 121, currency: 'EUR',
  tax_rate: 21, payment_method: null, category: null, notes: null,
  extraction_confidence: 0.95, needs_review: false,
  issuer_name: 'Proveedor S.L.', issuer_tax_id: 'B12345678',
  recipient_name: 'Cliente S.L.', recipient_tax_id: 'B87654321',
};

function withMockFetch(responses: (() => Response) | Array<() => Response>, run: (calls: MockCall[]) => Promise<void>) {
  const calls: MockCall[] = [];
  let i = 0;
  const responder = Array.isArray(responses) ? responses : null;
  const originalFetch = global.fetch;
  // @ts-ignore
  global.fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (responder) {
      const fn = responder[Math.min(i, responder.length - 1)];
      i++;
      return fn();
    }
    return (responses as () => Response)();
  };
  return run(calls).finally(() => { global.fetch = originalFetch; });
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nCase 1+2: factura normal exitosa -> usa NORMAL, una sola llamada, sin segunda pasada\n');
  await withMockFetch(
    () => geminiResponse({ ...NORMAL_HEADER_JSON, line_items: [{ description: 'Servicio', quantity: 1, unit_price: 100, tax_rate: 21, total_amount: 121 }] }),
    async (calls) => {
      const result = await extractInvoiceData('base64pdf', 'application/pdf', 'f.pdf', { provider: 'gemini' }, undefined, 'doc-1');
      assert(calls.length === 1, 'Exactamente 1 llamada a Gemini (NORMAL, sin fallback)');
      assert(result.supplier_name === 'Proveedor S.L.', 'Cabecera extraída correctamente en modo NORMAL');
      assert(result.line_items.length === 1, 'line_items presentes en el resultado NORMAL');
      assert(calls[0].body.generationConfig.maxOutputTokens === 16000, 'La llamada NORMAL usa maxOutputTokens=16000 (sin cambios)');
      assert(calls[0].body.generationConfig.thinkingConfig.thinkingBudget === 1024, 'La llamada NORMAL usa thinkingBudget=1024 (sin cambios)');
    },
  );

  console.log('\nCase 3+5: NORMAL con MAX_TOKENS -> cambia a LARGE_INVOICE (header + lines), nunca repite NORMAL\n');
  await withMockFetch(
    [
      () => maxTokensResponse(),
      () => geminiResponse(NORMAL_HEADER_JSON), // header pass (no line_items field)
      () => geminiResponse({ line_items: [
        { description: 'Producto A', quantity: 2, unit_price: 10, tax_rate: 21, total_amount: 24.2 },
        { description: 'Producto B', quantity: 1, unit_price: 50, tax_rate: 21, total_amount: 60.5 },
      ] }), // lines pass
    ],
    async (calls) => {
      const result = await extractInvoiceData('base64pdf', 'application/pdf', 'f.pdf', { provider: 'gemini' }, undefined, 'doc-2');
      assert(calls.length === 3, 'Exactamente 3 llamadas: NORMAL (MAX_TOKENS) + header + lines');
      assert(calls[0].body.generationConfig.maxOutputTokens === 16000, 'Llamada 1 = NORMAL (maxOutputTokens=16000)');
      assert(calls[1].body.generationConfig.maxOutputTokens === 2048, 'Llamada 2 = header-only (maxOutputTokens=2048), NO repite el prompt NORMAL');
      assert(calls[1].body.generationConfig.thinkingConfig.thinkingBudget === 512, 'Llamada 2 usa thinkingBudget=512 (mitad del global)');
      assert(calls[2].body.generationConfig.maxOutputTokens === 12000, 'Llamada 3 = lines-only (maxOutputTokens=12000)');
      assert(calls[2].body.generationConfig.thinkingConfig.thinkingBudget === 1024, 'Llamada 3 usa thinkingBudget=1024 (igual que NORMAL)');
      assert(result.supplier_name === 'Proveedor S.L.', 'Cabecera del merge coincide con la pasada 1');
      assert(result.line_items.length === 2, 'Líneas del merge coinciden con la pasada 2');
      assert(result.line_items[0].description === 'Producto A', 'Contenido de línea correcto tras el merge');
    },
  );

  console.log('\nCase 4: merge de header + lines es correcto (unitario, sin red)\n');
  {
    const header: InvoiceExtraction = { ...NORMAL_HEADER_JSON, needs_review: false, line_items: [] } as InvoiceExtraction;
    const lines = validateLineItems([{ description: 'X', quantity: 1, unit_price: 5, tax_rate: 21, total_amount: 6.05 }]);
    const merged = mergeLargeInvoiceResult(header, lines);
    assert(merged.supplier_name === header.supplier_name, 'Merge conserva los campos de cabecera');
    assert(merged.line_items === lines, 'Merge usa exactamente las líneas de la pasada 2');
    assert(merged.line_items.length === 1, 'Merge no pierde ni duplica líneas');
  }

  console.log('\nCase 6: error en la segunda pasada (header) -> el fallo se propaga (Document quedará failed, no atascado)\n');
  await withMockFetch(
    [
      () => maxTokensResponse(),
      () => { throw new Error('network blip'); },
    ],
    async () => {
      let threw = false;
      try {
        await extractInvoiceData('base64pdf', 'application/pdf', 'f.pdf', { provider: 'gemini' }, undefined, 'doc-3');
      } catch {
        threw = true;
      }
      assert(threw, 'Un error en la pasada de cabecera se propaga como excepción (proceso/route.ts ya maneja esto -> failed limpio)');
    },
  );

  console.log('\nCase 7: nunca se generan dos resultados para el mismo documento (no hay superficie para Invoice duplicada)\n');
  await withMockFetch(
    [
      () => maxTokensResponse(),
      () => geminiResponse(NORMAL_HEADER_JSON),
      () => geminiResponse({ line_items: [] }),
    ],
    async () => {
      const result = await extractInvoiceData('base64pdf', 'application/pdf', 'f.pdf', { provider: 'gemini' }, undefined, 'doc-4');
      assert(!Array.isArray(result), 'extractInvoiceData siempre resuelve UN único InvoiceExtraction, nunca una lista');
      assert(typeof result === 'object' && result !== null, 'Resultado es un objeto único (una sola Invoice posible aguas abajo)');
    },
  );

  console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
