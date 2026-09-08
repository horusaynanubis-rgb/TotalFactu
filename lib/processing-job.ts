// ProcessingJob helper layer (2026-09-08 async worker MVP).
//
// Design invariant: at most ONE ProcessingJob row EVER exists per Document
// (document_id is UNIQUE at the DB level — see prisma/migrations/add_processing_job.sql).
// Automatic retries mutate the SAME row (attempts++). A brand new attempt
// after a terminal state ('done'/'dead') is a deliberate human action
// (manual reprocess), not something this module does automatically — see
// enqueueJob()'s handling of an existing terminal job.
import { PrismaClient } from '@prisma/client';

export const JOB_STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  DONE: 'done',
  FAILED: 'failed',
  DEAD: 'dead',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

// A job "claimed" longer than this without completing is presumed to
// belong to a worker invocation that died (platform kill, uncaught crash).
// Safely above the worker's own maxDuration (180s) — see
// app/api/jobs/process-queue/route.ts.
export const ABANDONED_CLAIM_MINUTES = 5;

export const DEFAULT_MAX_ATTEMPTS = 2;

// ---------------------------------------------------------------------------
// Retry policy — Fase 5 of the plan. Pure/testable, no I/O.
// ---------------------------------------------------------------------------

export type JobErrorCode =
  | 'billing_exhausted'
  | 'timeout'
  | 'storage_timeout'
  | 'rate_limit_transient'
  | 'max_tokens'
  | 'invalid_json'
  | 'other';

export interface RetryDecision {
  retry: boolean;
  backoffMs: number;
}

// error_code -> { should this class of error ever be retried?, backoff if so }
const RETRY_POLICY: Record<JobErrorCode, RetryDecision> = {
  billing_exhausted: { retry: false, backoffMs: 0 }, // permanent — never helps (2026-09-07 incident)
  max_tokens: { retry: false, backoffMs: 0 }, // adaptive NORMAL->LARGE_INVOICE already happened inside the attempt; a 2nd job-level try won't change the outcome
  timeout: { retry: true, backoffMs: 60_000 },
  storage_timeout: { retry: true, backoffMs: 30_000 },
  rate_limit_transient: { retry: true, backoffMs: 30_000 },
  invalid_json: { retry: true, backoffMs: 15_000 },
  other: { retry: false, backoffMs: 0 }, // permanent/functional errors — no evidence retrying helps
};

/**
 * Decides whether a failed job should be requeued or marked dead.
 * Never loops within a single execution — this only ever runs once, AFTER
 * a job attempt has already finished (success or failure), to decide the
 * NEXT job-level attempt (a separate future invocation of the worker).
 */
