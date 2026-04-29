import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { runStorageHealthCheck } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Allow internal calls via shared secret (CI, cron, admin scripts)
    const internalSecret = request.headers.get('x-internal-secret');
    const isInternal =
      internalSecret &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      internalSecret === process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!isInternal) {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
      }
    }

    const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
    const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'invoices';

    if (!hasSupabaseUrl || !hasServiceKey) {
      return NextResponse.json({
        ok: false,
        has_supabase_url: hasSupabaseUrl,
        has_service_role_key: hasServiceKey,
        bucket,
        error: 'Missing required environment variables',
      });
    }

    const health = await runStorageHealthCheck();

    return NextResponse.json({
      ok: health.ok,
      has_supabase_url: hasSupabaseUrl,
      has_service_role_key: hasServiceKey,
      bucket,
      storage_health: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[storage/test] error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Internal error' },
      { status: 500 }
    );
  }
}
