import { getCurrentUser } from "@/lib/supabase-route";
import { Forbidden } from "@/components/forbidden";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return <Forbidden feature="Settings" />;
  }
  return <>{children}</>;
}
