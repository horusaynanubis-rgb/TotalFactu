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

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Not logged in — open this URL in a browser where you are authenticated' }, { status: 401 });
  }

  const result: Record<string, any> = {};

  // 1. What the session knows
  result.session_user_id = session.user.id;
  result.session_company_id = session.user.companyId ?? null;
  result.session_company_type = session.user.companyType ?? null;

  // 2. All memberships for this user (to spot multi-company cases)
  const memberships = await prisma.membership.findMany({
    where: { user_id: session.user.id },
    orderBy: { created_at: 'asc' },
    include: { company: { select: { id: true, name: true, company_type: true } } },
  });
  result.memberships = memberships.map(m => ({
    membership_id: m.id,
    company_id: m.company_id,
    company_name: m.company.name,
    company_type: m.company.company_type,
    role: m.role,
    created_at: m.created_at,
  }));

  // 3. Telegram links for this user
  const telegramLinks = await prisma.telegramLink.findMany({
    where: { user_id: session.user.id },
    orderBy: { created_at: 'asc' },
    include: { company: { select: { id: true, name: true } } },
  });
  result.telegram_links = telegramLinks.map(l => ({
    telegram_id: l.telegram_id,
    company_id: l.company_id,
    company_name: l.company.name,
    created_at: l.created_at,
  }));

  // 4. Determine which company_id /api/documents would use
  const effectiveCompanyId = session.user.companyId ?? memberships[0]?.company_id ?? null;
  result.effective_company_id_for_documents = effectiveCompanyId;

  // 5. Last 10 documents for the effective company
  if (effectiveCompanyId) {
    const docs = await prisma.document.findMany({
      where: { company_id: effectiveCompanyId },
      orderBy: { upload_timestamp: 'desc' },
      take: 10,
      select: {
        id: true,
        company_id: true,
        original_filename: true,
        processing_status: true,
        source_channel: true,
        mime_type: true,
        upload_timestamp: true,
      },
    });
    result.last_10_docs_for_session_company = docs;
  }

  // 6. Last 5 documents across ALL companies (to catch cross-company uploads)
  const allRecentDocs = await prisma.document.findMany({
    orderBy: { upload_timestamp: 'desc' },
    take: 5,
    select: {
      id: true,
      company_id: true,
      original_filename: true,
      processing_status: true,
      source_channel: true,
      upload_timestamp: true,
    },
  });
  result.last_5_docs_global = allRecentDocs;

  // 7. Mismatch detection
  const telegramCompanyIds = new Set(telegramLinks.map(l => l.company_id));
  const membershipCompanyIds = new Set(memberships.map(m => m.company_id));
  const mismatch = [...telegramCompanyIds].some(id => !membershipCompanyIds.has(id));
  result.company_id_mismatch_detected = mismatch;
  if (mismatch) {
    result.mismatch_detail = 'TelegramLink uses a company_id that is NOT in your memberships list. Documents would be invisible in the web UI.';
  }

  return NextResponse.json(result, { status: 200 });
}
