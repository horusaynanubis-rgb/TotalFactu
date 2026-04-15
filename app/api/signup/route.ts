import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, companyName, taxId } = body;

    // Validate required fields
    if (!name || !email || !password || !companyName || !taxId) {
      return NextResponse.json(
        { message: 'All fields are required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user, company, membership, and subscription in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create user
      const user = await tx.user.create({
        data: {
          name,
          email,
          password_hash,
        },
      });

      // Create company
      const company = await tx.company.create({
        data: {
          name: companyName,
          tax_id: taxId,
          export_email: email, // Use user email as default export email
        },
      });

      // Create membership
      await tx.membership.create({
        data: {
          user_id: user.id,
          company_id: company.id,
          role: 'admin',
        },
      });

      // Create subscription
      await tx.subscription.create({
        data: {
          company_id: company.id,
          plan_name: 'starter',
          status: 'active',
        },
      });

      return { user, company };
    });

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user: { id: result?.user?.id, email: result?.user?.email, name: result?.user?.name },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
