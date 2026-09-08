import { NextRequest, NextResponse } from 'next/server';
import { processDocument } from '@/lib/document-processing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Thin wrapper — all actual logic lives in lib/document-processing.ts
// (2026-09-08 async worker MVP), shared unchanged with
// app/api/jobs/process-queue/route.ts. This route's behavior, timeouts, and
// response shape are byte-for-byte the same as before the refactor:
// notifyTelegramOnSuccess stays false (the webhook still builds its own
// success message), no geminiTimeouts override (module defaults apply).
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const documentId = params.id;
  const hint = new URL(request.url).searchParams.get('hint') ?? undefined;

  const result = await processDocument(documentId, { hint });
  return NextResponse.json(result.body, { status: result.status });
}
