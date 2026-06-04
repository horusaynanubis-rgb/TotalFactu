import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram';
import { sendGestoriaMessageEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const VALID_SUBJECTS = [
  'General',
  'Revisión factura',
  'Exportación CSV',
  'Documentación pendiente',
  'Aviso importante',
  'Otro',
] as const;

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { id: true, name: true, company_type: true } } },
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

  return { gestoriaCompanyId: membership.company_id, gestoriaName: membership.company.name };
}

// GET — message history for this gestoria↔client pair
export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const messages = await prisma.gestoriaMessage.findMany({
    where: {
      gestoria_company_id: access.gestoriaCompanyId,
      client_company_id: params.clientCompanyId,
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  return NextResponse.json({ messages });
}

// POST — send a new message
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const { subject, message } = body ?? {};

  if (!subject || !VALID_SUBJECTS.includes(subject)) {
    return NextResponse.json({ error: 'Motivo inválido' }, { status: 400 });
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'El mensaje no puede estar vacío' }, { status: 400 });
  }
  if (message.length > 1000) {
    return NextResponse.json({ error: 'El mensaje no puede superar 1000 caracteres' }, { status: 400 });
  }

  // Fetch client data needed for delivery
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
      where: {
        gestoria_company_id: access.gestoriaCompanyId,
        license: { client_company_id: params.clientCompanyId },
        status: 'accepted',
      },
      select: { email: true },
    }),
  ]);

  if (!clientCompany) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  }

  // Create message record
  const record = await prisma.gestoriaMessage.create({
    data: {
      gestoria_company_id: access.gestoriaCompanyId,
      client_company_id: params.clientCompanyId,
      subject,
      body: message.trim(),
    },
  });

  // Determine recipient email
  const toEmail = invitation?.email ?? clientCompany.export_email;

  // Send email
  const emailSent = await sendGestoriaMessageEmail({
    toEmail,
    gestoriaName: access.gestoriaName,
    subject,
    body: message.trim(),
  });

  // Send Telegram (if linked)
  let telegramSent = false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && telegramLinks.length > 0) {
    const tgText =
      `📩 <b>Nuevo mensaje de tu gestoría</b>\n\n` +
      `<b>Motivo:</b> ${subject}\n\n` +
      `${message.trim()}\n\n` +
      `<i>Accede a TotalFactu para ver todos tus mensajes.</i>`;
    const results = await Promise.all(
      telegramLinks.map((link) => sendMessage(botToken, link.telegram_id, tgText)),
    );
    telegramSent = results.some(Boolean);
  }

  // Update delivery flags
  if (emailSent || telegramSent) {
    await prisma.gestoriaMessage.update({
      where: { id: record.id },
      data: { email_sent: emailSent, telegram_sent: telegramSent },
    });
  }

  return NextResponse.json({
    ok: true,
    messageId: record.id,
    emailSent,
    telegramSent,
    telegramAvailable: telegramLinks.length > 0,
  });
}
