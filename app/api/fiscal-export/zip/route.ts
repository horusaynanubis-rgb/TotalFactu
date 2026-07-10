import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { verifyFiscalExportBatchToken } from '@/lib/batch-token';
import { zipSync } from 'fflate';
import { buildFiscalExportZipFiles, fiscalExportZipFilename } from '@/lib/fiscal-export-builder';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) {
    return Response.json({ error: 'No company found' }, { status: 400 });
  }

  const token = request.nextUrl.searchParams.get('token');
  if (!token) return Response.json({ error: 'Missing token' }, { status: 400 });

  const payload = verifyFiscalExportBatchToken(token);
  if (!payload) return Response.json({ error: 'Invalid or expired token' }, { status: 403 });
  // Token must have been minted for this same active company — prevents a
  // multi-company user from reusing a token generated under a different company.
  if (payload.cid !== companyId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { files } = await buildFiscalExportZipFiles(companyId, payload);

  if (Object.keys(files).length === 0) {
    return Response.json({ error: 'Nothing to export for this batch' }, { status: 500 });
  }

  const zipBuffer = zipSync(files);
  const zipFilename = fiscalExportZipFilename(payload.year, payload.quarter, payload.batchIndex);

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'Content-Length': String(zipBuffer.byteLength),
    },
  });
}
