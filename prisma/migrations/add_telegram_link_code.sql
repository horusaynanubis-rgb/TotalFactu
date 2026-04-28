-- Migration: Add TelegramLinkCode table and remove per-company bot fields
-- Run this on your PostgreSQL production database (Vercel Postgres / Neon / Supabase)

-- 1. Remove per-company Telegram bot fields
ALTER TABLE "Company" DROP COLUMN IF EXISTS "telegram_bot_token";
ALTER TABLE "Company" DROP COLUMN IF EXISTS "telegram_webhook_secret";

-- 2. Create TelegramLinkCode table
CREATE TABLE IF NOT EXISTS "TelegramLinkCode" (
  "id"         TEXT          NOT NULL,
  "code"       TEXT          NOT NULL,
  "user_id"    TEXT          NOT NULL,
  "company_id" TEXT          NOT NULL,
  "expires_at" TIMESTAMP(3)  NOT NULL,
  "used_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);

-- 3. Unique and indexes
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramLinkCode_code_key"        ON "TelegramLinkCode"("code");
CREATE        INDEX IF NOT EXISTS "TelegramLinkCode_code_idx"        ON "TelegramLinkCode"("code");
CREATE        INDEX IF NOT EXISTS "TelegramLinkCode_user_id_idx"     ON "TelegramLinkCode"("user_id");
CREATE        INDEX IF NOT EXISTS "TelegramLinkCode_company_id_idx"  ON "TelegramLinkCode"("company_id");

-- 4. Foreign keys
ALTER TABLE "TelegramLinkCode"
  ADD CONSTRAINT "TelegramLinkCode_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramLinkCode"
  ADD CONSTRAINT "TelegramLinkCode_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
