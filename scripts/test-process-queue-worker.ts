/**
 * Tests for lib/process-queue-worker.ts (2026-09-18 queued-job rescue fix)
 * and the new isAuthorizedCron() guard in lib/process-queue-helpers.ts — no
 * real DB, no network, no Gemini. The fake ProcessingJob table + claim/
 * recover implementation below mirrors scripts/test-processing-job.ts's
 * fake Prisma exactly (same raw-SQL semantics for claimJobs/recoverAbandonedJobs),
 * so these tests exercise the REAL claimJobs()/completeJob()/failJob()/
 * recoverAbandonedJobs() from lib/processing-job.ts — only Prisma and
 * processDocument (Gemini) are faked, same boundary the rest of the test
 * suite uses.
 * Run with: npx tsx scripts/test-process-queue-worker.ts
 */
import {
  enqueueJob, claimJobs, completeJob, failJob, recoverAbandonedJobs,
  JOB_STATUS, ABANDONED_CLAIM_MINUTES,
} from '../lib/processing-job';
import { classifyForRetry, isAuthorized, isAuthorizedCron } from '../lib/process-queue-helpers';
import { runOneJobCycle, drainQueue, WorkerDeps, ProcessDocumentOutcome } from '../lib/process-queue-worker';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

// ---------------------------------------------------------------------------
// Fake Prisma — identical semantics to scripts/test-processing-job.ts.
// ---------------------------------------------------------------------------
interface Row {
  id: string; document_id: string; company_id: string; status: string;
  attempts: number; max_attempts: number; next_attempt_at: Date;
  claimed_at: Date | null; claimed_by: string | null; completed_at: Date | null;
  last_error: string | null; error_code: string | null; hint: string | null;
}

function makeFakePrisma() {
  const table: Row[] = [];
  let seq = 0;

  const fake = {
    processingJob: {
      findUnique: async ({ where: { document_id } }: any) =>
        table.find((r) => r.document_id === document_id) ?? null,
      create: async ({ data }: any) => {
        const row: Row = {
          id: `job-${++seq}`, document_id: data.document_id, company_id: data.company_id,
          status: JOB_STATUS.QUEUED, attempts: 0, max_attempts: 2, next_attempt_at: new Date(),
          claimed_at: null, claimed_by: null, completed_at: null, last_error: null, error_code: null,
          hint: data.hint ?? null,
        };
        table.push(row);
        return { ...row };
      },
      update: async ({ where: { id }, data }: any) => {
        const row = table.find((r) => r.id === id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('RETURNING id, document_id')) {
        const [claimedStatus, workerId, , limit] = values;
        const now = new Date();
        const eligible = table
          .filter((r) => r.status === JOB_STATUS.QUEUED && r.next_attempt_at <= now)
          .sort((a, b) => a.next_attempt_at.getTime() - b.next_attempt_at.getTime())
          .slice(0, limit);
        for (const row of eligible) {
          row.status = claimedStatus;
          row.claimed_at = now;
          row.claimed_by = workerId;
        }
        return eligible.map((r) => ({
          id: r.id, document_id: r.document_id, company_id: r.company_id,
          attempts: r.attempts, max_attempts: r.max_attempts, hint: r.hint,
        })) as any;
      }
      throw new Error(`fake $queryRaw: unrecognized query: ${sql}`);
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('attempts < max_attempts')) {
        const [queuedStatus, claimedStatus, cutoff] = values;
        let n = 0;
        for (const row of table) {
          if (row.status === claimedStatus && row.claimed_at && row.claimed_at < cutoff && row.attempts < row.max_attempts) {
            row.status = queuedStatus; row.next_attempt_at = new Date(); row.attempts += 1;
            row.claimed_at = null; row.claimed_by = null;
            row.last_error = 'Recovered: worker claimed this job and never completed it (presumed killed).';
            row.error_code = 'other';
            n++;
          }
        }
        return n as any;
      }
      if (sql.includes('attempts >= max_attempts')) {
        const [deadStatus, claimedStatus, cutoff] = values;
        let n = 0;
        for (const row of table) {
          if (row.status === claimedStatus && row.claimed_at && row.claimed_at < cutoff && row.attempts >= row.max_attempts) {
            row.status = deadStatus; row.claimed_at = null; row.claimed_by = null;
            row.last_error = 'Recovered: worker claimed this job and never completed it, attempts exhausted.';
            row.error_code = 'other';
            n++;
          }
        }
        return n as any;
      }
      throw new Error(`fake $executeRaw: unrecognized query: ${sql}`);
    },
    _table: table,
  };
  return fake as any;
}

