import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { prisma } from '@/lib/prisma';
import { findStuckDocuments, markStuckDocumentsFailed, DEFAULT_STUCK_TIMEOUT_MINUTES } from '@/lib/stuck-documents';

export const dynamic = 'force-dynamic';

// GET /api/admin/diagnostics/stuck-documents?timeoutMinutes=15
// Read-only. Lists documents stuck in processing_status='processing' with no
// resulting Invoice/DeliveryNote/DailyCashRegister, untouched for longer
// than timeoutMinutes. Admin-only — see lib/admin/auth.ts.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const timeoutMinutes = Number(request.nextUrl.searchParams.get('timeoutMinutes') ?? DEFAULT_STUCK_TIMEOUT_MINUTES);
  const companyId = request.nextUrl.searchParams.get('companyId') ?? undefined;

  const stuck = await findStuckDocuments(prisma, { companyId, timeoutMinutes });
  return NextResponse.json({ timeoutMinutes, count: stuck.length, documents: stuck });
}

// POST /api/admin/diagnostics/stuck-documents
// Body: { documentIds: string[], confirm: boolean }
// Mutating, gated. Never called automatically — this is the explicit,
// human-triggered action from the admin diagnostics panel. Transitions
// 'processing' -> 'failed' (never deletes, never reprocesses) so the
// existing retry button in /dashboard/documents becomes available.
// confirm=false (or omitted) returns a dry-run report and writes nothing.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const documentIds: string[] = Array.isArray(body.documentIds) ? body.documentIds : [];
  const confirm = body.confirm === true;

  if (documentIds.length === 0) {
    return NextResponse.json({ error: 'documentIds (non-empty array) is required' }, { status: 400 });
  }

  const results = await markStuckDocumentsFailed(prisma, documentIds, { confirm });
  console.log(`[stuck-documents] admin=${admin.email} confirm=${confirm} requested=${documentIds.length} marked=${results.filter((r) => r.marked).length}`);

  return NextResponse.json({ confirm, results });
}
