/**
 * Pure logic tests for lib/document-dedup.ts — no DB, no network.
 * Run with: npx tsx scripts/test-document-dedup.ts
 *
 * Covers the 2026-09-07 incident: the same file was resent ~265 times by
 * one Telegram user over 11 hours, and nothing stopped each resend from
 * burning a fresh Gemini call. These cases lock in the intended behaviour:
 * skip Gemini for an active/recent duplicate, but never block forever.
 */
import { evaluateDuplicate, computeContentHash, DuplicateCandidate } from '../lib/document-dedup';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const NOW = new Date('2026-09-07T12:00:00Z');
function minutesAgo(m: number): Date {
  return new Date(NOW.getTime() - m * 60_000);
}

console.log('\nCase: no prior document with this hash -> not a duplicate\n');
{
  const verdict = evaluateDuplicate(null, NOW);
  assert(verdict.kind === 'none', 'kind=none when there is nothing to compare against');
}

console.log('\nCase: identical file already "processing" 2 minutes ago -> block, still active (the BYOU pattern)\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'processing', updated_at: minutesAgo(2) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'active_processing', 'Blocked as active_processing');
  assert((verdict as any).matchedDocumentId === 'doc-1', 'References the matched document id');
}

console.log('\nCase: identical file "processing" but stale (20 min, past the 15-min stuck-timeout window) -> allow a fresh attempt\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'processing', updated_at: minutesAgo(20) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'none', 'NOT blocked — a document presumed dead never blocks resends forever');
}

console.log('\nCase: identical file completed 3 minutes ago -> short-circuit as duplicate, no new Gemini call\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'completed', updated_at: minutesAgo(3) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'recent_completed', 'Recognised as a recent completed duplicate');
}

console.log('\nCase: identical file completed 30 minutes ago -> cool-down expired, allow reprocessing\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'completed', updated_at: minutesAgo(30) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'none', 'Cool-down window (10 min) expired — treated as a fresh, independent upload');
}

console.log('\nCase: identical file failed 1 minute ago (billing exhausted at the time) -> do not immediately hammer Gemini again\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'failed', updated_at: minutesAgo(1) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'recent_failed', 'Recognised as a recent failure — resend suppressed for the cool-down window');
}

console.log('\nCase: identical file failed 15 minutes ago -> cool-down expired, retry is allowed through normally\n');
{
  const candidate: DuplicateCandidate = { id: 'doc-1', processing_status: 'failed', updated_at: minutesAgo(15) };
  const verdict = evaluateDuplicate(candidate, NOW);
  assert(verdict.kind === 'none', 'Old failure no longer suppresses retries — user can legitimately retry later');
}

console.log('\nCase: computeContentHash is deterministic and content-sensitive\n');
{
  const h1 = computeContentHash('same-bytes');
  const h2 = computeContentHash('same-bytes');
  const h3 = computeContentHash('different-bytes');
  assert(h1 === h2, 'Same content -> same hash');
  assert(h1 !== h3, 'Different content -> different hash');
  assert(/^[0-9a-f]{64}$/.test(h1), 'sha256 hex digest shape');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
