import { prisma } from "@/lib/prisma";
import { INTERNAL_COMPANY_TYPE } from "@/lib/admin/platform-admin";
import { getLatestSubscriptionMap, type SubscriptionSummary } from "@/lib/admin/company-metrics";

// Central eligibility engine for the NEW Gestoria model (plan: "Gestoria
// gratis con 5 empresas"). Single canonical source of state — every
// API route/UI surface must call getGestoriaEligibility() rather than
// recomputing any of this locally.
//
// Deliberately separate from the LEGACY pack model (LicensePack/License/
// LicenseInvitation): a firm is LEGACY forever once it has purchased at
// least one pack, and this engine returns state 'LEGACY' immediately for
// it without touching GestoriaClientRelation logic at all.

export const GESTORIA_REQUIRED_COMPANIES = 5;
export const GESTORIA_INITIAL_PERIOD_DAYS = 60;
export const GESTORIA_GRACE_PERIOD_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type GestoriaState = "LEGACY" | "INITIAL" | "ELIGIBLE" | "GRACE" | "LIMITED";
export type GestoriaAccessLevel = "FULL" | "LIMITED";

export type CompanyEligibilityReason =
  | "eligible"
  | "internal"
  | "beta"
  | "no_subscription"
  | "not_profesional_plan"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "inactive";

export interface CompanyEligibilityResult {
  counts: boolean;
  reason: CompanyEligibilityReason;
}

export interface SubscriptionEligibilityInput {
  isBeta: boolean;
  companyType: string;
  subscription: {
    plan_name: string;
    status: string;
    trial_end: Date | null;
    payment_failure_count: number;
  } | null;
}

/**
 * Pure classification of a single company's eligibility toward the "5
 * companies" count. No Prisma access — testable in isolation (see
 * scripts/test-gestoria-eligibility.ts).
 *
 * 'trialing' is NOT a distinct internal status (the Stripe webhook maps it
 * to our internal 'active' — see app/api/webhooks/stripe/route.ts), so the
 * only reliable signal for "still inside the trial window" is trial_end,
 * checked in addition to status. cancel_at_period_end deliberately has no
 * special case here: Stripe keeps status='active' for the whole paid
 * period regardless of that flag, and only flips it to 'cancelled' via the
 * customer.subscription.deleted webhook once the period genuinely ends —
 * so "counts while still active, stops when it really ends" is already the
 * native behavior of the mirrored data.
 */
export function classifyCompanyEligibility(
  input: SubscriptionEligibilityInput,
  now: Date = new Date(),
): CompanyEligibilityResult {
  if (input.companyType === INTERNAL_COMPANY_TYPE) return { counts: false, reason: "internal" };
  if (input.isBeta) return { counts: false, reason: "beta" };
  if (!input.subscription) return { counts: false, reason: "no_subscription" };

  const sub = input.subscription;
  if (sub.plan_name !== "profesional") return { counts: false, reason: "not_profesional_plan" };
  if (sub.status === "cancelled") return { counts: false, reason: "canceled" };
  if (sub.status === "past_due") {
    return { counts: false, reason: sub.payment_failure_count >= 2 ? "unpaid" : "past_due" };
  }
  if (sub.status !== "active") return { counts: false, reason: "inactive" };
  if (sub.trial_end && sub.trial_end.getTime() > now.getTime()) return { counts: false, reason: "trialing" };

  return { counts: true, reason: "eligible" };
}

export interface RelationLike {
  client_company_id: string;
  status: string; // only 'active' relations are ever counted
}

export interface CompanyLike {
  name: string;
  company_type: string;
  is_beta: boolean;
}

export interface CompanyBreakdownEntry {
  companyId: string;
  companyName: string;
  counts: boolean;
  reason: CompanyEligibilityReason;
}

export interface EligibilityBreakdown {
  eligibleCompanies: number;
  companies: CompanyBreakdownEntry[];
}

/**
 * Pure aggregation over already-fetched relations/companies/subscriptions —
 * factored out of getGestoriaEligibility so the "which companies count and
 * why" logic is testable without a database. Non-active relations (ended,
 * or — since pending invitations never create a relation row at all —
 * inherently absent) are excluded before classification ever runs.
 */
export function buildEligibilityBreakdown(
  relations: RelationLike[],
  companiesById: Map<string, CompanyLike>,
  subscriptionsByCompanyId: Map<string, SubscriptionSummary>,
  now: Date = new Date(),
): EligibilityBreakdown {
  const companies: CompanyBreakdownEntry[] = [];
  let eligibleCompanies = 0;

  for (const relation of relations) {
    if (relation.status !== "active") continue;
    const company = companiesById.get(relation.client_company_id);
    if (!company) continue; // defensive: relation pointing at a deleted company

    const subscription = subscriptionsByCompanyId.get(relation.client_company_id) ?? null;
    const { counts, reason } = classifyCompanyEligibility(
      { isBeta: company.is_beta, companyType: company.company_type, subscription },
      now,
    );

    if (counts) eligibleCompanies += 1;
    companies.push({ companyId: relation.client_company_id, companyName: company.name, counts, reason });
  }

  return { eligibleCompanies, companies };
}

