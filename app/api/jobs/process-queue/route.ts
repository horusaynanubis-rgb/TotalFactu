import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { processDocument } from '@/lib/document-processing';
import { claimJobs, completeJob, failJob, recoverAbandonedJobs } from '@/lib/processing-job';
import { classifyForRetry, isAuthorized, isAuthorizedCron } from '@/lib/process-queue-helpers';
import { runOneJobCycle, drainQueue, WorkerDeps } from '@/lib/process-queue-worker';

export const dynamic = 'force-dynamic';
// Real budget confirmed empirically (Paso 0, 2026-09-08): this project's
// Vercel plan sustains ~150s executions without being killed. 180s leaves
// headroom above the largest Gemini budget we hand out below (110s) plus
// storage download (~20s) and DB writes.
export const maxDuration = 180;

// Gemini timeout budget for THIS worker only — the synchronous route
// (app/api/documents/[id]/process/route.ts) is untouched and still uses its
// original 40s/20s/25s defaults. This is the whole point of the async
// worker: give LARGE_INVOICE's header+lines two-pass fallback (and a slow
// NORMAL call) the time it legitimately needs, without risking the
// Telegram webhook's maxDuration=60s.
const WORKER_GEMINI_TIMEOUTS = {
  normalMs: 110_000,
  headerMs: 30_000,
  linesMs: 70_000,
};

// The cron drain loop (GET, below) stops well before maxDuration so the
// in-flight job's own Gemini budget always has room to finish cleanly
// instead of being killed mid-call. DRAIN_MAX_JOBS is a second, independent
// cap — a plain safety valve so one invocation can never monopolize the
// worker indefinitely even if jobs somehow complete unusually fast.
const DRAIN_TIME_BUDGET_MS = 150_000;
const DRAIN_MAX_JOBS = 25;

function buildWorkerDeps(logPrefix: string): WorkerDeps {
  return {
    claimJobs: (workerId, limit) => claimJobs(prisma, workerId, limit),
    processDocument: (documentId, opts) =>
      processDocument(documentId, { ...opts, geminiTimeouts: WORKER_GEMINI_TIMEOUTS, notifyTelegramOnSuccess: true }),
    completeJob: (jobId) => completeJob(prisma, jobId),
    failJob: (job, errorCode, message) => failJob(prisma, job, errorCode, message),
    classifyForRetry,
    log: (msg) => console.log(`${logPrefix} ${msg}`),
  };
}

// Best-effort fast path: the Telegram webhook (app/api/webhooks/telegram/route.ts)
// fires this immediately after enqueuing a job, without awaiting it, so most
// documents get processed within seconds. If that fire-and-forget call never
// lands (known gap — see GET below for the fallback), the job simply stays
// queued until the cron drain picks it up; it is never lost or marked failed
// just for being old.
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const workerId = `worker-${randomUUID()}`;

  try {
    const recovered = await recoverAbandonedJobs(prisma);
    if (recovered > 0) {
      console.log(`[jobs:process-queue] workerId=${workerId} recovered ${recovered} abandoned job(s)`);
    }

    const deps = buildWorkerDeps('[jobs:process-queue]');
    const cycle = await runOneJobCycle(deps, workerId);
    if (!cycle.claimed) {
      return NextResponse.json({ message: 'No queued jobs', workerId });
    }

    if (cycle.outcome === 'done') {
      return NextResponse.json({ message: 'Job completed', workerId, jobId: cycle.jobId, documentId: cycle.documentId });
    }

    return NextResponse.json({
      message: cycle.outcome === 'retried' ? 'Job failed, requeued for retry' : 'Job failed, terminal',
      workerId,
      jobId: cycle.jobId,
      documentId: cycle.documentId,
      errorCode: cycle.errorCode,
      retried: cycle.outcome === 'retried',
    });
  } catch (error: any) {
    // Anything thrown here happened OUTSIDE processDocument's own try/catch
    // (e.g. the claim query itself, or completeJob/failJob failing) — the
    // job stays 'claimed' and will be picked up by recoverAbandonedJobs()
    // on a later invocation rather than being stuck forever.
    console.error(`[jobs:process-queue] workerId=${workerId} unhandled error:`, error?.message);
    return NextResponse.json({ message: 'Worker error', workerId, error: error?.message }, { status: 500 });
  }
}

// Rescue path — invoked by Vercel Cron (see vercel.json). Vercel always
// calls cron targets with GET and, when a CRON_SECRET env var is set on the
// project, an automatic `Authorization: Bearer <CRON_SECRET>` header (see
// isAuthorizedCron() in lib/process-queue-helpers.ts). Requires CRON_SECRET
// to be added to the Vercel project's Production env vars — see the
// deployment note in vercel.json.
//
// Drains MULTIPLE queued jobs per invocation (drainQueue, lib/process-queue-worker.ts)
// instead of just one: this project is on the Vercel Hobby plan, where a
// cron job can run at most once per day (any more-frequent expression fails
// deployment — https://vercel.com/docs/cron-jobs/usage-and-pricing). vercel.json
// works around that with 4 daily cron entries (~every 6h) at the SAME path,
// but even so, one job per run would leave same-day backlog stuck. This
// never converts a healthy queued job to failed for being old — it only
// claims jobs whose next_attempt_at has already arrived, via the exact same
// claimJobs()/runOneJobCycle() used by the POST fast path above.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const workerId = `cron-${randomUUID()}`;

  try {
    const recovered = await recoverAbandonedJobs(prisma);
    if (recovered > 0) {
      console.log(`[jobs:process-queue:cron] workerId=${workerId} recovered ${recovered} abandoned job(s)`);
    }

    const deps = buildWorkerDeps('[jobs:process-queue:cron]');
    const { processed, stoppedReason } = await drainQueue(deps, workerId, {
      maxJobs: DRAIN_MAX_JOBS,
      timeBudgetMs: DRAIN_TIME_BUDGET_MS,
    });

    const done = processed.filter((r) => r.outcome === 'done').length;
    const failedCount = processed.length - done;
    console.log(
      `[jobs:process-queue:cron] workerId=${workerId} drained ${processed.length} job(s) done=${done} failed=${failedCount} stoppedReason=${stoppedReason}`,
    );

    return NextResponse.json({
      message: 'Drain complete',
      workerId,
      processed: processed.length,
      done,
      failed: failedCount,
      stoppedReason,
    });
  } catch (error: any) {
    console.error(`[jobs:process-queue:cron] workerId=${workerId} unhandled error:`, error?.message);
    return NextResponse.json({ message: 'Worker error', workerId, error: error?.message }, { status: 500 });
  }
}
