/**
 * BYOU TPV Export Parser
 *
 * Parses the HTML-based XLS export from the BYOU point-of-sale system.
 * The file is a single-sheet HTML document masquerading as .xls.
 *
 * Column layout (0-indexed):
 *   0  TPV                 - Terminal name
 *   1  Fecha Negocio       - Business date DD/MM/YYYY  → date
 *   2  Efec. Inicial       - Initial cash              → ai_raw_data
 *   3  Efec. Final Teórico - Theoretical closing cash  → ai_raw_data
 *   4  Efec. Final Real    - Actual closing cash       → ai_raw_data
 *   5  Desc. Efectivo      - Cash discount             → ai_raw_data
 *   6  Descuadre           - Discrepancy ("No" or €)  → notes
 *   7  Fecha Apertura      - Opening datetime          → ai_raw_data
 *   8  Usuario Apertura    - Opening user              → ai_raw_data
 *   9  Fecha Cierre        - Closing datetime          → ai_raw_data
 *   10 Periodo             - Period (usually empty)    → ai_raw_data
 *   11 Usuario Cierre      - Closing user              → ai_raw_data
 *   12 Incidencia          - Incident note             → notes
 *   13 Ventas              - Total sales               → total_amount
 *   14 Movimientos         - Cash movements (usually 0)→ ai_raw_data
 *   15 Efectivo            - Cash collected            → cash_amount
 *   16 Tarjeta             - Card collected            → card_amount
 *   17 Cód. Seguridad      - Security hash             → ai_raw_data
 */

export interface ByouParsedRow {
  date: string;
  cash_amount: number;
  card_amount: number;
  total_amount: number;
  notes: string | null;
  ai_raw_data: string;
}

export interface ByouParseResult {
  rows: ByouParsedRow[];
  skipped: number;
  parseErrors: string[];
}

function parseSpanishNumber(str: string): number {
  if (!str || str.trim() === '') return 0;
  const cleaned = str.trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseByouDate(str: string): string | null {
  const m = str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function extractTableRows(html: string): string[][] {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const rows: string[][] = [];

  for (const rowMatch of tbody.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const rowAttrs = rowMatch[1] ?? '';
    // The totals row uses class='footer' on individual <td> elements; detect via row attrs or content
    if (/class=['"]footer['"]/i.test(rowAttrs)) continue;

    const cells = [...rowMatch[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, '').trim(),
    );

    // Skip rows that don't have at least 17 cells (minimum needed)
    if (cells.length < 17) continue;

    // Skip footer: first cell is footer class — detect by checking if cells have 'footer' class
    // (the footer <td> elements have class='footer')
    if (rowMatch[2].includes("class='footer'") || rowMatch[2].includes('class="footer"')) continue;

    rows.push(cells);
  }

  return rows;
}

export function parseByouXls(content: string): ByouParseResult {
  const rawRows = extractTableRows(content);
  const result: ByouParseResult = { rows: [], skipped: 0, parseErrors: [] };

  for (const cells of rawRows) {
    const dateStr = parseByouDate(cells[1]);
    if (!dateStr) {
      result.skipped++;
      continue;
    }

    const descuadre = cells[6]?.trim() ?? 'No';
    const incidencia = cells[12]?.trim() ?? '';

    const notesParts: string[] = [];
    if (descuadre && descuadre !== 'No') notesParts.push(`Descuadre: ${descuadre}`);
    if (incidencia) notesParts.push(incidencia);
    const notes = notesParts.length > 0 ? notesParts.join(' | ') : null;

    const row: ByouParsedRow = {
      date: dateStr,
      cash_amount: parseSpanishNumber(cells[15]),
      card_amount: parseSpanishNumber(cells[16]),
      total_amount: parseSpanishNumber(cells[13]),
      notes,
      ai_raw_data: JSON.stringify({
        source_format: 'byou_tpv_export',
        tpv: cells[0] ?? '',
        efec_inicial: parseSpanishNumber(cells[2]),
        efec_final_teorico: parseSpanishNumber(cells[3]),
        efec_final_real: parseSpanishNumber(cells[4]),
        desc_efectivo: parseSpanishNumber(cells[5]),
        descuadre,
        fecha_apertura: cells[7] ?? '',
        usuario_apertura: cells[8] ?? '',
        fecha_cierre: cells[9] ?? '',
        periodo: cells[10] ?? '',
        usuario_cierre: cells[11] ?? '',
        incidencia,
        movimientos: parseSpanishNumber(cells[14]),
        cod_seguridad: cells[17] ?? '',
      }),
    };

    result.rows.push(row);
  }

  return result;
}
