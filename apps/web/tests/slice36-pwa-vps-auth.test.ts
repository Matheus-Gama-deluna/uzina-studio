import fs from "node:fs";
import path from "node:path";
import { closeDb } from "@uzina/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { POST as sharePost } from "../src/app/api/share/route";
import manifest from "../src/app/manifest";
import {
  resetAuthForTests,
  resolveTrustedOrigins,
  shouldUseSecureAuthCookies,
} from "../src/lib/auth";
import { getDetailedHealth } from "../src/lib/health-service";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Slice 36 — PWA Manifest, Service Worker, Share Target & Prontidão VPS HTTPS", () => {
  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("manifest.ts expõe configuração standalone completa, ícones válidos, shortcuts e share_target", () => {
    const data = manifest();
    expect(data.name).toContain("Uzina Studio");
    expect(data.short_name).toBe("Uzina");
    expect(data.display).toBe("standalone");
    expect(data.start_url).toBe("/app");
    expect(Array.isArray(data.icons)).toBe(true);
    expect(data.icons?.length).toBeGreaterThanOrEqual(3);

    for (const icon of data.icons ?? []) {
      const relPath = icon.src.replace(/^\//, "");
      const absPath = path.resolve(process.cwd(), "public", relPath);
      expect(fs.existsSync(absPath)).toBe(true);
      const bytes = fs.readFileSync(absPath);
      // Assinatura mágica PNG (89 50 4E 47)
      expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
    }

    expect(data.shortcuts?.some((s) => s.url.includes("/app/decisions"))).toBe(
      true
    );
    expect(data.share_target?.action).toBe("/api/share");
    expect(data.share_target?.method).toBe("POST");
  });

  test("public/sw.js registra listeners, ignora /api/* e responde offline para navegação", async () => {
    const swPath = path.resolve(process.cwd(), "public", "sw.js");
    const swSource = fs.readFileSync(swPath, "utf8");
    const listeners = new Map<string, (event: unknown) => void>();
    const cachedOfflineResponse = new Response("Offline Shell", { status: 200 });

    const mockSelf = {
      location: { origin: "https://studio.uzina.dev" },
      skipWaitingCalls: 0,
      skipWaiting() {
        this.skipWaitingCalls += 1;
      },
      clients: {
        claim: async () => undefined,
        matchAll: async () => [],
        openWindow: async () => undefined,
      },
      registration: {
        showNotification: async () => undefined,
      },
      navigator: {
        setAppBadge: async () => undefined,
        clearAppBadge: async () => undefined,
      },
      addEventListener(type: string, cb: (event: unknown) => void) {
        listeners.set(type, cb);
      },
    };

    const mockCaches = {
      open: async () => ({ addAll: async () => undefined, put: async () => undefined }),
      keys: async () => [],
      delete: async () => true,
      match: async (req: Request | string) => {
        const pathname =
          typeof req === "string"
            ? new URL(req, "https://studio.uzina.dev").pathname
            : new URL(req.url).pathname;
        return pathname === "/offline" ? cachedOfflineResponse : undefined;
      },
    };

    const runSw = new Function("self", "caches", "fetch", swSource) as (
      s: typeof mockSelf,
      c: typeof mockCaches,
      f: typeof fetch
    ) => void;
    runSw(mockSelf, mockCaches, async () => {
      throw new Error("Network down");
    });

    // Não chama skipWaiting automaticamente; só via mensagem SKIP_WAITING
    expect(mockSelf.skipWaitingCalls).toBe(0);
    listeners.get("message")?.({ data: { type: "SKIP_WAITING" } });
    expect(mockSelf.skipWaitingCalls).toBe(1);

    // /api/* NÃO deve ser interceptado via respondWith
    let apiIntercepted = false;
    listeners.get("fetch")?.({
      request: new Request("https://studio.uzina.dev/api/decisions", { method: "GET" }),
      respondWith: () => {
        apiIntercepted = true;
      },
    });
    expect(apiIntercepted).toBe(false);

    // Navegação sem rede entrega /offline do cache
    let navPromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://studio.uzina.dev/app",
      },
      respondWith: (p: Promise<Response>) => {
        navPromise = p;
      },
    });
    const navRes = await navPromise;
    expect(navRes).toBe(cachedOfflineResponse);
  });

  test.each([
    {
      name: "HTTPS único",
      env: { BETTER_AUTH_URL: "https://studio.uzina.dev" },
      expectedOrigins: ["https://studio.uzina.dev"],
      expectedSecure: true,
    },
    {
      name: "HTTPS com origens extras",
      env: {
        BETTER_AUTH_URL: "https://studio.uzina.dev",
        BETTER_AUTH_TRUSTED_ORIGINS:
          "https://exec.uzina.dev, https://preview.uzina.dev/rota",
      },
      expectedOrigins: [
        "https://studio.uzina.dev",
        "https://exec.uzina.dev",
        "https://preview.uzina.dev",
      ],
      expectedSecure: true,
    },
    {
      name: "Dev HTTP local",
      env: { BETTER_AUTH_URL: "http://localhost:3000" },
      expectedOrigins: ["http://localhost:3000"],
      expectedSecure: false,
    },
  ])(
    "resolveTrustedOrigins e shouldUseSecureAuthCookies ($name)",
    ({ env, expectedOrigins, expectedSecure }) => {
      expect(resolveTrustedOrigins(env)).toEqual(expectedOrigins);
      expect(shouldUseSecureAuthCookies(env)).toBe(expectedSecure);
    }
  );

  test("POST /api/share redireciona não autenticado para /login e autenticado para /app/ideas com campos sanitizados", async () => {
    const unauthForm = new FormData();
    unauthForm.append("title", "Ideia externa");
    const unauthRes = await sharePost(
      new Request("http://localhost:3000/api/share", {
        method: "POST",
        body: unauthForm,
      })
    );
    expect(unauthRes.status).toBe(303);
    expect(unauthRes.headers.get("location")).toContain("/login");

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Share User",
          email: "share-s36@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    const cookie = cookieOf(signUpRes);

    const form = new FormData();
    form.append("title", "App\u0007 Mobile");
    form.append("text", "Gerenciar entregas por voz");
    form.append("url", "https://exemplo.com/ref");

    const authRes = await sharePost(
      new Request("http://localhost:3000/api/share", {
        method: "POST",
        headers: { cookie },
        body: form,
      })
    );
    expect(authRes.status).toBe(303);
    const loc = authRes.headers.get("location") ?? "";
    expect(loc).toContain("/app/ideas?");
    expect(loc).toContain("sharedTitle=App+Mobile");
    expect(loc).toContain("sharedText=Gerenciar+entregas+por+voz");
  });

  test("getDetailedHealth reporta httpsReady fiel a BETTER_AUTH_URL, pwaEnabled e vapidConfigured", async () => {
    const prevAuthUrl = process.env.BETTER_AUTH_URL;
    try {
      process.env.BETTER_AUTH_URL = "https://studio.uzina.dev";
      const httpsHealth = await getDetailedHealth(
        async () => ({ status: "up", mode: "pglite", latencyMs: 1 }),
        async () => ({ ready: false, version: null, errorCode: "DOCKER_UNAVAILABLE" })
      );
      expect(httpsHealth.checks.pwaEnabled).toBe(true);
      expect(httpsHealth.checks.httpsReady).toBe(true);
      expect(httpsHealth.checks.vapidConfigured).toBe(true);

      process.env.BETTER_AUTH_URL = "http://localhost:3000";
      const httpHealth = await getDetailedHealth(
        async () => ({ status: "up", mode: "pglite", latencyMs: 1 }),
        async () => ({ ready: false, version: null, errorCode: "DOCKER_UNAVAILABLE" })
      );
      expect(httpHealth.checks.httpsReady).toBe(false);
    } finally {
      if (prevAuthUrl === undefined) {
        delete process.env.BETTER_AUTH_URL;
      } else {
        process.env.BETTER_AUTH_URL = prevAuthUrl;
      }
    }
  });
});
