import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { uploadFile, buildTelegramPath } from '@/lib/storage';
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
  console.log('🔥 TELEGRAM UPDATE RECEIVED');

  try {
    // Log all incoming headers for debugging
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => { headersObj[key] = value; });
    console.log('[Telegram webhook] Headers:', JSON.stringify(headersObj));

    // Secret validation — WARN only, never block (ensures Telegram reaches the handler)
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');

    if (webhookSecret) {
      if (!incomingSecret) {
        console.warn('[Telegram webhook] ⚠️ TELEGRAM_WEBHOOK_SECRET is set but Telegram did NOT send X-Telegram-Bot-Api-Secret-Token. Webhook may have been registered without secret_token — re-register via /api/telegram/set-webhook with {force:true}. Processing update anyway.');
      } else if (incomingSecret !== webhookSecret) {
        console.warn('[Telegram webhook] ⚠️ Secret token MISMATCH — incoming does not match TELEGRAM_WEBHOOK_SECRET. Re-register webhook to sync. Processing update anyway.');
      } else {
        console.log('[Telegram webhook] ✅ Secret token valid');
      }
    } else {
      console.log('[Telegram webhook] ℹ️ No TELEGRAM_WEBHOOK_SECRET configured (open endpoint)');
    }

    // Read and log raw body
    const body = await request.text();
    console.log('[Telegram webhook] Raw body:', body);

    // Parse update
    let update: TelegramUpdate;
    try {
      update = JSON.parse(body) as TelegramUpdate;
    } catch (parseErr) {
      console.error('[Telegram webhook] ❌ Failed to parse JSON body:', parseErr);
      return NextResponse.json({ ok: true });
    }

    console.log('[Telegram webhook] Parsed update:', JSON.stringify(update, null, 2));

    const message = update.message;
    console.log('[Telegram webhook] Message text:', message?.text ?? null);
    console.log('[Telegram webhook] Chat ID:', message?.chat?.id ?? null);

    if (!message) {
      console.log('[Telegram webhook] No message in update — ignoring');
      return NextResponse.json({ ok: true });
    }

    const botToken = getBotToken();
    const chatId = String(message.chat.id);
    const telegramUserId = String(message.from?.id ?? message.chat.id);

    if (message.text?.startsWith('/start')) {
      await handleStartCommand(botToken, chatId, telegramUserId, message);
      return NextResponse.json({ ok: true });
    }

    if (message.text?.startsWith('/status')) {
      await handleStatusCommand(botToken, chatId, telegramUserId);
      return NextResponse.json({ ok: true });
    }

    if (message.text?.startsWith('/help')) {
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
      await handleFileUpload(botToken, chatId, telegramUserId, message);
      return NextResponse.json({ ok: true });
    }

    // Unknown text
    const link = await prisma.telegramLink.findFirst({
    where: { telegram_id: telegramUserId },
    orderBy: { created_at: 'desc' },
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
    console.error('[Telegram webhook] ❌ Unhandled error:', error);
    // Always return 200 so Telegram doesn't retry indefinitely
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
      orderBy: { created_at: 'desc' },
      include: { user: true, company: true },
    });
    if (existing) {
      console.log(`[Telegram /start] Already linked — user=${existing.user_id} company=${existing.company_id}`);
      await sendMessage(botToken, chatId,
        `✅ Tu cuenta ya está vinculada.\n\n` +
        `👤 <b>${existing.user.name}</b> → <b>${existing.company.name}</b>\n\n` +
        '📎 Envía una factura para procesarla.'
      );
    } else {
      console.log('[Telegram /start] No code provided and not linked — showing welcome');
      await sendMessage(botToken, chatId,
        '👋 Bienvenido a <b>TotalFactu</b>.\n\n' +
        'Para vincular tu cuenta, genera un código desde Configuración y envía:\n\n' +
        '<code>/start TF-XXXXXX</code>'
      );
    }
    return;
  }

  const normalizedCode = code.toUpperCase();
  console.log(`[Telegram /start] Looking up code in DB: "${normalizedCode}"`);

  const linkCode = await prisma.telegramLinkCode.findUnique({
    where: { code: normalizedCode },
    include: { user: true, company: true },
  });

  if (!linkCode) {
    console.warn(`[Telegram /start] ❌ Code not found in DB: "${normalizedCode}"`);
    await sendMessage(botToken, chatId,
      '❌ Código no válido. Genera uno nuevo desde Configuración en TotalFactu.'
    );
    return;
  }

  console.log(`[Telegram /start] Code found: id=${linkCode.id} user=${linkCode.user_id} company=${linkCode.company_id} used_at=${linkCode.used_at} expires_at=${linkCode.expires_at}`);

  if (linkCode.used_at) {
    console.warn(`[Telegram /start] ❌ Code already used at ${linkCode.used_at}`);
    await sendMessage(botToken, chatId,
      '❌ Este código ya ha sido usado. Genera uno nuevo desde Configuración.'
    );
    return;
  }

  if (linkCode.expires_at < new Date()) {
    console.warn(`[Telegram /start] ❌ Code expired at ${linkCode.expires_at}`);
    await sendMessage(botToken, chatId,
      '❌ Este código ha caducado. Genera uno nuevo desde Configuración.'
    );
    return;
  }

  console.log(`[Telegram /start] Creating/updating TelegramLink telegram_id=${telegramUserId} company_id=${linkCode.company_id}`);

  // Delete any stale links for this telegram_id that point to OTHER companies.
  // One Telegram account = one active company at a time.
  const deleted = await prisma.telegramLink.deleteMany({
    where: {
      telegram_id: telegramUserId,
      NOT: { company_id: linkCode.company_id },
    },
  });
  if (deleted.count > 0) {
    console.log(`[Telegram /start] Removed ${deleted.count} stale TelegramLink(s) for telegram_id=${telegramUserId}`);
  }

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

  await prisma.telegramLinkCode.update({
    where: { id: linkCode.id },
    data: { used_at: new Date() },
  });

  console.log(`[Telegram /start] ✅ TelegramLink saved. Sending confirmation to chat_id=${chatId}`);

  const payload = {
    chat_id: chatId,
    text:
      `✅ <b>¡Cuenta vinculada correctamente!</b>\n\n` +
      `👤 ${linkCode.user.name}\n` +
      `🏢 ${linkCode.company.name}\n\n` +
      '📎 Ya puedes enviar facturas (fotos, PDFs, imágenes) y las procesaré automáticamente.',
    parse_mode: 'HTML',
  };
  console.log('[Telegram /start] sendMessage payload:', JSON.stringify(payload));

  const sendResult = await sendMessage(botToken, chatId, payload.text);

  if (!sendResult) {
    console.error(`[Telegram /start] ❌ sendMessage returned null — check TELEGRAM_BOT_TOKEN validity and bot chat permissions`);
  } else {
    console.log(`[Telegram /start] ✅ Confirmation message sent. message_id=${sendResult.message_id}`);
  }
}

