import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";

function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Returns the session user's email if they are a configured admin, or null otherwise.
 * Used to protect /api/admin/** routes and /dashboard/admin/** pages.
 */
export async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const admins = getAdminEmails();
  if (admins.length === 0) return null; // fail-closed: no ADMIN_EMAILS → no access
  if (!admins.includes(session.user.email)) return null;
  return { email: session.user.email };
}
