import { ProvidersManager } from "@/components/providers-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  return <ProvidersManager />;
}
