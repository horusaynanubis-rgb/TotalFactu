/**
 * Shared Prisma where-condition builder for unified document status filtering.
 * Maps UnifiedStatus values to the equivalent multi-field DB conditions.
 */

const GESTORIA_DONE = ['reviewed_ok', 'reviewed_issue', 'corrected'];
const GESTORIA_ACTIVE = ['waiting_client', 'reviewed_ok', 'reviewed_issue', 'corrected'];

export function buildUnifiedStatusCondition(status: string): object {
  switch (status) {
    case 'processing':
      return { processing_status: 'processing' };

    case 'error':
      return { processing_status: 'failed' };

    case 'waiting':
      return {
        processing_status: { notIn: ['processing', 'failed'] },
        invoice: { is: { gestoria_review_status: 'waiting_client' } },
      };

    case 'done':
      return {
        processing_status: { notIn: ['processing', 'failed'] },
        invoice: { is: { gestoria_review_status: { in: GESTORIA_DONE } } },
      };

    case 'reviewed':
      return {
        processing_status: { notIn: ['processing', 'failed'] },
        invoice: {
          is: {
            review_status: 'approved',
            OR: [
              { gestoria_review_status: null },
              { gestoria_review_status: { notIn: GESTORIA_ACTIVE } },
            ],
          },
        },
      };

    case 'rejected':
      return {
        processing_status: { notIn: ['processing', 'failed'] },
        invoice: {
          is: {
            review_status: 'rejected',
            OR: [
              { gestoria_review_status: null },
              { gestoria_review_status: { notIn: GESTORIA_ACTIVE } },
            ],
          },
        },
      };

    case 'pending':
      return {
        processing_status: { notIn: ['processing', 'failed'] },
        OR: [
          { invoice: { is: null } },
          {
            invoice: {
              is: {
                review_status: { notIn: ['approved', 'rejected'] },
                OR: [
                  { gestoria_review_status: null },
                  { gestoria_review_status: { notIn: GESTORIA_ACTIVE } },
                ],
              },
            },
          },
        ],
      };

    default:
      return {};
  }
}

/** Builds the complete Prisma where object from all filter params. */
export function buildDocumentWhere(
  companyId: string,
  params: {
    status?: string | null;
    channel?: string | null;
    q?: string | null;
    from?: string | null;
    to?: string | null;
  },
): object {
  const and: any[] = [{ company_id: companyId }];

  if (params.channel && params.channel !== 'all') {
    and.push({ source_channel: params.channel });
  }

  if (params.status && params.status !== 'all') {
    const cond = buildUnifiedStatusCondition(params.status);
    if (Object.keys(cond).length > 0) and.push(cond);
  }

  if (params.from) {
    and.push({ upload_timestamp: { gte: new Date(`${params.from}T00:00:00`) } });
  }
  if (params.to) {
    and.push({ upload_timestamp: { lte: new Date(`${params.to}T23:59:59`) } });
  }

  if (params.q?.trim()) {
    const q = params.q.trim();
    and.push({
      OR: [
        { original_filename: { contains: q, mode: 'insensitive' } },
        { invoice: { is: { invoice_number: { contains: q, mode: 'insensitive' } } } },
        { invoice: { is: { supplier_name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }

  return and.length === 1 ? and[0] : { AND: and };
}
