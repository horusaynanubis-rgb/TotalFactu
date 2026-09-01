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

// Internal-only recipient for billing incidents (plan section 10 — no
// customer-facing email yet, just an internal heads-up). Overridable via env
// for staging without touching code.
const BILLING_ALERT_EMAIL = process.env.BILLING_ALERT_EMAIL ?? 'info@horusayn.com';

/**
 * Internal notification for a billing incident (failed payment, past_due,
 * unpaid). Dedup against repeat sends is the caller's responsibility — see
 * PaymentAlertLog in app/api/webhooks/stripe/route.ts — this function always
 * sends when called.
 */
export async function sendPaymentAlertEmail({
  companyName,
  taxId,
  plan,
  amountCents,
  currency,
  expectedDate,
  stripeStatus,
  lastAttempt,
  stripeCustomerId,
  alertType,
}: {
  companyName: string;
  taxId: string;
  plan: string;
  amountCents: number | null;
  currency: string;
  expectedDate: Date | null;
  stripeStatus: string;
  lastAttempt: Date | null;
  stripeCustomerId: string | null;
  alertType: string;
}): Promise<boolean> {
  const amountLabel = typeof amountCents === 'number'
    ? new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amountCents / 100)
    : '—';
  const dateLabel = expectedDate ? expectedDate.toLocaleDateString('es-ES') : '—';
  const lastAttemptLabel = lastAttempt ? lastAttempt.toLocaleString('es-ES') : '—';
  const subject = `Pago pendiente — ${companyName}`;

  const resend = getResend();
  if (!resend) {
    console.log(`[email] RESEND_API_KEY not configured — payment alert skipped (would send to ${BILLING_ALERT_EMAIL}): ${subject}`);
    return false;
  }

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: BILLING_ALERT_EMAIL,
      subject: `[TotalFactu] ${subject}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="margin-bottom:8px">⚠️ ${subject}</h2>
          <p style="color:#555">Tipo de incidencia: <strong>${alertType}</strong></p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 0;color:#888;width:160px">Empresa</td><td style="padding:6px 0;font-weight:600">${companyName}</td></tr>
            <tr><td style="padding:6px 0;color:#888">CIF</td><td style="padding:6px 0">${taxId}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Plan</td><td style="padding:6px 0">${plan}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Importe</td><td style="padding:6px 0">${amountLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Fecha prevista</td><td style="padding:6px 0">${dateLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Estado Stripe</td><td style="padding:6px 0">${stripeStatus}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Último intento</td><td style="padding:6px 0">${lastAttemptLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888">Stripe customer ID</td><td style="padding:6px 0;font-family:monospace">${stripeCustomerId ?? '—'}</td></tr>
          </table>
          <p style="margin-top:24px">
            <a href="${BASE_URL}/dashboard/admin" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
              Ver en Admin Control
            </a>
          </p>
          <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:12px;margin-top:12px">
            Aviso interno automático de TotalFactu. No se ha enviado ningún email al cliente.
          </p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[email] sendPaymentAlertEmail failed:', err);
    return false;
  }
}

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
