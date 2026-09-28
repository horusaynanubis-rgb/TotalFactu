import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, companyName, taxId, activationToken, gestoriaInvitationToken, plan } = body;

    if (!name || !email || !password || !companyName || !taxId) {
      return NextResponse.json({ message: 'All fields are required' }, { status: 400 });
    }

    const VALID_PLANS = ['demo', 'profesional', 'gestoria'];
    const planName = VALID_PLANS.includes(plan) ? plan : 'demo';

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ message: 'User with this email already exists' }, { status: 400 });
    }

    // Validate activation token if provided — LEGACY pack/license model.
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

    // Validate gestoria company invitation token if provided — NEW MODEL,
    // creates a GestoriaClientRelation instead of touching License. See
    // lib/gestoria-eligibility.ts. Independent of activationToken above —
    // a signup only ever carries one or the other in practice.
    let gestoriaInvitation: { id: string; target_email: string; expires_at: Date; status: string; gestoria_company_id: string } | null = null;
    if (gestoriaInvitationToken) {
      gestoriaInvitation = await prisma.gestoriaCompanyInvitation.findUnique({
        where: { token: gestoriaInvitationToken },
      });

      if (!gestoriaInvitation || gestoriaInvitation.status !== 'pending' || gestoriaInvitation.expires_at < new Date()) {
        return NextResponse.json({ message: 'Invalid or expired activation link' }, { status: 400 });
      }

      if (gestoriaInvitation.target_email.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json({ message: 'Email does not match the invitation' }, { status: 400 });
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({ data: { name, email, password_hash } });

      // plan='gestoria' must create a real company_type='gestoria' account —
      // without this, signing up with that plan silently left company_type
      // at its 'individual' default and the user would never actually reach
      // /dashboard/gestoria despite Subscription.plan_name saying 'gestoria'.
      // Pre-existing gap, fixed here as part of wiring the new free-with-5-
      // companies landing CTA to this same signup flow.
      //
      // Guarded against `invitation`/`gestoriaInvitation`: a signup that's
      // accepting an invitation to become someone's CLIENT must never also
      // self-declare as a gestoria, even if a caller passed plan='gestoria'
      // alongside a token — that would create the impossible state of a
      // company being simultaneously a gestoria and someone else's client.
      const isPlainGestoriaSignup = planName === 'gestoria' && !invitation && !gestoriaInvitation;
      const company = await tx.company.create({
        data: {
          name: companyName,
          tax_id: taxId,
          export_email: email,
          ...(isPlainGestoriaSignup ? { company_type: 'gestoria' } : {}),
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

      // Link the gestoria license to this new company — LEGACY model
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

      // NEW MODEL — a brand-new company can never already have an active
      // gestoria relation (it didn't exist a moment ago), so no exclusivity
      // check is needed here, unlike the existing-company accept endpoint.
      if (gestoriaInvitation) {
        await tx.gestoriaClientRelation.create({
          data: {
            gestoria_company_id: gestoriaInvitation.gestoria_company_id,
            client_company_id: company.id,
            status: 'active',
            source: 'invitation',
            accepted_at: new Date(),
          },
        });

        await tx.gestoriaCompanyInvitation.update({
          where: { id: gestoriaInvitation.id },
          data: { status: 'accepted', accepted_at: new Date(), accepted_by_user_id: user.id },
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
