import { SecurityAuditConsole } from "@/components/security-audit-console";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SecurityPage() {
  return <SecurityAuditConsole />;
}
