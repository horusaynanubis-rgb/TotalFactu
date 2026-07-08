// Shared helpers for the "active company" mechanism used by multi-company
// owner accounts (Gestión de empresas). Not related to the gestoría
// client-portal selector, which is a separate localStorage-only UI mode.

import { prisma } from '@/lib/prisma';

export const ACTIVE_COMPANY_COOKIE = 'tf_active_company';

// 1 year — same company preference should stick across sessions until the
// user explicitly switches again.
export const ACTIVE_COMPANY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function activeCompanyCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ACTIVE_COMPANY_COOKIE_MAX_AGE,
  };
}

interface SessionLike {
  user?: { id?: string | null; companyId?: string | null } | null;
}

/**
 * Resolves the caller's active company id for API routes: trusts the
 * JWT-validated `session.user.companyId` (set by the auth-options jwt()
 * callback from the tf_active_company cookie); falls back to the oldest
 * Membership only for a stale/edge-case token — the same default every
 * endpoint used before multi-company support existed.
 *
 * Use this instead of re-deriving company_id via a bare
 * `membership.findFirst({ where: { user_id } })`, which ignores which
 * company the user currently has active.
 */
export async function resolveActiveCompanyId(session: SessionLike | null | undefined): Promise<string | null> {
  const userId = session?.user?.id;
  if (!userId) return null;
  if (session?.user?.companyId) return session.user.companyId;

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
    select: { company_id: true },
  });
  return membership?.company_id ?? null;
}
