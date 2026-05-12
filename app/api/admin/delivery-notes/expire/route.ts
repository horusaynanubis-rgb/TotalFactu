import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// POST /api/admin/delivery-notes/expire
// Marks pending delivery notes older than EXPIRY_MONTHS (default 6) as 'expired'.
// Can be called from a cron job or manually by an admin.
// Protected by ADMIN_SECRET header.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const expiryMonths = Number(process.env.DELIVERY_NOTE_EXPIRY_MONTHS ?? 6);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - expiryMonths);

  const result = await prisma.deliveryNote.updateMany({
    where: {
      status: 'pending',
      created_at: { lt: cutoff },
    },
    data: { status: 'expired' },
  });

  console.log(`[expire] Marked ${result.count} delivery notes as expired (cutoff=${cutoff.toISOString()})`);
  return NextResponse.json({ expired_count: result.count, cutoff });
}
