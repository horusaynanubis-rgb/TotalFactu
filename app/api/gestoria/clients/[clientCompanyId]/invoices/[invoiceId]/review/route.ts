import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram';
import { sendGestoriaMessageEmail } from '@/lib/email';
import {
  isValidDocumentTypeValue,
  isValidFiscalPeriodValue,
  isValidVatTreatmentOverrideValue,
  isVatTreatmentOverrideConsistentWithDocumentType,
  buildFiscalOverrideUpdate,
} from '@/lib/invoice-fiscal-override';

export const dynamic = 'force-dynamic';

const VALID_ACTIONS = [
  'mark_correct',
  'mark_incorrect',
  'mark_pending',
  'add_note',
  'request_client_action',
  'correction_detected',
] as const;

const VALID_STATUSES = [
  'reviewed_ok',
  'reviewed_issue',
  'waiting_client',
  'pending_review',
  'corrected',
  'ignored',
] as const;

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: {
      role: true,
      company_id: true,
      company: { select: { id: true, name: true, company_type: true } },
    },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return {
    gestoriaCompanyId: membership.company_id,
    gestoriaName: membership.company.name,
    role: membership.role,
  };
}

// POST — create a review entry
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string; invoiceId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (access.role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden: viewers cannot review' }, { status: 403 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, company_id: params.clientCompanyId },
    select: { id: true, gestoria_review_status: true, invoice_number: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  let body: {
    action: string;
    newStatus: string;
    observations?: string;
    internalNotes?: string;
    issueTypes?: string[];
    clientComment?: string;
    visibleToClient?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, newStatus, observations, internalNotes, issueTypes, clientComment, visibleToClient } = body;

  if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(newStatus as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: 'Invalid newStatus' }, { status: 400 });
  }

  const issueTypesJson = issueTypes?.length ? JSON.stringify(issueTypes) : null;
  const previousStatus = invoice.gestoria_review_status ?? null;

  const [log] = await prisma.$transaction([
    prisma.invoiceReviewLog.create({
      data: {
        invoice_id: params.invoiceId,
        client_company_id: params.clientCompanyId,
        gestoria_company_id: access.gestoriaCompanyId,
        reviewed_by_user_id: session.user.id,
        action,
        previous_status: previousStatus,
        new_status: newStatus,
        observations: observations?.trim() || null,
        internal_notes: internalNotes?.trim() || null,
        issue_types: issueTypesJson,
        client_comment: clientComment?.trim() || null,
        visible_to_client: !!visibleToClient,
      },
    }),
    prisma.invoice.update({
      where: { id: params.invoiceId },
      data: {
        gestoria_review_status: newStatus,
        gestoria_reviewed_at: new Date(),
        gestoria_reviewed_by: session.user.id,
        gestoria_review_notes: observations?.trim() || null,
        gestoria_issue_types: issueTypesJson,
      },
    }),
  ]);

  // Send notification to client if comment is visible or action requests client action
  if ((visibleToClient || action === 'request_client_action') && clientComment?.trim()) {
    try {
      const [clientCompany, telegramLinks, invitation] = await Promise.all([
        prisma.company.findUnique({
          where: { id: params.clientCompanyId },
          select: { export_email: true },
        }),
        prisma.telegramLink.findMany({
          where: { company_id: params.clientCompanyId },
          select: { telegram_id: true },
        }),
        prisma.licenseInvitation.findFirst({
          where: { gestoria_company_id: access.gestoriaCompanyId, status: 'accepted' },
          select: { email: true },
        }),
      ]);

      const toEmail = invitation?.email ?? clientCompany?.export_email ?? '';
      const msgBody = `Revisión factura${invoice.invoice_number ? ` ${invoice.invoice_number}` : ''}: ${clientComment.trim()}`;

      const record = await prisma.gestoriaMessage.create({
        data: {
          gestoria_company_id: access.gestoriaCompanyId,
          client_company_id: params.clientCompanyId,
          subject: 'Revisión factura',
          body: msgBody,
        },
      });

      let emailSent = false;
      let telegramSent = false;

      try {
        if (toEmail) {
          await sendGestoriaMessageEmail({
            toEmail,
            gestoriaName: access.gestoriaName,
            subject: 'Revisión factura',
            body: msgBody,
          });
          emailSent = true;
        }
      } catch { /* non-blocking */ }

      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken && telegramLinks.length > 0) {
          const tgText = `📋 *${access.gestoriaName}* — Revisión factura\n\n${msgBody}`;
          await Promise.all(
            telegramLinks.map((l) => sendMessage(botToken, l.telegram_id, tgText)),
          );
          telegramSent = true;
        }
      } catch { /* non-blocking */ }

      await prisma.gestoriaMessage.update({
        where: { id: record.id },
        data: { email_sent: emailSent, telegram_sent: telegramSent },
      });
    } catch { /* non-blocking: notification failure never fails the review */ }
  }

  return NextResponse.json({ ok: true, logId: log.id });
}

