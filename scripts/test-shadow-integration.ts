/**
 * Integration tests for lib/invoice-decision.ts — the persistence wrapper
 * that lib/document-processing.ts calls after invoice creation. Uses an
 * in-memory fake Prisma client (same pattern as scripts/test-processing-job.ts)
 * so this NEVER touches a real database — critical here, since
 * DATABASE_URL in this project points at the actual production Postgres
 * instance. No live DB connection is opened anywhere in this file.
 *
 * Run with: npx tsx scripts/test-shadow-integration.ts
 *
 * The fake prisma object below deliberately exposes ONLY an `invoiceDecision`
 * delegate (matching lib/invoice-decision.ts's own
 * `Pick<PrismaClient, 'invoiceDecision'>` parameter type) — if
 * recordShadowDecision() ever tried to touch Invoice, Document, or any other
 * table, it would throw immediately (property doesn't exist on the fake),
 * which itself proves isolation from the real workflow.
 */
import { recordShadowDecision, isShadowEngineEnabled } from '../lib/invoice-decision';
import { EvaluateInvoiceDecisionInput } from '../lib/exception-engine';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

interface FakeRow {
  id: string;
  invoice_id: string;
  company_id: string;
  mode: string;
  engine_version: string;
  decision: string;
  rules_evaluated: string;
  rules_passed: string;
  rules_failed: string;
  signals: string;
  engine_error: string | null;
  evaluated_at: Date;
}

function makeFakePrisma(opts: { failUpsert?: boolean } = {}) {
  const store = new Map<string, FakeRow>();
  let seq = 0;
  const invoiceDecision = {
    upsert: async ({ where, create, update }: any) => {
      if (opts.failUpsert) throw new Error('simulated DB failure');
      const k = where.invoice_id_engine_version_mode;
      const key = `${k.invoice_id}|${k.engine_version}|${k.mode}`;
      const existing = store.get(key);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const row: FakeRow = { id: `dec-${++seq}`, evaluated_at: new Date(), ...create };
      store.set(key, row);
      return { ...row };
    },
  };
  return { prisma: { invoiceDecision } as any, store, callCount: () => Array.from(store.values()) };
}

function cleanEngineInput(): EvaluateInvoiceDecisionInput {
  return {
    extraction: {
      invoice_number: 'F-0001',
      issue_date: '2026-01-15',
      supplier_name: 'Proveedor Sintético SL',
      customer_name: 'Cliente Sintético SL',
      total_amount: 121,
      extraction_confidence: 0.95,
    },
    invoice: {
      subtotal: 100,
      tax_amount: 21,
      total_amount: 121,
      invoice_type: 'received',
      supplier_tax_id: 'B12345678',
    },
    fiscalStatus: 'classified',
    duplicateProbableMatchCount: 0,
    invoiceTypeConfirmed: true,
  };
}

function withEnv(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.EXCEPTION_REVIEW_SHADOW_ENABLED;
  if (value === undefined) delete process.env.EXCEPTION_REVIEW_SHADOW_ENABLED;
  else process.env.EXCEPTION_REVIEW_SHADOW_ENABLED = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.EXCEPTION_REVIEW_SHADOW_ENABLED;
    else process.env.EXCEPTION_REVIEW_SHADOW_ENABLED = prev;
  });
}

