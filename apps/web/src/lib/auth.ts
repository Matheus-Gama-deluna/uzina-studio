import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  accounts,
  getDb,
  organizations,
  resolveDataDir,
  resolveDatabaseConfig,
  sessions,
  users,
  verifications,
} from "@uzina/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins";

const AUTH_SECRET_KEY = Symbol.for("@uzina/web/ephemeralAuthSecret");
const AUTH_INSTANCE_KEY = Symbol.for("@uzina/web/authInstance");

const authSchema = {
  organizations,
  users,
  sessions,
  accounts,
  verifications,
};

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

export function getAuthStatus(): "configured" | "ephemeral_dev" {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured && configured.length >= 32) {
    return "configured";
  }
  return "ephemeral_dev";
}

export function resolveAuthSecret(
  env: Record<string, string | undefined> = process.env
): string {
  const configured = env.BETTER_AUTH_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET inválido: deve possuir pelo menos 32 caracteres."
      );
    }
    return configured;
  }

  const dbConfig = resolveDatabaseConfig(env);
  const strictSecrets =
    dbConfig.mode === "postgres" ||
    env.UZINA_STRICT_SECRETS === "true" ||
    env.UZINA_STRICT_SECRETS === "1";

  if (strictSecrets && !isBuildPhase()) {
    throw new Error(
      "BETTER_AUTH_SECRET obrigatório quando DATABASE_URL ou UZINA_STRICT_SECRETS=true estão ativos."
    );
  }

  const dataDir = resolveDataDir(env);
  if (dataDir !== ":memory:" && !isBuildPhase()) {
    const secretPath = path.join(dataDir, ".auth-secret");
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const generated = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(secretPath, generated, { flag: "wx", mode: 0o600 });
      return generated;
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "EEXIST") {
        const existing = fs.readFileSync(secretPath, "utf8").trim();
        if (existing.length < 32) {
          throw new Error(
            ".auth-secret inválido ou corrompido (< 32 caracteres)."
          );
        }
        return existing;
      }
      throw error;
    }
  }

  const holder = globalThis as Record<symbol, string | undefined>;
  if (!holder[AUTH_SECRET_KEY]) {
    holder[AUTH_SECRET_KEY] = crypto.randomBytes(32).toString("hex");
  }
  return holder[AUTH_SECRET_KEY];
}

export function resolveTrustedOrigins(
  env: Record<string, string | undefined> = process.env
): string[] {
  const origins = new Set<string>();
  const baseUrl = env.BETTER_AUTH_URL?.trim();
  if (baseUrl) {
    try {
      origins.add(new URL(baseUrl).origin);
    } catch {
      // ignora URL malformada
    }
  }
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ?? [];
  for (const item of extra) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === "*") continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // ignora origem inválida
    }
  }
  if (origins.size === 0) {
    origins.add("http://localhost:3000");
  }
  return Array.from(origins);
}

export function shouldUseSecureAuthCookies(
  env: Record<string, string | undefined> = process.env
): boolean {
  const baseUrl = env.BETTER_AUTH_URL?.trim().toLowerCase() ?? "";
  return baseUrl.startsWith("https://");
}

function createAuthInstance(
  db: Awaited<ReturnType<typeof getDb>>["db"],
  secret: string
) {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const trustedOrigins = resolveTrustedOrigins(process.env);
  const useSecureCookies = shouldUseSecureAuthCookies(process.env);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      usePlural: true,
    }),
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
      useSecureCookies,
    },
    secret,
    baseURL,
    trustedOrigins,
    basePath: "/api/auth",
    ...(process.env.UZINA_E2E_DISABLE_RATE_LIMIT === "1"
      ? { rateLimit: { enabled: false } }
      : {}),
    plugins: [bearer(), nextCookies()],
  });
}

export type UzinaAuth = ReturnType<typeof createAuthInstance>;

export async function getAuth(): Promise<UzinaAuth> {
  const holder = globalThis as Record<
    symbol,
    { instance?: UzinaAuth; promise?: Promise<UzinaAuth> } | undefined
  >;
  let state = holder[AUTH_INSTANCE_KEY];
  if (!state) {
    state = {};
    holder[AUTH_INSTANCE_KEY] = state;
  }

  if (state.instance) {
    return state.instance;
  }
  if (!state.promise) {
    state.promise = (async () => {
      const { db } = await getDb();
      const secret = resolveAuthSecret();
      const instance = createAuthInstance(db, secret);
      state.instance = instance;
      return instance;
    })().catch((err: unknown) => {
      state.promise = undefined;
      throw err;
    });
  }
  return state.promise;
}

export function resetAuthForTests(): void {
  const holder = globalThis as Record<symbol, unknown>;
  delete holder[AUTH_INSTANCE_KEY];
  delete holder[AUTH_SECRET_KEY];
}
