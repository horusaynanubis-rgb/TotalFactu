/**
 * Tests for the new Gestoria model's eligibility engine — no real database
 * or Stripe connection needed, matching the style of scripts/test-billing.ts
 * and scripts/test-gestoria-packs-purchase-authz.ts.
 * Run with: npx tsx scripts/test-gestoria-eligibility.ts
 *
 * Covers the full matrix from the implementation spec:
 *   - per-company classification (active/trialing/past_due/unpaid/canceled/
 *     cancel_at_period_end/internal/beta/no_subscription/demo-plan)
 *   - breakdown aggregation (0/1/4/5/6 companies, excluding non-active
 *     relations i.e. "invitation pending" never creates a counted row)
 *   - the LEGACY / INITIAL / ELIGIBLE / GRACE / LIMITED state machine,
 *     including day-boundary edges (day 59/60/61 of the initial period,
 *     day 29/30/31 of grace) and grace start/clear/recovery transitions
 *
 * getGestoriaEligibility() itself (the Prisma-querying orchestrator) is not
 * covered here — this repo's test scripts don't mock Prisma (see
 * test-billing.ts's own note). It's exercised manually against a local dev
 * server / staging DB; see the implementation report's KNOWN LIMITATIONS.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  classifyCompanyEligibility,
  buildEligibilityBreakdown,
  computeGestoriaState,
  GESTORIA_REQUIRED_COMPANIES,
  GESTORIA_INITIAL_PERIOD_DAYS,
  GESTORIA_GRACE_PERIOD_DAYS,
  type RelationLike,
  type CompanyLike,
} from '../lib/gestoria-eligibility';
import type { SubscriptionSummary } from '../lib/admin/company-metrics';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00.000Z');

function sub(overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    id: 's1',
    status: 'active',
    plan_name: 'profesional',
    stripe_customer_id: null,
    current_period_start: null,
    current_period_end: null,
    trial_end: null,
    cancel_at_period_end: false,
    payment_failure_count: 0,
    unit_amount_cents: 1499,
    created_at: NOW,
    ...overrides,
  } as SubscriptionSummary;
}

console.log('\n1. classifyCompanyEligibility — per-company reasons');

assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub() }, NOW).reason === 'eligible',
  'active profesional, no trial → eligible',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub() }, NOW).counts === true,
  'eligible company counts=true',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'internal', subscription: sub() }, NOW).reason === 'internal',
  'internal company → internal, regardless of subscription',
);
assert(
  classifyCompanyEligibility({ isBeta: true, companyType: 'individual', subscription: sub() }, NOW).reason === 'beta',
  'beta company → beta, regardless of subscription',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: null }, NOW).reason === 'no_subscription',
  'no subscription row → no_subscription',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ plan_name: 'demo' }) }, NOW).reason === 'not_profesional_plan',
  'demo plan → not_profesional_plan',
);
assert(
  classifyCompanyEligibility(
    { isBeta: false, companyType: 'individual', subscription: sub({ trial_end: new Date(NOW.getTime() + DAY) }) },
    NOW,
  ).reason === 'trialing',
  'trial_end in the future → trialing (status stays internal "active")',
);
assert(
  classifyCompanyEligibility(
    { isBeta: false, companyType: 'individual', subscription: sub({ trial_end: new Date(NOW.getTime() - DAY) }) },
    NOW,
  ).reason === 'eligible',
  'trial_end in the past → eligible (trial already over)',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ status: 'past_due', payment_failure_count: 1 }) }, NOW).reason === 'past_due',
  'past_due with 1 failure → past_due (not yet "unpaid")',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ status: 'past_due', payment_failure_count: 2 }) }, NOW).reason === 'unpaid',
  'past_due with 2+ failures → unpaid',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ status: 'cancelled' }) }, NOW).reason === 'canceled',
  'cancelled status → canceled',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ status: 'inactive' }) }, NOW).reason === 'inactive',
  'inactive status → inactive',
);
assert(
  classifyCompanyEligibility({ isBeta: false, companyType: 'individual', subscription: sub({ cancel_at_period_end: true }) }, NOW).counts === true,
  'cancel_at_period_end=true but status still active → still counts (Stripe keeps status=active for the whole paid period)',
);

console.log('\n2. buildEligibilityBreakdown — 0/1/4/5/6 companies + pending exclusion');

function makeFleet(n: number): { relations: RelationLike[]; companies: Map<string, CompanyLike>; subs: Map<string, SubscriptionSummary> } {
  const relations: RelationLike[] = [];
  const companies = new Map<string, CompanyLike>();
  const subs = new Map<string, SubscriptionSummary>();
  for (let i = 0; i < n; i++) {
    const id = `c${i}`;
    relations.push({ client_company_id: id, status: 'active' });
    companies.set(id, { name: `Company ${i}`, company_type: 'individual', is_beta: false });
    subs.set(id, sub());
  }
  return { relations, companies, subs };
}

for (const n of [0, 1, 4, 5, 6]) {
  const { relations, companies, subs } = makeFleet(n);
  const result = buildEligibilityBreakdown(relations, companies, subs, NOW);
  assert(result.eligibleCompanies === n, `${n} active+profesional companies → eligibleCompanies=${n}`);
  assert(result.companies.length === n, `${n} companies → breakdown has ${n} entries`);
}

{
  // A pending invitation never creates a relation row at all (see
  // app/api/gestoria/company-invitations/route.ts) — simulate by mixing an
  // 'ended' relation into the fleet and confirming it's excluded, exactly
  // as a never-accepted invitation would be.
  const { relations, companies, subs } = makeFleet(3);
  relations.push({ client_company_id: 'not-yet-accepted', status: 'ended' });
  const result = buildEligibilityBreakdown(relations, companies, subs, NOW);
  assert(result.eligibleCompanies === 3, 'non-active relation (ended / never-accepted) excluded from count');
  assert(result.companies.length === 3, 'non-active relation excluded from breakdown entries');
}

console.log('\n3. computeGestoriaState — LEGACY');

assert(
  computeGestoriaState({ isLegacy: true, companyCreatedAt: NOW, eligibleCompanies: 0, requiredCompanies: 5, existingGrace: null }, NOW).state === 'LEGACY',
  'isLegacy=true → LEGACY regardless of company count',
);
assert(
  computeGestoriaState({ isLegacy: true, companyCreatedAt: NOW, eligibleCompanies: 99, requiredCompanies: 5, existingGrace: null }, NOW).accessLevel === 'FULL',
  'LEGACY → accessLevel FULL',
);

console.log('\n4. computeGestoriaState — INITIAL period boundaries (day 59/60/61)');

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const day59 = new Date(createdAt.getTime() + 59 * DAY);
const day60 = new Date(createdAt.getTime() + GESTORIA_INITIAL_PERIOD_DAYS * DAY);
const day61 = new Date(createdAt.getTime() + 61 * DAY);

assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 0, requiredCompanies: 5, existingGrace: null }, day59).state === 'INITIAL',
  'day 59, 0 companies → still INITIAL',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 0, requiredCompanies: 5, existingGrace: null }, day60).state !== 'INITIAL',
  'day 60 (exactly 60*24h later) → initial period has ended',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 0, requiredCompanies: 5, existingGrace: null }, day61).state === 'GRACE',
  'day 61, 0 companies, first time below threshold → GRACE (not LIMITED immediately)',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 5, requiredCompanies: 5, existingGrace: null }, day59).accessLevel === 'FULL',
  'INITIAL always has FULL access regardless of company count',
);

console.log('\n5. computeGestoriaState — ELIGIBLE / GRACE start / recovery');

const pastInitial = new Date(createdAt.getTime() + 100 * DAY);

{
  const r = computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 5, requiredCompanies: 5, existingGrace: null }, pastInitial);
  assert(r.state === 'ELIGIBLE', '5/5 past initial period → ELIGIBLE');
  assert(r.graceWrite.type === 'none', '5/5 with no prior grace → no write needed');
}

{
  const r = computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace: null }, pastInitial);
  assert(r.state === 'GRACE', '4/5 past initial period, no prior grace → GRACE starts');
  assert(r.graceWrite.type === 'start', 'first drop below threshold → graceWrite=start');
  assert(r.grace?.daysRemaining === GESTORIA_GRACE_PERIOD_DAYS, `fresh grace → ${GESTORIA_GRACE_PERIOD_DAYS} days remaining`);
}

{
  // Recovery: was in grace, now back to 5+ → ELIGIBLE, graceWrite=clear
  const existingGrace = { eligibility_lost_at: new Date(pastInitial.getTime() - 5 * DAY), grace_ends_at: new Date(pastInitial.getTime() + 25 * DAY) };
  const r = computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 5, requiredCompanies: 5, existingGrace }, pastInitial);
  assert(r.state === 'ELIGIBLE', '4→5 recovery during grace → ELIGIBLE');
  assert(r.graceWrite.type === 'clear', 'recovery → graceWrite=clear (no accumulated penalty)');
}

console.log('\n6. computeGestoriaState — GRACE day 29/30/31 boundary, then LIMITED');

const graceStart = pastInitial;
const graceEnds = new Date(graceStart.getTime() + GESTORIA_GRACE_PERIOD_DAYS * DAY);
const existingGrace = { eligibility_lost_at: graceStart, grace_ends_at: graceEnds };

const graceDay29 = new Date(graceStart.getTime() + 29 * DAY);
const graceDay30 = graceEnds; // exactly at the boundary
const graceDay31 = new Date(graceStart.getTime() + 31 * DAY);

assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace }, graceDay29).state === 'GRACE',
  'grace day 29 → still GRACE',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace }, graceDay30).state === 'GRACE',
  'grace day 30 (exactly at grace_ends_at) → still GRACE (inclusive boundary)',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace }, graceDay31).state === 'LIMITED',
  'grace day 31 (past grace_ends_at) → LIMITED',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace }, graceDay31).accessLevel === 'LIMITED',
  'LIMITED state → accessLevel LIMITED',
);
assert(
  computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace }, graceDay31).graceWrite.type === 'none',
  'LIMITED → no new write (grace already recorded, nothing new to persist)',
);

console.log('\n7. computeGestoriaState — new drop after a prior recovery (no stale grace reused)');

{
  // Firm was ELIGIBLE (grace cleared), now drops again — must start a FRESH
  // grace window, not resume a stale one.
  const clearedGrace = { eligibility_lost_at: null, grace_ends_at: null };
  const r = computeGestoriaState({ isLegacy: false, companyCreatedAt: createdAt, eligibleCompanies: 4, requiredCompanies: 5, existingGrace: clearedGrace }, pastInitial);
  assert(r.state === 'GRACE', 'new drop after cleared grace → GRACE');
  assert(r.graceWrite.type === 'start', 'new drop after cleared grace → starts a fresh grace window');
}

console.log('\n8. Structural regression guard — sync-gestoria-eligibility cron endpoint');

{
  // Mirrors the same "auth gate before any Prisma call" structural check
  // used for the packs/purchase security fix
  // (scripts/test-gestoria-packs-purchase-authz.ts) — cheap insurance
  // against someone accidentally removing the isAuthorizedCron() gate.
  const jobPath = path.join(__dirname, '..', 'app', 'api', 'jobs', 'sync-gestoria-eligibility', 'route.ts');
  const src = fs.readFileSync(jobPath, 'utf8');

  const idxImportGuard = src.indexOf("isAuthorizedCron } from '@/lib/process-queue-helpers'");
  const idxAuthCheck = src.indexOf('isAuthorizedCron(request)');
  const idxCompanyFindMany = src.indexOf('prisma.company.findMany(');

  assert(idxImportGuard !== -1, 'sync job imports isAuthorizedCron from the shared cron-auth helper (no parallel auth mechanism)');
  assert(idxAuthCheck !== -1, 'sync job calls isAuthorizedCron(request)');
  assert(
    idxAuthCheck !== -1 && idxCompanyFindMany !== -1 && idxAuthCheck < idxCompanyFindMany,
    'isAuthorizedCron() is checked BEFORE any Prisma query (no data touched for unauthorized callers)',
  );
}

{
  // vercel.json must actually wire the endpoint in — otherwise it's dead
  // code nobody ever calls, silently never keeping grace state fresh for
  // firms whose admins stop visiting the dashboard.
  const vercelJsonPath = path.join(__dirname, '..', 'vercel.json');
  const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
  const hasSyncCron = (vercelConfig.crons ?? []).some((c: any) => c.path === '/api/jobs/sync-gestoria-eligibility');
  assert(hasSyncCron, 'vercel.json crons[] includes /api/jobs/sync-gestoria-eligibility');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
