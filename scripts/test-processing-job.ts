/**
 * Tests for lib/processing-job.ts (2026-09-08 async worker MVP) — no real
 * DB, no network. Mocks Prisma with a tiny in-memory table that reproduces
 * the exact semantics of the raw SQL in claimJobs()/recoverAbandonedJobs()
 * (matched by inspecting the tagged-template SQL text, since a single fake
 * $queryRaw/$executeRaw has to distinguish between the two different raw
 * queries the module issues).
 * Run with: npx tsx scripts/test-processing-job.ts
 */
import {
  enqueueJob, claimJobs, completeJob, failJob, recoverAbandonedJobs, decideRetry,
  JOB_STATUS, ABANDONED_CLAIM_MINUTES, ClaimedJob,
} from '../lib/processing-job';
import { classifyForRetry, shouldUseAsyncProcessing } from '../lib/process-queue-helpers';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

// ---------------------------------------------------------------------------
// In-memory fake Prisma — just enough surface for lib/processing-job.ts.
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
        // claimJobs(): values = [CLAIMED, workerId, QUEUED, limit]
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
        // recoverAbandonedJobs() requeue branch: values = [QUEUED, CLAIMED, cutoff]
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
        // recoverAbandonedJobs() dead branch: values = [DEAD, CLAIMED, cutoff]
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

