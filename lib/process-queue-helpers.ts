// Small helpers for app/api/jobs/process-queue/route.ts, split into a plain
// module (not exported from the route file itself) because Next.js App
// Router route files only allow HTTP-method + a fixed config export list —
// any other export fails the build. Keeping these here also makes them
// importable from scripts/test-processing-job.ts without pulling in the
// route's NextRequest-typed POST handler.
import { NextRequest } from 'next/server';
import { JobErrorCode } from '@/lib/processing-job';

export function classifyForRetry(errorType: string | undefined): JobErrorCode {
  switch (errorType) {
    case 'billing_exhausted':
    case 'timeout':
    case 'storage_timeout':
    case 'rate_limit_transient':
    case 'max_tokens':
    case 'invalid_json':
      return errorType;
    default:
      return 'other';
  }
}

// Not exposed to the public internet unauthenticated — same shared-secret
// pattern already used by app/api/storage/test/route.ts and
// app/api/telegram/webhook-info/route.ts (reuses TELEGRAM_WEBHOOK_SECRET,
// no new secret introduced). Never logged.
export function isAuthorized(request: NextRequest): boolean {
  const provided = request.headers.get('x-internal-secret');
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(provided && expected && provided === expected);
}

// Single decision point for the Telegram webhook's sync/async fork — pulled
// out as a pure function (instead of an inline `=== 'async'` check) so the
// "async never processes synchronously" contract in the webhook is
// independently testable without mocking Prisma/Telegram/network.
// Default is 'sync' for any value that isn't the literal 'async' — unset,
// null, or an unrecognized string all fail safe to the unchanged sync path.
export function shouldUseAsyncProcessing(processingMode: string | null | undefined): boolean {
  return processingMode === 'async';
}
