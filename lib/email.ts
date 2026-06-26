/**
 * Email utility using Resend.
 * Requires RESEND_API_KEY env var. If not set, logs and returns false silently.
 * Add RESEND_API_KEY to .env to enable real email delivery.
 */

let resendClient: any = null;

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'TotalFactu <noreply@totalfactu.com>';
const BASE_URL = process.env.NEXTAUTH_URL ?? 'https://totalfactu.com';

export async function sendCorrectionNotificationEmail({
  toEmail,
  subject,
  body,
  ctaUrl,
  ctaLabel,
}: {
  toEmail: string;
  subject: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.log('[email] RESEND_API_KEY not configured — email skipped');
    return false;
  }
  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `[TotalFactu] ${subject}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin-bottom:8px">📋 ${subject}</h2>
          <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin:16px 0">
            <p style="margin:0;white-space:pre-wrap">${body}</p>
          </div>
          <p style="margin-top:24px">
            <a href="${ctaUrl}"
               style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
              ${ctaLabel}
            </a>
          </p>
          <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:12px;margin-top:12px">
            Notificación automática de TotalFactu.
          </p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendCorrectionNotificationEmail failed:', err);
    return false;
  }
}

export async function sendGestoriaMessageEmail({
  toEmail,
  gestoriaName,
  subject,
  body,
}: {
  toEmail: string;
  gestoriaName: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.log('[email] RESEND_API_KEY not configured — email skipped');
    return false;
  }

  const dashboardUrl = `${BASE_URL}/dashboard/messages`;

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: toEmail,
      subject: `[TotalFactu] Nuevo mensaje de tu gestoría`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin-bottom:8px">📩 Nuevo mensaje de tu gestoría</h2>
          <p style="color:#555">Has recibido un mensaje de <strong>${gestoriaName}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr>
              <td style="padding:8px 0;color:#888;width:100px">Motivo</td>
              <td style="padding:8px 0;font-weight:600">${subject}</td>
            </tr>
          </table>
          <div style="background:#f4f4f5;border-radius:8px;padding:16px;margin:16px 0">
            <p style="margin:0;white-space:pre-wrap">${body}</p>
          </div>
          <p style="margin-top:24px">
            <a href="${dashboardUrl}"
               style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
              Ver mensajes en TotalFactu
            </a>
          </p>
          <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:12px;margin-top:12px">
            Este mensaje fue enviado desde TotalFactu. Si no esperabas este correo, ignóralo.
          </p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendGestoriaMessageEmail failed:', err);
    return false;
  }
}
