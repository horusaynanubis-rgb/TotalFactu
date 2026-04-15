// CSV Export Generator
import { Invoice, Document } from '@prisma/client';

export interface InvoiceWithDocument extends Invoice {
  document: Document;
}

export function generateCSV(invoices: InvoiceWithDocument[]): string {
  const headers = [
    'invoice_type',
    'issue_date',
    'due_date',
    'invoice_number',
    'supplier_name',
    'supplier_tax_id',
    'customer_name',
    'customer_tax_id',
    'subtotal',
    'tax_amount',
    'total_amount',
    'currency',
    'tax_rate',
    'payment_method',
    'category',
    'notes',
    'extraction_confidence',
    'review_status',
    'source_channel'
  ];

  const rows = invoices.map((inv: InvoiceWithDocument) => [
    escapeCSV(inv.invoice_type),
    inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : '',
    inv.due_date ? new Date(inv.due_date).toISOString().split('T')[0] : '',
    escapeCSV(inv.invoice_number),
    escapeCSV(inv.supplier_name),
    escapeCSV(inv.supplier_tax_id || ''),
    escapeCSV(inv.customer_name),
    escapeCSV(inv.customer_tax_id || ''),
    inv.subtotal.toFixed(2),
    inv.tax_amount.toFixed(2),
    inv.total_amount.toFixed(2),
    escapeCSV(inv.currency),
    inv.tax_rate ? inv.tax_rate.toFixed(2) : '',
    escapeCSV(inv.payment_method || ''),
    escapeCSV(inv.category || ''),
    escapeCSV(inv.notes || ''),
    inv.extraction_confidence ? inv.extraction_confidence.toFixed(2) : '',
    escapeCSV(inv.review_status),
    escapeCSV(inv.document?.source_channel || '')
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row: any[]) => row.join(','))
  ].join('\n');

  return csvContent;
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function getDateRange(type: 'monthly' | 'quarterly', date: Date = new Date()): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (type === 'monthly') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { start, end };
  } else {
    const quarter = Math.floor(month / 3);
    const start = new Date(year, quarter * 3, 1);
    const end = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);
    return { start, end };
  }
}