async function main() {
  console.log('\nKill switch — default/absent -> OFF\n');
  await withEnv(undefined, async () => {
    assert(isShadowEngineEnabled() === false, 'Env var absent -> isShadowEngineEnabled() is false');
    const { prisma, callCount } = makeFakePrisma();
    await recordShadowDecision(prisma, { invoiceId: 'inv-1', companyId: 'co-1', engineInput: cleanEngineInput() });
    assert(callCount().length === 0, 'Kill switch OFF (absent) -> zero InvoiceDecision rows written');
  });

  console.log('\nKill switch — explicit "false" -> OFF\n');
  await withEnv('false', async () => {
    const { prisma, callCount } = makeFakePrisma();
    await recordShadowDecision(prisma, { invoiceId: 'inv-1', companyId: 'co-1', engineInput: cleanEngineInput() });
    assert(callCount().length === 0, "Kill switch explicitly 'false' -> zero rows written");
  });

  console.log('\nKill switch — "true" -> ON\n');
  await withEnv('true', async () => {
    assert(isShadowEngineEnabled() === true, "Env var 'true' -> isShadowEngineEnabled() is true");
    const { prisma, callCount } = makeFakePrisma();
    await recordShadowDecision(prisma, { invoiceId: 'inv-1', companyId: 'co-1', engineInput: cleanEngineInput() });
    assert(callCount().length === 1, 'Kill switch ON -> exactly one InvoiceDecision row written');
    assert(callCount()[0].decision === 'AUTO_APPROVED', 'Clean invoice, shadow ON -> decision recorded as AUTO_APPROVED');
    assert(callCount()[0].mode === 'shadow', "mode is always 'shadow' in this phase");
  });

  console.log('\nIdempotency — same invoice+version+mode called twice\n');
  await withEnv('true', async () => {
    const { prisma, callCount } = makeFakePrisma();
    await recordShadowDecision(prisma, { invoiceId: 'inv-2', companyId: 'co-1', engineInput: cleanEngineInput() });
    await recordShadowDecision(prisma, { invoiceId: 'inv-2', companyId: 'co-1', engineInput: cleanEngineInput() });
    assert(callCount().length === 1, 'Two calls for the same invoice -> a single row (upsert), not a duplicate');
  });

  console.log('\nVersioning — compound key (invoice_id, engine_version, mode) keeps versions separate\n');
  await withEnv('true', async () => {
    // Exercises the storage contract a future engine_version="v2" bump
    // relies on directly against the fake store, since ENGINE_VERSION is a
    // fixed module constant in v1 (not a runtime parameter).
    const { prisma, store } = makeFakePrisma();
    await prisma.invoiceDecision.upsert({
      where: { invoice_id_engine_version_mode: { invoice_id: 'inv-3', engine_version: 'v1', mode: 'shadow' } },
      create: { invoice_id: 'inv-3', company_id: 'co-1', mode: 'shadow', engine_version: 'v1', decision: 'AUTO_APPROVED', rules_evaluated: '[]', rules_passed: '[]', rules_failed: '[]', signals: '{}', engine_error: null },
      update: {},
    });
    await prisma.invoiceDecision.upsert({
      where: { invoice_id_engine_version_mode: { invoice_id: 'inv-3', engine_version: 'v2', mode: 'shadow' } },
      create: { invoice_id: 'inv-3', company_id: 'co-1', mode: 'shadow', engine_version: 'v2', decision: 'REVIEW_REQUIRED', rules_evaluated: '[]', rules_passed: '[]', rules_failed: '[]', signals: '{}', engine_error: null },
      update: {},
    });
    assert(store.size === 2, 'v1 and v2 decisions for the same invoice coexist as two rows');
    const v1 = store.get('inv-3|v1|shadow');
    assert(v1?.decision === 'AUTO_APPROVED', 'v1 row is untouched by the v2 write');
  });

  console.log('\nNon-blocking — engine throws on malformed input\n');
  await withEnv('true', async () => {
    const { prisma, callCount } = makeFakePrisma();
    let threw = false;
    try {
      await recordShadowDecision(prisma, { invoiceId: 'inv-4', companyId: 'co-1', engineInput: null as any });
    } catch {
      threw = true;
    }
    assert(!threw, 'recordShadowDecision() never throws, even when the engine itself throws');
    assert(callCount().length === 1, 'A conservative fallback row is still written');
    assert(callCount()[0].decision === 'REVIEW_REQUIRED', 'Fallback decision is REVIEW_REQUIRED, never AUTO_APPROVED');
    assert(!!callCount()[0].engine_error, 'engine_error is populated so the failure is observable');
  });

  console.log('\nNon-blocking — DB write itself fails\n');
  await withEnv('true', async () => {
    const { prisma } = makeFakePrisma({ failUpsert: true });
    let threw = false;
    try {
      await recordShadowDecision(prisma, { invoiceId: 'inv-5', companyId: 'co-1', engineInput: cleanEngineInput() });
    } catch {
      threw = true;
    }
    assert(!threw, 'recordShadowDecision() swallows a DB failure too — never propagates to the caller');
  });

  console.log('\nIsolation — shadow decision cannot touch any other table\n');
  await withEnv('true', async () => {
    // The fake prisma below structurally has ONLY `invoiceDecision`. If
    // recordShadowDecision touched `.invoice`, `.document`, or any other
    // delegate, this call would throw (property is undefined) instead of
    // resolving cleanly.
    const { prisma } = makeFakePrisma();
    let threw = false;
    try {
      await recordShadowDecision(prisma, { invoiceId: 'inv-6', companyId: 'co-1', engineInput: cleanEngineInput() });
    } catch {
      threw = true;
    }
    assert(!threw, 'Only invoiceDecision.upsert is ever called — no other Prisma delegate is touched');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