async function main() {
  console.log('\nCase: enqueueJob — first call creates a job\n');
  {
    const db = makeFakePrisma();
    const r1 = await enqueueJob(db, 'doc-1', 'company-1');
    assert(r1.outcome === 'created', 'First enqueue creates the job');
  }

  console.log('\nCase: enqueueJob — no duplicate active jobs for the same Document\n');
  {
    const db = makeFakePrisma();
    const r1 = await enqueueJob(db, 'doc-1', 'company-1');
    const r2 = await enqueueJob(db, 'doc-1', 'company-1');
    assert(r1.outcome === 'created', 'First call creates');
    assert(r2.outcome === 'already_active', 'Second call while still queued does NOT create a second row');
    assert(r1.jobId === r2.jobId, 'Both calls resolve to the SAME job id');
    assert(db._table.length === 1, 'Only one row exists in the table for this document');
  }

  console.log('\nCase: enqueueJob — a terminal (done) job resets for a fresh manual attempt\n');
  {
    const db = makeFakePrisma();
    const r1 = await enqueueJob(db, 'doc-1', 'company-1');
    await completeJob(db, r1.jobId);
    const r2 = await enqueueJob(db, 'doc-1', 'company-1');
    assert(r2.outcome === 'reset_for_retry', 'Re-enqueueing a done job resets it instead of creating a duplicate row');
    assert(db._table.length === 1, 'Still only one row — reset, not duplicated');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Reset row is queued again');
  }

  console.log('\nCase: claimJobs — atomic claim: a claimed job is no longer claimable\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const firstClaim = await claimJobs(db, 'worker-A', 5);
    const secondClaim = await claimJobs(db, 'worker-B', 5);
    assert(firstClaim.length === 1, 'First claim gets the job');
    assert(secondClaim.length === 0, 'Second claim (simulating a concurrent worker) gets nothing — status is no longer queued');
    assert(db._table[0].claimed_by === 'worker-A', 'Row records which worker claimed it');
  }

  console.log('\nCase: claimJobs — successful job completes cleanly\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'worker-A', 1);
    await completeJob(db, job.id);
    assert(db._table[0].status === JOB_STATUS.DONE, 'Job marked done');
    assert(db._table[0].completed_at !== null, 'completed_at is set');
    assert(db._table[0].last_error === null, 'last_error cleared on success');
  }

  console.log('\nCase: failJob — transient error (timeout) is retried, job requeued with backoff\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    const { retried } = await failJob(db, job, 'timeout', 'Gemini call exceeded 110000ms');
    assert(retried === true, 'Timeout is retried (attempt 1 of 2)');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Requeued, not left claimed');
    assert(db._table[0].claimed_by === null, 'Claim released on requeue');
    assert(db._table[0].next_attempt_at.getTime() > Date.now(), 'next_attempt_at pushed into the future (backoff)');
  }

  console.log('\nCase: failJob — billing_exhausted is NEVER retried, even on attempt 1\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    const { retried } = await failJob(db, job, 'billing_exhausted', 'prepayment credits are depleted');
    assert(retried === false, 'billing_exhausted never retries, regardless of attempts remaining');
    assert(db._table[0].status === JOB_STATUS.FAILED, 'attempts(1) < max_attempts(2) but still terminal — status=failed not dead');
  }

  console.log('\nCase: failJob — max_tokens is NOT retried at the job level (adaptive fallback already happened inside the attempt)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    const { retried } = await failJob(db, job, 'max_tokens', 'MAX_TOKENS even after LARGE_INVOICE fallback');
    assert(retried === false, 'A second job-level attempt would hit the same wall — no retry');
  }

  console.log('\nCase: failJob — exhausting max_attempts marks the job dead, not failed\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    let [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    await failJob(db, job, 'timeout', 'attempt 1 timed out'); // attempts becomes 1, retried
    db._table[0].next_attempt_at = new Date(); // simulate the backoff window having elapsed
    [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[]; // pick it back up
    const { retried } = await failJob(db, job, 'timeout', 'attempt 2 timed out'); // attempts becomes 2 === max_attempts
    assert(retried === false, 'No more retries once max_attempts is reached');
    assert(db._table[0].status === JOB_STATUS.DEAD, 'Terminal state is dead once attempts >= max_attempts');
    assert(db._table[0].attempts === 2, 'attempts counted correctly across two failures');
  }

  console.log('\nCase: recoverAbandonedJobs — a claimed-and-abandoned job (worker presumed killed) is requeued, not left claimed forever\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'dead-worker', 1) as ClaimedJob[];
    // Simulate the claim happening well past ABANDONED_CLAIM_MINUTES ago.
    db._table[0].claimed_at = new Date(Date.now() - (ABANDONED_CLAIM_MINUTES + 1) * 60_000);
    const recoveredCount = await recoverAbandonedJobs(db);
    assert(recoveredCount === 1, 'One abandoned job recovered');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Requeued (attempts=0 < max_attempts=2)');
    assert(db._table[0].claimed_by === null, 'Claim released');
    void job;
  }

  console.log('\nCase: recoverAbandonedJobs — an abandoned job that already exhausted attempts goes straight to dead\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    db._table[0].attempts = 2; // == max_attempts
    const [job] = await claimJobs(db, 'dead-worker', 1) as ClaimedJob[];
    db._table[0].claimed_at = new Date(Date.now() - (ABANDONED_CLAIM_MINUTES + 1) * 60_000);
    await recoverAbandonedJobs(db);
    assert(db._table[0].status === JOB_STATUS.DEAD, 'Exhausted + abandoned -> dead, not requeued into a retry loop');
    void job;
  }

  console.log('\nCase: recoverAbandonedJobs — a recently-claimed job (worker still plausibly running) is left alone\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    await claimJobs(db, 'worker-A', 1);
    // claimed_at defaults to "now" — well within ABANDONED_CLAIM_MINUTES.
    const recoveredCount = await recoverAbandonedJobs(db);
    assert(recoveredCount === 0, 'Nothing recovered — the claim is still fresh');
    assert(db._table[0].status === JOB_STATUS.CLAIMED, 'Still claimed, untouched');
  }

  console.log('\nCase: decideRetry — pure policy table sanity (no I/O)\n');
  {
    assert(decideRetry('timeout', 1, 2).retry === true, 'timeout retries under max_attempts');
    assert(decideRetry('timeout', 2, 2).retry === false, 'timeout does not retry once attempts hit max_attempts');
    assert(decideRetry('billing_exhausted', 1, 2).retry === false, 'billing_exhausted never retries');
    assert(decideRetry('rate_limit_transient', 1, 2).retry === true, '429 transient retries');
    assert(decideRetry('storage_timeout', 1, 2).retry === true, 'storage_timeout retries');
    assert(decideRetry('invalid_json', 1, 2).retry === true, 'invalid_json retries once');
    assert(decideRetry('other', 1, 2).retry === false, 'unclassified/functional errors do not retry');
  }

  console.log('\nCase: worker route classifyForRetry() maps every ProcessDocumentResult errorType to a valid JobErrorCode\n');
  {
    assert(classifyForRetry('billing_exhausted') === 'billing_exhausted', 'billing_exhausted passthrough');
    assert(classifyForRetry('timeout') === 'timeout', 'timeout passthrough');
    assert(classifyForRetry('storage_timeout') === 'storage_timeout', 'storage_timeout passthrough');
    assert(classifyForRetry('rate_limit_transient') === 'rate_limit_transient', 'rate_limit_transient passthrough');
    assert(classifyForRetry('max_tokens') === 'max_tokens', 'max_tokens passthrough');
    assert(classifyForRetry('invalid_json') === 'invalid_json', 'invalid_json passthrough');
    assert(classifyForRetry('other') === 'other', 'other passthrough');
    assert(classifyForRetry(undefined) === 'other', 'undefined (e.g. a 404 with no errorType) defaults to other, never crashes');
    assert(classifyForRetry('something-unexpected') === 'other', 'unrecognized string defaults to other rather than throwing');
  }

  console.log('\nCase: enqueueJob carries the cash_closeout hint through to the claimed job (worker needs it to replicate sync behavior)\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1', 'cash_closeout');
    const [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    assert(job.hint === 'cash_closeout', 'hint survives enqueue -> claim');
  }

  console.log('\nCase: enqueueJob with no hint stores null, not the string "undefined"\n');
  {
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    const [job] = await claimJobs(db, 'worker-A', 1) as ClaimedJob[];
    assert(job.hint === null, 'hint defaults to null');
  }

  console.log('\nCase: decideRetry — explicit per-error-class checks requested by spec (2026-09-08), traceable 1:1\n');
  {
    // Gemini timeout: retry sí, máximo 2 intentos totales
    assert(decideRetry('timeout', 1, 2).retry === true, 'Gemini timeout: retried on attempt 1 of 2');
    assert(decideRetry('timeout', 2, 2).retry === false, 'Gemini timeout: NOT retried once 2 total attempts are used');
    // HTTP 503 and HTTP 429 transitorio both classify as rate_limit_transient
    // at the document-processing.ts error-classification layer (see its catch
    // block: '429' || '503' || 'UNAVAILABLE' -> rate_limit_transient) — this
    // is the SAME bucket 503 and 429-transient fall into by design, not an
    // oversight, so both are exercised explicitly here even though they
    // share one policy entry.
    assert(decideRetry('rate_limit_transient', 1, 2).retry === true, 'HTTP 503 (bucketed as rate_limit_transient): retried');
    assert(decideRetry('rate_limit_transient', 1, 2).retry === true, 'HTTP 429 transitorio (bucketed as rate_limit_transient): retried');
    // Billing exhausted: NO retry, job failed/dead según intentos restantes
    assert(decideRetry('billing_exhausted', 1, 2).retry === false, 'Billing exhausted: never retried (permanent)');
    // Storage timeout: retry sí
    assert(decideRetry('storage_timeout', 1, 2).retry === true, 'Storage timeout: retried');
    // JSON inválido: máximo 1 retry adicional (== 2 total attempts, same as timeout's cap)
    assert(decideRetry('invalid_json', 1, 2).retry === true, 'Invalid JSON: 1 retry granted (attempt 1 of 2)');
    assert(decideRetry('invalid_json', 2, 2).retry === false, 'Invalid JSON: no further retry after the 1 extra attempt is used');
    // MAX_TOKENS: no repetir NORMAL (ya se intentó LARGE_INVOICE dentro del intento) — no bucle
    assert(decideRetry('max_tokens', 1, 2).retry === false, 'MAX_TOKENS: no job-level retry even on attempt 1 (adaptive fallback already ran inside the attempt)');
    // Error funcional/permanente: NO retry
    assert(decideRetry('other', 1, 2).retry === false, 'Functional/permanent error: never retried');
  }

  console.log('\nCase: shouldUseAsyncProcessing — single decision point for the Telegram webhook sync/async fork\n');
  {
    assert(shouldUseAsyncProcessing('async') === true, "'async' -> true");
    assert(shouldUseAsyncProcessing('sync') === false, "'sync' -> false (the default for every company today)");
    assert(shouldUseAsyncProcessing(undefined) === false, 'undefined fails safe to sync');
    assert(shouldUseAsyncProcessing(null) === false, 'null fails safe to sync');
    assert(shouldUseAsyncProcessing('') === false, 'empty string fails safe to sync');
    assert(shouldUseAsyncProcessing('ASYNC') === false, 'case-sensitive — only the exact literal "async" activates it, no silent typo-activation');
  }

  console.log('\nCase: worker exception outside processDocument leaves the job "claimed", not lost — recoverAbandonedJobs is the actual safety net\n');
  {
    // app/api/jobs/process-queue/route.ts's outer try/catch deliberately does
    // NOT call failJob() when claimJobs/completeJob/failJob itself throws
    // (there is nothing safe left to update) — the job is simply left
    // 'claimed' for a LATER invocation's recoverAbandonedJobs() to reclaim.
    // This proves that safety net actually reclaims such a job instead of
    // leaving it claimed forever.
    const db = makeFakePrisma();
    await enqueueJob(db, 'doc-1', 'company-1');
    await claimJobs(db, 'worker-that-crashed', 1);
    assert(db._table[0].status === JOB_STATUS.CLAIMED, 'Simulates the worker crashing right after claiming, before completeJob/failJob ran');
    db._table[0].claimed_at = new Date(Date.now() - (ABANDONED_CLAIM_MINUTES + 1) * 60_000);
    const recovered = await recoverAbandonedJobs(db);
    assert(recovered === 1, 'A later worker invocation reclaims it — never stuck claimed forever');
    assert(db._table[0].status === JOB_STATUS.QUEUED, 'Back to queued, claimable again');
  }

  console.log('\nCase: source-structure checks — properties that need the real files, not a mock (matches this repo\'s existing convention, e.g. scripts/test-resolve-duplicates-safety.ts)\n');
  {
    const webhookSrc = fs.readFileSync(path.join(__dirname, '../app/api/webhooks/telegram/route.ts'), 'utf8');
    const workerSrc = fs.readFileSync(path.join(__dirname, '../app/api/jobs/process-queue/route.ts'), 'utf8');
    const pipelineSrc = fs.readFileSync(path.join(__dirname, '../lib/document-processing.ts'), 'utf8');

    // processing_mode=async crea job pero NO procesa síncronamente: the async
    // branch must enqueue + return BEFORE the sync fetch(processUrl...) call.
    const asyncBranchIdx = webhookSrc.indexOf('shouldUseAsyncProcessing(companyMode');
    const enqueueIdx = webhookSrc.indexOf('await enqueueJob(prisma, document.id');
    const syncFetchIdx = webhookSrc.indexOf('await fetch(processUrl, { method:');
    assert(asyncBranchIdx !== -1 && enqueueIdx !== -1 && syncFetchIdx !== -1, 'All three anchors found in the webhook source');
    assert(asyncBranchIdx < enqueueIdx && enqueueIdx < syncFetchIdx, 'Async branch (enqueue) is positioned strictly before the synchronous fetch(processUrl) call — async never falls through to sync processing');

    // Dedup runs BEFORE enqueueJob within the async branch (spec point 10).
    const dedupCallIdx = webhookSrc.indexOf('await checkContentHashDuplicate(document.id');
    assert(dedupCallIdx !== -1 && dedupCallIdx < enqueueIdx, 'checkContentHashDuplicate() runs before enqueueJob() in the async branch');

    // processing_mode=sync conserva comportamiento actual: the pre-existing
    // sync call site is untouched (same URL construction, same bare fetch).
    assert(webhookSrc.includes('const processUrl = `${baseUrl}/api/documents/${document.id}/process${cashCloseoutHint ? \'?hint=cash_closeout\' : \'\'}`;'), 'Sync processUrl construction is byte-for-byte unchanged');

    // Document no queda eternamente "processing": processDocument()'s catch
    // block always resolves the Document to a terminal status.
    assert(pipelineSrc.includes("data: { processing_status: 'failed', confidence_score: 0 }"), "processDocument()'s catch block always terminates the Document as 'failed', never leaves it hanging in 'processing'");

    // Worker never uses the sync 40s default when it explicitly overrides timeouts.
    assert(workerSrc.includes('WORKER_GEMINI_TIMEOUTS'), 'Worker defines its own Gemini timeout budget');
    assert(workerSrc.includes('geminiTimeouts: WORKER_GEMINI_TIMEOUTS'), 'Worker passes its own timeout budget into processDocument(), not the sync 40s default');
  }

  console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
  if (failed > 0) process.exit(1);
}

main();