async function handleStatusCommand(
  botToken: string,
  chatId: string,
  telegramUserId: string
) {
  const link = await prisma.telegramLink.findFirst({
    where: { telegram_id: telegramUserId },
    orderBy: { created_at: 'desc' },
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

// Detect the real MIME type from the first bytes of a buffer (magic bytes).
// Telegram sometimes delivers photos as WebP/HEIC despite the API saying "photo".
function detectMimeType(buf: Buffer): string {
  if (buf.length < 4) return 'application/octet-stream';
  const b = buf;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  // PDF: 25 50 44 46 (%PDF)
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  // WebP: RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      buf.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

async function handleFileUpload(
  botToken: string,
  chatId: string,
  telegramUserId: string,
  message: any
) {
  const link = await prisma.telegramLink.findFirst({
    where: { telegram_id: telegramUserId },
    orderBy: { created_at: 'desc' },
  });

  if (!link) {
    await sendMessage(botToken, chatId,
      '⚠️ Primero vincula tu cuenta.\n\nGenera un código en TotalFactu → Configuración y envía:\n<code>/start TF-XXXXXX</code>'
    );
    return;
  }

  console.log(`[Telegram upload] TelegramLink found: user_id=${link.user_id} company_id=${link.company_id} chat_id=${chatId}`);

  let fileId: string;
  let fileName: string;
  // originalFileName keeps the user-visible name (with accents/spaces) for DB storage.
  // fileName may have its extension normalised after MIME detection.
  // buildTelegramPath() will sanitize the name for the storage key automatically.
  let originalFileName: string;
  // This is the declared MIME — will be verified against actual bytes after download
  let declaredMime: string;
  let isPhotoMessage = false;

  if (message.document) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || `document_${Date.now()}`;
    originalFileName = fileName;
    declaredMime = message.document.mime_type || getMimeType(fileName);

    if (message.document.file_size && message.document.file_size > 20 * 1024 * 1024) {
      await sendMessage(botToken, chatId,
        '❌ El archivo es demasiado grande. El tamaño máximo por Telegram es 20MB.',
        { reply_to_message_id: message.message_id }
      );
      return;
    }
    console.log(`[Telegram upload] Document: name=${fileName} declared_mime=${declaredMime} size=${message.document.file_size ?? 'unknown'}`);
  } else if (message.photo) {
    // Telegram always recompresses photos to JPEG — pick the largest available size
    const photo = message.photo[message.photo.length - 1];
    fileId = photo.file_id;
    fileName = `photo_${Date.now()}.jpg`;
    originalFileName = fileName;
    declaredMime = 'image/jpeg';
    isPhotoMessage = true;
    console.log(`[Telegram upload] Photo: ${message.photo.length} sizes, largest: ${photo.width}x${photo.height} file_size=${photo.file_size ?? 'unknown'}`);
  } else {
    return;
  }

  // Pre-check declared MIME before downloading (saves bandwidth on unsupported types)
  if (!isSupportedFile(declaredMime)) {
    await sendMessage(botToken, chatId,
      '❌ Tipo de archivo no soportado. Envía un <b>PDF</b>, <b>JPG</b> o <b>PNG</b>.',
      { reply_to_message_id: message.message_id }
    );
    return;
  }

  const statusMsg = await sendMessage(botToken, chatId,
    '📨 <b>Documento recibido</b>\n⏳ Descargando y procesando...',
    { reply_to_message_id: message.message_id }
  );

  let uploadPhase: 'telegram_download' | 'storage_upload' | 'db_insert' | 'ai_process' = 'telegram_download';
  let documentIdForLog: string | null = null;

  try {
    // --- Download from Telegram ---
    const fileInfo = await getFile(botToken, fileId);
    if (!fileInfo?.file_path) throw new Error('No se pudo obtener la ruta del archivo de Telegram');
    console.log(`[Telegram upload] file_path from Telegram: ${fileInfo.file_path}`);

    const fileBuffer = await downloadFile(botToken, fileInfo.file_path);
    if (!fileBuffer || fileBuffer.length === 0) throw new Error('El archivo descargado está vacío');
    console.log(`[Telegram upload] Downloaded buffer size: ${fileBuffer.length} bytes`);

    // --- Verify actual MIME type from magic bytes ---
    const actualMime = detectMimeType(fileBuffer);
    console.log(`[Telegram upload] MIME — declared=${declaredMime} actual=${actualMime}`);

    // If Telegram sent a WebP (some Android/iOS share sheets) but declared JPEG, use actual
    let mimeType = declaredMime;
    if (actualMime !== 'application/octet-stream' && actualMime !== declaredMime) {
      console.warn(`[Telegram upload] MIME mismatch! Using actual: ${actualMime}`);
      mimeType = actualMime;
      // Rename file extension to match actual content
      if (actualMime === 'image/png') fileName = fileName.replace(/\.\w+$/, '.png');
      else if (actualMime === 'application/pdf') fileName = fileName.replace(/\.\w+$/, '.pdf');
      else if (actualMime === 'image/webp') fileName = fileName.replace(/\.\w+$/, '.webp');
    }

    // WebP is not supported by Gemini invoice extraction — ask user to send as file/PDF
    if (mimeType === 'image/webp') {
      const webpMsg = '⚠️ <b>Formato no compatible</b>\n\n' +
        'Las fotos enviadas como imagen se convierten a WebP y no pueden procesarse.\n\n' +
        'Por favor, envía la foto como <b>archivo</b> (botón de clip → Archivo) para preservar la calidad.';
      if (statusMsg) {
        await editMessage(botToken, chatId, statusMsg.message_id, webpMsg);
      } else {
        await sendMessage(botToken, chatId, webpMsg);
      }
      return;
    }

    // Validate final MIME
    if (!isSupportedFile(mimeType)) {
      const unsupportedMsg = '❌ Formato no reconocido.\n\nEnvía un <b>PDF</b>, <b>JPG</b> o <b>PNG</b>. ' +
        (isPhotoMessage ? '\n\nPara mejores resultados, envía la foto como <b>archivo</b> (botón de clip → Archivo).' : '');
      if (statusMsg) {
        await editMessage(botToken, chatId, statusMsg.message_id, unsupportedMsg);
      } else {
        await sendMessage(botToken, chatId, unsupportedMsg);
      }
      return;
    }

    // --- Upload to Supabase Storage ---
    // buildTelegramPath() sanitizes the filename automatically (strips accents, spaces, etc.)
    // originalFileName is preserved as-is for the DB record (human-readable display).
    uploadPhase = 'storage_upload';
    const cloudStoragePath = buildTelegramPath(link.company_id, fileName);
    await uploadFile(fileBuffer, cloudStoragePath, mimeType);
    console.log(`[Telegram upload] Uploaded to Supabase: path=${cloudStoragePath} (original=${originalFileName})`);

    // --- Create Document record ---
    uploadPhase = 'db_insert';
    const document = await prisma.document.create({
      data: {
        company_id: link.company_id,
        user_id: link.user_id,
        source_channel: 'telegram',
        original_filename: originalFileName,
        mime_type: mimeType,
        processing_status: 'processing',
        cloud_storage_path: cloudStoragePath,
        is_public: false,
        telegram_chat_id: chatId,
        telegram_message_id: statusMsg?.message_id ?? null,
      },
    });
    documentIdForLog = document.id;

    console.log(`[Telegram upload] Document created: id=${document.id} company_id=${document.company_id} user_id=${document.user_id} mime=${mimeType} path=${cloudStoragePath}`);

    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id,
        '📨 <b>Documento recibido</b>\n🤖 La IA está analizando el contenido...'
      );
    }

    // --- Call process endpoint ---
    uploadPhase = 'ai_process';
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
    const baseUrl = process.env.NEXTAUTH_URL || vercelUrl || 'http://localhost:3000';
    const processUrl = `${baseUrl}/api/documents/${document.id}/process`;
    console.log(`[Telegram upload] Calling process: ${processUrl}`);

    const processResponse = await fetch(processUrl, { method: 'POST' });
    const processBody = await processResponse.text();
    console.log(`[Telegram upload] Process result: status=${processResponse.status} body=${processBody}`);

    if (processResponse.ok) {
      let result: any;
      try { result = JSON.parse(processBody); } catch { result = {}; }
      const doc = result.document;
      const invoice = result.invoice;
      const deliveryNote = result.delivery_note;

      let finalText = '';

      if (deliveryNote) {
        // Delivery note path
        finalText = '📦 <b>Albarán recibido y guardado</b>\n\n';
        finalText += `🏢 ${deliveryNote.supplier_name}\n`;
        finalText += `📋 Albarán #${deliveryNote.delivery_note_number}\n`;
        if (deliveryNote.issue_date) {
          finalText += `📅 ${new Date(deliveryNote.issue_date).toLocaleDateString('es-ES')}\n`;
        }
        if (deliveryNote.total_amount != null) {
          finalText += `💰 ${deliveryNote.currency ?? ''} ${deliveryNote.total_amount.toFixed(2)}\n`;
        }
        finalText += '\n<i>No se contabilizará como factura hasta que llegue la factura asociada.</i>';
        if (doc?.processing_status === 'needs_review') {
          finalText += '\n\n⚠️ Algunos campos requieren revisión en el panel web.';
        }
      } else if (doc?.processing_status === 'completed') {
        finalText = '✅ <b>¡Factura procesada correctamente!</b>\n\n';
        if (invoice) {
          finalText += `📄 Factura #${invoice.invoice_number}\n`;
          finalText += `🏢 ${invoice.supplier_name}\n`;
          finalText += `💰 ${invoice.currency} ${invoice.total_amount.toFixed(2)}\n`;
          finalText += `📅 ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('es-ES') : 'N/A'}\n`;
          finalText += `\n🎯 Confianza: ${((doc.confidence_score || 0) * 100).toFixed(0)}%`;
        }
      } else if (doc?.processing_status === 'needs_review') {
        finalText = '⚠️ <b>Factura procesada — requiere revisión</b>\n\n' +
          'Algunos campos no se extrajeron con suficiente confianza.\n' +
          'Revísalos en el panel de TotalFactu.';
      }

      if (finalText) {
        if (statusMsg) {
          await editMessage(botToken, chatId, statusMsg.message_id, finalText);
        } else {
          await sendMessage(botToken, chatId, finalText);
        }
      }
    } else {
      console.error(`[Telegram upload] ❌ Process failed. documentId=${document.id} status=${processResponse.status} body=${processBody}`);
      let failText = '❌ <b>Error extrayendo datos</b>\n\nNo se pudo procesar este archivo.';
      if (isPhotoMessage) {
        failText += '\n\n💡 <b>Consejo:</b> Para mejores resultados, envía la foto como <b>archivo</b> (botón de clip → Archivo) en lugar de como foto. Así se preserva la calidad original.';
      } else {
        failText += '\n\nInténtalo de nuevo o sube la factura desde el panel web.';
      }
      if (statusMsg) {
        await editMessage(botToken, chatId, statusMsg.message_id, failText);
      } else {
        await sendMessage(botToken, chatId, failText);
      }
    }
  } catch (error: any) {
    console.error(
      '[Telegram upload] ❌ FAILED',
      `phase=${uploadPhase}`,
      `documentId=${documentIdForLog ?? 'none'}`,
      `original_filename=${originalFileName!}`,
      `source=telegram`,
      `mime=${declaredMime!}`,
      `error=${error?.message}`,
      '\nStack:', error?.stack,
    );

    // User-friendly message — never expose raw technical errors
    let friendlyMsg: string;
    if (uploadPhase === 'telegram_download') {
      friendlyMsg = '❌ <b>No se pudo descargar el archivo</b>\n\nTelegram no pudo enviar el archivo correctamente. Inténtalo de nuevo.';
    } else if (uploadPhase === 'storage_upload') {
      friendlyMsg = '❌ <b>No se pudo subir el archivo</b>\n\nError al guardar el documento en el servidor. Inténtalo de nuevo o sube la factura desde el panel web.';
    } else {
      // ai_process or db_insert — process endpoint handles its own Telegram notification,
      // but if we ended up here it means the fetch itself failed (network/timeout)
      friendlyMsg = '❌ <b>Error procesando la factura</b>\n\nNo se pudo completar el análisis. Inténtalo de nuevo o sube la factura desde el panel web.';
      if (isPhotoMessage) {
        friendlyMsg += '\n\n💡 <b>Consejo:</b> Envía la foto como <b>archivo</b> (botón de clip → Archivo) para mejor calidad.';
      }
    }

    if (statusMsg) {
      await editMessage(botToken, chatId, statusMsg.message_id, friendlyMsg);
    } else {
      await sendMessage(botToken, chatId, friendlyMsg);
    }
  }
}
