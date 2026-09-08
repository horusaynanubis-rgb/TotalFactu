import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { processDocument } from '@/lib/document-processing';
import { claimJobs, completeJob, failJob, recoverAbandonedJobs } from '@/lib/processing-job';
import { classifyForRetry, isAuthorized } from '@/lib/process-queue-helpers';

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

    const claimed = await claimJobs(prisma, workerId, 1);
    if (claimed.length === 0) {
      return NextResponse.json({ message: 'No queued jobs', workerId });
    }

    const job = claimed[0];
    console.log(`[jobs:process-queue] workerId=${workerId} claimed jobId=${job.id} documentId=${job.document_id} attempt=${job.attempts + 1}/${job.max_attempts}`);

    const result = await processDocument(job.document_id, {
      hint: job.hint ?? undefined,
      geminiTimeouts: WORKER_GEMINI_TIMEOUTS,
      notifyTelegramOnSuccess: true,
    });

    if (result.status === 200) {
      await completeJob(prisma, job.id);
      console.log(`[jobs:process-queue] workerId=${workerId} jobId=${job.id} DONE`);
      return NextResponse.json({ message: 'Job completed', workerId, jobId: job.id, documentId: job.document_id });
    }

    const errorCode = classifyForRetry(result.errorType);
    const { retried } = await failJob(prisma, job, errorCode, result.body?.message ?? 'Unknown processing error');
    console.log(`[jobs:process-queue] workerId=${workerId} jobId=${job.id} FAILED errorCode=${errorCode} retried=${retried}`);

    return NextResponse.json({
      message: retried ? 'Job failed, requeued for retry' : 'Job failed, terminal',
      workerId, jobId: job.id, documentId: job.document_id, errorCode, retried,
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
