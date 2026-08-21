// Duplicate-invoice detection — pure comparison logic, no DB access here so
// it can be reused identically by:
//   - app/api/documents/[id]/process/route.ts, BEFORE creating a new Invoice
//     for a freshly-extracted document (live path).
//   - scripts/audit-byou-duplicates.ts, grouping a full invoice list after
//     the fact (audit path).
// Root cause fixed (auditoría 2026-07-15): BYOU Q2 2026 had 9 confirmed
// duplicate invoice pairs (1.341,21 €), created because the same physical
// document was re-uploaded through a second channel (web + Telegram) or
// resent weeks later, and the only existing safeguard — a client-side UI
// badge matching on invoice_number + supplier_tax_id + total_amount +
// issue_date — silently failed whenever supplier_tax_id differed between the
// two OCR extractions of the same document (which it did in 8 of the 9
// cases). This module never requires supplier_tax_id alone: name and tax_id
// are both accepted signals.
import { normalizeCompanyName, normalizeTaxId, namesMatch } from './invoice-type-classifier';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TOTAL_AMOUNT_TOLERANCE_EUR = 0.01;
const PROBABLE_MATCH_DATE_WINDOW_DAYS = 3; // resends are rarely on the exact same millisecond, but are on the same or an adjacent invoice date
const CANDIDATE_LOOKUP_WINDOW_DAYS = 45; // bound the live DB query; audits/backfills pass their own full list instead

export type DuplicateMatchType = 'strong' | 'probable';

export interface DuplicateInvoiceRef {
  invoiceId: string;
  documentId: string | null;
  invoiceNumber: string | null | undefined;
  supplierName: string | null | undefined;
  supplierTaxId: string | null | undefined;
  issueDate: Date | null | undefined;
  totalAmount: number;
  sourceChannel?: string | null;
  originalFilename?: string | null;
  createdAt?: Date;
}

export interface DuplicateCandidateInput {
  invoiceNumber: string | null | undefined;
  supplierName: string | null | undefined;
  supplierTaxId: string | null | undefined;
  issueDate: Date | null | undefined;
  totalAmount: number;
  sourceChannel?: string | null;
  originalFilename?: string | null;
}

export interface DuplicateMatch {
  matchType: DuplicateMatchType;
  matchedOn: string[];
  existing: DuplicateInvoiceRef;
}

export interface DuplicateCheckResult {
  strongMatch: DuplicateMatch | null;
  probableMatches: DuplicateMatch[];
}

/** "photo_1780559748148.jpg" / "A-V2026-00002743529 (1).pdf" -> comparable stem. */
export function normalizeFilenameForSimilarity(filename: string | null | undefined): string {
  if (!filename) return '';
  const lastDot = filename.lastIndexOf('.');
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  return stem
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '')
    .replace(/\(\d+\)$/, ''); // trailing "(1)", "(2)" from repeated downloads/uploads
}

function sameDay(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < MS_PER_DAY;
}

function withinDays(a: Date, b: Date, days: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= days * MS_PER_DAY;
}

function sameTotal(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOTAL_AMOUNT_TOLERANCE_EUR;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = tmp;
    }
  }
  return dp[n];
}

/**
 * namesMatch() (exact/substring) plus a small-edit-distance fallback for OCR
 * typos — confirmed necessary in production: "FRIOLISA S.A.U." vs
 * "FRIDOLISA S.A.U." (one inserted letter) is the same real supplier
 * extracted twice, but is neither equal nor a substring of the other, so
 * namesMatch() alone missed this duplicate pair during the 2026-07-15 audit.
 * Bounded to short names (<=2 edits, <=25% of the longer name) to avoid
 * matching two genuinely different short suppliers.
 */
function namesAreSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (namesMatch(a, b)) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 6) return false;
  const distance = levenshtein(a, b);
  return distance <= 2 && distance / maxLen <= 0.25;
}

interface NormalizedRef {
  ref: DuplicateInvoiceRef;
  number: string;
  taxId: string;
  name: string;
  filename: string;
}

function normalizeRef(ref: DuplicateInvoiceRef): NormalizedRef {
  return {
    ref,
    number: (ref.invoiceNumber ?? '').trim().toUpperCase(),
    taxId: normalizeTaxId(ref.supplierTaxId),
    name: normalizeCompanyName(ref.supplierName),
    filename: normalizeFilenameForSimilarity(ref.originalFilename),
  };
}

/**
 * Compares two normalized invoices and returns the strongest match type, or
 * null if they don't look related at all. Symmetric — order doesn't matter.
 */
