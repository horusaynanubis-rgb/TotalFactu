-- Migration: Add ProcessingJob (async worker MVP) + Company.processing_mode flag
-- Run this on your PostgreSQL production database (Vercel Postgres / Neon / Supabase)
--
-- Context: 2026-09-08 — LARGE_INVOICE (adaptive header+lines extraction for
-- dense invoices) needs 60-120s of real Gemini time, which the synchronous
-- Telegram webhook (maxDuration=60s) cannot safely provide. This table lets
-- a separate worker process a Document asynchronously, decoupled from the
-- original Telegram/web request. Fully additive — no existing table/column
-- is modified, and Company.processing_mode defaults to 'sync' so behavior
-- is UNCHANGED for every company until explicitly flagged.
--
-- NOT YET APPLIED — this file only documents the intended DDL.

CREATE TABLE IF NOT EXISTS "ProcessingJob" (
  "id"              TEXT          NOT NULL,
  "document_id"     TEXT          NOT NULL,
  "company_id"      TEXT          NOT NULL,
  "status"          TEXT          NOT NULL DEFAULT 'queued',
  "attempts"        INTEGER       NOT NULL DEFAULT 0,
  "max_attempts"    INTEGER       NOT NULL DEFAULT 2,
  "next_attempt_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at"      TIMESTAMP(3),
  "claimed_by"      TEXT,
  "completed_at"    TIMESTAMP(3),
  "last_error"      TEXT,
  "error_code"      TEXT,
  "hint"            TEXT,
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcessingJob_document_id_key" UNIQUE ("document_id"),
  CONSTRAINT "ProcessingJob_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE,
  CONSTRAINT "ProcessingJob_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE
);

-- document_id already has a unique index via the UNIQUE constraint above —
-- covers both "prevent two active jobs per Document" and lookups by document_id.
CREATE INDEX IF NOT EXISTS "ProcessingJob_status_next_attempt_at_idx" ON "ProcessingJob" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "ProcessingJob_company_id_idx" ON "ProcessingJob" ("company_id");
CREATE INDEX IF NOT EXISTS "ProcessingJob_claimed_at_idx" ON "ProcessingJob" ("claimed_at");

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "processing_mode" TEXT NOT NULL DEFAULT 'sync';
