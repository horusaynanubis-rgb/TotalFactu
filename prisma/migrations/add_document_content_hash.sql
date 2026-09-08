-- Migration: Add content_hash to Document for pre-Gemini duplicate detection
-- Run this on your PostgreSQL production database (Vercel Postgres / Neon / Supabase)
--
-- Context: 2026-09-07 incident — a single file resent ~265 times by the same
-- Telegram user burned a large share of the day's Gemini quota because
-- nothing detected "this exact file is already processing/was just
-- processed" before calling the AI. See lib/document-dedup.ts.
--
-- NOT YET APPLIED — this file only documents the intended DDL. Apply
-- manually when ready to deploy the Fase 2 fix.

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "content_hash" TEXT;

CREATE INDEX IF NOT EXISTS "Document_company_id_content_hash_idx"
  ON "Document" ("company_id", "content_hash");
