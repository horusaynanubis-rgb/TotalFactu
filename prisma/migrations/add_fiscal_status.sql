-- Migration: Add fiscal VAT-classification status to Invoice
-- A document can be perfectly processed (processing_status/review_status OK)
-- and still have no reliable VAT breakdown. This adds a status independent
-- of processing_status / review_status / gestoria_review_status — see
-- lib/fiscal-status.ts and lib/iva-classification.ts.
--
-- The DEFAULT below leaves every existing row in a valid state immediately.
-- Afterwards run `npx tsx --require dotenv/config scripts/backfill-fiscal-status.ts`
-- to (re)classify existing invoices locally — no AI calls, same computation
-- lib/fiscal-summary.ts already does today, just persisted this time.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_fiscal_status.sql
-- Do NOT run via `npx prisma migrate dev`.

-- ─── Columns ────────────────────────────────────────────────────────────────

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_status" TEXT NOT NULL DEFAULT 'pending_classification';

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_status_reason" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "ai_vat_breakdown" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_reclassification_attempted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_reclassified_at" TIMESTAMP(3);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "Invoice_fiscal_status_idx" ON "Invoice"("fiscal_status");

-- ─── Verification ───────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'Invoice'
--   AND (column_name LIKE 'fiscal_%' OR column_name LIKE 'vat_%' OR column_name = 'ai_vat_breakdown')
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'Invoice' AND indexname = 'Invoice_fiscal_status_idx';
--
-- SELECT fiscal_status, count(*) FROM "Invoice" GROUP BY fiscal_status ORDER BY 1;