// A fake processDocument — NEVER calls Gemini/network. Behavior is scripted
// per-call via a queue of canned outcomes so tests can simulate success,
// transient failure, permanent failure, and multi-job sequences.
function makeFakeProcessDocument(outcomes: ProcessDocumentOutcome[]) {
  const calls: string[] = [];
  const fn = async (documentId: string): Promise<ProcessDocumentOutcome> => {
    calls.push(documentId);
    const next = outcomes.shift();
    if (!next) throw new Error('makeFakeProcessDocument: ran out of scripted outcomes');
    return next;
  };
  return { fn, calls };
}

function makeDeps(db: any, processDocument: WorkerDeps['processDocument']): WorkerDeps {
  return {
    claimJobs: (workerId, limit) => claimJobs(db, workerId, limit),
    processDocument,
    completeJob: (jobId) => completeJob(db, jobId),
    failJob: (job, errorCode, message) => failJob(db, job, errorCode, message),
    classifyForRetry,
  };
}

async function main() {
  console.log('\nCase: runOneJobCycle — a due queued job is claimed and completed on success (fake processDocument, no Gemini)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const { fn, calls } = makeFakeProcessDocument([{ status: 200, body: {} }]);
    const result = await runOneJobCycle(makeDeps(db, fn), 'worker-A');
    assert(result.claimed === true, 'Job was claimed');
    assert(result.outcome === 'done', 'Outcome is done');
    assert(calls.length === 1 && calls[0] === db._table[0].document_id, 'processDocument called exactly once, for the right document');
    assert(db._table[0].status === JOB_STATUS.DONE, 'Row status is done in the DB');
  }

  console.log('\nCase: queued with next_attempt_at in the FUTURE is NOT claimed (e.g. mid-backoff after a transient failure)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    db._table[0].next_attempt_at = new Date(Date.now() + 60_000); // 1 min in the future
    const { fn, calls } = makeFakeProcessDocument([]);
    const result = await runOneJobCycle(makeDeps(db, fn), 'worker-A');
    assert(result.claimed === false, 'Not claimed — next_attempt_at has not arrived yet');
    assert(calls.length === 0, 'processDocument never called');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Row untouched, still queued (not failed for being "old")');
  }

  console.log('\nCase: two concurrent invocations never claim the same job (atomic claim, status flips before the second lookup)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    // Simulates two overlapping worker/cron invocations racing on the same queue.
    const [firstBatch, secondBatch] = await Promise.all([
      claimJobs(db, 'worker-A', 1),
      claimJobs(db, 'worker-B', 1),
    ]);
    const totalClaimed = firstBatch.length + secondBatch.length;
    assert(totalClaimed === 1, 'Exactly one of the two concurrent claims got the job, never both');
  }

  console.log('\nCase: a claimed-and-abandoned job is still recovered via recoverAbandonedJobs() (scenario B, unchanged)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    await claimJobs(db, 'dead-worker', 1);
    db._table[0].claimed_at = new Date(Date.now() - (ABANDONED_CLAIM_MINUTES + 1) * 60_000);
    const recovered = await recoverAbandonedJobs(db);
    assert(recovered === 1, 'Abandoned claim recovered');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Back to queued, reclaimable by the next cycle');

    const { fn } = makeFakeProcessDocument([{ status: 200, body: {} }]);
    const result = await runOneJobCycle(makeDeps(db, fn), 'worker-C');
    assert(result.claimed === true && result.outcome === 'done', 'Recovered job is claimable and completes normally afterwards');
  }

  console.log('\nCase: retry/backoff still works through runOneJobCycle — transient error requeues with a future next_attempt_at\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const { fn } = makeFakeProcessDocument([{ status: 500, body: { message: 'Gemini timeout' }, errorType: 'timeout' }]);
    const result = await runOneJobCycle(makeDeps(db, fn), 'worker-A');
    assert(result.claimed === true && result.outcome === 'retried', 'Transient timeout classified as retried');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Requeued for a later attempt');
    assert(db._table[0].next_attempt_at.getTime() > Date.now(), 'Backoff pushes next_attempt_at into the future');
    assert(db._table[0].attempts === 1, 'attempts incremented');
  }

  console.log('\nCase: retry/backoff — permanent error (billing_exhausted) goes terminal, not requeued\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const { fn } = makeFakeProcessDocument([{ status: 500, body: { message: 'no credits' }, errorType: 'billing_exhausted' }]);
    const result = await runOneJobCycle(makeDeps(db, fn), 'worker-A');
    assert(result.outcome === 'terminal', 'billing_exhausted never retries, even on attempt 1');
    assert(db._table[0].status === JOB_STATUS.FAILED, 'Terminal failed state');
  }

  console.log('\nCase: a job already done is never picked up again by a later cycle\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const { fn: fn1 } = makeFakeProcessDocument([{ status: 200, body: {} }]);
    await runOneJobCycle(makeDeps(db, fn1), 'worker-A');
    assert(db._table[0].status === JOB_STATUS.DONE, 'First cycle completed the job');

    const { fn: fn2, calls } = makeFakeProcessDocument([]);
    const secondResult = await runOneJobCycle(makeDeps(db, fn2), 'worker-B');
    assert(secondResult.claimed === false, 'A done job is not reclaimed by a later cycle');
    assert(calls.length === 0, 'processDocument never called again for the same job');
  }

  console.log('\nCase: drainQueue processes multiple queued jobs in one invocation (the actual cron rescue behavior)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    await enqueueJob(db, 'doc-2', 'company-1');
    await enqueueJob(db, 'doc-3', 'company-1');
    const { fn, calls } = makeFakeProcessDocument([
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    const { processed, stoppedReason } = await drainQueue(makeDeps(db, fn), 'cron-A', { maxJobs: 25, timeBudgetMs: 150_000 });
    assert(processed.length === 3, 'All 3 queued jobs drained in one invocation');
    assert(stoppedReason === 'empty', 'Stopped because the queue emptied, not because of a cap');
    assert(calls.length === 3, 'processDocument called once per job, never duplicated');
    assert(db._table.every((r: Row) => r.status === JOB_STATUS.DONE), 'All 3 rows are done');
  }

  console.log('\nCase: drainQueue respects maxJobs even if more queued work remains (stays bounded, does not run away)\n');
  {
    const db = makeFakePrisma();
    for (let i = 0; i < 5; i++) await enqueueJob(db, `doc-${i}`, 'company-1');
    const { fn } = makeFakeProcessDocument(Array.from({ length: 5 }, () => ({ status: 200, body: {} })));
    const { processed, stoppedReason } = await drainQueue(makeDeps(db, fn), 'cron-A', { maxJobs: 2, timeBudgetMs: 150_000 });
    assert(processed.length === 2, 'Stopped at the maxJobs cap');
    assert(stoppedReason === 'max_jobs', 'Correct stop reason reported');
    const remainingQueued = db._table.filter((r: Row) => r.status === JOB_STATUS.QUEUED).length;
    assert(remainingQueued === 3, 'The other 3 jobs are left untouched, still queued — not failed, not lost');
  }

  console.log('\nCase: drainQueue respects the time budget (stops before maxDuration would kill the function)\n');
  {
    const db = makeFakePrisma();
    for (let i = 0; i < 3; i++) await enqueueJob(db, `doc-${i}`, 'company-1');
    const { fn } = makeFakeProcessDocument(Array.from({ length: 3 }, () => ({ status: 200, body: {} })));
    let clock = 0;
    const fakeNow = () => {
      clock += 40_000; // simulate each cycle taking 40s of wall-clock time
      return clock;
    };
    const { processed, stoppedReason } = await drainQueue(
      makeDeps(db, fn), 'cron-A', { maxJobs: 25, timeBudgetMs: 100_000, now: fakeNow },
    );
    assert(stoppedReason === 'time_budget', 'Stopped because the time budget ran out, not because the queue emptied');
    assert(processed.length < 3, 'Did not process every job — bailed out early to stay inside maxDuration');
  }

  console.log('\nCase: isAuthorized() (POST, Telegram-triggered fast path) — unchanged behavior\n');
  {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secret-abc';
    const ok = isAuthorized({ headers: { get: (k: string) => (k === 'x-internal-secret' ? 'secret-abc' : null) } } as any);
    const badSecret = isAuthorized({ headers: { get: (k: string) => (k === 'x-internal-secret' ? 'wrong' : null) } } as any);
    const missing = isAuthorized({ headers: { get: () => null } } as any);
    assert(ok === true, 'Correct shared secret authorizes');
    assert(badSecret === false, 'Wrong shared secret rejected');
    assert(missing === false, 'Missing header rejected');
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }

  console.log('\nCase: isAuthorizedCron() (GET, Vercel Cron) — Bearer CRON_SECRET, the exact header Vercel documents sending automatically\n');
  {
    process.env.CRON_SECRET = 'cron-secret-xyz';
    const ok = isAuthorizedCron({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer cron-secret-xyz' : null) } } as any);
    const badSecret = isAuthorizedCron({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer wrong' : null) } } as any);
    const noBearerPrefix = isAuthorizedCron({ headers: { get: (k: string) => (k === 'authorization' ? 'cron-secret-xyz' : null) } } as any);
    const missing = isAuthorizedCron({ headers: { get: () => null } } as any);
    assert(ok === true, 'Correct Bearer token authorizes');
    assert(badSecret === false, 'Wrong token rejected');
    assert(noBearerPrefix === false, 'Missing "Bearer " prefix rejected — must match Vercel\'s exact header format');
    assert(missing === false, 'Missing header rejected');
    delete process.env.CRON_SECRET;
  }

  console.log('\nCase: isAuthorizedCron() fails closed when CRON_SECRET is not configured (never silently open)\n');
  {
    delete process.env.CRON_SECRET;
    const result = isAuthorizedCron({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer anything' : null) } } as any);
    assert(result === false, 'No CRON_SECRET configured -> always unauthorized, never a fallback-open endpoint');
  }

  console.log('\nCase: end-to-end cron mechanism — mixed queue (one future, one due, one already-claimed-and-abandoned) drains correctly with no Gemini call\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-future', 'company-1');
    db._table[0].next_attempt_at = new Date(Date.now() + 3_600_000);

    await enqueueJob(db, 'doc-abandoned', 'company-1');
    await claimJobs(db, 'dead-worker', 1);
    db._table[1].claimed_at = new Date(Date.now() - (ABANDONED_CLAIM_MINUTES + 1) * 60_000);

    await enqueueJob(db, 'doc-due', 'company-1');

    // Simulate the GET handler's own sequence: recover, then drain.
    const recovered = await recoverAbandonedJobs(db);
    assert(recovered === 1, 'The abandoned claim is recovered as part of the cron pass');

    const { fn, calls } = makeFakeProcessDocument([
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    const { processed, stoppedReason } = await drainQueue(makeDeps(db, fn), 'cron-A', { maxJobs: 25, timeBudgetMs: 150_000 });

    assert(processed.length === 2, 'Only the 2 truly-due jobs (doc-abandoned after recovery, doc-due) were processed');
    assert(stoppedReason === 'empty', 'Stopped because nothing else was eligible — not an error');
    assert(!calls.includes('doc-future'), 'The not-yet-due job was never touched');
    assert(db._table.find((r: Row) => r.document_id === 'doc-future')!.status === JOB_STATUS.QUEUED, 'doc-future left untouched, still queued');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exitCode = 1;
});
