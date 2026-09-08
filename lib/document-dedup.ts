// Pre-Gemini duplicate detection by raw file content.
//
// Root cause this addresses (2026-09-07 incident): a single BYOU Telegram
// user resent the exact same PDF ~265 times over 11 hours (client-side
// retry behaviour, not a user manually spamming). Nothing stopped each
// resend from creating a brand-new Document and burning a fresh Gemini
// call, which combined with the existing 429-retry-storm to consume a
// large share of that day's Gemini quota. See diagnóstico 2026-09-08.
//
// This module is intentionally DB-agnostic: evaluateDuplicate() is a pure
// function so it can be unit-tested without a database. The caller
// (app/api/documents/[id]/process/route.ts) is responsible for the actual
// Prisma lookup and for writing the outcome back to the Document.
import crypto from 'crypto';

/** sha256 of the exact bytes/base64 Gemini would receive — identical file → identical hash. */
export function computeContentHash(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Mirrors DEFAULT_STUCK_TIMEOUT_MINUTES in lib/stuck-documents.ts: a document
// that's been "processing" longer than this is presumed dead (its lambda was
// killed without ever reaching a terminal state), so a fresh attempt is
// allowed rather than blocking the user forever on a ghost.
export const DEDUP_ACTIVE_PROCESSING_WINDOW_MINUTES = 15;

// Cool-down after a definitive outcome (completed/needs_review/failed)
// before the same file is allowed to be reprocessed from scratch. Short
// enough to not annoy a legitimate quick retry after fixing something,
// long enough to absorb a burst of identical resends.
export const DEDUP_RECENT_OUTCOME_WINDOW_MINUTES = 10;

export interface DuplicateCandidate {
  id: string;
  processing_status: string;
  updated_at: Date;
}

export type DuplicateVerdict =
  | { kind: 'none' }
  | { kind: 'active_processing'; matchedDocumentId: string }
  | { kind: 'recent_completed'; matchedDocumentId: string }
  | { kind: 'recent_failed'; matchedDocumentId: string };

/**
 * Given the most recent OTHER document for the same company with the same
 * content_hash, decide whether the current upload is a duplicate that
 * should skip its own Gemini call. Pure — no I/O.
 */
export function evaluateDuplicate(
  candidate: DuplicateCandidate | null,
  now: Date = new Date(),
): DuplicateVerdict {
  if (!candidate) return { kind: 'none' };

  const minutesSinceUpdate = (now.getTime() - candidate.updated_at.getTime()) / 60000;

  if (candidate.processing_status === 'processing') {
    if (minutesSinceUpdate <= DEDUP_ACTIVE_PROCESSING_WINDOW_MINUTES) {
      return { kind: 'active_processing', matchedDocumentId: candidate.id };
    }
    return { kind: 'none' }; // presumed dead — let a fresh attempt through
  }

  if (candidate.processing_status === 'completed' || candidate.processing_status === 'needs_review') {
    if (minutesSinceUpdate <= DEDUP_RECENT_OUTCOME_WINDOW_MINUTES) {
      return { kind: 'recent_completed', matchedDocumentId: candidate.id };
    }
    return { kind: 'none' };
  }

  if (candidate.processing_status === 'failed') {
    if (minutesSinceUpdate <= DEDUP_RECENT_OUTCOME_WINDOW_MINUTES) {
      return { kind: 'recent_failed', matchedDocumentId: candidate.id };
    }
    return { kind: 'none' };
  }

  return { kind: 'none' };
}

// User-facing Telegram/UI text for each duplicate verdict — no technical
// details (matches Fase 2 requirement: clear but not exposing internals).
export const DUPLICATE_USER_MESSAGES: Record<Exclude<DuplicateVerdict['kind'], 'none'>, string> = {
  active_processing: '📎 Este documento ya se está procesando.\n\nTe avisaré en cuanto termine — no hace falta que lo reenvíes.',
  recent_completed: '✅ Este documento ya fue procesado hace un momento.\n\nRevísalo en el panel de TotalFactu.',
  recent_failed: '⚠️ Ya intentamos procesar este documento hace un momento y no fue posible.\n\nEspera unos minutos antes de reenviarlo.',
};

// processing_status to persist on the duplicate (new) Document row for each verdict.
export const DUPLICATE_STATUS_BY_VERDICT: Record<Exclude<DuplicateVerdict['kind'], 'none'>, string> = {
  active_processing: 'failed', // bounded — lets the existing manual retry button work after the window above
  recent_completed: 'completed',
  recent_failed: 'failed',
};
