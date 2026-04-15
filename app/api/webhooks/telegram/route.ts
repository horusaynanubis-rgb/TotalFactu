import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from '@/lib/aws-config';
import {
  sendMessage,
  editMessage,
  getFile,
  downloadFile,
  getMimeType,
  isSupportedFile,
  TelegramUpdate,
} from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Find company by bot token - we look up all companies with a telegram_bot_token
// and match via the webhook secret in the header
async function findCompanyBySecret(secretToken: string) {
  return prisma.company.findFirst({
    where: { telegram_webhook_secret: secretToken },
  });
}

// Find company that owns this bot token (fallback: iterate companies)
async function findCompanyByBotToken(botToken: string) {
  return prisma.company.findFirst({
    where: {
      telegram_bot_token: botToken,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    // Parse the update from Telegram
    const update: TelegramUpdate = await request.json();
    const message = update.message;

    if (!message) {
      return NextResponse.json({ ok: true });
    }

    // Identify the company via the X-Telegram-Bot-Api-Secret-Token header
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token');
    let company: any = null;

    if (secretToken) {
      company = await findCompanyBySecret(secretToken);
    }

    if (!company) {
      // Fallback: try to find any company with a configured bot token
      // In production with multiple companies, the secret token approach is preferred
      const companies = await prisma.company.findMany({
        where: { telegram_bot_token: { not: null } },
      });
      if (companies.length === 1) {
        company = companies[0];
      } else {
        console.error('Cannot determine company for telegram webhook - no secret match and multiple companies have tokens');
        return NextResponse.json({ ok: true });
      }
    }

    if (!company?.telegram_bot_token) {
      console.error('Company has no telegram bot token');
      return NextResponse.json({ ok: true });
    }

    const botToken = company.telegram_bot_token;
    const chatId = String(message.chat.id);
    const telegramUserId = String(message.from?.id || message.chat.id);

    // Handle /start command
    if (message.text?.startsWith('/start')) {
      await handleStartCommand(botToken, chatId, telegramUserId, company, message);
      return NextResponse.json({ ok: true });
    }

    // Handle /status command
    if (message.text?.startsWith('/status')) {
      await handleStatusCommand(botToken, chatId, telegramUserId, company);
      return NextResponse.json({ ok: true });
    }

    // Handle /help command
    if (message.text?.startsWith('/help')) {
      await sendMessage(botToken, chatId,
        '📋 <b>Available commands:</b>\n\n' +
        '/start - Link your account\n' +
        '/status - Check recent invoice status\n' +
        '/help - Show this help\n\n' +
        '📎 Send a <b>photo</b>, <b>PDF</b>, <b>JPG</b>, or <b>PNG</b> file to process an invoice.'
      );
      return NextResponse.json({ ok: true });
    }

    // Handle text messages that might be email for linking
    if (message.text && !message.text.startsWith('/')) {
      await handleTextMessage(botToken, chatId, telegramUserId, company, message.text);
      return NextResponse.json({ ok: true });
    }

    // Handle file uploads (document or photo)
    if (message.document || message.photo) {
      await handleFileUpload(botToken, chatId, telegramUserId, company, message);
      return NextResponse.json({ ok: true });
    }

    // Unknown message type
    await sendMessage(botToken, chatId,
      '❓ I can only process invoice files.\n\nPlease send a <b>PDF</b>, <b>JPG</b>, <b>PNG</b>, or <b>photo</b> of an invoice.\n\nType /help for more options.'
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    // Always return 200 to Telegram to prevent retries
    return NextResponse.json({ ok: true });
  }
}

async function handleStartCommand(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  company: any,
  message: any
) {
  // Check if already linked
  const existingLink = await prisma.telegramLink.findUnique({
    where: {
      telegram_id_company_id: {
        telegram_id: telegramUserId,
        company_id: company.id,
      },
    },
    include: { user: true },
  });

  if (existingLink) {
    await sendMessage(botToken, chatId,
      `✅ Welcome back, <b>${existingLink.user.name}</b>!\n\n` +
      `Your account is linked to <b>${company.name}</b>.\n\n` +
      '📎 Send a photo or file of an invoice to process it.'
    );
    return;
  }

  // Not linked - ask for email
  await sendMessage(botToken, chatId,
    `👋 Welcome to <b>${company.name}</b>'s TotalFactu bot!\n\n` +
    'To link your Telegram account, please send me your <b>registered email address</b>.\n\n' +
    '💡 If you don\'t have an account yet, sign up at the TotalFactu web app first.'
  );
}

async function handleTextMessage(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  company: any,
  text: string
) {
  // Check if already linked
  const existingLink = await prisma.telegramLink.findUnique({
    where: {
      telegram_id_company_id: {
        telegram_id: telegramUserId,
        company_id: company.id,
      },
    },
  });

  if (existingLink) {
    await sendMessage(botToken, chatId,
      '📎 To process an invoice, send a <b>photo</b>, <b>PDF</b>, <b>JPG</b>, or <b>PNG</b> file.\n\nType /help for more commands.'
    );
    return;
  }

  // Try to match email
  const email = text.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    await sendMessage(botToken, chatId,
      '❓ That doesn\'t look like an email address.\n\nPlease send your <b>registered email address</b> to link your account, or type /start to begin.'
    );
    return;
  }

  // Look up the user in this company
  const membership = await prisma.membership.findFirst({
    where: {
      company_id: company.id,
      user: { email },
    },
    include: { user: true },
  });

  if (!membership) {
    await sendMessage(botToken, chatId,
      '❌ No account found with that email in this company.\n\n' +
      'Please check your email or sign up at the TotalFactu web app first.'
    );
    return;
  }

  // Create the link
  await prisma.telegramLink.create({
    data: {
      telegram_id: telegramUserId,
      user_id: membership.user_id,
      company_id: company.id,
      username: undefined,
      first_name: undefined,
    },
  });

  await sendMessage(botToken, chatId,
    `✅ Account linked successfully!\n\n` +
    `Welcome, <b>${membership.user.name}</b>! You're connected to <b>${company.name}</b>.\n\n` +
    '📎 You can now send invoices (photos, PDFs, images) and I\'ll process them automatically.'
  );
}

async function handleStatusCommand(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  company: any
) {
  const link = await prisma.telegramLink.findUnique({
    where: {
      telegram_id_company_id: {
        telegram_id: telegramUserId,
        company_id: company.id,
      },
    },
  });

  if (!link) {
    await sendMessage(botToken, chatId,
      '⚠️ Your account is not linked. Send /start to begin.'
    );
    return;
  }

  // Get recent documents from this user via telegram
  const recentDocs = await prisma.document.findMany({
    where: {
      company_id: company.id,
      user_id: link.user_id,
      source_channel: 'telegram',
    },
    orderBy: { upload_timestamp: 'desc' },
    take: 5,
    include: { invoice: true },
  });

  if (recentDocs.length === 0) {
    await sendMessage(botToken, chatId,
      '📋 No recent invoices sent via Telegram. Send a file to get started!'
    );
    return;
  }

  const statusEmoji: Record<string, string> = {
    processing: '⏳',
    completed: '✅',
    needs_review: '⚠️',
    failed: '❌',
  };

  let statusText = '📋 <b>Recent invoices:</b>\n\n';
  for (const doc of recentDocs) {
    const emoji = statusEmoji[doc.processing_status] || '❓';
    const invoiceNum = doc.invoice?.invoice_number || 'Processing...';
    const amount = doc.invoice ? `€${doc.invoice.total_amount.toFixed(2)}` : '-';
    statusText += `${emoji} <b>${doc.original_filename}</b>\n`;
    statusText += `   Status: ${doc.processing_status} | #${invoiceNum} | ${amount}\n\n`;
  }

  await sendMessage(botToken, chatId, statusText);
}

async function handleFileUpload(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  company: any,
  message: any
) {
  // Check if user is linked
  const link = await prisma.telegramLink.findUnique({
    where: {
      telegram_id_company_id: {
        telegram_id: telegramUserId,
        company_id: company.id,
      },
    },
  });

  if (!link) {
    await sendMessage(botToken, chatId,
      '⚠️ Please link your account first.\n\nSend /start to begin the linking process.'
    );
    return;
  }

  // Determine file info
  let fileId: string;
  let fileName: string;
  let mimeType: string;

  if (message.document) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || `document_${Date.now()}`;
    mimeType = message.document.mime_type || getMimeType(fileName);

    // Check file size (Telegram limit is 20MB for bots)
    if (message.document.file_size && message.document.file_size > 20 * 1024 * 1024) {
      await sendMessage(botToken, chatId,
        '❌ File is too large. Maximum size is 20MB via Telegram.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
  } else if (message.photo) {
    // Get the largest photo
    const photo = message.photo[message.photo.length - 1];
    fileId = photo.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    mimeType = 'image/jpeg';
  } else {
    return;
  }

  // Check if supported
  if (!isSupportedFile(mimeType)) {
    await sendMessage(botToken, chatId,
      '❌ Unsupported file type. Please send a <b>PDF</b>, <b>JPG</b>, or <b>PNG</b> file.',
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  // Send "received" confirmation
  const statusMsg = await sendMessage(botToken, chatId,
    '📨 <b>Invoice received!</b>\n⏳ Downloading and processing...',
    { reply_to_message_id: message.message_id }
  );

  try {
    // Download file from Telegram
    const fileInfo = await getFile(botToken, fileId);
    if (!fileInfo?.file_path) {
      throw new Error('Could not get file path from Telegram');
    }

    const fileBuffer = await downloadFile(botToken, fileInfo.file_path);
    if (!fileBuffer) {
      throw new Error('Could not download file from Telegram');
    }

    // Upload to S3
    const s3Client = createS3Client();
    const { bucketName, folderPrefix } = getBucketConfig();
    const timestamp = Date.now();
    const cloudStoragePath = `${folderPrefix}uploads/telegram/${company.id}/${timestamp}-${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: cloudStoragePath,
        Body: fileBuffer,
        ContentType: mimeType,
      })
    );

    // Create document record
    const document = await prisma.document.create({
      data: {
        company_id: company.id,
        user_id: link.user_id,
        source_channel: 'telegram',
        original_filename: fileName,
        mime_type: mimeType,
        processing_status: 'processing',
        cloud_storage_path: cloudStoragePath,
        is_public: false,
        telegram_chat_id: chatId,
        telegram_message_id: statusMsg?.message_id || null,
      },
    });

    // Update status message
    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id,
        '📨 <b>Invoice received!</b>\n🤖 AI is extracting data...'
      );
    }

    // Trigger AI processing
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const processResponse = await fetch(`${baseUrl}/api/documents/${document.id}/process`, {
      method: 'POST',
    });

    if (processResponse.ok) {
      const result = await processResponse.json();
      const doc = result.document;
      const invoice = result.invoice;

      if (doc?.processing_status === 'completed') {
        let completedText = '✅ <b>Invoice processed successfully!</b>\n\n';
        if (invoice) {
          completedText += `📄 Invoice #${invoice.invoice_number}\n`;
          completedText += `🏢 ${invoice.supplier_name}\n`;
          completedText += `💰 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
          completedText += `📅 ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString() : 'N/A'}\n`;
          completedText += `\n🎯 Confidence: ${((doc.confidence_score || 0) * 100).toFixed(0)}%`;
        }
        if (statusMsg) {
          await editMessage(botToken, chatId, statusMsg.message_id, completedText);
        } else {
          await sendMessage(botToken, chatId, completedText);
        }
      } else if (doc?.processing_status === 'needs_review') {
        const reviewText = '⚠️ <b>Invoice processed - needs review</b>\n\n' +
          'Some fields could not be extracted with high confidence.\n' +
          'Please review in the TotalFactu dashboard.';
        if (statusMsg) {
          await editMessage(botToken, chatId, statusMsg.message_id, reviewText);
        } else {
          await sendMessage(botToken, chatId, reviewText);
        }
      }
    } else {
      // Processing failed
      const failText = '❌ <b>Processing failed</b>\n\n' +
        'Could not extract data from this file. Please try again or upload via the web dashboard.';
      if (statusMsg) {
        await editMessage(botToken, chatId, statusMsg.message_id, failText);
      } else {
        await sendMessage(botToken, chatId, failText);
      }
    }
  } catch (error: any) {
    console.error('Telegram file processing error:', error);
    const errorText = '❌ <b>Error processing invoice</b>\n\n' +
      `${error?.message || 'An unexpected error occurred'}\n\n` +
      'Please try again or upload via the web dashboard.';
    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id, errorText);
    } else {
      await sendMessage(botToken, chatId, errorText);
    }
  }
}
