-- Migration: Billing audit trail — PaymentRecord, PaymentAlertLog, and
-- extra Subscription columns (trial dates, cancel_at_period_end, price
-- snapshot, payment failure count).
--
-- Context: Admin Control's "Próximo cobro" was reading Subscription.
-- current_period_end, a field only refreshed by the Stripe webhook — and the
-- webhook's subscription handlers were still reading current_period_start/
-- end off the raw event payload, a shape Stripe stopped sending at the top
-- level once the account moved to the Basil (2025-03-31+) API. Real paying
-- companies (BYOU, Eliteclub, GASCON) all show a frozen period_end from
-- their last successful sync. See app/api/webhooks/stripe/route.ts for the
-- fix and lib/admin/billing-status.ts for the resolver that reads these
-- columns.
--
-- Idempotent: safe to run multiple times against the same database.
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_payment_records_and_billing_fields.sql
-- Do NOT run via `npx prisma migrate dev`.

-- ─── Subscription: new columns ────────────────────────────────────────────

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "trial_start" TIMESTAMP(3);

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "trial_end" TIMESTAMP(3);

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "unit_amount_cents" INTEGER;

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'EUR';

ALTER TABLE "Subscription"
    ADD COLUMN IF NOT EXISTS "payment_failure_count" INTEGER NOT NULL DEFAULT 0;

-- ─── PaymentRecord ─────────────────────────────────────────────────────────
-- One row per Stripe invoice event (paid or failed). stripe_invoice_id is
-- unique so a duplicate webhook delivery upserts instead of double-counting
-- revenue. Starts empty for existing subscriptions (BYOU/Eliteclub/GASCON) —
-- historical rows before this migration are NOT backfilled automatically;
-- see scripts/backfill-payment-records.ts to pull them from Stripe once
-- (read-only Stripe calls, run manually with real Stripe keys).

CREATE TABLE IF NOT EXISTS "PaymentRecord" (
    "id"                        TEXT NOT NULL,
    "company_id"                TEXT NOT NULL,
    "stripe_invoice_id"         TEXT NOT NULL,
    "stripe_payment_intent_id"  TEXT,
    "stripe_subscription_id"    TEXT,
    "amount_cents"              INTEGER NOT NULL,
    "currency"                  TEXT NOT NULL DEFAULT 'EUR',
    "status"                    TEXT NOT NULL,
    "period_start"              TIMESTAMP(3),
    "period_end"                TIMESTAMP(3),
    "paid_at"                   TIMESTAMP(3),
    "failed_at"                 TIMESTAMP(3),
    "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "PaymentRecord"
        ADD CONSTRAINT "PaymentRecord_stripe_invoice_id_key" UNIQUE ("stripe_invoice_id");
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentRecord"
        ADD CONSTRAINT "PaymentRecord_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentRecord_company_id_idx" ON "PaymentRecord"("company_id");
CREATE INDEX IF NOT EXISTS "PaymentRecord_stripe_subscription_id_idx" ON "PaymentRecord"("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "PaymentRecord_status_idx" ON "PaymentRecord"("status");
CREATE INDEX IF NOT EXISTS "PaymentRecord_paid_at_idx" ON "PaymentRecord"("paid_at");

-- ─── PaymentAlertLog ───────────────────────────────────────────────────────
-- Dedup control so one impago incident sends exactly one internal email
-- (see app/api/webhooks/stripe/route.ts + lib/email.ts#sendPaymentAlertEmail).
-- stripe_invoice_id defaults to '' (not NULL) for alert types not tied to a
-- single invoice (e.g. a past_due status transition) — Postgres treats NULL
-- as distinct-from-NULL, which would silently defeat the unique constraint.

CREATE TABLE IF NOT EXISTS "PaymentAlertLog" (
    "id"                TEXT NOT NULL,
    "company_id"        TEXT NOT NULL,
    "alert_type"        TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL DEFAULT '',
    "sent_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAlertLog_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "PaymentAlertLog"
        ADD CONSTRAINT "PaymentAlertLog_company_id_alert_type_stripe_invoice_id_key"
        UNIQUE ("company_id", "alert_type", "stripe_invoice_id");
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PaymentAlertLog"
        ADD CONSTRAINT "PaymentAlertLog_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentAlertLog_company_id_idx" ON "PaymentAlertLog"("company_id");

-- ─── Verification ───────────────────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'Subscription'
--   AND column_name IN ('trial_start','trial_end','cancel_at_period_end','unit_amount_cents','currency','payment_failure_count')
-- ORDER BY ordinal_position;
--
-- SELECT count(*) FROM "PaymentRecord";
-- SELECT count(*) FROM "PaymentAlertLog";
--
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('PaymentRecord','PaymentAlertLog') ORDER BY 1;
