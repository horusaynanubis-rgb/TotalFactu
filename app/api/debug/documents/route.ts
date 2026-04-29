import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) return false;
  return request.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized. Set DEBUG_SECRET in env and pass ?secret=XXX' }, { status: 401 });
  }

  const result: Record<string, any> = {};

  // 1. Session info (requires being logged in)
  const session = await getServerSession(authOptions);
  result.session = session
    ? {
        user_id: session.user.id,
        email: session.user.email,
        company_id_from_jwt: session.user.companyId ?? null,
        company_type: session.user.companyType ?? null,
      }
    : null;

  // 2. Memberships for this user
  if (session?.user?.id) {
    const memberships = await prisma.membership.findMany({
      where: { user_id: session.user.id },
      orderBy: { created_at: 'asc' },
      include: { company: { select: { id: true, name: true, company_type: true } } },
    });
    result.user_memberships = memberships.map(m => ({
      company_id: m.company_id,
      company_name: m.company.name,
      role: m.role,
      created_at: m.created_at,
    }));

    // Telegram links for this user
    const tgLinks = await prisma.telegramLink.findMany({
      where: { user_id: session.user.id },
      orderBy: { created_at: 'asc' },
      include: { company: { select: { id: true, name: true } } },
    });
    result.telegram_links = tgLinks.map(l => ({
      telegram_id: l.telegram_id,
      company_id: l.company_id,
      company_name: l.company.name,
      created_at: l.created_at,
    }));

    // Mismatch detection
    const membershipIds = new Set(memberships.map(m => m.company_id));
    const telegramIds = tgLinks.map(l => l.company_id);
    const mismatched = telegramIds.filter(id => !membershipIds.has(id));
    result.company_id_mismatch = mismatched.length > 0;
    if (mismatched.length > 0) {
      result.mismatch_telegram_company_ids = mismatched;
      result.mismatch_explanation = 'These company_ids are in TelegramLink but NOT in your Memberships. Documents uploaded via Telegram will NOT appear in the web UI.';
    }
  }

  // 3. Last 20 documents across ALL companies (to see what's actually in DB)
  const docs = await prisma.document.findMany({
    orderBy: { upload_timestamp: 'desc' },
    take: 20,
    select: {
      id: true,
      company_id: true,
      user_id: true,
      original_filename: true,
      mime_type: true,
      processing_status: true,
      source_channel: true,
      upload_timestamp: true,
    },
  });
  result.last_20_documents = docs;

  // 4. Last 20 invoices across ALL companies
  const invoices = await prisma.invoice.findMany({
    orderBy: { created_at: 'desc' },
    take: 20,
    select: {
      id: true,
      company_id: true,
      document_id: true,
      invoice_number: true,
      supplier_name: true,
      total_amount: true,
      created_at: true,
    },
  });
  result.last_20_invoices = invoices;

  // 5. What /api/documents would actually show for the current session
  const effectiveCompanyId = session?.user?.companyId ?? null;
  result.effective_company_id_for_api = effectiveCompanyId;
  if (effectiveCompanyId) {
    const visibleDocs = await prisma.document.findMany({
      where: { company_id: effectiveCompanyId },
      orderBy: { upload_timestamp: 'desc' },
      take: 20,
      select: { id: true, original_filename: true, processing_status: true, source_channel: true, upload_timestamp: true },
    });
    result.documents_visible_in_web = visibleDocs;
  }

  return NextResponse.json(result, { status: 200 });
}
