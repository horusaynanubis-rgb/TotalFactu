// Telegram Bot API Utility
// Provides functions for interacting with the Telegram Bot API

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  document?: TelegramDocument;
  photo?: TelegramPhoto[];
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

// Send a text message to a chat
export async function sendMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  options?: { parse_mode?: string; reply_to_message_id?: number }
): Promise<TelegramMessage | null> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parse_mode || 'HTML',
        reply_to_message_id: options?.reply_to_message_id,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram sendMessage error:', data.description);
      return null;
    }
    return data.result;
  } catch (error) {
    console.error('Telegram sendMessage failed:', error);
    return null;
  }
}

// Edit an existing message
export async function editMessage(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const data = await response.json();
    return data.ok === true;
  } catch (error) {
    console.error('Telegram editMessage failed:', error);
    return false;
  }
}

// Get file info from Telegram
export async function getFile(
  botToken: string,
  fileId: string
): Promise<TelegramFile | null> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram getFile error:', data.description);
      return null;
    }
    return data.result;
  } catch (error) {
    console.error('Telegram getFile failed:', error);
    return null;
  }
}

// Download file from Telegram servers
export async function downloadFile(
  botToken: string,
  filePath: string
): Promise<Buffer | null> {
  try {
    const url = `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Telegram downloadFile error:', response.statusText);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Telegram downloadFile failed:', error);
    return null;
  }
}

// Set webhook URL for the bot
export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<{ ok: boolean; description?: string }> {
  try {
    const body: any = {
      url: webhookUrl,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    };
    if (secretToken) {
      body.secret_token = secretToken;
    }
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch (error: any) {
    return { ok: false, description: error?.message || 'Network error' };
  }
}

// Delete webhook
export async function deleteWebhook(
  botToken: string
): Promise<{ ok: boolean; description?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: true }),
    });
    return await response.json();
  } catch (error: any) {
    return { ok: false, description: error?.message || 'Network error' };
  }
}

// Get bot info (for testing connection)
export async function getMe(
  botToken: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`);
    return await response.json();
  } catch (error: any) {
    return { ok: false, description: error?.message || 'Network error' };
  }
}

// Get webhook info
export async function getWebhookInfo(
  botToken: string
): Promise<{ ok: boolean; result?: any; description?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/getWebhookInfo`);
    return await response.json();
  } catch (error: any) {
    return { ok: false, description: error?.message || 'Network error' };
  }
}

// Determine mime type from file extension
export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

// Check if a file is a supported invoice format
export function isSupportedFile(mimeType: string): boolean {
  const supported = ['application/pdf', 'image/jpeg', 'image/png'];
  return supported.includes(mimeType);
}
