import {
  EngineConfigResponseSchema,
  FinopsSummarySchema,
  TokenSavingsEventSchema,
} from "@uzina/contracts";
import { closeDb, getDb, organizations, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import {
  GET as getEngineConfig,
  PUT as updateEngineConfig,
} from "../src/app/api/finops/config/route";
import {
  GET as getFinopsSummary,
  POST as recordFinopsEvent,
} from "../src/app/api/finops/summary/route";
import { resetAuthForTests } from "../src/lib/auth";
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

describe("Slice 10 APIs — /api/finops/summary (RBAC & Isolamento Multi-tenant)", () => {
  let ownerCookie = "";
  let auditorCookie = "";
  let otherOrgCookie = "";

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpCookie("Owner S10", "owner-s10@uzina.studio");
    auditorCookie = await signUpCookie("Auditor S10", "auditor-s10@uzina.studio");
    otherOrgCookie = await signUpCookie("Other S10", "other-s10@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s10@uzina.studio"));

    await db
      .update(users)
      .set({ organizationId: ownerRow!.organizationId, role: "auditor" })
      .where(eq(users.email, "auditor-s10@uzina.studio"));

    const [otherOrg] = await db
      .insert(organizations)
      .values({
        name: "Org Isolada S10",
        slug: "other-org-s10",
      })
      .returning();
    await db
      .update(users)
      .set({ organizationId: otherOrg!.id, role: "owner" })
      .where(eq(users.email, "other-s10@uzina.studio"));
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("impõe 401/403, registra medição FinOps e isola resumo por organização", async () => {
    const unauth = await getFinopsSummary(
      new Request("http://localhost:3000/api/finops/summary")
    );
    expect(unauth.status).toBe(401);

    const forbidden = await recordFinopsEvent(
      new Request("http://localhost:3000/api/finops/summary", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({
          technique: "skeleton",
          tokensBaseline: 1000,
          tokensActual: 100,
        }),
      })
    );
    expect(forbidden.status).toBe(403);

    const postRes = await recordFinopsEvent(
      new Request("http://localhost:3000/api/finops/summary", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          technique: "skeleton",
          tokensBaseline: 10000,
          tokensActual: 1000,
        }),
      })
    );
    expect(postRes.status).toBe(201);
    const created = TokenSavingsEventSchema.parse(await postRes.json());
    expect(created.tokensSaved).toBe(9000);

    const getRes = await getFinopsSummary(
      new Request("http://localhost:3000/api/finops/summary", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(getRes.status).toBe(200);
    const summary = FinopsSummarySchema.parse(await getRes.json());
    expect(summary.totalTokensSaved).toBe(9000);
    expect(summary.overallSavingsPercent).toBe(90);

    const otherRes = await getFinopsSummary(
      new Request("http://localhost:3000/api/finops/summary", {
        headers: { cookie: otherOrgCookie },
      })
    );
    expect(otherRes.status).toBe(200);
    const otherSummary = FinopsSummarySchema.parse(await otherRes.json());
    expect(otherSummary.totalTokensSaved).toBe(0);

    // Hot-reload /api/finops/config (403 para auditor, 200 para owner, sem restart)
    const cfgForbidden = await updateEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: auditorCookie },
        body: JSON.stringify({ embeddingMode: "onnx_e5_small" }),
      })
    );
    expect(cfgForbidden.status).toBe(403);

    const cfgPut = await updateEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          embeddingMode: "onnx_e5_small",
          astMode: "polyglot",
          autoInjectInRunner: true,
        }),
      })
    );
    expect(cfgPut.status).toBe(200);
    const updatedCfg = EngineConfigResponseSchema.parse(await cfgPut.json());
    expect(updatedCfg.activeEmbeddingProviderId).toBe("onnx-e5-small-384");

    const cfgGet = await getEngineConfig(
      new Request("http://localhost:3000/api/finops/config", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(cfgGet.status).toBe(200);
    expect(
      EngineConfigResponseSchema.parse(await cfgGet.json()).config.embeddingMode
    ).toBe("onnx_e5_small");
  });
});
