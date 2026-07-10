-- Migration: Add ExportLog model for "Centro de Exportación" history
-- Purely additive action log — no file storage. Distinct from the existing
-- Export table (which requires a stored CSV and backs 3 existing features);
-- this covers every export type (CSV, ZIP, paquete) without that coupling.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_export_log.sql
-- Do NOT run via `npx prisma migrate dev`.

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ExportLog" (
    "id"             TEXT NOT NULL,
    "company_id"     TEXT NOT NULL,
    "user_id"        TEXT,
    "export_type"    TEXT NOT NULL,
    "format"         TEXT NOT NULL,
    "period_label"   TEXT NOT NULL,
    "fiscal_year"    INTEGER,
    "fiscal_quarter" TEXT,
    "record_count"   INTEGER NOT NULL DEFAULT 0,
    "status"         TEXT NOT NULL DEFAULT 'completed',
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "ExportLog_company_id_idx"            ON "ExportLog"("company_id");
CREATE INDEX IF NOT EXISTS "ExportLog_company_id_created_at_idx" ON "ExportLog"("company_id", "created_at");

-- ─── Foreign keys (idempotent — guarded via pg_constraint) ─────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExportLog_company_id_fkey'
    ) THEN
        ALTER TABLE "ExportLog"
            ADD CONSTRAINT "ExportLog_company_id_fkey"
                FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExportLog_user_id_fkey'
    ) THEN
        ALTER TABLE "ExportLog"
            ADD CONSTRAINT "ExportLog_user_id_fkey"
                FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Same defense-in-depth rationale as prisma/migrations/add_fiscal_documents.sql:
-- no other access path (Prisma/DATABASE_URL) is affected; this only locks the
-- table down in case it's ever exposed through Supabase's client-side API.

ALTER TABLE "ExportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExportLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "export_log_service_role_all" ON "ExportLog";
CREATE POLICY "export_log_service_role_all" ON "ExportLog"
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ─── Verification ───────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'ExportLog'
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'public' AND tablename = 'ExportLog';
--
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = '"ExportLog"'::regclass AND contype = 'f';
