-- Migration: Backfill legacy invoices so they stop appearing as "Pendientes" in the gestoria review queue
-- Run with: psql $DATABASE_URL -f prisma/migrations/backfill_legacy_gestoria_review_status.sql
--
-- Context: gestoria_review_status was introduced in commit 2923a08 ("Add invoice review
-- workflow and audit trail") on 2026-06-26 11:35:04 +02:00 (2026-06-26 09:35:04 UTC).
-- Before that moment the column did not exist, so every invoice created earlier has
-- gestoria_review_status = NULL — not because it is pending review, but because the
-- workflow simply didn't exist yet. The current queries treat NULL and 'pending_review'
-- as equivalent ("not yet reviewed"), which is correct for invoices created AFTER the
-- workflow launched, but incorrectly floods the queue with the entire pre-workflow
-- historical backlog (130 invoices across 4 companies as of 2026-07-09, 118 of them for
-- "byou coffehouse S.L").
--
-- This is a one-time, idempotent backfill: it only touches rows that are still NULL and
-- were created before the cutoff, tagging them 'legacy_unreviewed' so they are excluded
-- from the "Pendientes" filters (which check for NULL or 'pending_review') while remaining
-- fully visible under "Todas". It does NOT set gestoria_reviewed_at/by/notes, since nobody
-- actually reviewed them — the audit trail stays honest.
--
-- Safe to re-run: WHERE gestoria_review_status IS NULL means already-migrated rows are
-- skipped on subsequent runs.

UPDATE "Invoice"
SET gestoria_review_status = 'legacy_unreviewed'
WHERE gestoria_review_status IS NULL
  AND created_at < '2026-06-26T09:35:04.000Z';

-- Verification query (expect 0 rows returned if the backfill covered everything intended):
-- SELECT company_id, count(*) FROM "Invoice"
-- WHERE gestoria_review_status IS NULL AND created_at < '2026-06-26T09:35:04.000Z'
-- GROUP BY company_id;
