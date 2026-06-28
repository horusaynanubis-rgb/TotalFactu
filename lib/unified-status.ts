/**
 * Unified document/invoice status system.
 *
 * Combines Document.processing_status + Invoice.review_status +
 * Invoice.gestoria_review_status into a single user-facing stage so
 * that all modules (Documents, Invoices, Review, Gestoria) always
 * show the same language.
 *
 * Stage order:
 *   processing → error
 *   processing → pending → reviewed | rejected
 *   reviewed   → waiting (gestoria) → done (gestoria)
 */

export type UnifiedStatus =
  | 'processing'   // AI is processing
  | 'error'        // Processing failed
  | 'pending'      // Waiting for review
  | 'reviewed'     // Reviewed & approved by user
  | 'rejected'     // Reviewed & rejected by user
  | 'waiting'      // Gestoria waiting for client response
  | 'done';        // Gestoria finalized

export interface UnifiedStatusInfo {
  status: UnifiedStatus;
  label: string;
  colorClasses: string;   // bg + text + ring Tailwind classes for inline badge
  step: number;           // 1-6 for timeline progress
}

/** Maps raw DB values to a single unified status. */
export function getUnifiedStatus(params: {
  processingStatus: string;
  reviewStatus?: string | null;
  gestoriaStatus?: string | null;
}): UnifiedStatus {
  const { processingStatus, reviewStatus, gestoriaStatus } = params;

  if (processingStatus === 'processing') return 'processing';
  if (processingStatus === 'failed') return 'error';

  // Gestoria layer takes priority over user review
  if (gestoriaStatus === 'waiting_client') return 'waiting';
  if (
    gestoriaStatus === 'reviewed_ok' ||
    gestoriaStatus === 'reviewed_issue' ||
    gestoriaStatus === 'corrected'
  ) return 'done';

  // User review layer
  if (reviewStatus === 'rejected') return 'rejected';
  if (reviewStatus === 'approved') return 'reviewed';

  // Processed but not yet reviewed
  return 'pending';
}

/** Timeline stages — ordered list used by DocumentTimeline. */
export const TIMELINE_STAGES: { status: UnifiedStatus | 'received'; label: string }[] = [
  { status: 'received',   label: 'Documento recibido' },
  { status: 'processing', label: 'Procesando IA' },
  { status: 'pending',    label: 'Pendiente de revisión' },
  { status: 'reviewed',   label: 'Revisada' },
  { status: 'waiting',    label: 'Esperando cliente' },
  { status: 'done',       label: 'Finalizada' },
];

/** Step index (1-based) for a given unified status. Used in the timeline. */
export function getTimelineStep(status: UnifiedStatus): number {
  const order: UnifiedStatus[] = ['processing', 'error', 'pending', 'reviewed', 'rejected', 'waiting', 'done'];
  const steps: Record<UnifiedStatus, number> = {
    processing: 2,
    error: 2,
    pending: 3,
    reviewed: 4,
    rejected: 4,
    waiting: 5,
    done: 6,
  };
  return steps[status] ?? 1;
}