export interface GraceRecordLike {
  eligibility_lost_at: Date | null;
  grace_ends_at: Date | null;
}

export interface InitialPeriod {
  startedAt: Date;
  endsAt: Date;
  isActive: boolean;
}

export interface GraceInfo {
  lossDetectedAt: Date;
  endsAt: Date;
  daysRemaining: number;
}

export type GraceWriteAction =
  | { type: "none" }
  | { type: "clear" }
  | { type: "start"; eligibility_lost_at: Date; grace_ends_at: Date };

export interface GestoriaStateResult {
  state: GestoriaState;
  initialPeriod: InitialPeriod | null;
  grace: GraceInfo | null;
  accessLevel: GestoriaAccessLevel;
  graceWrite: GraceWriteAction;
}

export interface ComputeStateInput {
  isLegacy: boolean;
  companyCreatedAt: Date;
  eligibleCompanies: number;
  requiredCompanies: number;
  existingGrace: GraceRecordLike | null;
}

/**
 * Pure state-machine step. No Prisma access. The only side effect this
 * function can request is expressed as `graceWrite` — the orchestrator
 * (getGestoriaEligibility) performs the actual persistence, idempotently.
 * See plan section 21/22: nothing here is persisted except
 * eligibility_lost_at/grace_ends_at, because everything else (state itself,
 * the initial-period window, the live company count) is always re-derivable.
 */
export function computeGestoriaState(input: ComputeStateInput, now: Date = new Date()): GestoriaStateResult {
  if (input.isLegacy) {
    return { state: "LEGACY", initialPeriod: null, grace: null, accessLevel: "FULL", graceWrite: { type: "none" } };
  }

  const startedAt = input.companyCreatedAt;
  const endsAt = new Date(startedAt.getTime() + GESTORIA_INITIAL_PERIOD_DAYS * MS_PER_DAY);
  const initialPeriod: InitialPeriod = { startedAt, endsAt, isActive: now.getTime() < endsAt.getTime() };

  const hadGrace =
    input.existingGrace &&
    (input.existingGrace.eligibility_lost_at !== null || input.existingGrace.grace_ends_at !== null);

  if (initialPeriod.isActive) {
    // Still inside the free 60-day window — full access regardless of count.
    // Defensive clear: grace should never be set this early, but if it is
    // (e.g. a manual DB edit), don't leave stale grace dates lying around.
    return {
      state: "INITIAL",
      initialPeriod,
      grace: null,
      accessLevel: "FULL",
      graceWrite: hadGrace ? { type: "clear" } : { type: "none" },
    };
  }

  const isEligibleNow = input.eligibleCompanies >= input.requiredCompanies;

  if (isEligibleNow) {
    return {
      state: "ELIGIBLE",
      initialPeriod,
      grace: null,
      accessLevel: "FULL",
      graceWrite: hadGrace ? { type: "clear" } : { type: "none" },
    };
  }

  // Below the threshold, past the initial period.
  if (input.existingGrace?.grace_ends_at) {
    const endsAtGrace = input.existingGrace.grace_ends_at;
    const lossDetectedAt = input.existingGrace.eligibility_lost_at ?? endsAtGrace;
    const stillInGrace = now.getTime() <= endsAtGrace.getTime();
    const daysRemaining = Math.max(0, Math.ceil((endsAtGrace.getTime() - now.getTime()) / MS_PER_DAY));

    return {
      state: stillInGrace ? "GRACE" : "LIMITED",
      initialPeriod,
      grace: { lossDetectedAt, endsAt: endsAtGrace, daysRemaining },
      accessLevel: stillInGrace ? "FULL" : "LIMITED",
      graceWrite: { type: "none" }, // already recorded; nothing new to persist
    };
  }

  // First time crossing below the threshold since INITIAL/ELIGIBLE — start grace now.
  const lossDetectedAt = now;
  const graceEndsAt = new Date(now.getTime() + GESTORIA_GRACE_PERIOD_DAYS * MS_PER_DAY);
  return {
    state: "GRACE",
    initialPeriod,
    grace: { lossDetectedAt, endsAt: graceEndsAt, daysRemaining: GESTORIA_GRACE_PERIOD_DAYS },
    accessLevel: "FULL",
    graceWrite: { type: "start", eligibility_lost_at: lossDetectedAt, grace_ends_at: graceEndsAt },
  };
}

