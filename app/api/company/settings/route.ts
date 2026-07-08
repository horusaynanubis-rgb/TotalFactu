import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await resolveActiveCompanyId(session);
    if (!companyId) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    return NextResponse.json({ company });
  } catch (error: any) {
    console.error('Get settings error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await resolveActiveCompanyId(session);
    if (!companyId) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const body = await request.json();

    // Whitelist allowed fields to prevent overwriting sensitive data
    const allowedFields: Record<string, any> = {};
    const safeFields = [
      'name', 'tax_id', 'address', 'export_email',
      'email_forwarding_address',
      'ai_provider', 'ai_api_key', 'ai_api_endpoint',
    ];
    for (const key of safeFields) {
      if (key in body) {
        allowedFields[key] = body[key];
      }
    }

    const company = await prisma.company.update({
      where: { id: companyId },
      data: allowedFields,
    });

    return NextResponse.json({ company });
  } catch (error: any) {
    console.error('Update settings error:', error);
    return NextResponse.json(
      { message: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
