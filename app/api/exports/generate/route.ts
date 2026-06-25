import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { generateCSV, getDateRange } from '@/lib/csv-generator';
import { uploadFile, buildExportPath } from '@/lib/storage';
import { sendMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id },
      include: { company: true },
    });

    if (!membership) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const body = await request.json();
    const { exportType } = body; // 'monthly' or 'quarterly'

    const { start, end } = getDateRange(exportType as any);

    const invoices = await prisma.invoice.findMany({
      where: {
        company_id: membership.company_id,
        issue_date: { gte: start, lte: end },
      },
      include: { document: true },
      orderBy: { issue_date: 'desc' },
    });

    if (invoices.length === 0) {
      return NextResponse.json(
        { message: 'No invoices found for this period' },
        { status: 400 }
      );
    }

    const csvContent = generateCSV(invoices as any);

    const filename = `${exportType}-export-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}.csv`;
    const cloud_storage_path = buildExportPath(membership.company_id, filename);

    await uploadFile(Buffer.from(csvContent, 'utf-8'), cloud_storage_path, 'text/csv; charset=utf-8');

    const exportRecord = await prisma.export.create({
      data: {
        company_id: membership.company_id,
        export_type: exportType,
        period_start: start,
        period_end: end,
        record_count: invoices.length,
        cloud_storage_path,
        is_public: false,
      },
    });

    // Email notification placeholder
    try {
      await prisma.export.update({
        where: { id: exportRecord.id },
        data: { email_sent: false, email_sent_at: null },
      });
    } catch (emailError: any) {
      console.error('Email notification skipped/failed:', emailError);
    }

    // Telegram notification
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const telegramLinks = await prisma.telegramLink.findMany({
          where: { company_id: membership.company_id },
        });
        const exportMsg =
          `📁 <b>CSV Export Ready!</b>\n\n` +
          `📅 ${exportType.charAt(0).toUpperCase() + exportType.slice(1)} export\n` +
          `📄 ${invoices.length} invoices\n` +
          `📆 ${formatDate(start)} — ${formatDate(end)}\n\n` +
          `Download it from the TotalFactu dashboard.`;
        for (const link of telegramLinks) {
          await sendMessage(botToken, link.telegram_id, exportMsg);
        }
      }
    } catch (tgError: any) {
      console.error('Telegram export notification failed:', tgError);
    }

    return NextResponse.json({ export: exportRecord });
  } catch (error: any) {
    console.error('Generate export error:', error);
    return NextResponse.json(
      { message: `Failed to generate export: ${error?.message}` },
      { status: 500 }
    );
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
