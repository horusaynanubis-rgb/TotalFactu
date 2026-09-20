// Shadow-mode persistence wrapper around lib/exception-engine.ts. This is
// the ONLY module that writes InvoiceDecision rows. Called from
// lib/document-processing.ts right after invoice creation — see the call
// site there for exactly which already-computed locals it reuses (zero
// extra queries beyond the upsert itself).
//
// Kill switch: EXCEPTION_REVIEW_SHADOW_ENABLED, same boolean-string idiom as
// FORCE_LOCAL_AI in lib/ai-extraction.ts. Default OFF — absent, empty, or
// anything other than the literal string 'true' means no evaluation, no
// write, zero added cost. Never enabled here; toggled externally via env.
//
// recordShadowDecision() never throws. Engine failures and DB failures are
// both logged and swallowed — this function's only contract with its caller
// is "never affects the real invoice processing pipeline".
//
// The Prisma client is passed in explicitly (same dependency-injection
// pattern as lib/processing-job.ts#enqueueJob) rather than imported as a
// module-level singleton, so tests can pass a fake/in-memory client and
// never touch a real database — see scripts/test-shadow-integration.ts.
import type { PrismaClient } from '@prisma/client';
import {
  evaluateInvoiceDecision,
  ENGINE_VERSION,
  EvaluateInvoiceDecisionInput,
  ShadowDecision,
} from './exception-engine';

export function isShadowEngineEnabled(): boolean {
  return process.env.EXCEPTION_REVIEW_SHADOW_ENABLED === 'true';
}

export interface RecordShadowDecisionInput {
  invoiceId: string;
  companyId: string;
  engineInput: EvaluateInvoiceDecisionInput;
}

export async function recordShadowDecision(
  prisma: Pick<PrismaClient, 'invoiceDecision'>,
  input: RecordShadowDecisionInput,
): Promise<void> {
  if (!isShadowEngineEnabled()) return;

  const { invoiceId, companyId, engineInput } = input;

  let decision: ShadowDecision = 'REVIEW_REQUIRED';
  let rulesEvaluated: unknown[] = [];
  let rulesPassed: unknown[] = [];
  let rulesFailed: unknown[] = [];
  let signals: Record<string, unknown> = {};
  let engineError: string | null = null;

  try {
    const result = evaluateInvoiceDecision(engineInput);
    decision = result.decision;
    rulesEvaluated = result.rules_evaluated;
    rulesPassed = result.rules_passed;
    rulesFailed = result.rules_failed;
    signals = result.signals;
  } catch (err: any) {
    // Engine itself threw — conservative fallback, never AUTO_APPROVED on error.
    engineError = err?.message ?? 'Unknown exception-engine error';
    decision = 'REVIEW_REQUIRED';
    console.error(
      `[shadow-engine] evaluation threw (non-fatal) invoiceId=${invoiceId} engine_version=${ENGINE_VERSION} error=${engineError}`,
    );
  }

  try {
    await prisma.invoiceDecision.upsert({
      where: {
        invoice_id_engine_version_mode: {
          invoice_id: invoiceId,
          engine_version: ENGINE_VERSION,
          mode: 'shadow',
        },
      },
      create: {
        invoice_id: invoiceId,
        company_id: companyId,
        mode: 'shadow',
        engine_version: ENGINE_VERSION,
        decision,
        rules_evaluated: JSON.stringify(rulesEvaluated),
        rules_passed: JSON.stringify(rulesPassed),
        rules_failed: JSON.stringify(rulesFailed),
        signals: JSON.stringify(signals),
        engine_error: engineError,
      },
      update: {
        decision,
        rules_evaluated: JSON.stringify(rulesEvaluated),
        rules_passed: JSON.stringify(rulesPassed),
        rules_failed: JSON.stringify(rulesFailed),
        signals: JSON.stringify(signals),
        engine_error: engineError,
        evaluated_at: new Date(),
      },
    });
    console.log(
      `[shadow-engine] evaluated invoiceId=${invoiceId} engine_version=${ENGINE_VERSION} decision=${decision} ` +
        `gates_failed=${rulesFailed.length}${engineError ? ' engine_error=true' : ''}`,
    );
  } catch (dbErr: any) {
    console.error(
      `[shadow-engine] persistence failed (non-fatal) invoiceId=${invoiceId} engine_version=${ENGINE_VERSION} error=${dbErr?.message}`,
    );
  }
}
