import {
  HealthDetailsSchema,
  HealthPublicSchema,
  type DatabaseHealthCheck,
  type HealthDetails,
  type HealthPublic,
} from "@uzina/contracts";
import { checkDbHealth } from "@uzina/db";
import {
  probeDockerDaemon,
  type DockerProbeResult,
} from "@uzina/mastra-runtime";
import { NextResponse } from "next/server";
import { getAuth, getAuthStatus } from "./auth";
import { resolveVapidKeys } from "./vapid";

export type DbHealthProbe = (timeoutMs?: number) => Promise<DatabaseHealthCheck>;
export type DockerHealthProbe = () => Promise<DockerProbeResult>;

export async function getPublicHealth(
  probe: DbHealthProbe = checkDbHealth
): Promise<HealthPublic> {
  let isUp = false;
  try {
    const dbCheck = await probe(5000);
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
  probe: DbHealthProbe = checkDbHealth,
  dockerProbe: DockerHealthProbe = probeDockerDaemon
): Promise<HealthDetails> {
  let dbCheck: DatabaseHealthCheck;
  try {
    dbCheck = await probe(5000);
  } catch {
    dbCheck = {
      status: "down",
      mode: "pglite",
      latencyMs: 0,
      errorCode: "DB_PROBE_FAILED",
    };
  }

  let dockerCheck: DockerProbeResult;
  try {
    dockerCheck = await dockerProbe();
  } catch {
    dockerCheck = {
      ready: false,
      version: null,
      errorCode: "DOCKER_UNAVAILABLE",
    };
  }

  const status: HealthDetails["status"] =
    dbCheck.status === "down" ? "error" : "ok";

  let vapidConfigured = false;
  try {
    const vapid = resolveVapidKeys();
    vapidConfigured = Boolean(vapid.publicKey && vapid.privateKey);
  } catch {
    vapidConfigured = false;
  }
  const httpsReady = (process.env.BETTER_AUTH_URL?.trim() ?? "").startsWith(
    "https://"
  );

  return HealthDetailsSchema.parse({
    status,
    service: "uzina-studio",
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      auth: { status: getAuthStatus() },
      docker: dockerCheck,
      httpsReady,
      pwaEnabled: true,
      vapidConfigured,
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
  dockerProbe?: DockerHealthProbe;
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

    const payload = await getDetailedHealth(deps?.probe, deps?.dockerProbe);
    const httpStatus = payload.status === "error" ? 503 : 200;
    return NextResponse.json(payload, { status: httpStatus });
  };
}
