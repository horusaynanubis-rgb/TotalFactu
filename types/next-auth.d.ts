import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      companyId?: string | null;
      companyType?: string | null;
      companyCount?: number;
    };
  }

  interface User {
    id: string;
    name: string;
    email: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    companyId?: string | null;
    companyType?: string | null;
    companyCount?: number;
  }
}
