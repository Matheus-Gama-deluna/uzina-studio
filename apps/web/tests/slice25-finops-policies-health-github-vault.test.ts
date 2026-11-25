import {
  EngineConfigResponseSchema,
  HealthDetailsSchema,
  ProviderProfileListResponseSchema,
  ProviderProfilePublicSchema,
} from "@uzina/contracts";
import { decryptSecret } from "@uzina/core";
import { closeDb, getDb, providerProfiles, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import {
  GET as getEngineConfig,
  PUT as updateEngineConfig,
} from "../src/app/api/finops/config/route";
import {
  GET as getProviders,
  POST as createProvider,
} from "../src/app/api/providers/route";
import { resetAuthForTests } from "../src/lib/auth";
import { createHealthDetailsGetHandler } from "../src/lib/health-service";
import { getServerMasterKey } from "../src/lib/vault";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpCookie(name: string, email: string): Promise<string> {
  const res = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "StrongPassword!123" }),
    })
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

describe("Slice 25 Web APIs — Engine Policies, Docker Health & GitHub PAT Vault", () => {
  let ownerCookie = "";
  let auditorCookie = "";
  let organizationId = "";

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S25", "owner-s25@uzina.studio");
    auditorCookie = await signUpCookie(
      "Auditor S25",
      "auditor-s25@uzina.studio"
    );

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s25@uzina.studio"));
    expect(ownerRow?.organizationId).toBeTruthy();
    organizationId = ownerRow!.organizationId!;

    await db
      .update(users)
      .set({ organizationId, role: "auditor" })
      .where(eq(users.email, "auditor-s25@uzina.studio"));
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("GET/PUT /api/finops/config persiste toolPolicies, expõe dockerReady e bloqueia auditor com 403", async () => {
    const getBefore = await getEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(getBefore.status).toBe(200);
    const parsedBefore = EngineConfigResponseSchema.parse(
      await getBefore.json()
    );
    expect(typeof parsedBefore.dockerReady).toBe("boolean");
    expect(parsedBefore.config.toolPolicies).toEqual({
      readCode: "allow",
      runTests: "allow",
      writeFiles: "allow",
      gitFinalize: "allow",
    });

    const forbiddenPut = await updateEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: auditorCookie,
        },
        body: JSON.stringify({
          toolPolicies: { writeFiles: "deny" },
        }),
      })
    );
    expect(forbiddenPut.status).toBe(403);

    const putRes = await updateEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          workspaceKind: "docker",
          toolPolicies: {
            readCode: "allow",
            runTests: "ask",
            writeFiles: "ask",
            gitFinalize: "deny",
          },
        }),
      })
    );
    expect(putRes.status).toBe(200);
    const parsedAfter = EngineConfigResponseSchema.parse(await putRes.json());
    expect(parsedAfter.config.workspaceKind).toBe("docker");
    expect(parsedAfter.config.toolPolicies).toEqual({
      readCode: "allow",
      runTests: "ask",
      writeFiles: "ask",
      gitFinalize: "deny",
    });

    const unauthGet = await getEngineConfig(
      new Request("http://localhost:3000/api/finops/config")
    );
    expect(unauthGet.status).toBe(401);

    const invalidPut = await updateEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          toolPolicies: { readCode: "invalid_mode" },
        }),
      })
    );
    expect(invalidPut.status).toBe(400);
  });

  test("createHealthDetailsGetHandler popula checks.docker e mantém status ok mesmo com daemon indisponível", async () => {
    const readyHandler = createHealthDetailsGetHandler({
      probe: async () => ({ status: "up", mode: "pglite", latencyMs: 3 }),
      dockerProbe: async () => ({ ready: true, version: "27.0.1" }),
    });
    const readyRes = await readyHandler(
      new Request("http://localhost:3000/api/health/details", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(readyRes.status).toBe(200);
    const readyParsed = HealthDetailsSchema.parse(await readyRes.json());
    expect(readyParsed.status).toBe("ok");
    expect(readyParsed.checks.docker).toEqual({
      ready: true,
      version: "27.0.1",
    });

    const offlineHandler = createHealthDetailsGetHandler({
      probe: async () => ({ status: "up", mode: "pglite", latencyMs: 3 }),
      dockerProbe: async () => ({
        ready: false,
        version: null,
        errorCode: "DOCKER_UNAVAILABLE",
      }),
    });
    const offlineRes = await offlineHandler(
      new Request("http://localhost:3000/api/health/details", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(offlineRes.status).toBe(200);
    const offlineParsed = HealthDetailsSchema.parse(await offlineRes.json());
    expect(offlineParsed.status).toBe("ok");
    expect(offlineParsed.checks.docker).toEqual({
      ready: false,
      version: null,
      errorCode: "DOCKER_UNAVAILABLE",
    });

    const throwingDockerHandler = createHealthDetailsGetHandler({
      probe: async () => ({ status: "up", mode: "pglite", latencyMs: 3 }),
      dockerProbe: async () => {
        throw new Error("socket permission denied");
      },
    });
    const throwingRes = await throwingDockerHandler(
      new Request("http://localhost:3000/api/health/details", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(throwingRes.status).toBe(200);
    const throwingParsed = HealthDetailsSchema.parse(await throwingRes.json());
    expect(throwingParsed.status).toBe("ok");
    expect(throwingParsed.checks.docker).toEqual({
      ready: false,
      version: null,
      errorCode: "DOCKER_UNAVAILABLE",
    });
  });

  test("POST/GET /api/providers armazena github_pat cifrado em AES-256-GCM sem vazar segredo, isola isDefault de LLMs e aplica anti-SSRF/RBAC", async () => {
    const llmRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          name: "OmniRouter Principal",
          providerType: "omniroute",
          baseUrl: "https://omnirouter.example.com/v1",
          apiKey: "sk-llm-secret-value-1234",
          isDefault: true,
          roleBindings: {
            builder: { modelId: "omni-fast" },
          },
        }),
      })
    );
    expect(llmRes.status).toBe(201);
    const llmProfile = ProviderProfilePublicSchema.parse(await llmRes.json());

    const ssrfRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          name: "GitHub SSRF",
          providerType: "github_pat",
          baseUrl: "http://127.0.0.1:8080",
          apiKey: "ghp_ssrfTestToken123456",
          isDefault: false,
        }),
      })
    );
    expect(ssrfRes.status).toBe(400);

    const forbiddenCreate = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: auditorCookie,
        },
        body: JSON.stringify({
          name: "PAT Auditor Bloqueado",
          providerType: "github_pat",
          baseUrl: "https://api.github.com",
          apiKey: "ghp_auditorBlockedToken1234",
          isDefault: false,
        }),
      })
    );
    expect(forbiddenCreate.status).toBe(403);

    const patSecret = "ghp_Slice25TestSecret987654321";
    const patRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          name: "GitHub PAT Org",
          providerType: "github_pat",
          baseUrl: "https://api.github.com",
          apiKey: patSecret,
          isDefault: true,
        }),
      })
    );
    expect(patRes.status).toBe(201);
    const patRawText = await patRes.text();
    expect(patRawText).not.toContain(patSecret);
    const patProfile = ProviderProfilePublicSchema.parse(JSON.parse(patRawText));
    expect(patProfile.providerType).toBe("github_pat");
    expect(patProfile.keyPreview).toBe("ghp...4321");

    const listRes = await getProviders(
      new Request("http://localhost:3000/api/providers", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).not.toContain(patSecret);
    const listParsed = ProviderProfileListResponseSchema.parse(
      JSON.parse(listText)
    );
    const storedLlm = listParsed.items.find((i) => i.id === llmProfile.id);
    const storedPat = listParsed.items.find((i) => i.id === patProfile.id);
    expect(storedLlm?.isDefault).toBe(true);
    expect(storedPat?.isDefault).toBe(true);

    const { db } = await getDb();
    const [dbPatRow] = await db
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.id, patProfile.id));
    expect(dbPatRow?.encryptedApiKey?.startsWith("v1:")).toBe(true);
    expect(dbPatRow?.encryptedApiKey).not.toContain(patSecret);
    expect(
      decryptSecret({
        encrypted: dbPatRow!.encryptedApiKey!,
        masterKey: getServerMasterKey(),
        organizationId,
        providerType: "github_pat",
      })
    ).toBe(patSecret);

    const secondPatRes = await createProvider(
      new Request("http://localhost:3000/api/providers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          name: "GitHub PAT Org 2",
          providerType: "github_pat",
          baseUrl: "https://api.github.com",
          apiKey: "ghp_SecondPatSecretValue99999",
          isDefault: true,
        }),
      })
    );
    expect(secondPatRes.status).toBe(201);
    const secondPatProfile = ProviderProfilePublicSchema.parse(
      await secondPatRes.json()
    );

    const listAfterSecondRes = await getProviders(
      new Request("http://localhost:3000/api/providers", {
        headers: { cookie: ownerCookie },
      })
    );
    const listAfterSecond = ProviderProfileListResponseSchema.parse(
      await listAfterSecondRes.json()
    );
    expect(
      listAfterSecond.items.find((i) => i.id === llmProfile.id)?.isDefault
    ).toBe(true);
    expect(
      listAfterSecond.items.find((i) => i.id === patProfile.id)?.isDefault
    ).toBe(false);
    expect(
      listAfterSecond.items.find((i) => i.id === secondPatProfile.id)?.isDefault
    ).toBe(true);
  });
});
