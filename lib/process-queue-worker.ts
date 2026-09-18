// Pure orchestration for draining the ProcessingJob queue — no direct Prisma
// or Gemini/network imports, so it can be unit-tested with fakes (see
// scripts/test-process-queue-worker.ts) the same way lib/processing-job.ts
// itself is tested. app/api/jobs/process-queue/route.ts wires this up with
// the real Prisma-bound primitives from lib/processing-job.ts and the real
// processDocument() from lib/document-processing.ts — this module never
// duplicates that logic, only sequences it.
import { ClaimedJob, JobErrorCode } from './processing-job';

export interface ProcessDocumentOutcome {
  status: number;
  body?: { message?: string };
  errorType?: JobErrorCode;
}

export interface WorkerDeps {
  claimJobs: (workerId: string, limit: number) => Promise<ClaimedJob[]>;
  processDocument: (documentId: string, opts: { hint?: string }) => Promise<ProcessDocumentOutcome>;
  completeJob: (jobId: string) => Promise<void>;
  failJob: (job: ClaimedJob, errorCode: JobErrorCode, message: string) => Promise<{ retried: boolean }>;
  classifyForRetry: (errorType: string | undefined) => JobErrorCode;
  log?: (msg: string) => void;
}

export interface JobCycleResult {
  claimed: boolean;
  jobId?: string;
  documentId?: string;
  outcome?: 'done' | 'retried' | 'terminal';
  errorCode?: JobErrorCode;
}

/**
 * Claims and processes AT MOST one job. `{ claimed: false }` when the queue
 * has nothing eligible right now (empty, or every queued row's
 * next_attempt_at is still in the future) — this is the exact single-job
 * cycle the POST handler has always run; drainQueue() below just calls it
 * repeatedly.
 */
export async function runOneJobCycle(deps: WorkerDeps, workerId: string): Promise<JobCycleResult> {
  const claimed = await deps.claimJobs(workerId, 1);
  if (claimed.length === 0) return { claimed: false };

  const job = claimed[0];
  deps.log?.(`workerId=${workerId} claimed jobId=${job.id} documentId=${job.document_id} attempt=${job.attempts + 1}/${job.max_attempts}`);

  const result = await deps.processDocument(job.document_id, { hint: job.hint ?? undefined });

  if (result.status === 200) {
    await deps.completeJob(job.id);
    deps.log?.(`workerId=${workerId} jobId=${job.id} DONE`);
    return { claimed: true, jobId: job.id, documentId: job.document_id, outcome: 'done' };
  }

  const errorCode = deps.classifyForRetry(result.errorType);
  const { retried } = await deps.failJob(job, errorCode, result.body?.message ?? 'Unknown processing error');
  deps.log?.(`workerId=${workerId} jobId=${job.id} FAILED errorCode=${errorCode} retried=${retried}`);
  return { claimed: true, jobId: job.id, documentId: job.document_id, outcome: retried ? 'retried' : 'terminal', errorCode };
}

export interface DrainOptions {
  maxJobs: number;
  timeBudgetMs: number;
  now?: () => number; // injectable clock for tests
}

export interface DrainResult {
  processed: JobCycleResult[];
  stoppedReason: 'empty' | 'max_jobs' | 'time_budget';
}

/**
 * Repeatedly runs runOneJobCycle (same code path as a single POST
 * invocation — never a second implementation of the claim/process/complete
 * logic) until the queue is empty or a safety bound is hit.
 *
 * Exists because this project is on the Vercel Hobby plan, where a Cron Job
 * can run at most once a day (see app/api/jobs/process-queue/route.ts GET
 * handler and vercel.json) — draining only one job per invocation would
 * leave the rest of a day's backlog stuck regardless of how many documents
 * came in. maxJobs/timeBudgetMs bound a single invocation so it can never
 * itself become a new kind of "stuck forever" (runs inside maxDuration=180s).
 */
export async function drainQueue(deps: WorkerDeps, workerId: string, opts: DrainOptions): Promise<DrainResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const processed: JobCycleResult[] = [];

  while (processed.length < opts.maxJobs) {
    if (now() - startedAt >= opts.timeBudgetMs) {
      return { processed, stoppedReason: 'time_budget' };
    }
    const cycle = await runOneJobCycle(deps, workerId);
    if (!cycle.claimed) return { processed, stoppedReason: 'empty' };
    processed.push(cycle);
  }
  return { processed, stoppedReason: 'max_jobs' };
}
