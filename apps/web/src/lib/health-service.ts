import {
  HealthDetailsSchema,
  HealthPublicSchema,
  type DatabaseHealthCheck,
  type HealthDetails,
  type HealthPublic,
} from "@uzina/contracts";
import { checkDbHealth } from "@uzina/db";
import { NextResponse } from "next/server";
import { getAuth, getAuthStatus } from "./auth";

export type DbHealthProbe = (timeoutMs?: number) => Promise<DatabaseHealthCheck>;

export async function getPublicHealth(
  probe: DbHealthProbe = checkDbHealth
): Promise<HealthPublic> {
  let isUp = false;
  try {
    const dbCheck = await probe(2000);
    isUp = dbCheck.status === "up";
  } catch {
    isUp = false;
  }

  return HealthPublicSchema.parse({
    status: isUp ? "ok" : "error",
    service: "uzina-studio",
    timestamp: new Date().toISOString(),
  });
}

export async function getDetailedHealth(
  probe: DbHealthProbe = checkDbHealth
): Promise<HealthDetails> {
  let dbCheck: DatabaseHealthCheck;
  try {
    dbCheck = await probe(2000);
  } catch {
    dbCheck = {
      status: "down",
      mode: "pglite",
      latencyMs: 0,
      errorCode: "DB_PROBE_FAILED",
    };
  }

  const status: HealthDetails["status"] =
    dbCheck.status === "down" ? "error" : "ok";

  return HealthDetailsSchema.parse({
    status,
    service: "uzina-studio",
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      auth: { status: getAuthStatus() },
    },
  });
}

export function createHealthGetHandler(deps?: { probe?: DbHealthProbe }) {
  return async function GET(): Promise<Response> {
    const payload = await getPublicHealth(deps?.probe);
    const httpStatus = payload.status === "ok" ? 200 : 503;
    return NextResponse.json(payload, { status: httpStatus });
  };
}

export function createHealthDetailsGetHandler(deps?: {
  probe?: DbHealthProbe;
}) {
  return async function GET(request: Request): Promise<Response> {
    let session: unknown;
    try {
      const auth = await getAuth();
      session = await auth.api.getSession({ headers: request.headers });
    } catch {
      return NextResponse.json(
        { error: "Serviço de autenticação indisponível" },
        { status: 503 }
      );
    }
    if (!session) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 }
      );
    }

    const payload = await getDetailedHealth(deps?.probe);
    const httpStatus = payload.status === "error" ? 503 : 200;
    return NextResponse.json(payload, { status: httpStatus });
  };
}
