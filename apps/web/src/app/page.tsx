import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled"
  ) {
    redirect("/app");
  }

  let hasSession = false;
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    hasSession = Boolean(session?.user?.id);
  } catch {
    hasSession = false;
  }

  redirect(hasSession ? "/app" : "/login");
}