export function decideRetry(errorCode: JobErrorCode, attempts: number, maxAttempts: number): RetryDecision {
  if (attempts >= maxAttempts) return { retry: false, backoffMs: 0 };
  const policy = RETRY_POLICY[errorCode] ?? RETRY_POLICY.other;
  return policy.retry ? policy : { retry: false, backoffMs: 0 };
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export type EnqueueResult =
  | { outcome: 'created'; jobId: string }
  | { outcome: 'already_active'; jobId: string } // an active (queued/claimed) job already exists — do NOT create a second one
  | { outcome: 'reset_for_retry'; jobId: string }; // a terminal job existed (done/dead) — reset to queued for a fresh manual attempt

/**
 * Creates a ProcessingJob for a Document, or reuses the existing one.
 * document_id is UNIQUE, so this never produces two active jobs for the
 * same Document — the actual duplicate-file protection (content_hash) is
 * unchanged and independent, this only prevents duplicate JOB rows for the
 * SAME Document row.
 */
export async function enqueueJob(
  prisma: PrismaClient,
  documentId: string,
  companyId: string,
  hint?: string,
): Promise<EnqueueResult> {
  const existing = await prisma.processingJob.findUnique({ where: { document_id: documentId } });

  if (!existing) {
    const created = await prisma.processingJob.create({
      data: { document_id: documentId, company_id: companyId, hint: hint ?? null },
    });
    return { outcome: 'created', jobId: created.id };
  }

  if (existing.status === JOB_STATUS.QUEUED || existing.status === JOB_STATUS.CLAIMED) {
    return { outcome: 'already_active', jobId: existing.id };
  }

  // Terminal (done/dead) — a fresh enqueue is a deliberate reprocess.
  await prisma.processingJob.update({
    where: { id: existing.id },
    data: { status: JOB_STATUS.QUEUED, attempts: 0, next_attempt_at: new Date(), last_error: null, error_code: null, completed_at: null, claimed_at: null, claimed_by: null, hint: hint ?? null },
  });
  return { outcome: 'reset_for_retry', jobId: existing.id };
}

// ---------------------------------------------------------------------------
// Claim — atomic, race-safe across concurrent worker invocations
// ---------------------------------------------------------------------------

export interface ClaimedJob {
  id: string;
  document_id: string;
  company_id: string;
  attempts: number;
  max_attempts: number;
  hint: string | null;
}

/**
 * Atomically claims up to `limit` queued jobs whose next_attempt_at has
 * arrived. Uses SELECT ... FOR UPDATE SKIP LOCKED so two overlapping
 * worker invocations can never claim the same row — Prisma has no
 * declarative API for this, hence the raw SQL.
 */
export async function claimJobs(prisma: PrismaClient, workerId: string, limit: number): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "ProcessingJob"
    SET status = ${JOB_STATUS.CLAIMED}, claimed_at = now(), claimed_by = ${workerId}, updated_at = now()
    WHERE id IN (
      SELECT id FROM "ProcessingJob"
      WHERE status = ${JOB_STATUS.QUEUED} AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, document_id, company_id, attempts, max_attempts, hint;
  `;
}

// ---------------------------------------------------------------------------
// Complete / fail
// ---------------------------------------------------------------------------

export async function completeJob(prisma: PrismaClient, jobId: string): Promise<void> {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: JOB_STATUS.DONE, completed_at: new Date(), last_error: null, error_code: null },
  });
}

/**
 * Records a failed attempt and either requeues (with backoff) or marks the
 * job dead, per decideRetry(). Never retries within the same execution —
 * a "retry" here always means a LATER worker invocation picks it up again.
 */
export async function failJob(
  prisma: PrismaClient,
  job: ClaimedJob,
  errorCode: JobErrorCode,
  errorMessage: string,
): Promise<{ retried: boolean }> {
  const attempts = job.attempts + 1;
  const decision = decideRetry(errorCode, attempts, job.max_attempts);

  if (decision.retry) {
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS.QUEUED,
        attempts,
        next_attempt_at: new Date(Date.now() + decision.backoffMs),
        claimed_at: null,
        claimed_by: null,
        last_error: errorMessage.slice(0, 500),
        error_code: errorCode,
      },
    });
    return { retried: true };
  }

  await prisma.processingJob.update({
    where: { id: job.id },
    data: {
      status: attempts >= job.max_attempts ? JOB_STATUS.DEAD : JOB_STATUS.FAILED,
      attempts,
      last_error: errorMessage.slice(0, 500),
      error_code: errorCode,
    },
  });
  return { retried: false };
}

// ---------------------------------------------------------------------------
// Abandoned claim recovery
// ---------------------------------------------------------------------------

/**
 * Requeues jobs stuck in 'claimed' past ABANDONED_CLAIM_MINUTES — the
 * worker that claimed them almost certainly died mid-execution. Does NOT
 * increment attempts by itself beyond what failJob would (this is a
 * recovery, not a counted failure) — kept simple for the MVP: bump
 * attempts here too so a repeatedly-abandoned job still eventually reaches
 * max_attempts and stops instead of looping forever across invocations.
 */
export async function recoverAbandonedJobs(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDONED_CLAIM_MINUTES * 60_000);
  const result = await prisma.$executeRaw`
    UPDATE "ProcessingJob"
    SET status = ${JOB_STATUS.QUEUED}, next_attempt_at = now(), attempts = attempts + 1,
        claimed_at = NULL, claimed_by = NULL,
        last_error = 'Recovered: worker claimed this job and never completed it (presumed killed).',
        error_code = 'other', updated_at = now()
    WHERE status = ${JOB_STATUS.CLAIMED} AND claimed_at < ${cutoff}
      AND attempts < max_attempts;
  `;
  // Anything past max_attempts and still abandoned goes straight to dead —
  // no point requeuing a job that would immediately fail decideRetry() anyway.
  await prisma.$executeRaw`
    UPDATE "ProcessingJob"
    SET status = ${JOB_STATUS.DEAD}, claimed_at = NULL, claimed_by = NULL,
        last_error = 'Recovered: worker claimed this job and never completed it, attempts exhausted.',
        error_code = 'other', updated_at = now()
    WHERE status = ${JOB_STATUS.CLAIMED} AND claimed_at < ${cutoff}
      AND attempts >= max_attempts;
  `;
  return Number(result);
}
