import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) return false;
  return request.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized. Set DEBUG_SECRET in env and pass ?secret=XXX' }, { status: 401 });
  }

  const result: Record<string, any> = {};

  // 1. Env sanity
  result.supabase_url_present = !!process.env.SUPABASE_URL;
  result.supabase_service_key_present = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  result.supabase_bucket = process.env.SUPABASE_STORAGE_BUCKET || 'invoices';
  result.nextauth_url = process.env.NEXTAUTH_URL ?? null;
  result.vercel_url = process.env.VERCEL_URL ?? null;

  // 2. Latest document from DB
  try {
    const doc = await prisma.document.findFirst({
      orderBy: { upload_timestamp: 'desc' },
      select: {
        id: true,
        company_id: true,
        mime_type: true,
        original_filename: true,
        cloud_storage_path: true,
        processing_status: true,
        source_channel: true,
        upload_timestamp: true,
        is_public: true,
      },
    });

    if (!doc) {
      return NextResponse.json({ ...result, ok: false, error: 'No documents in database' });
    }

    result.document = doc;

    // 3. Try to get a signed URL for it
    let signedUrl: string | null = null;
    try {
      signedUrl = await getFileUrl(doc.cloud_storage_path, doc.is_public);
      result.signed_url_ok = true;
      result.signed_url_length = signedUrl.length;
    } catch (err: any) {
      result.signed_url_ok = false;
      result.signed_url_error = err?.message ?? 'unknown';
      return NextResponse.json({ ...result, ok: false });
    }

    // 4. Try to download the file
    try {
      const fileResponse = await fetch(signedUrl);
      result.file_http_status = fileResponse.status;
      result.file_content_type = fileResponse.headers.get('content-type');
      if (fileResponse.ok) {
        const buf = await fileResponse.arrayBuffer();
        result.file_size_bytes = buf.byteLength;
        result.file_download_ok = true;
        result.ok = true;
      } else {
        result.file_download_ok = false;
        result.ok = false;
        result.file_error = `HTTP ${fileResponse.status}`;
      }
    } catch (err: any) {
      result.file_download_ok = false;
      result.ok = false;
      result.file_error = err?.message ?? 'unknown';
    }
  } catch (err: any) {
    result.ok = false;
    result.db_error = err?.message ?? 'unknown';
  }

  return NextResponse.json(result);
}
