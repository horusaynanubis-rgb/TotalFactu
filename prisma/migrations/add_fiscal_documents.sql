-- Migration: Add FiscalDocument model for "Documentación fiscal complementaria"
-- These rows are NOT invoices: they never enter the OCR/Gemini extraction
-- pipeline and must never be joined into Invoice/Supplier/InvoiceLine queries.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_fiscal_documents.sql
-- Do NOT run via `npx prisma migrate dev`.

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "FiscalDocument" (
    "id"                    TEXT NOT NULL,
    "company_id"            TEXT NOT NULL,
    "uploaded_by_user_id"   TEXT NOT NULL,
    "original_filename"     TEXT NOT NULL,
    "mime_type"             TEXT NOT NULL,
    "size_bytes"            INTEGER NOT NULL,
    "cloud_storage_path"    TEXT NOT NULL,
    "document_type"         TEXT NOT NULL,
    "fiscal_year"           INTEGER NOT NULL,
    "fiscal_period"         TEXT NOT NULL,
    "description"           TEXT,
    "status"                TEXT NOT NULL DEFAULT 'available',
    "gestoria_notes"        TEXT,
    "reviewed_at"           TIMESTAMP(3),
    "reviewed_by_user_id"   TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "FiscalDocument_company_id_idx"                      ON "FiscalDocument"("company_id");
CREATE INDEX IF NOT EXISTS "FiscalDocument_company_id_fiscal_year_fiscal_perio" ON "FiscalDocument"("company_id", "fiscal_year", "fiscal_period");
CREATE INDEX IF NOT EXISTS "FiscalDocument_document_type_idx"                   ON "FiscalDocument"("document_type");
CREATE INDEX IF NOT EXISTS "FiscalDocument_status_idx"                          ON "FiscalDocument"("status");

-- ─── Foreign keys (idempotent — guarded via pg_constraint) ─────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FiscalDocument_company_id_fkey'
    ) THEN
        ALTER TABLE "FiscalDocument"
            ADD CONSTRAINT "FiscalDocument_company_id_fkey"
                FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FiscalDocument_uploaded_by_user_id_fkey'
    ) THEN
        ALTER TABLE "FiscalDocument"
            ADD CONSTRAINT "FiscalDocument_uploaded_by_user_id_fkey"
                FOREIGN KEY ("uploaded_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'FiscalDocument_reviewed_by_user_id_fkey'
    ) THEN
        ALTER TABLE "FiscalDocument"
            ADD CONSTRAINT "FiscalDocument_reviewed_by_user_id_fkey"
                FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- ─── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_fiscal_document_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_document_updated_at ON "FiscalDocument";
CREATE TRIGGER fiscal_document_updated_at
    BEFORE UPDATE ON "FiscalDocument"
    FOR EACH ROW EXECUTE FUNCTION update_fiscal_document_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- NOTE: no other table in this schema has RLS enabled today. The app never
-- queries Postgres through Supabase's PostgREST/data API — Prisma talks to
-- Postgres directly over DATABASE_URL, and Supabase is only used for Storage
-- (see lib/storage.ts). All tenant isolation is enforced in the API layer
-- (Membership / License lookups before every read/write — see
-- app/api/fiscal-documents/** and app/api/gestoria/clients/**).
--
-- This RLS block is defense-in-depth only: it locks the table down in case it
-- is ever exposed through Supabase's client-side (anon/authenticated) API,
-- without changing anything for the current app. The role behind DATABASE_URL
-- in a Supabase project (typically `postgres` or the pooler user) has
-- BYPASSRLS, so Prisma's direct access is unaffected either way.
--
-- Safe to skip this block entirely if you'd rather keep this table consistent
-- with the rest of the schema (no RLS anywhere else).

ALTER TABLE "FiscalDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalDocument" FORCE ROW LEVEL SECURITY;

-- service_role (used by SUPABASE_SERVICE_ROLE_KEY) keeps full access.
DROP POLICY IF EXISTS "fiscal_document_service_role_all" ON "FiscalDocument";
CREATE POLICY "fiscal_document_service_role_all" ON "FiscalDocument"
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- anon / authenticated: no policy is created for them, so with RLS enabled
-- they get zero rows and no writes — i.e. this table is unreachable via the
-- Supabase client-side API, matching "never trust client-supplied companyId".
-- If you later need client-side (supabase-js) access to this table, add a
-- scoped policy here instead of relying on the app-layer checks alone.

-- ─── Verification ───────────────────────────────────────────────────────────
-- Run these after applying the migration to confirm the table is correct.

-- 1) Table + columns + types + nullability
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'FiscalDocument'
-- ORDER BY ordinal_position;

-- 2) Indexes
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'FiscalDocument';

-- 3) Foreign keys
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = '"FiscalDocument"'::regclass AND contype = 'f';

-- 4) RLS status + policies
-- SELECT relrowsecurity, relforcerowsecurity
-- FROM pg_class WHERE oid = '"FiscalDocument"'::regclass;
--
-- SELECT policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'FiscalDocument';
