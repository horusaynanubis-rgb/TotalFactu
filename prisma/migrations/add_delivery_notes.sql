-- Migration: Add DeliveryNote model for albaranes support
-- Run with: psql $DATABASE_URL -f prisma/migrations/add_delivery_notes.sql
-- Or via Prisma: npx prisma migrate dev --name add_delivery_notes

CREATE TABLE IF NOT EXISTS "DeliveryNote" (
    "id"                    TEXT NOT NULL,
    "company_id"            TEXT NOT NULL,
    "document_id"           TEXT NOT NULL,
    "supplier_name"         TEXT NOT NULL,
    "supplier_tax_id"       TEXT,
    "delivery_note_number"  TEXT NOT NULL,
    "issue_date"            TIMESTAMP(3),
    "total_amount"          DOUBLE PRECISION,
    "currency"              TEXT,
    "status"                TEXT NOT NULL DEFAULT 'pending',
    "matched_invoice_id"    TEXT,
    "notes"                 TEXT,
    "extraction_confidence" DOUBLE PRECISION,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one delivery note per document
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryNote_document_id_key"
    ON "DeliveryNote"("document_id");

-- Indexes
CREATE INDEX IF NOT EXISTS "DeliveryNote_company_id_idx"    ON "DeliveryNote"("company_id");
CREATE INDEX IF NOT EXISTS "DeliveryNote_status_idx"        ON "DeliveryNote"("status");
CREATE INDEX IF NOT EXISTS "DeliveryNote_supplier_name_idx" ON "DeliveryNote"("supplier_name");
CREATE INDEX IF NOT EXISTS "DeliveryNote_issue_date_idx"    ON "DeliveryNote"("issue_date");

-- Foreign keys
ALTER TABLE "DeliveryNote"
    ADD CONSTRAINT "DeliveryNote_company_id_fkey"
        FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE;

ALTER TABLE "DeliveryNote"
    ADD CONSTRAINT "DeliveryNote_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE;

ALTER TABLE "DeliveryNote"
    ADD CONSTRAINT "DeliveryNote_matched_invoice_id_fkey"
        FOREIGN KEY ("matched_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_delivery_note_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS delivery_note_updated_at ON "DeliveryNote";
CREATE TRIGGER delivery_note_updated_at
    BEFORE UPDATE ON "DeliveryNote"
    FOR EACH ROW EXECUTE FUNCTION update_delivery_note_updated_at();
