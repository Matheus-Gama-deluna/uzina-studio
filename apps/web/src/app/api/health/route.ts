import { createHealthGetHandler } from "@/lib/health-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createHealthGetHandler();
