import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getGestoriaEligibility } from '@/lib/gestoria-eligibility';
import { isAuthorizedCron } from '@/lib/process-queue-helpers';

export const dynamic = 'force-dynamic';

// Daily safety net for the grace-period state machine (plan section 9/21).
//
// Important nuance: computeGestoriaState() always derives LIMITED vs GRACE
// live from `now` vs the stored grace_ends_at — so a firm's *displayed*
// state is never stale, even if this cron never ran, the moment anyone
// (the firm's own admin, support, or a future admin-overview page) reads
// it. This job is NOT fixing a staleness bug; it exists for two things that
// DO need a periodic sweep rather than an on-demand read:
//   1. Insurance — a defensive backstop in case some future call site reads
//      eligibility without going through getGestoriaEligibility().
//   2. Foundation for likely-next features that react to a transition
//      proactively without anyone loading a page first — e.g. an email
//      when a firm enters GRACE/LIMITED (not built yet), or a bulk
//      admin-overview reading a pre-computed snapshot instead of N+1
//      calling getGestoriaEligibility() per firm.
// Wired into vercel.json (daily, off-peak from the process-queue crons).
//
// Reuses the same shared-secret cron pattern as
// app/api/jobs/process-queue/route.ts (CRON_SECRET via
// isAuthorizedCron) — no new secret introduced.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firms = await prisma.company.findMany({
    where: { company_type: 'gestoria' },
    select: { id: true },
  });

  let processed = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  for (const firm of firms) {
    try {
      await getGestoriaEligibility(firm.id);
      processed += 1;
    } catch (err: any) {
      errors += 1;
      errorDetails.push(`${firm.id}: ${err?.message ?? 'unknown error'}`);
      console.error(`[sync-gestoria-eligibility] firm ${firm.id} failed:`, err);
    }
  }

  return NextResponse.json({ total: firms.length, processed, errors, errorDetails });
}
