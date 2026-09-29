-- Migration: Add simplified-invoice classification + independent fiscal period to Invoice
-- Fase Gascón (2026-09) — see design doc discussed with Jesús Gascón (GASCÓN gestoría).
--
-- Fully additive, non-destructive:
--   - All new columns are NULLable, no NOT NULL / no DEFAULT other than NULL.
--   - NO backfill. Every existing row keeps document_type = NULL and
--     fiscal_period_year/quarter = NULL after this migration runs.
--   - NULL is not a transient "pending" state here — it is the permanent,
--     intentional fallback that makes every historical row (and every new
--     row pending human confirmation) behave EXACTLY as before this
--     migration: fiscal calculations keep reading tax_amount/subtotal and
--     issue_date directly, unchanged. See lib/fiscal-summary.ts,
--     lib/economic-summary.ts — NEITHER is modified by this migration or by
--     the accompanying reprocess-preservation fix in
--     lib/document-processing.ts. Fiscal calculations, Economic Summary,
--     exports and UI are all unaffected until a later phase explicitly wires
--     them to read these columns.
--
-- String, not a Postgres/Prisma enum, for document_type — see the comment
-- block in prisma/schema.prisma above the Invoice.document_type field for
-- the full rationale (matches every other closed-value status column on
-- this model; none of them use a DB enum anywhere in this schema).
--
-- fiscal_period_source is deliberately NOT a column — see schema comment;
-- it is derived as `fiscal_period_set_by IS NULL ? 'default' : 'manual_override'`.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_invoice_document_type_and_fiscal_period.sql
-- Do NOT run via `npx prisma migrate dev` (this project's pooled PgBouncer
-- connection does not support it — see prisma/migrations/add_fiscal_status.sql).
--
-- APPLIED to production 2026-09-29 via a one-off Prisma $executeRawUnsafe
-- script (psql is not available in the deploy environment; same method
-- already used for prior DDL against this project's pooled PgBouncer
-- connection). Verified read-only post-migration: 8 columns + 2 indexes
-- present with correct types/nullability, Invoice count unchanged (250
-- before and after), zero rows with any new field set (no backfill).

-- ─── Columns: simplified-invoice classification ────────────────────────────

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "document_type" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "suggested_document_type" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "document_type_classified_by" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "document_type_classified_at" TIMESTAMP(3);

-- ─── Columns: fiscal period independent of issue_date ──────────────────────

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_period_year" INTEGER;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_period_quarter" INTEGER;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_period_set_by" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "fiscal_period_set_at" TIMESTAMP(3);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "Invoice_document_type_idx" ON "Invoice"("document_type");

CREATE INDEX IF NOT EXISTS "Invoice_company_id_fiscal_period_year_fiscal_period_quarter_idx"
    ON "Invoice"("company_id", "fiscal_period_year", "fiscal_period_quarter");

-- ─── Verification ───────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'Invoice'
--   AND (column_name LIKE 'document_type%' OR column_name LIKE 'suggested_document_type%'
--        OR column_name LIKE 'fiscal_period_%')
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'Invoice'
--   AND indexname IN ('Invoice_document_type_idx',
--                      'Invoice_company_id_fiscal_period_year_fiscal_period_quarter_idx');
--
-- -- Confirms NO backfill happened — every row must be NULL right after this runs:
-- SELECT count(*) AS total, count(document_type) AS with_document_type,
--        count(fiscal_period_year) AS with_fiscal_period
-- FROM "Invoice";
