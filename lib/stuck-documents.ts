// Detects documents stuck in processing_status = 'processing' indefinitely,
// and provides a gated, explicit-confirmation transition to 'failed' so the
// existing retry UI (app/(dashboard)/dashboard/documents/page.tsx — canRetry
// already includes processing_status === 'failed') can pick them back up.
//
// Root cause this addresses (auditoría 2026-07-15): 95 BYOU documents got
// stuck in 'processing' permanently in June 2026 (87 were retries of one
// file that succeeded once elsewhere; 7 distinct files never produced any
// Invoice at all). Nothing ever timed them out, so they were invisible to
// both the user (no retry button appears for 'processing') and to any
// export (a stuck document simply doesn't exist in facturas.csv).
//
// This module NEVER reprocesses a document itself — it only flips
// processing_status so the human-triggered retry button becomes available.
import { PrismaClient } from '@prisma/client';

export const DEFAULT_STUCK_TIMEOUT_MINUTES = 15;

export interface StuckDocument {
  id: string;
  companyId: string;
  originalFilename: string;
  sourceChannel: string;
  createdAt: Date;
  updatedAt: Date;
  minutesStuck: number;
}

/**
 * Read-only. A document counts as "stuck" when: still 'processing', has no
 * linked Invoice/DeliveryNote/DailyCashRegister (a completed run always
 * creates exactly one of those, or moves to 'failed'/'needs_review'), and
 * hasn't been touched in `timeoutMinutes` — i.e. no active job could
 * plausibly still be running against it.
 */
export async function findStuckDocuments(
  prisma: PrismaClient,
  opts: { companyId?: string; timeoutMinutes?: number } = {},
): Promise<StuckDocument[]> {
  const timeoutMinutes = opts.timeoutMinutes ?? DEFAULT_STUCK_TIMEOUT_MINUTES;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const docs = await prisma.document.findMany({
    where: {
      ...(opts.companyId ? { company_id: opts.companyId } : {}),
      processing_status: 'processing',
      updated_at: { lt: cutoff },
      invoice: null,
      delivery_note: null,
      daily_cash_register: null,
    },
    select: { id: true, company_id: true, original_filename: true, source_channel: true, created_at: true, updated_at: true },
    orderBy: { updated_at: 'asc' },
  });

  const now = Date.now();
  return docs.map((d) => ({
    id: d.id,
    companyId: d.company_id,
    originalFilename: d.original_filename,
    sourceChannel: d.source_channel,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    minutesStuck: Math.round((now - d.updated_at.getTime()) / 60000),
  }));
}

export const STUCK_TIMEOUT_USER_MESSAGE =
  'El procesamiento se interrumpió antes de completarse. Puedes reintentarlo.';

export interface MarkStuckResult {
  documentId: string;
  marked: boolean;
  reason?: string;
}

/**
 * Mutating. Requires an explicit, caller-supplied list of document IDs
 * (never "all currently stuck documents" implicitly) and `confirm: true` —
 * without confirm this is a no-op dry-run that reports what it would do.
 * Never reprocesses; only transitions processing_status: 'processing' -> 'failed'
 * and records a friendly, structured reason in AuditLog (same convention as
 * the existing [process] error handler in app/api/documents/[id]/process/route.ts).
 */
export async function markStuckDocumentsFailed(
  prisma: PrismaClient,
  documentIds: string[],
  opts: { confirm: boolean },
): Promise<MarkStuckResult[]> {
  const results: MarkStuckResult[] = [];

  for (const documentId of documentIds) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) { results.push({ documentId, marked: false, reason: 'not_found' }); continue; }
    if (doc.processing_status !== 'processing') {
      results.push({ documentId, marked: false, reason: `not_processing (status=${doc.processing_status})` });
      continue;
    }

    if (!opts.confirm) {
      results.push({ documentId, marked: false, reason: 'dry_run' });
      continue;
    }

    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: { processing_status: 'failed' },
      }),
      prisma.auditLog.create({
        data: {
          company_id: doc.company_id,
          user_id: null,
          entity_type: 'document',
          entity_id: documentId,
          action: 'stuck_timeout_marked_failed',
          new_values: JSON.stringify({
            original_filename: doc.original_filename,
            source_channel: doc.source_channel,
            stuck_since: doc.updated_at.toISOString(),
            user_message: STUCK_TIMEOUT_USER_MESSAGE,
          }),
        },
      }),
    ]);
    results.push({ documentId, marked: true });
  }

  return results;
}
