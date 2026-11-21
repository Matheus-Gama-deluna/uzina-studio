import type { DatabaseHealthCheck } from "@uzina/contracts";
import { getDb, resolveDatabaseConfig } from "./client.js";

function mapSafeErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "DB_PROBE_TIMEOUT") {
      return "DB_TIMEOUT";
    }
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === "string" && /^[A-Z0-9_]{2,32}$/.test(maybeCode)) {
      return maybeCode;
    }
  }
  return "DB_UNAVAILABLE";
}

export async function checkDbHealth(
  timeoutMs = 2000
): Promise<DatabaseHealthCheck> {
  const start = performance.now();
  let mode: DatabaseHealthCheck["mode"] = "pglite";

  try {
    mode = resolveDatabaseConfig(process.env).mode;
  } catch {
    return {
      status: "down",
      mode,
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
      errorCode: "DB_CONFIG_INVALID",
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("DB_PROBE_TIMEOUT"));
      }, timeoutMs);
    });

    const probePromise = (async () => {
      const ctx = await getDb();
      await ctx.ping();
    })();

    await Promise.race([probePromise, timeoutPromise]);

    return {
      status: "up",
      mode,
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
    };
  } catch (error: unknown) {
    return {
      status: "down",
      mode,
      latencyMs: Math.round((performance.now() - start) * 100) / 100,
      errorCode: mapSafeErrorCode(error),
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
