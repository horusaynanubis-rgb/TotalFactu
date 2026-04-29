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

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return token;
}

export async function POST(request: NextRequest) {
  try {
    // Validate webhook secret
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');

    if (webhookSecret) {
      if (!incomingSecret) {
        console.warn('[Telegram webhook] REJECTED: TELEGRAM_WEBHOOK_SECRET is set but Telegram did not send X-Telegram-Bot-Api-Secret-Token header. The webhook may have been registered without a secret_token. Call POST /api/telegram/set-webhook with { force: true } to re-register.');
        return NextResponse.json({ ok: true });
      }
      if (incomingSecret !== webhookSecret) {
        console.warn('[Telegram webhook] REJECTED: secret token mismatch. Incoming does not match TELEGRAM_WEBHOOK_SECRET. Re-register the webhook to sync the secret.');
        return NextResponse.json({ ok: true });
      }
    } else if (incomingSecret) {
      console.warn('[Telegram webhook] WARNING: Telegram sent a secret token but TELEGRAM_WEBHOOK_SECRET is not set. Update will be processed but consider setting the env var for security.');
    }

    const body = await request.text();
    console.log('[Telegram webhook] Raw body length:', body.length);

    let update: TelegramUpdate;
    try {
      update = JSON.parse(body) as TelegramUpdate;
    } catch {
      console.error('[Telegram webhook] Failed to parse JSON body');
      return NextResponse.json({ ok: true });
    }

    console.log('[Telegram webhook] update_id:', update.update_id, '| has message:', Boolean(update.message));

    const message = update.message;

    if (!message) {
      console.log('[Telegram webhook] No message in update — ignoring');
      return NextResponse.json({ ok: true });
    }

    const botToken = getBotToken();
    const chatId = String(message.chat.id);
    const telegramUserId = String(message.from?.id ?? message.chat.id);

    console.log(`[Telegram webhook] chat_id=${chatId} user_id=${telegramUserId} text=${JSON.stringify(message.text ?? null)} has_doc=${Boolean(message.document)} has_photo=${Boolean(message.photo)}`);

    if (message.text?.startsWith('/start')) {
      console.log('[Telegram webhook] Handling /start command');
      await handleStartCommand(botToken, chatId, telegramUserId, message);
      return NextResponse.json({ ok: true });
    }

    if (message.text?.startsWith('/status')) {
      console.log('[Telegram webhook] Handling /status command');
      await handleStatusCommand(botToken, chatId, telegramUserId);
      return NextResponse.json({ ok: true });
    }

    if (message.text?.startsWith('/help')) {
      console.log('[Telegram webhook] Handling /help command');
      await sendMessage(botToken, chatId,
        '📋 <b>Comandos disponibles:</b>\n\n' +
        '/start CODIGO — Vincula tu cuenta de TotalFactu\n' +
        '/status — Ver estado de tus últimas facturas\n' +
        '/help — Mostrar esta ayuda\n\n' +
        '📎 Envía una <b>foto</b>, <b>PDF</b>, <b>JPG</b> o <b>PNG</b> para procesar una factura.'
      );
      return NextResponse.json({ ok: true });
    }

    if (message.document || message.photo) {
      console.log('[Telegram webhook] Handling file upload');
      await handleFileUpload(botToken, chatId, telegramUserId, message);
      return NextResponse.json({ ok: true });
    }

    // Unknown text — check if linked first
    const link = await prisma.telegramLink.findFirst({
      where: { telegram_id: telegramUserId },
    });
    if (!link) {
      await sendMessage(botToken, chatId,
        '👋 Bienvenido a <b>TotalFactu</b>.\n\n' +
        'Para empezar, obtén tu código de vinculación en Configuración y envía:\n\n' +
        '<code>/start TF-XXXXXX</code>'
      );
    } else {
      await sendMessage(botToken, chatId,
        '📎 Envía una <b>foto</b> o <b>archivo</b> de factura para procesarla.\n\nEscribe /help para más opciones.'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram webhook] Unhandled error:', error);
    return NextResponse.json({ ok: true });
  }
}

async function handleStartCommand(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  message: any
) {
  const parts = message.text?.trim().split(/\s+/) ?? [];
  const code = parts[1];

  console.log(`[Telegram /start] chat_id=${chatId} user_id=${telegramUserId} code=${code ?? 'none'}`);

  if (!code) {
    const existing = await prisma.telegramLink.findFirst({
      where: { telegram_id: telegramUserId },
      include: { user: true, company: true },
    });
    if (existing) {
      console.log(`[Telegram /start] Already linked — user_id=${existing.user_id} company_id=${existing.company_id}`);
      await sendMessage(botToken, chatId,
        `✅ Tu cuenta ya está vinculada.\n\n` +
        `👤 <b>${existing.user.name}</b> → <b>${existing.company.name}</b>\n\n` +
        '📎 Envía una factura para procesarla.'
      );
    } else {
      console.log('[Telegram /start] No code and not linked — showing welcome message');
      await sendMessage(botToken, chatId,
        '👋 Bienvenido a <b>TotalFactu</b>.\n\n' +
        'Para vincular tu cuenta, genera un código desde Configuración y envía:\n\n' +
        '<code>/start TF-XXXXXX</code>'
      );
    }
    return;
  }

  // Validate the linking code
  const normalizedCode = code.toUpperCase();
  console.log(`[Telegram /start] Looking up code: ${normalizedCode}`);

  const linkCode = await prisma.telegramLinkCode.findUnique({
    where: { code: normalizedCode },
    include: { user: true, company: true },
  });

  if (!linkCode) {
    console.warn(`[Telegram /start] Code not found in DB: ${normalizedCode}`);
    await sendMessage(botToken, chatId,
      '❌ Código no válido. Genera uno nuevo desde Configuración en TotalFactu.'
    );
    return;
  }

  console.log(`[Telegram /start] Code found: id=${linkCode.id} user_id=${linkCode.user_id} used_at=${linkCode.used_at} expires_at=${linkCode.expires_at}`);

  if (linkCode.used_at) {
    console.warn(`[Telegram /start] Code already used at ${linkCode.used_at}`);
    await sendMessage(botToken, chatId,
      '❌ Este código ya ha sido usado. Genera uno nuevo desde Configuración.'
    );
    return;
  }

  if (linkCode.expires_at < new Date()) {
    console.warn(`[Telegram /start] Code expired at ${linkCode.expires_at}`);
    await sendMessage(botToken, chatId,
      '❌ Este código ha caducado. Genera uno nuevo desde Configuración.'
    );
    return;
  }

  // Create or update the TelegramLink
  console.log(`[Telegram /start] Creating/updating TelegramLink for telegram_id=${telegramUserId} company_id=${linkCode.company_id}`);
  await prisma.telegramLink.upsert({
    where: {
      telegram_id_company_id: {
        telegram_id: telegramUserId,
        company_id: linkCode.company_id,
      },
    },
    create: {
      telegram_id: telegramUserId,
      user_id: linkCode.user_id,
      company_id: linkCode.company_id,
      username: message.from?.username,
      first_name: message.from?.first_name,
    },
    update: {
      user_id: linkCode.user_id,
      username: message.from?.username,
      first_name: message.from?.first_name,
    },
  });

  // Mark code as used
  await prisma.telegramLinkCode.update({
    where: { id: linkCode.id },
    data: { used_at: new Date() },
  });

  console.log(`[Telegram /start] TelegramLink created/updated successfully. Sending confirmation to chat_id=${chatId}`);

  const sendResult = await sendMessage(botToken, chatId,
    `✅ <b>¡Cuenta vinculada correctamente!</b>\n\n` +
    `👤 ${linkCode.user.name}\n` +
    `🏢 ${linkCode.company.name}\n\n` +
    '📎 Ya puedes enviar facturas (fotos, PDFs, imágenes) y las procesaré automáticamente.'
  );

  if (!sendResult) {
    console.error(`[Telegram /start] sendMessage failed for chat_id=${chatId} — check TELEGRAM_BOT_TOKEN and bot permissions`);
  } else {
    console.log(`[Telegram /start] Confirmation message sent successfully`);
  }
}

async function handleStatusCommand(
  botToken: string,
  chatId: string,
  telegramUserId: string
) {
  const link = await prisma.telegramLink.findFirst({
    where: { telegram_id: telegramUserId },
  });

  if (!link) {
    await sendMessage(botToken, chatId,
      '⚠️ Tu cuenta no está vinculada. Genera un código en TotalFactu y envía /start CODIGO.'
    );
    return;
  }

  const recentDocs = await prisma.document.findMany({
    where: {
      company_id: link.company_id,
      user_id: link.user_id,
      source_channel: 'telegram',
    },
    orderBy: { upload_timestamp: 'desc' },
    take: 5,
    include: { invoice: true },
  });

  if (recentDocs.length === 0) {
    await sendMessage(botToken, chatId,
      '📋 Aún no has enviado facturas por Telegram. ¡Envía tu primera factura!'
    );
    return;
  }

  const statusEmoji: Record<string, string> = {
    processing: '⏳',
    completed: '✅',
    needs_review: '⚠️',
    failed: '❌',
  };

  let statusText = '📋 <b>Últimas facturas:</b>\n\n';
  for (const doc of recentDocs) {
    const emoji = statusEmoji[doc.processing_status] || '❓';
    const invoiceNum = doc.invoice?.invoice_number || 'Procesando...';
    const amount = doc.invoice ? `€${doc.invoice.total_amount.toFixed(2)}` : '-';
    statusText += `${emoji} <b>${doc.original_filename}</b>\n`;
    statusText += `   ${doc.processing_status} | #${invoiceNum} | ${amount}\n\n`;
  }

  await sendMessage(botToken, chatId, statusText);
}

async function handleFileUpload(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  message: any
) {
  const link = await prisma.telegramLink.findFirst({
    where: { telegram_id: telegramUserId },
  });

  if (!link) {
    await sendMessage(botToken, chatId,
      '⚠️ Primero vincula tu cuenta.\n\nGenera un código en TotalFactu → Configuración y envía:\n<code>/start TF-XXXXXX</code>'
    );
    return;
  }

  let fileId: string;
  let fileName: string;
  let mimeType: string;

  if (message.document) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || `document_${Date.now()}`;
    mimeType = message.document.mime_type || getMimeType(fileName);

    if (message.document.file_size && message.document.file_size > 20 * 1024 * 1024) {
      await sendMessage(botToken, chatId,
        '❌ El archivo es demasiado grande. El tamaño máximo por Telegram es 20MB.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
  } else if (message.photo) {
    const photo = message.photo[message.photo.length - 1];
    fileId = photo.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    mimeType = 'image/jpeg';
  } else {
    return;
  }

  if (!isSupportedFile(mimeType)) {
    await sendMessage(botToken, chatId,
      '❌ Tipo de archivo no soportado. Envía un <b>PDF</b>, <b>JPG</b> o <b>PNG</b>.',
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const statusMsg = await sendMessage(botToken, chatId,
    '📨 <b>¡Factura recibida!</b>\n⏳ Descargando y procesando...',
    { reply_to_message_id: message.message_id }
  );

  try {
    const fileInfo = await getFile(botToken, fileId);
    if (!fileInfo?.file_path) throw new Error('No se pudo obtener la ruta del archivo');

    const fileBuffer = await downloadFile(botToken, fileInfo.file_path);
    if (!fileBuffer) throw new Error('No se pudo descargar el archivo');

    const s3Client = createS3Client();
    const { bucketName, folderPrefix } = getBucketConfig();
    const timestamp = Date.now();
    const cloudStoragePath = `${folderPrefix}uploads/telegram/${link.company_id}/${timestamp}-${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: cloudStoragePath,
        Body: fileBuffer,
        ContentType: mimeType,
      })
    );

    const document = await prisma.document.create({
      data: {
        company_id: link.company_id,
        user_id: link.user_id,
        source_channel: 'telegram',
        original_filename: fileName,
        mime_type: mimeType,
        processing_status: 'processing',
        cloud_storage_path: cloudStoragePath,
        is_public: false,
        telegram_chat_id: chatId,
        telegram_message_id: statusMsg?.message_id ?? null,
      },
    });

    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id,
        '📨 <b>¡Factura recibida!</b>\n🤖 La IA está extrayendo los datos...'
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const processResponse = await fetch(`${baseUrl}/api/documents/${document.id}/process`, {
      method: 'POST',
    });

    if (processResponse.ok) {
      const result = await processResponse.json();
      const doc = result.document;
      const invoice = result.invoice;

      if (doc?.processing_status === 'completed') {
        let completedText = '✅ <b>¡Factura procesada correctamente!</b>\n\n';
        if (invoice) {
          completedText += `📄 Factura #${invoice.invoice_number}\n`;
          completedText += `🏢 ${invoice.supplier_name}\n`;
          completedText += `💰 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
          completedText += `📅 ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('es-ES') : 'N/A'}\n`;
          completedText += `\n🎯 Confianza: ${((doc.confidence_score || 0) * 100).toFixed(0)}%`;
        }
        if (statusMsg) {
          await editMessage(botToken, chatId, statusMsg.message_id, completedText);
        } else {
          await sendMessage(botToken, chatId, completedText);
        }
      } else if (doc?.processing_status === 'needs_review') {
        const reviewText = '⚠️ <b>Factura procesada — requiere revisión</b>\n\n' +
          'Algunos campos no se extrajeron con suficiente confianza.\n' +
          'Revísalos en el panel de TotalFactu.';
        if (statusMsg) {
          await editMessage(botToken, chatId, statusMsg.message_id, reviewText);
        } else {
          await sendMessage(botToken, chatId, reviewText);
        }
      }
    } else {
      const failText = '❌ <b>Error al procesar</b>\n\n' +
        'No se pudo extraer datos de este archivo. Inténtalo de nuevo o sube la factura desde el panel web.';
      if (statusMsg) {
        await editMessage(botToken, chatId, statusMsg.message_id, failText);
      } else {
        await sendMessage(botToken, chatId, failText);
      }
    }
  } catch (error: any) {
    console.error('Telegram file processing error:', error);
    const errorText = '❌ <b>Error procesando la factura</b>\n\n' +
      `${error?.message || 'Error inesperado'}\n\n` +
      'Inténtalo de nuevo o sube la factura desde el panel web.';
    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id, errorText);
    } else {
      await sendMessage(botToken, chatId, errorText);
    }
  }
}
