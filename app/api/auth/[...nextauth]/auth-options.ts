import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import * as bcrypt from 'bcryptjs';
import { ACTIVE_COMPANY_COOKIE } from '@/lib/active-company';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials: any) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Invalid credentials');
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user?.password_hash) {
          throw new Error('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password_hash
        );

        if (!isPasswordValid) {
          throw new Error('Invalid credentials');
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
      }
      // Refresh company_type / active company on every token refresh
      if (token.id) {
        // "Active company" preference (multi-company owner accounts —
        // Gestión de empresas). Only trusted if the user still has a real
        // Membership on that company; otherwise falls back to the default
        // (oldest membership), same as before this feature existed.
        let preferredCompanyId: string | undefined;
        try {
          preferredCompanyId = cookies().get(ACTIVE_COMPANY_COOKIE)?.value;
        } catch {
          // cookies() unavailable outside a request context — ignore.
        }

        let membership = preferredCompanyId
          ? await prisma.membership.findFirst({
              where: { user_id: token.id as string, company_id: preferredCompanyId },
              include: { company: { select: { id: true, company_type: true } } },
            })
          : null;

        if (!membership) {
          membership = await prisma.membership.findFirst({
            where: { user_id: token.id as string },
            orderBy: { created_at: 'asc' },
            include: { company: { select: { id: true, company_type: true } } },
          });
        }

        token.companyId = membership?.company.id ?? null;
        token.companyType = membership?.company.company_type ?? 'individual';
        token.companyCount = await prisma.membership.count({ where: { user_id: token.id as string } });
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        session.user.id = token.id;
        session.user.companyId = token.companyId;
        session.user.companyType = token.companyType;
        session.user.companyCount = token.companyCount ?? 1;
      }
      return session;
    },
  },
};
