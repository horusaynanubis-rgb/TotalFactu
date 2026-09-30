-- Migration: Add VAT-deductibility override to Invoice, independent of document_type
-- 2026-09-30 — Marc/Gascón "AIGÜES DE PALAMÓS" case: a full invoice (legally
-- FULL_INVOICE, has an identified recipient) whose fiscal recipient is not
-- this company (e.g. a utility bill addressed to the premises' individual
-- owner, repercuted to the company) — deductible VAT must be 0 and the
-- expense must be the full total_amount, WITHOUT reclassifying the document
-- as SIMPLIFIED_INVOICE (that would corrupt the documental/legal
-- classification — see design discussion with Jesús Gascón).
--
-- Fully additive, non-destructive:
--   - All new columns are NULLable, no NOT NULL / no DEFAULT other than NULL.
--   - NO backfill. Every existing row keeps vat_treatment_override = NULL
--     after this migration runs.
--   - NULL means "today's behavior, unchanged" — every existing calculation
--     path (lib/invoice-fiscal-treatment.ts, lib/fiscal-summary.ts,
--     lib/economic-summary.ts, lib/iva-detalle.ts) keeps producing byte-for-byte
--     identical output for every invoice until a human explicitly sets this
--     column via the app.
--
-- String, not a Postgres/Prisma enum, for vat_treatment_override — matches
-- document_type and every other closed-value status column on this model
-- (see the comment block above Invoice.document_type in prisma/schema.prisma).
-- The only value in use today is 'THIRD_PARTY_RECIPIENT'; new codes are
-- expected to be added over time in lib/invoice-fiscal-treatment.ts's
-- VAT_TREATMENT_OVERRIDE_EFFECTS table, not via a schema change.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_invoice_vat_treatment_override.sql
-- Do NOT run via `npx prisma migrate dev` (this project's pooled PgBouncer
-- connection does not support it — see prisma/migrations/add_fiscal_status.sql).
--
-- APPLIED to production 2026-09-30 via a one-off Prisma $executeRawUnsafe
-- script (psql is not available in the deploy environment; same method
-- already used for prior DDL against this project's pooled PgBouncer
-- connection — see prisma/migrations/add_invoice_document_type_and_fiscal_period.sql).
-- Verified read-only post-migration: 4 columns + 1 index present with
-- correct types/nullability, Invoice count unchanged (251 before and after),
-- zero rows with vat_treatment_override set (no backfill), AIGÜES invoice
-- (id cmunpvzvd0001kz04c5mvjtum) byte-for-byte unchanged.

-- ─── Columns: VAT-deductibility override (independent of document_type) ────

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_treatment_override" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_treatment_override_note" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_treatment_override_set_by" TEXT;

ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "vat_treatment_override_set_at" TIMESTAMP(3);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "Invoice_vat_treatment_override_idx" ON "Invoice"("vat_treatment_override");

-- ─── Verification ───────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'Invoice'
--   AND column_name LIKE 'vat_treatment_override%'
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'Invoice'
--   AND indexname = 'Invoice_vat_treatment_override_idx';
--
-- -- Confirms NO backfill happened — every row must be NULL right after this runs:
-- SELECT count(*) AS total, count(vat_treatment_override) AS with_override
-- FROM "Invoice";
