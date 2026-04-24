import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, companyName, taxId, activationToken, plan } = body;

    if (!name || !email || !password || !companyName || !taxId) {
      return NextResponse.json({ message: 'All fields are required' }, { status: 400 });
    }

    const VALID_PLANS = ['demo', 'profesional', 'gestoria'];
    const planName = VALID_PLANS.includes(plan) ? plan : 'demo';

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ message: 'User with this email already exists' }, { status: 400 });
    }

    // Validate activation token if provided
    let invitation: { id: string; email: string; license_id: string; expires_at: Date; status: string; license: any } | null = null;
    if (activationToken) {
      invitation = await prisma.licenseInvitation.findUnique({
        where: { token: activationToken },
        include: { license: { include: { pack: true } } },
      });

      if (!invitation || invitation.status !== 'pending' || invitation.expires_at < new Date()) {
        return NextResponse.json({ message: 'Invalid or expired activation link' }, { status: 400 });
      }

      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json({ message: 'Email does not match the invitation' }, { status: 400 });
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { name, email, password_hash } });

      const company = await tx.company.create({
        data: {
          name: companyName,
          tax_id: taxId,
          export_email: email,
        },
      });

      await tx.membership.create({
        data: { user_id: user.id, company_id: company.id, role: 'admin' },
      });

      await tx.subscription.create({
        data: {
          company_id: company.id,
          plan_name: planName,
          status: planName === 'demo' ? 'active' : 'inactive',
        },
      });

      // Link the gestoria license to this new company
      if (invitation) {
        await tx.license.update({
          where: { id: invitation.license_id },
          data: { client_company_id: company.id, assigned_at: new Date() },
        });

        await tx.licenseInvitation.update({
          where: { id: invitation.id },
          data: { status: 'accepted', accepted_at: new Date() },
        });
      }

      return { user, company };
    });

    return NextResponse.json(
      { message: 'Account created successfully', user: { id: result?.user?.id, email: result?.user?.email, name: result?.user?.name } },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