// PATCH — gestoría confirms/overrides document_type and/or fiscal_period
// (Fase Gascón, 2026-09). Separate from the POST review-workflow above (that
// tracks gestoria_review_status; this tracks fiscal classification/period —
// two independent concerns, see lib/invoice-fiscal-treatment.ts). Reuses the
// same access resolution and cross-company scoping as GET/POST in this file.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string; invoiceId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (access.role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden: viewers cannot review' }, { status: 403 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, company_id: params.clientCompanyId },
    select: {
      id: true,
      document_type: true,
      fiscal_period_year: true,
      fiscal_period_quarter: true,
      vat_treatment_override: true,
      vat_treatment_override_note: true,
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  let body: {
    document_type?: string | null;
    fiscal_period_year?: number | null;
    fiscal_period_quarter?: number | null;
    vat_treatment_override?: string | null;
    vat_treatment_override_note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if ('document_type' in body && !isValidDocumentTypeValue(body.document_type)) {
    return NextResponse.json({ error: 'Invalid document_type' }, { status: 400 });
  }
  if (
    ('fiscal_period_year' in body || 'fiscal_period_quarter' in body) &&
    !isValidFiscalPeriodValue(body.fiscal_period_year ?? null, body.fiscal_period_quarter ?? null)
  ) {
    return NextResponse.json({ error: 'Invalid fiscal_period_year/fiscal_period_quarter' }, { status: 400 });
  }
  if ('vat_treatment_override' in body && !isValidVatTreatmentOverrideValue(body.vat_treatment_override)) {
    return NextResponse.json({ error: 'Invalid vat_treatment_override' }, { status: 400 });
  }
  if ('vat_treatment_override' in body) {
    const resolvedDocumentType = 'document_type' in body ? (body.document_type ?? null) : invoice.document_type;
    if (!isVatTreatmentOverrideConsistentWithDocumentType(resolvedDocumentType as any, (body.vat_treatment_override ?? null) as any)) {
      return NextResponse.json(
        { error: 'vat_treatment_override cannot be combined with document_type = SIMPLIFIED_INVOICE' },
        { status: 400 },
      );
    }
  }

  const { updateData, auditEntries } = buildFiscalOverrideUpdate(
    invoice,
    {
      ...('document_type' in body ? { document_type: (body.document_type ?? null) as 'FULL_INVOICE' | 'SIMPLIFIED_INVOICE' | null } : {}),
      ...('fiscal_period_year' in body || 'fiscal_period_quarter' in body
        ? { fiscal_period_year: body.fiscal_period_year ?? null, fiscal_period_quarter: body.fiscal_period_quarter ?? null }
        : {}),
      ...('vat_treatment_override' in body
        ? { vat_treatment_override: (body.vat_treatment_override ?? null) as any, vat_treatment_override_note: body.vat_treatment_override_note ?? null }
        : {}),
    },
    session.user.id,
  );

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ ok: true, invoice, changed: false });
  }

  const [updatedInvoice] = await prisma.$transaction([
    prisma.invoice.update({ where: { id: params.invoiceId }, data: updateData }),
    ...auditEntries.map((entry) =>
      prisma.auditLog.create({
        data: {
          company_id: params.clientCompanyId,
          user_id: session.user.id,
          entity_type: 'invoice',
          entity_id: params.invoiceId,
          action: entry.action,
          old_values: entry.old_values,
          new_values: entry.new_values,
        },
      }),
    ),
  ]);

  return NextResponse.json({ ok: true, invoice: updatedInvoice, changed: true });
}

// GET — review history for an invoice
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string; invoiceId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invoiceExists = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, company_id: params.clientCompanyId },
    select: { id: true },
  });
  if (!invoiceExists) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const logs = await prisma.invoiceReviewLog.findMany({
    where: { invoice_id: params.invoiceId },
    include: {
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ logs });
}
