-- Migration: Add Supplier and InvoiceLine tables
-- Run this in the Supabase SQL Editor BEFORE deploying to Vercel.

-- 1. Supplier table
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id"              TEXT NOT NULL,
    "company_id"      TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "tax_id"          TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Supplier_company_id_idx"
    ON "Supplier"("company_id");
CREATE INDEX IF NOT EXISTS "Supplier_company_id_tax_id_idx"
    ON "Supplier"("company_id", "tax_id");
CREATE INDEX IF NOT EXISTS "Supplier_company_id_name_normalized_idx"
    ON "Supplier"("company_id", "name_normalized");

ALTER TABLE "Supplier"
    ADD CONSTRAINT "Supplier_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. InvoiceLine table
CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id"                     TEXT NOT NULL,
    "company_id"             TEXT NOT NULL,
    "invoice_id"             TEXT NOT NULL,
    "supplier_id"            TEXT,
    "description"            TEXT NOT NULL,
    "normalized_description" TEXT,
    "quantity"               DOUBLE PRECISION,
    "unit_price"             DOUBLE PRECISION,
    "tax_rate"               DOUBLE PRECISION,
    "total_amount"           DOUBLE PRECISION,
    "currency"               TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InvoiceLine_company_id_idx"
    ON "InvoiceLine"("company_id");
CREATE INDEX IF NOT EXISTS "InvoiceLine_invoice_id_idx"
    ON "InvoiceLine"("invoice_id");
CREATE INDEX IF NOT EXISTS "InvoiceLine_supplier_id_idx"
    ON "InvoiceLine"("supplier_id");
CREATE INDEX IF NOT EXISTS "InvoiceLine_company_id_norm_desc_idx"
    ON "InvoiceLine"("company_id", "normalized_description");

ALTER TABLE "InvoiceLine"
    ADD CONSTRAINT "InvoiceLine_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine"
    ADD CONSTRAINT "InvoiceLine_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine"
    ADD CONSTRAINT "InvoiceLine_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Add supplier_id column to Invoice
ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;

CREATE INDEX IF NOT EXISTS "Invoice_supplier_id_idx"
    ON "Invoice"("supplier_id");

ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
