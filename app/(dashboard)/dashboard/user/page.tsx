import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";
import { DashboardUserContent } from "@/components/dashboard-user-content";

export const dynamic = "force-dynamic";

export default async function UserDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <DashboardUserContent />;
}
