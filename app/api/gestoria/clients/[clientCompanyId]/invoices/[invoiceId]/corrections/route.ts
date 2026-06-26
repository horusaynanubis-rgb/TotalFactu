import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { sendCorrectionNotificationEmail } from '@/lib/email';
import { sendMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const CORRECTABLE_FIELDS = new Set([
  'issue_date',
  'supplier_name',
  'invoice_number',
  'subtotal',
  'tax_amount',
  'total_amount',
  'invoice_type',
  'tax_rate',
  'category',
]);

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: {
      role: true,
      company_id: true,
      company: { select: { id: true, name: true, company_type: true, export_email: true } },
      user: { select: { name: true, email: true } },
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
    gestoriaEmail: membership.company.export_email,
    role: membership.role,
    userName: membership.user.name,
  };
}

// POST — gestoría creates a correction proposal
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string; invoiceId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (access.role === 'viewer') {
    return NextResponse.json({ error: 'Viewers cannot propose corrections' }, { status: 403 });
  }

  // Verify invoice belongs to client
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, company_id: params.clientCompanyId },
    select: { id: true, invoice_number: true, supplier_name: true },
  });
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  let body: {
    fieldChanges: { field: string; label: string; currentValue: string; proposedValue: string }[];
    reason?: string;
    clientComment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { fieldChanges, reason, clientComment } = body;

  if (!Array.isArray(fieldChanges) || fieldChanges.length === 0) {
    return NextResponse.json({ error: 'fieldChanges must be a non-empty array' }, { status: 400 });
  }
  for (const fc of fieldChanges) {
    if (!CORRECTABLE_FIELDS.has(fc.field)) {
      return NextResponse.json({ error: `Field '${fc.field}' is not correctable` }, { status: 400 });
    }
    if (fc.proposedValue === undefined || fc.proposedValue === null || String(fc.proposedValue).trim() === '') {
      return NextResponse.json({ error: `proposedValue is required for field '${fc.field}'` }, { status: 400 });
    }
  }

  // Supersede any existing pending proposals for this invoice
  await prisma.invoiceCorrectionProposal.updateMany({
    where: { invoice_id: params.invoiceId, status: 'pending' },
    data: { status: 'superseded' },
  });

  const proposal = await prisma.invoiceCorrectionProposal.create({
    data: {
      invoice_id: params.invoiceId,
      client_company_id: params.clientCompanyId,
      gestoria_company_id: access.gestoriaCompanyId,
      proposed_by_user_id: session.user.id,
      field_changes: JSON.stringify(fieldChanges),
      reason: reason?.trim() || null,
    },
  });

  // Notify client (email + Telegram)
  if (clientComment?.trim() || reason?.trim()) {
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
      const numFields = fieldChanges.length;
      const fieldList = fieldChanges.map((f) => `• ${f.label}: "${f.currentValue}" → "${f.proposedValue}"`).join('\n');
      const msgBody = [
        `Tu gestoría ${access.gestoriaName} ha propuesto ${numFields === 1 ? 'una corrección' : `${numFields} correcciones`} sobre la factura ${invoice.invoice_number ? `#${invoice.invoice_number}` : ''} (${invoice.supplier_name}).`,
        '',
        fieldList,
        reason ? `\nMotivo: ${reason}` : '',
        clientComment ? `\nComentario: ${clientComment}` : '',
        '\nPuedes aceptar, rechazar o pedir aclaración desde tu portal.',
      ].join('\n');

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
          emailSent = await sendCorrectionNotificationEmail({
            toEmail,
            subject: 'Corrección propuesta por tu gestoría',
            body: msgBody,
            ctaUrl: `${process.env.NEXTAUTH_URL ?? ''}/dashboard/review`,
            ctaLabel: 'Ver corrección pendiente',
          });
        }
      } catch { /* non-blocking */ }

      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken && telegramLinks.length > 0) {
          const tgText = `📋 *Corrección propuesta* por ${access.gestoriaName}\n\n${msgBody}`;
          await Promise.all(telegramLinks.map((l) => sendMessage(botToken, l.telegram_id, tgText)));
          telegramSent = true;
        }
      } catch { /* non-blocking */ }

      await prisma.gestoriaMessage.update({
        where: { id: record.id },
        data: { email_sent: emailSent, telegram_sent: telegramSent },
      });
    } catch { /* non-blocking */ }
  }

  return NextResponse.json({ ok: true, proposalId: proposal.id });
}

// GET — list correction proposals for this invoice (gestoría view)
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string; invoiceId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const invoiceExists = await prisma.invoice.findFirst({
    where: { id: params.invoiceId, company_id: params.clientCompanyId },
    select: { id: true },
  });
  if (!invoiceExists) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

  const proposals = await prisma.invoiceCorrectionProposal.findMany({
    where: { invoice_id: params.invoiceId },
    include: {
      proposed_by: { select: { id: true, name: true, email: true } },
      responded_by: { select: { id: true, name: true, email: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ proposals });
}
