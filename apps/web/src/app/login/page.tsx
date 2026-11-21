import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuth } from "@/lib/auth";
import { getPublicHealth } from "@/lib/health-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_API_MOCKING === "enabled"
  ) {
    redirect("/app");
  }

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      redirect("/app");
    }
  } catch {
    // Segue para formulário caso sessão não possa ser lida
  }

  const health = await getPublicHealth();

  return <LoginForm systemHealthy={health.status === "ok"} />;
}
