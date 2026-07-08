import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { sendCorrectionNotificationEmail } from '@/lib/email';
import { sendMessage } from '@/lib/telegram';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

const VALID_ACTIONS = ['accept', 'reject', 'needs_clarification'] as const;

// Mapping from proposal field names to Prisma Invoice scalar field names
const FIELD_MAP: Record<string, string> = {
  issue_date:     'issue_date',
  supplier_name:  'supplier_name',
  invoice_number: 'invoice_number',
  subtotal:       'subtotal',
  tax_amount:     'tax_amount',
  total_amount:   'total_amount',
  invoice_type:   'invoice_type',
  tax_rate:       'tax_rate',
  category:       'category',
};

const NUMERIC_FIELDS = new Set(['subtotal', 'tax_amount', 'total_amount', 'tax_rate']);
const DATE_FIELDS = new Set(['issue_date']);

// PATCH — client responds to a correction proposal
export async function PATCH(
  request: NextRequest,
  { params }: { params: { proposalId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  const membership = companyId
    ? await prisma.membership.findFirst({
        where: { user_id: session.user.id, company_id: companyId },
        select: {
          company_id: true,
          role: true,
          company: { select: { company_type: true, export_email: true, name: true } },
          user: { select: { name: true } },
        },
      })
    : null;
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (membership.company.company_type === 'gestoria') {
    return NextResponse.json({ error: 'Gestoria cannot respond to proposals via this endpoint' }, { status: 403 });
  }
  if (membership.role === 'viewer') {
    return NextResponse.json({ error: 'Viewers cannot respond to proposals' }, { status: 403 });
  }

  // Load proposal and verify it belongs to this client
  const proposal = await prisma.invoiceCorrectionProposal.findUnique({
    where: { id: params.proposalId },
    include: {
      invoice: { select: { id: true, invoice_number: true, supplier_name: true, company_id: true } },
      gestoria_company: { select: { id: true, name: true, export_email: true } },
    },
  });

  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  if (proposal.client_company_id !== membership.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Proposal is already ${proposal.status}` }, { status: 409 });
  }
  // Double-check invoice belongs to this client
  if (proposal.invoice.company_id !== membership.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { action: string; clientResponse?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, clientResponse } = body;

  if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const now = new Date();

  if (action === 'accept') {
    // Parse field changes and build invoice update payload
    let fieldChanges: { field: string; label: string; currentValue: string; proposedValue: string }[];
    try {
      fieldChanges = JSON.parse(proposal.field_changes);
    } catch {
      return NextResponse.json({ error: 'Corrupt proposal data' }, { status: 500 });
    }

    const invoiceUpdate: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};

    for (const fc of fieldChanges) {
      const prismaField = FIELD_MAP[fc.field];
      if (!prismaField) continue;

      oldValues[prismaField] = fc.currentValue;

      if (NUMERIC_FIELDS.has(fc.field)) {
        const n = parseFloat(fc.proposedValue);
        if (!isNaN(n)) invoiceUpdate[prismaField] = n;
      } else if (DATE_FIELDS.has(fc.field)) {
        const d = new Date(fc.proposedValue);
        if (!isNaN(d.getTime())) invoiceUpdate[prismaField] = d;
      } else {
        invoiceUpdate[prismaField] = fc.proposedValue;
      }
    }

    // Transaction: update invoice + mark proposal accepted + create audit logs
    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: proposal.invoice_id },
        data: invoiceUpdate,
      }),
      prisma.invoiceCorrectionProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'accepted',
          client_response: clientResponse?.trim() || null,
          responded_by_user_id: session.user.id,
          responded_at: now,
        },
      }),
      // InvoiceReviewLog entry for the correction acceptance
      prisma.invoiceReviewLog.create({
        data: {
          invoice_id: proposal.invoice_id,
          client_company_id: proposal.client_company_id,
          gestoria_company_id: proposal.gestoria_company_id,
          reviewed_by_user_id: session.user.id,
          action: 'correction_detected',
          previous_status: null,
          new_status: 'corrected',
          observations: `Corrección aceptada por el cliente. Campos aplicados: ${fieldChanges.map((f) => f.label).join(', ')}`,
          visible_to_client: false,
        },
      }),
      // AuditLog
      prisma.auditLog.create({
        data: {
          company_id: membership.company_id,
          user_id: session.user.id,
          entity_type: 'invoice',
          entity_id: proposal.invoice_id,
          action: 'update',
          old_values: JSON.stringify(oldValues),
          new_values: JSON.stringify(invoiceUpdate),
        },
      }),
    ]);

    // Notify gestoria
    _notifyGestoria({
      gestoriaEmail: proposal.gestoria_company.export_email,
      gestoriaName: proposal.gestoria_company.name,
      clientName: membership.company.name,
      invoiceNumber: proposal.invoice.invoice_number,
      action: 'accepted',
      clientResponse,
    });
  } else {
    // reject or needs_clarification
    const newStatus = action === 'reject' ? 'rejected' : 'needs_clarification';

    await prisma.invoiceCorrectionProposal.update({
      where: { id: proposal.id },
      data: {
        status: newStatus,
        client_response: clientResponse?.trim() || null,
        responded_by_user_id: session.user.id,
        responded_at: now,
      },
    });

    // Notify gestoria
    _notifyGestoria({
      gestoriaEmail: proposal.gestoria_company.export_email,
      gestoriaName: proposal.gestoria_company.name,
      clientName: membership.company.name,
      invoiceNumber: proposal.invoice.invoice_number,
      action: newStatus === 'rejected' ? 'rejected' : 'needs_clarification',
      clientResponse,
    });
  }

  return NextResponse.json({ ok: true, action });
}

// Fire-and-forget gestoria notification
function _notifyGestoria({
  gestoriaEmail,
  gestoriaName,
  clientName,
  invoiceNumber,
  action,
  clientResponse,
}: {
  gestoriaEmail: string;
  gestoriaName: string;
  clientName: string;
  invoiceNumber: string;
  action: string;
  clientResponse?: string;
}) {
  const actionLabels: Record<string, string> = {
    accepted: 'aceptado',
    rejected: 'rechazado',
    needs_clarification: 'solicitado aclaración',
  };
  const subjectLabels: Record<string, string> = {
    accepted: '✅ Corrección aceptada',
    rejected: '❌ Corrección rechazada',
    needs_clarification: '💬 El cliente solicita aclaración',
  };

  const subject = subjectLabels[action] ?? 'Respuesta del cliente';
  const bodyLines = [
    `El cliente ${clientName} ha ${actionLabels[action] ?? action} la propuesta de corrección sobre la factura ${invoiceNumber ? `#${invoiceNumber}` : ''}.`,
  ];
  if (clientResponse?.trim()) {
    bodyLines.push('', `Mensaje del cliente: ${clientResponse.trim()}`);
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  sendCorrectionNotificationEmail({
    toEmail: gestoriaEmail,
    subject,
    body: bodyLines.join('\n'),
    ctaUrl: `${baseUrl}/dashboard/gestoria/clients`,
    ctaLabel: 'Ver clientes en TotalFactu',
  }).catch(() => { /* non-blocking */ });
}
