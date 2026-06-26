import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram';
import { sendGestoriaMessageEmail } from '@/lib/email';

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
