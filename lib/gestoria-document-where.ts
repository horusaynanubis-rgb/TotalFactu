import { Prisma } from '@prisma/client';

export function buildDocumentWhere(
  clientCompanyId: string,
  fromDate: Date,
  toDate: Date,
  type: string,
  status: string,
): Prisma.DocumentWhereInput {
  const processingStatuses =
    status === 'approved_only' ? ['completed'] : ['completed', 'needs_review'];

  const invoiceFilter: Prisma.InvoiceWhereInput = {
    issue_date: { gte: fromDate, lte: toDate },
    ...(type !== 'all' ? { invoice_type: type } : {}),
    ...(status === 'approved_only' ? { review_status: 'approved' } : {}),
  };

  const dateConditions: Prisma.DocumentWhereInput[] = [
    { invoice: invoiceFilter },
  ];

  if (type === 'all' && status !== 'approved_only') {
    dateConditions.push({
      invoice: null,
      upload_timestamp: { gte: fromDate, lte: toDate },
    });
  }

  return {
    company_id: clientCompanyId,
    processing_status: { in: processingStatuses },
    cloud_storage_path: { not: '' },
    OR: dateConditions,
  };
}
