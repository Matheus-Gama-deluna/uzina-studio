import { HealthDetailsSchema, HealthPublicSchema } from "@uzina/contracts";
import { closeDb } from "@uzina/db";
import { afterAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getDetails } from "../src/app/api/health/details/route";
import { GET as getHealth } from "../src/app/api/health/route";
import { resetAuthForTests } from "../src/lib/auth";
import {
  createHealthDetailsGetHandler,
  createHealthGetHandler,
} from "../src/lib/health-service";

describe("GET /api/health & /api/health/details", () => {
  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("GET /api/health retorna 200 e payload válido contra HealthPublicSchema usando PGlite real", async () => {
    const response = await getHealth();
    expect(response.status).toBe(200);

    const body: unknown = await response.json();
    const parsed = HealthPublicSchema.parse(body);

    expect(parsed.status).toBe("ok");
    expect(parsed.service).toBe("uzina-studio");
    expect(Object.keys(parsed).sort()).toEqual(["service", "status", "timestamp"]);
  });

  test.each<{ label: string; headers: Record<string, string> }>([
    { label: "sem cookie de sessão", headers: {} },
    {
      label: "com cookie adulterado/inválido",
      headers: { cookie: "better-auth.session_token=forged.invalid.token" },
    },
  ])("GET /api/health/details rejeita acesso ($label) com 401", async ({ headers }) => {
    const request = new Request("http://localhost:3000/api/health/details", {
      headers,
    });
    const response = await getDetails(request);
    expect(response.status).toBe(401);
  });

  test("createHealthGetHandler retorna 503 sem vazar mensagens internas quando probe falha", async () => {
    const failingHandler = createHealthGetHandler({
      probe: async () => ({
        status: "down",
        mode: "postgres",
        latencyMs: 2000,
        errorCode: "DB_TIMEOUT",
      }),
    });

    const response = await failingHandler();
    expect(response.status).toBe(503);

    const rawText = await response.text();
    expect(rawText).not.toContain("postgres://");
    expect(rawText).not.toContain("DB_TIMEOUT");

    const parsed = HealthPublicSchema.parse(JSON.parse(rawText));
    expect(parsed.status).toBe("error");
    expect(parsed.service).toBe("uzina-studio");
  });

  test("createHealthGetHandler retorna 503 sem vazar credenciais quando probe lança exceção", async () => {
    const throwingHandler = createHealthGetHandler({
      probe: async () => {
        throw new Error("connect ECONNREFUSED postgres://admin:supersecret@db:5432/prod");
      },
    });

    const response = await throwingHandler();
    expect(response.status).toBe(503);

    const rawText = await response.text();
    expect(rawText).not.toContain("supersecret");
    expect(rawText).not.toContain("postgres://");

    const parsed = HealthPublicSchema.parse(JSON.parse(rawText));
    expect(parsed.status).toBe("error");
  });

  test("createHealthDetailsGetHandler autenticado retorna 503 e payload válido quando banco está down", async () => {
    resetAuthForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Operador Health",
          email: "health-down@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    const cookieHeader = signUpRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]?.trim() ?? "")
      .filter(Boolean)
      .join("; ");

    const downDetailsHandler = createHealthDetailsGetHandler({
      probe: async () => ({
        status: "down",
        mode: "pglite",
        latencyMs: 12,
        errorCode: "DB_UNAVAILABLE",
      }),
    });

    const response = await downDetailsHandler(
      new Request("http://localhost:3000/api/health/details", {
        headers: { cookie: cookieHeader },
      })
    );
    expect(response.status).toBe(503);

    const parsed = HealthDetailsSchema.parse(await response.json());
    expect(parsed.status).toBe("error");
    expect(parsed.checks.database.status).toBe("down");
    expect(parsed.checks.database.errorCode).toBe("DB_UNAVAILABLE");
  });
});
