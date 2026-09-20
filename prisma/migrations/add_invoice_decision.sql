-- Migration: Add InvoiceDecision (Exception-Based Review — Shadow Mode, Fase 1+2)
-- Run this on your PostgreSQL production database (Vercel Postgres / Neon / Supabase)
--
-- Context: 2026-09 — shadow rule engine for exception-based review. This
-- table stores a hypothetical AUTO_APPROVED/REVIEW_REQUIRED decision per
-- invoice, computed in parallel to the real pipeline (see
-- lib/exception-engine.ts + lib/invoice-decision.ts). It is purely
-- observational: nothing in the existing gestoria/fiscal/processing
-- workflow reads from this table. Fully additive — no existing table or
-- column is modified, and writes only happen when
-- EXCEPTION_REVIEW_SHADOW_ENABLED=true (default: unset/false, i.e. OFF).
--
-- NOT YET APPLIED — this file only documents the intended DDL.

CREATE TABLE IF NOT EXISTS "InvoiceDecision" (
  "id"              TEXT NOT NULL,
  "invoice_id"      TEXT NOT NULL,
  "company_id"      TEXT NOT NULL,
  "mode"            TEXT NOT NULL DEFAULT 'shadow',
  "engine_version"  TEXT NOT NULL,
  "decision"        TEXT NOT NULL,
  "rules_evaluated" TEXT NOT NULL,
  "rules_passed"    TEXT NOT NULL,
  "rules_failed"    TEXT NOT NULL,
  "signals"         TEXT NOT NULL,
  "engine_error"    TEXT,
  "evaluated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceDecision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InvoiceDecision"
  ADD CONSTRAINT "InvoiceDecision_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceDecision"
  ADD CONSTRAINT "InvoiceDecision_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceDecision_invoice_id_engine_version_mode_key"
  ON "InvoiceDecision"("invoice_id", "engine_version", "mode");

CREATE INDEX IF NOT EXISTS "InvoiceDecision_company_id_idx" ON "InvoiceDecision"("company_id");
CREATE INDEX IF NOT EXISTS "InvoiceDecision_decision_idx" ON "InvoiceDecision"("decision");
CREATE INDEX IF NOT EXISTS "InvoiceDecision_evaluated_at_idx" ON "InvoiceDecision"("evaluated_at");
