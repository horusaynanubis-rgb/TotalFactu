import crypto from 'crypto';

export interface BatchPayload {
  cid: string;          // clientCompanyId
  from: string;         // ISO date string (YYYY-MM-DD)
  to: string;           // ISO date string (YYYY-MM-DD)
  type: string;         // all | received | issued
  status: string;       // processed | approved_only
  batchIndex: number;
  offset: number;
  count: number;
  exp: number;          // Unix timestamp (seconds)
}

const BATCH_TTL_SECONDS = 3600; // 1 hour

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set');
  return s;
}

export function createBatchToken(
  cid: string,
  from: string,
  to: string,
  type: string,
  status: string,
  batchIndex: number,
  offset: number,
  count: number,
): string {
  const payload: BatchPayload = {
    cid, from, to, type, status, batchIndex, offset, count,
    exp: Math.floor(Date.now() / 1000) + BATCH_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(data).digest('hex');
  return `${data}.${sig}`;
}

export function verifyBatchToken(token: string): BatchPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret()).update(data).digest('hex');
  if (sig !== expected) return null;
  try {
    const payload: BatchPayload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
