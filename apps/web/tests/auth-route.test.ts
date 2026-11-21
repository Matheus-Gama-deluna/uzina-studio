import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HealthDetailsSchema } from "@uzina/contracts";
import { closeDb, getDb, sessions, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { GET as authGet, POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getHealthDetails } from "../src/app/api/health/details/route";
import { resetAuthForTests, resolveAuthSecret } from "../src/lib/auth";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractCookieHeader(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);

  return cookies
    .map((raw) => raw.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Better Auth + Drizzle + PGlite integração real", () => {
  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("executa sign-up, persiste UUID em users/sessions, valida get-session e acessa /api/health/details", async () => {
    resetAuthForTests();
    await closeDb();

    const email = "cto@uzina.studio";
    const signUpReq = new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "CTO Uzina",
        email,
        password: "StrongPassword!123",
      }),
    });

    const signUpRes = await authPost(signUpReq);
    expect(signUpRes.status).toBe(200);

    const cookieHeader = extractCookieHeader(signUpRes);
    expect(cookieHeader.length).toBeGreaterThan(0);

    const { db } = await getDb();
    const dbUsers = await db.select().from(users).where(eq(users.email, email));
    expect(dbUsers).toHaveLength(1);
    const createdUser = dbUsers[0];
    expect(createdUser?.id).toMatch(UUID_REGEX);
    expect(createdUser?.organizationId).toBeNull();

    const dbSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, createdUser?.id ?? ""));
    expect(dbSessions).toHaveLength(1);
    expect(dbSessions[0]?.id).toMatch(UUID_REGEX);

    const sessionRes = await authGet(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie: cookieHeader },
      })
    );
    expect(sessionRes.status).toBe(200);
    const sessionData = (await sessionRes.json()) as {
      user?: { email?: string; id?: string };
    };
    expect(sessionData.user?.email).toBe(email);
    expect(sessionData.user?.id).toBe(createdUser?.id);

    const detailsRes = await getHealthDetails(
      new Request("http://localhost:3000/api/health/details", {
        headers: { cookie: cookieHeader },
      })
    );
    expect(detailsRes.status).toBe(200);
    const detailsBody = HealthDetailsSchema.parse(await detailsRes.json());
    expect(detailsBody.status).toBe("ok");
    expect(detailsBody.checks.database.mode).toBe("pglite");
    expect(detailsBody.checks.auth.status).toBe("ephemeral_dev");

    const badSignInRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "WrongPassword!999",
        }),
      })
    );
    expect(badSignInRes.status).toBe(401);
  });
});

describe("resolveAuthSecret — bordas e fail-fast", () => {
  test.each([
    { label: "secret muito curto (10 chars)", secret: "short-key!" },
    { label: "secret com 31 chars", secret: "a".repeat(31) },
  ])("rejeita BETTER_AUTH_SECRET menor que 32 chars ($label)", ({ secret }) => {
    expect(() =>
      resolveAuthSecret({ BETTER_AUTH_SECRET: secret })
    ).toThrow(/32 caracteres/);
  });

  test.each<{ label: string; env: Record<string, string | undefined> }>([
    {
      label: "UZINA_STRICT_SECRETS=true sem BETTER_AUTH_SECRET",
      env: { UZINA_STRICT_SECRETS: "true", UZINA_DATA_DIR: ":memory:" },
    },
    {
      label: "DATABASE_URL postgres sem BETTER_AUTH_SECRET",
      env: { DATABASE_URL: "postgres://uzina:uzina@localhost:5432/uzina" },
    },
  ])("falha fechado em modo strict ($label)", ({ env }) => {
    expect(() => resolveAuthSecret(env)).toThrow(
      /BETTER_AUTH_SECRET obrigatório/
    );
  });

  test("gera e reutiliza .auth-secret em disco e falha se arquivo existente estiver corrompido", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-secret-"));
    try {
      const first = resolveAuthSecret({ UZINA_DATA_DIR: tmpDir });
      const second = resolveAuthSecret({ UZINA_DATA_DIR: tmpDir });

      expect(first).toHaveLength(64);
      expect(second).toBe(first);

      const secretFile = path.join(tmpDir, ".auth-secret");
      fs.writeFileSync(secretFile, "corrompido", "utf8");

      expect(() =>
        resolveAuthSecret({ UZINA_DATA_DIR: tmpDir })
      ).toThrow(/inválido ou corrompido/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
