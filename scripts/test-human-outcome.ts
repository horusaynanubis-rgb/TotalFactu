/**
 * Unit tests for lib/human-outcome.ts — pure logic, no DB.
 * Run with: npx tsx scripts/test-human-outcome.ts
 *
 * Critical property under test: absence of a correction must NEVER be
 * classified the same as a confirmed review. NOT_REVIEWED and UNKNOWN are
 * both distinct from HUMAN_CONFIRMED.
 */
import { classifyHumanOutcome } from '../lib/human-outcome';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nHuman Outcome — HUMAN_CONFIRMED\n');
{
  const result = classifyHumanOutcome({
    gestoriaReviewStatus: 'reviewed_ok',
    reviewLogActions: ['mark_correct'],
    hasAcceptedCorrectionProposal: false,
  });
  assert(result === 'HUMAN_CONFIRMED', "gestoria_review_status='reviewed_ok', no negative logs -> HUMAN_CONFIRMED");
}

console.log('\nHuman Outcome — HUMAN_CORRECTED\n');
{
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: ['mark_incorrect'], hasAcceptedCorrectionProposal: false }) === 'HUMAN_CORRECTED',
    "InvoiceReviewLog action='mark_incorrect' -> HUMAN_CORRECTED",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: ['correction_detected'], hasAcceptedCorrectionProposal: false }) === 'HUMAN_CORRECTED',
    "InvoiceReviewLog action='correction_detected' -> HUMAN_CORRECTED",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: [], hasAcceptedCorrectionProposal: true }) === 'HUMAN_CORRECTED',
    'Accepted InvoiceCorrectionProposal alone -> HUMAN_CORRECTED',
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'reviewed_issue', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'HUMAN_CORRECTED',
    "gestoria_review_status='reviewed_issue' alone -> HUMAN_CORRECTED",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'corrected', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'HUMAN_CORRECTED',
    "gestoria_review_status='corrected' alone -> HUMAN_CORRECTED",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'reviewed_ok', reviewLogActions: ['mark_incorrect'], hasAcceptedCorrectionProposal: false }) === 'HUMAN_CORRECTED',
    "A negative log always wins over a later 'reviewed_ok' status — correction evidence takes priority",
  );
}

console.log('\nHuman Outcome — NOT_REVIEWED (zero touchpoints)\n');
{
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'NOT_REVIEWED',
    'null status, no logs, no proposals, no direct edit -> NOT_REVIEWED',
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'pending_review', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'NOT_REVIEWED',
    "status='pending_review' with no other touchpoint -> NOT_REVIEWED",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'legacy_unreviewed', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'NOT_REVIEWED',
    "status='legacy_unreviewed' with no other touchpoint -> NOT_REVIEWED",
  );
}

console.log('\nHuman Outcome — UNKNOWN (some touchpoint, inconclusive)\n');
{
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: [], hasAcceptedCorrectionProposal: false, hasDirectEdit: true }) === 'UNKNOWN',
    'Untouched gestoria status but a direct self-service edit exists -> UNKNOWN, not NOT_REVIEWED and not CONFIRMED',
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'waiting_client', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'UNKNOWN',
    "status='waiting_client' (neither confirmed nor corrected nor untouched) -> UNKNOWN",
  );
  assert(
    classifyHumanOutcome({ gestoriaReviewStatus: 'ignored', reviewLogActions: [], hasAcceptedCorrectionProposal: false }) === 'UNKNOWN',
    "status='ignored' -> UNKNOWN",
  );
}

console.log('\nHuman Outcome — the critical invariant\n');
{
  const notReviewed = classifyHumanOutcome({ gestoriaReviewStatus: null, reviewLogActions: [], hasAcceptedCorrectionProposal: false });
  const unknown = classifyHumanOutcome({ gestoriaReviewStatus: 'waiting_client', reviewLogActions: [], hasAcceptedCorrectionProposal: false });
  assert(notReviewed !== 'HUMAN_CONFIRMED', 'NOT_REVIEWED is never conflated with HUMAN_CONFIRMED');
  assert(unknown !== 'HUMAN_CONFIRMED', 'UNKNOWN is never conflated with HUMAN_CONFIRMED');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
