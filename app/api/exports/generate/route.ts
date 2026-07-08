import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { generateCSV, getDateRange } from '@/lib/csv-generator';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { uploadFile, buildExportPath } from '@/lib/storage';
import { sendMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await resolveActiveCompanyId(session);
    if (!companyId) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const body = await request.json();
    const { exportType, year, quarter } = body; // exportType: 'monthly' or 'quarterly'

    // Custom period export: year + quarter override the automatic
    // "last completed quarter" range used by the quick quarterly export.
    // The rest of the flow below (query, CSV generation, upload, Export
    // record) is identical either way — only the {start, end} source differs.
    const isCustomQuarter = Number.isInteger(year) && [1, 2, 3, 4].includes(quarter);

    let start: Date;
    let end: Date;
    if (isCustomQuarter) {
      const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
      start = info.period_start;
      end = info.period_end;
    } else {
      ({ start, end } = getDateRange(exportType as any));
    }

    const resolvedExportType = isCustomQuarter ? 'quarterly' : exportType;

    const invoices = await prisma.invoice.findMany({
      where: {
        company_id: companyId,
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

    const filename = `${resolvedExportType}-export-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}.csv`;
    const cloud_storage_path = buildExportPath(companyId, filename);

    await uploadFile(Buffer.from(csvContent, 'utf-8'), cloud_storage_path, 'text/csv; charset=utf-8');

    const exportRecord = await prisma.export.create({
      data: {
        company_id: companyId,
        export_type: resolvedExportType,
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
          where: { company_id: companyId },
        });
        const exportMsg =
          `📁 <b>CSV Export Ready!</b>\n\n` +
          `📅 ${resolvedExportType.charAt(0).toUpperCase() + resolvedExportType.slice(1)} export\n` +
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