function compare(a: NormalizedRef, b: NormalizedRef): { matchType: DuplicateMatchType; matchedOn: string[] } | null {
  if (!sameTotal(a.ref.totalAmount, b.ref.totalAmount)) return null;

  const sameTaxId = a.taxId !== '' && a.taxId === b.taxId;
  const sameSupplier = sameTaxId || namesAreSimilar(a.name, b.name);
  if (!sameSupplier) return null;

  const sameNumber = a.number !== '' && a.number === b.number;

  // A. Strong: same supplier (CIF, or name exact/near-exact) + same invoice_number + same total.
  if (sameNumber) {
    return {
      matchType: 'strong',
      matchedOn: [sameTaxId ? 'supplier_tax_id' : 'supplier_name', 'invoice_number', 'total_amount'],
    };
  }

  // B. Probable: same supplier + same/adjacent date + same total, OR a
  // filename that looks like the same file re-uploaded (e.g. "(1)" suffix,
  // or an identical stem from a different channel's upload path).
  const dateClose = a.ref.issueDate && b.ref.issueDate && withinDays(a.ref.issueDate, b.ref.issueDate, PROBABLE_MATCH_DATE_WINDOW_DAYS);
  const filenameMatch = a.filename !== '' && a.filename === b.filename;

  if (dateClose || filenameMatch) {
    const matchedOn = ['supplier', 'total_amount'];
    if (dateClose) matchedOn.push(a.ref.issueDate && b.ref.issueDate && sameDay(a.ref.issueDate, b.ref.issueDate) ? 'issue_date' : 'issue_date~');
    if (filenameMatch) matchedOn.push('filename');
    return { matchType: 'probable', matchedOn };
  }

  return null;
}

/**
 * Live path: check one freshly-extracted candidate against a list of
 * existing invoices (caller fetches these — see process/route.ts, which
 * scopes the query to the same company/invoice_type and a ±45-day window
 * around the candidate's issue_date via candidateLookupWindow()).
 */
export function checkDuplicate(candidate: DuplicateCandidateInput, existing: DuplicateInvoiceRef[]): DuplicateCheckResult {
  const normCandidate = normalizeRef({ invoiceId: '', documentId: null, ...candidate });
  const probableMatches: DuplicateMatch[] = [];

  for (const e of existing) {
    const result = compare(normCandidate, normalizeRef(e));
    if (!result) continue;
    if (result.matchType === 'strong') {
      return { strongMatch: { matchType: 'strong', matchedOn: result.matchedOn, existing: e }, probableMatches: [] };
    }
    probableMatches.push({ matchType: 'probable', matchedOn: result.matchedOn, existing: e });
  }

  return { strongMatch: null, probableMatches };
}

export function candidateLookupWindow(issueDate: Date | null | undefined): { gte: Date; lte: Date } | undefined {
  if (!issueDate) return undefined;
  return {
    gte: new Date(issueDate.getTime() - CANDIDATE_LOOKUP_WINDOW_DAYS * MS_PER_DAY),
    lte: new Date(issueDate.getTime() + CANDIDATE_LOOKUP_WINDOW_DAYS * MS_PER_DAY),
  };
}

export interface ConfirmedDuplicatePair {
  principalId: string;
  duplicateId: string;
}

/**
 * Pure parser for scripts/resolve-confirmed-duplicates.ts's --pairs=a:b,c:d
 * argument. Extracted so it's unit-testable without touching Prisma/the DB —
 * see scripts/test-resolve-duplicates-safety.ts.
 */
export function parseDuplicatePairsArg(raw: string): ConfirmedDuplicatePair[] {
  return raw
    .split(',')
    .filter(Boolean)
    .map((p) => {
      const [principalId, duplicateId] = p.split(':');
      if (!principalId || !duplicateId) {
        throw new Error(`Invalid pair "${p}" — expected format principalId:duplicateId`);
      }
      return { principalId, duplicateId };
    });
}

export interface DuplicateGroup {
  matchType: DuplicateMatchType;
  members: DuplicateInvoiceRef[];
  matchedOn: string[];
}

/**
 * Audit path: group a full invoice list pairwise. O(n²) — fine for a single
 * company/period (hundreds of rows), not meant for whole-table scans.
 * Uses the exact same compare() as the live path, so the audit script and
 * the ingestion-time check can never disagree about what counts as a
 * duplicate.
 */
export function groupDuplicates(invoices: DuplicateInvoiceRef[]): DuplicateGroup[] {
  const normalized = invoices.map(normalizeRef);
  const used = new Set<string>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < normalized.length; i++) {
    if (used.has(normalized[i].ref.invoiceId)) continue;
    const clusterMembers: NormalizedRef[] = [normalized[i]];
    let clusterType: DuplicateMatchType | null = null;
    let clusterMatchedOn: string[] = [];

    for (let j = i + 1; j < normalized.length; j++) {
      if (used.has(normalized[j].ref.invoiceId)) continue;
      const result = compare(normalized[i], normalized[j]);
      if (!result) continue;
      clusterMembers.push(normalized[j]);
      used.add(normalized[j].ref.invoiceId);
      // A cluster is as strong as its strongest pairwise match.
      if (clusterType === null || (clusterType === 'probable' && result.matchType === 'strong')) {
        clusterType = result.matchType;
      }
      clusterMatchedOn = Array.from(new Set([...clusterMatchedOn, ...result.matchedOn]));
    }

    if (clusterMembers.length > 1) {
      used.add(normalized[i].ref.invoiceId);
      groups.push({ matchType: clusterType ?? 'probable', members: clusterMembers.map((m) => m.ref), matchedOn: clusterMatchedOn });
    }
  }

  return groups;
}
