import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";

// A Membership.role value (see prisma/schema.prisma — role is a free-form
// string, no enum) that marks a user as platform-wide staff. Independent of
// the ADMIN_EMAILS allowlist in lib/admin/auth.ts, which continues to gate
// the older /dashboard/admin/demo and /api/admin/diagnostics|demo-gestoria
// tools unchanged.
export const PLATFORM_ADMIN_ROLE = "platform_admin";

// A Company.company_type value for the internal "TotalFactu Internal"
// company that platform_admin users belong to. Also free-form, no enum —
// every commercial metric query must exclude it explicitly.
export const INTERNAL_COMPANY_TYPE = "internal";

/**
 * Returns the session user's id/email if they hold the platform_admin role
 * (see PLATFORM_ADMIN_ROLE), or null otherwise. Used to protect
 * /api/admin/overview|companies|reports and /dashboard/admin/** (the new
 * Admin Control backoffice) server-side. The middleware.ts matcher covers
 * the same routes for a real 403 on direct navigation — this is
 * defense-in-depth for when a route is hit without going through the
 * middleware (e.g. server-to-server calls).
 */
export async function requirePlatformAdmin(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isPlatformAdmin) return null;
  return { id: session.user.id, email: session.user.email ?? "" };
}
