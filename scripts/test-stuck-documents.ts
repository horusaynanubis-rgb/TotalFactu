/**
 * Tests lib/stuck-documents.ts#markStuckDocumentsFailed's confirm-gate using
 * a minimal in-memory fake of the Prisma methods it calls — no real
 * database connection, so this is safe to run anywhere, including against
 * this repo with no DATABASE_URL configured.
 * Run with: npx tsx scripts/test-stuck-documents.ts
 *
 * Covers audit case 7: a stuck document transitions to 'failed' (enabling
 * the existing retry button) only when explicitly confirmed — never as a
 * side effect of detection/listing.
 */
import { markStuckDocumentsFailed, STUCK_TIMEOUT_USER_MESSAGE } from '../lib/stuck-documents';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

function makeFakePrisma(initialStatus: string) {
  const state = { status: initialStatus, updateCalls: 0, auditLogCalls: 0, transactionCalls: 0 };
  const fake = {
    document: {
      findUnique: async ({ where }: any) => (where.id === 'doc-1' ? { id: 'doc-1', company_id: 'company-1', original_filename: 'f.pdf', source_channel: 'telegram', processing_status: state.status, updated_at: new Date() } : null),
      update: async (_args: any) => { state.updateCalls++; state.status = 'failed'; return {}; },
    },
    auditLog: {
      create: async (_args: any) => { state.auditLogCalls++; return {}; },
    },
    $transaction: async (ops: Promise<any>[]) => { state.transactionCalls++; return Promise.all(ops); },
  };
  return { fake, state };
}

async function run() {
  console.log('\nCase 7a: confirm=false is a no-op (dry-run) — nothing is written\n');
  {
    const { fake, state } = makeFakePrisma('processing');
    const results = await markStuckDocumentsFailed(fake as any, ['doc-1'], { confirm: false });
    assert(results.length === 1 && results[0].marked === false && results[0].reason === 'dry_run', 'Result reports dry_run, marked=false');
    assert(state.updateCalls === 0, 'document.update was never called without confirm');
    assert(state.transactionCalls === 0, '$transaction was never called without confirm');
    assert(state.status === 'processing', 'Document status unchanged after a dry-run');
  }

  console.log('\nCase 7b: confirm=true transitions processing -> failed via a transaction (AuditLog + update together)\n');
  {
    const { fake, state } = makeFakePrisma('processing');
    const results = await markStuckDocumentsFailed(fake as any, ['doc-1'], { confirm: true });
    assert(results.length === 1 && results[0].marked === true, 'Result reports marked=true when confirmed');
    assert(state.transactionCalls === 1, 'Update + AuditLog happen inside exactly one transaction (atomic)');
    assert(state.status === 'failed', 'Document status is now "failed" — the existing UI retry button will show for it');
  }

  console.log('\nCase 7c: a document that already left "processing" is skipped, even with confirm=true\n');
  {
    const { fake, state } = makeFakePrisma('completed'); // e.g. it finished between listing and acting
    const results = await markStuckDocumentsFailed(fake as any, ['doc-1'], { confirm: true });
    assert(results[0].marked === false && !!results[0].reason?.startsWith('not_processing'), 'Refuses to override a document that is no longer "processing"');
    assert(state.transactionCalls === 0, 'No transaction attempted for a non-stuck document');
  }

  console.log('\nCase 7d: unknown document id is reported, not thrown\n');
  {
    const { fake } = makeFakePrisma('processing');
    const results = await markStuckDocumentsFailed(fake as any, ['does-not-exist'], { confirm: true });
    assert(results[0].marked === false && results[0].reason === 'not_found', 'Unknown id reported as not_found instead of crashing');
  }

  assert(STUCK_TIMEOUT_USER_MESSAGE.length > 0, 'A friendly user-facing message is defined for the stuck-timeout state');

  console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
  if (failed > 0) process.exit(1);
}

run();
