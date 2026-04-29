import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) return false;
  return request.nextUrl.searchParams.get('secret') === secret;
}

/**
 * GET  /api/debug/telegram-links?secret=XXX&telegram_id=1312375861
 *   — Shows all TelegramLink rows for a given telegram_id and which one
 *     the webhook would actually use (most recently created).
 *
 * POST /api/debug/telegram-links?secret=XXX
 *   body: { telegram_id: "1312375861", keep_company_id: "mariano-company-001" }
 *   — Deletes all TelegramLink rows for that telegram_id EXCEPT the one
 *     matching keep_company_id. Use once to fix stale prod data.
 */

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const telegramId = request.nextUrl.searchParams.get('telegram_id');
  if (!telegramId) {
    return NextResponse.json({ error: 'Pass ?telegram_id=XXXXXX' }, { status: 400 });
  }

  const links = await prisma.telegramLink.findMany({
    where: { telegram_id: telegramId },
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      company: { select: { id: true, name: true, company_type: true } },
    },
  });

  const active = links[0] ?? null; // the one the webhook uses (desc order = newest first)

  return NextResponse.json({
    telegram_id: telegramId,
    total_links: links.length,
    active_link: active
      ? {
          id: active.id,
          company_id: active.company_id,
          company_name: active.company.name,
          user_id: active.user_id,
          user_email: active.user.email,
          created_at: active.created_at,
        }
      : null,
    all_links: links.map(l => ({
      id: l.id,
      company_id: l.company_id,
      company_name: l.company.name,
      user_id: l.user_id,
      user_email: l.user.email,
      created_at: l.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { telegram_id, keep_company_id } = body;
  if (!telegram_id || !keep_company_id) {
    return NextResponse.json({ error: 'Body must include telegram_id and keep_company_id' }, { status: 400 });
  }

  // Show what exists before the cleanup
  const before = await prisma.telegramLink.findMany({
    where: { telegram_id },
    orderBy: { created_at: 'desc' },
    select: { id: true, company_id: true, user_id: true, created_at: true },
  });

  // Confirm the link to keep actually exists
  const keepLink = before.find(l => l.company_id === keep_company_id);
  if (!keepLink) {
    return NextResponse.json({
      error: `No TelegramLink found for telegram_id=${telegram_id} company_id=${keep_company_id}`,
      existing_links: before,
    }, { status: 404 });
  }

  // Delete all other links for this telegram_id
  const result = await prisma.telegramLink.deleteMany({
    where: {
      telegram_id,
      NOT: { company_id: keep_company_id },
    },
  });

  const after = await prisma.telegramLink.findMany({
    where: { telegram_id },
    select: { id: true, company_id: true, user_id: true, created_at: true },
  });

  return NextResponse.json({
    ok: true,
    telegram_id,
    kept_company_id: keep_company_id,
    deleted_count: result.count,
    links_before: before,
    links_after: after,
  });
}