export interface GestoriaEligibility {
  firmId: string;
  state: GestoriaState;
  isLegacy: boolean;
  eligibleCompanies: number;
  requiredCompanies: number;
  isEligible: boolean;
  companies: CompanyBreakdownEntry[];
  initialPeriod: InitialPeriod | null;
  grace: GraceInfo | null;
  accessLevel: GestoriaAccessLevel;
}

/** A firm is LEGACY forever once it has purchased at least one pack. */
export async function isLegacyGestoria(firmId: string): Promise<boolean> {
  const count = await prisma.licensePack.count({ where: { gestoria_company_id: firmId } });
  return count > 0;
}

/**
 * The canonical entry point. Reads current relations/subscriptions, computes
 * the full breakdown + state, and idempotently persists a grace-period
 * transition if the state machine says one is needed (starting or clearing
 * GestoriaEligibilityGrace). Safe to call as often as needed — e.g. on every
 * portal dashboard load AND from a daily cron safety net
 * (scripts/sync-gestoria-eligibility.ts) — calling it twice in a row with no
 * state change performs zero writes.
 */
export async function getGestoriaEligibility(firmId: string): Promise<GestoriaEligibility> {
  const now = new Date();

  const company = await prisma.company.findUnique({
    where: { id: firmId },
    select: { id: true, created_at: true },
  });
  if (!company) {
    throw new Error(`getGestoriaEligibility: company ${firmId} not found`);
  }

  const [isLegacy, relations, existingGrace] = await Promise.all([
    isLegacyGestoria(firmId),
    prisma.gestoriaClientRelation.findMany({
      where: { gestoria_company_id: firmId, status: "active" },
      select: { client_company_id: true, status: true },
    }),
    prisma.gestoriaEligibilityGrace.findUnique({
      where: { gestoria_company_id: firmId },
      select: { eligibility_lost_at: true, grace_ends_at: true },
    }),
  ]);

  const clientIds = relations.map((r) => r.client_company_id);

  let companiesById = new Map<string, CompanyLike>();
  let subscriptionsByCompanyId = new Map<string, SubscriptionSummary>();
  if (clientIds.length > 0) {
    const [companies, subscriptionMap] = await Promise.all([
      prisma.company.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true, company_type: true, is_beta: true },
      }),
      getLatestSubscriptionMap(clientIds),
    ]);
    companiesById = new Map(companies.map((c) => [c.id, c]));
    subscriptionsByCompanyId = subscriptionMap;
  }

  const breakdown = buildEligibilityBreakdown(relations, companiesById, subscriptionsByCompanyId, now);

  const stateResult = computeGestoriaState(
    {
      isLegacy,
      companyCreatedAt: company.created_at,
      eligibleCompanies: breakdown.eligibleCompanies,
      requiredCompanies: GESTORIA_REQUIRED_COMPANIES,
      existingGrace,
    },
    now,
  );

  if (stateResult.graceWrite.type === "start") {
    await prisma.gestoriaEligibilityGrace.upsert({
      where: { gestoria_company_id: firmId },
      update: {
        eligibility_lost_at: stateResult.graceWrite.eligibility_lost_at,
        grace_ends_at: stateResult.graceWrite.grace_ends_at,
      },
      create: {
        gestoria_company_id: firmId,
        eligibility_lost_at: stateResult.graceWrite.eligibility_lost_at,
        grace_ends_at: stateResult.graceWrite.grace_ends_at,
      },
    });
  } else if (stateResult.graceWrite.type === "clear" && existingGrace) {
    await prisma.gestoriaEligibilityGrace.update({
      where: { gestoria_company_id: firmId },
      data: { eligibility_lost_at: null, grace_ends_at: null },
    });
  }

  return {
    firmId,
    state: stateResult.state,
    isLegacy,
    eligibleCompanies: breakdown.eligibleCompanies,
    requiredCompanies: GESTORIA_REQUIRED_COMPANIES,
    isEligible: breakdown.eligibleCompanies >= GESTORIA_REQUIRED_COMPANIES,
    companies: breakdown.companies,
    initialPeriod: stateResult.initialPeriod,
    grace: stateResult.grace,
    accessLevel: stateResult.accessLevel,
  };
}

/**
 * Companies list every gestoria-scoped route resolves ownership against — a
 * lightweight helper so every new-model route uses the exact same
 * "does this relation really belong to this firm" check (see plan section
 * 29 — no IDOR between gestorias).
 */
export async function assertActiveRelationOwnership(relationId: string, firmId: string) {
  const relation = await prisma.gestoriaClientRelation.findUnique({ where: { id: relationId } });
  if (!relation || relation.gestoria_company_id !== firmId) return null;
  return relation;
}
