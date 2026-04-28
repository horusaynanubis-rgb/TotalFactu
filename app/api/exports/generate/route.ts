import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { generateCSV, getDateRange } from '@/lib/csv-generator';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from '@/lib/aws-config';
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

    // Fetch invoices for the period
    const invoices = await prisma.invoice.findMany({
      where: {
        company_id: membership.company_id,
        issue_date: {
          gte: start,
          lte: end,
        },
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

    // Generate CSV
    const csvContent = generateCSV(invoices as any);

    // Upload to S3
    const s3Client = createS3Client();
    const { bucketName, folderPrefix } = getBucketConfig();
    const timestamp = Date.now();
    const filename = `${exportType}-export-${start.toISOString().split('T')[0]}-${end.toISOString().split('T')[0]}.csv`;
    const cloud_storage_path = `${folderPrefix}exports/${membership.company_id}/${timestamp}-${filename}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: cloud_storage_path,
        Body: Buffer.from(csvContent, 'utf-8'),
        ContentType: 'text/csv',
        ContentDisposition: 'attachment',
      })
    );

    // Save export record
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

        // Send email notification (local mode): Abacus dependency removed.
    // Keep export generation functional even without an email provider configured.
    try {
      // TODO: integrate local SMTP/Resend provider.
      // For now, we intentionally skip external email dispatch.
      await prisma.export.update({
        where: { id: exportRecord.id },
        data: {
          email_sent: false,
          email_sent_at: null,
        },
      });
    } catch (emailError: any) {
      console.error('Email notification skipped/failed:', emailError);
    }

// Send Telegram notification to all linked users for this company
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const telegramLinks = await prisma.telegramLink.findMany({
          where: { company_id: membership.company_id },
        });
        const exportMsg =
          `\ud83d\udcc1 <b>CSV Export Ready!</b>\n\n` +
          `\ud83d\udcc5 ${exportType.charAt(0).toUpperCase() + exportType.slice(1)} export\n` +
          `\ud83d\udcc4 ${invoices.length} invoices\n` +
          `\ud83d\udcc6 ${formatDate(start)} \u2014 ${formatDate(end)}\n\n` +
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
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
