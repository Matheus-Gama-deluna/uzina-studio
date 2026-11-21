import { WorkspaceBoard } from "@/components/workspace-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CockpitHomePage() {
  return <WorkspaceBoard />;
}
