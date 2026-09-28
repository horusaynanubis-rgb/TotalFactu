-- Migration: New Gestoria model — free Portal Gestoria once a firm has >=5
-- eligible client companies, decoupled from the legacy pack/license
-- purchase model (LicensePack/License/LicenseInvitation, untouched by this
-- migration).
--
-- Adds three tables:
--   - GestoriaClientRelation: the management relationship (gestoria <-> client
--     company), independent of billing. A client company always pays
--     TotalFactu directly; this table never carries Stripe/subscription data.
--   - GestoriaCompanyInvitation: token-based invitation for the new model,
--     mirroring LicenseInvitation's shape but not tied to a License/seat.
--   - GestoriaEligibilityGrace: one row per firm, only once it has ever
--     entered the 30-day grace window — the one piece of state that can't be
--     derived on the fly (see lib/gestoria-eligibility.ts).
--
-- Also adds a partial unique index enforcing "at most one ACTIVE gestoria
-- per client company" at the database level — Prisma's schema language has
-- no WHERE-clause unique index support without preview features this
-- project doesn't otherwise use, so it's expressed here directly.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_gestoria_new_model.sql
-- Do NOT run via `npx prisma migrate dev`.
--
-- NOT APPLIED to any database as part of this change — written for review
-- only, per explicit instruction. Apply manually once approved.

-- ─── GestoriaClientRelation ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "GestoriaClientRelation" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "gestoria_company_id" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "client_company_id"   TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "status"              TEXT NOT NULL DEFAULT 'active',
  "source"              TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at"         TIMESTAMP(3),
  "ended_at"            TIMESTAMP(3),
  "ended_reason"        TEXT
);

CREATE INDEX IF NOT EXISTS "GestoriaClientRelation_gestoria_company_id_idx" ON "GestoriaClientRelation"("gestoria_company_id");
CREATE INDEX IF NOT EXISTS "GestoriaClientRelation_client_company_id_idx" ON "GestoriaClientRelation"("client_company_id");
CREATE INDEX IF NOT EXISTS "GestoriaClientRelation_status_idx" ON "GestoriaClientRelation"("status");

-- The exclusivity guarantee (plan section 3 — "una empresa solo puede
-- contar para UNA gestoria activa"): the application layer checks this
-- before writing, but only a DB constraint makes it impossible to violate
-- under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS "GestoriaClientRelation_one_active_per_company"
  ON "GestoriaClientRelation" ("client_company_id")
  WHERE "status" = 'active';

-- ─── GestoriaCompanyInvitation ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "GestoriaCompanyInvitation" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "gestoria_company_id" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "target_email"        TEXT NOT NULL,
  "target_company_id"   TEXT,
  "mode"                TEXT NOT NULL,
  "token"               TEXT NOT NULL UNIQUE,
  "status"              TEXT NOT NULL DEFAULT 'pending',
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "created_by_user_id"  TEXT,
  "accepted_by_user_id" TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at"         TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "GestoriaCompanyInvitation_gestoria_company_id_idx" ON "GestoriaCompanyInvitation"("gestoria_company_id");
CREATE INDEX IF NOT EXISTS "GestoriaCompanyInvitation_token_idx" ON "GestoriaCompanyInvitation"("token");
CREATE INDEX IF NOT EXISTS "GestoriaCompanyInvitation_status_idx" ON "GestoriaCompanyInvitation"("status");
CREATE INDEX IF NOT EXISTS "GestoriaCompanyInvitation_target_email_idx" ON "GestoriaCompanyInvitation"("target_email");

-- ─── GestoriaEligibilityGrace ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "GestoriaEligibilityGrace" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "gestoria_company_id" TEXT NOT NULL UNIQUE REFERENCES "Company"("id") ON DELETE CASCADE,
  "eligibility_lost_at" TIMESTAMP(3),
  "grace_ends_at"       TIMESTAMP(3),
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
