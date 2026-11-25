import crypto from "node:crypto";
import {
  DecisionListResponseSchema,
  EvidencePackSchema,
  ExecutionEventSchema,
  ToolCallTracePayloadSchema,
} from "@uzina/contracts";
import {
  clients,
  closeDb,
  decisions,
  deliverables,
  executionEvents,
  getDb,
  projects,
  users,
} from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getDecisions } from "../src/app/api/decisions/route";
import { GET as getDeliverableEvents } from "../src/app/api/deliverables/[id]/events/route";
import { resetAuthForTests } from "../src/lib/auth";
import { listDeliverableEventsScoped } from "../src/lib/operations-queries";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUp(name: string, email: string): Promise<string> {
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

function parseSseFrames(body: string): Array<{
  id?: string;
  event?: string;
  data: unknown;
}> {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let id: string | undefined;
      let event: string | undefined;
      let rawData = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) rawData += line.slice(5).trim();
      }
      let data: unknown = rawData;
      try {
        data = JSON.parse(rawData);
      } catch {
        // Frame textual como snapshot_end
      }
      return { id, event, data };
    });
}

describe("Slice 23 — SSE Resumível (afterEventId / Last-Event-ID) & Persistência Semantic Diff", () => {
  let ownerCookie = "";
  let otherOrgCookie = "";
  let deliverableId = "";
  let orderedEventIds: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUp("Owner S23", "owner-s23@uzina.studio");
    otherOrgCookie = await signUp("Other S23", "other-s23@uzina.studio");

    await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, "owner-s23@uzina.studio"));

    const [client] = await db
      .insert(clients)
      .values({
        organizationId: ownerRow!.organizationId!,
        name: "Cliente S23",
        slug: `cliente-s23-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();

    const [project] = await db
      .insert(projects)
      .values({
        clientId: client!.id,
        name: "Projeto S23",
        slug: `proj-s23-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();

    const [deliverable] = await db
      .insert(deliverables)
      .values({
        projectId: project!.id,
        title: "Entrega SSE Resumível S23",
        status: "decision_pending",
      })
      .returning();
    deliverableId = deliverable!.id;

    const evidencePack = EvidencePackSchema.parse({
      deliverableId,
      branchName: "feat/demo-s23",
      baseBranch: "main",
      verifyAttempts: 1,
      verifyPassed: true,
      verifyChecks: [
        { name: "vitest", passed: true, durationMs: 20, summary: "4 passed" },
      ],
      testAuditPassed: true,
      testAuditViolationsCount: 0,
      diffSummary: {
        filesChanged: 2,
        diffBytes: 512,
        preview: "+export const ok = true;",
        fileDiffs: [
          {
            filePath: "src/ok.ts",
            category: "code",
            additions: 1,
            deletions: 0,
            hunkPreview: "@@ -0,0 +1 @@\n+export const ok = true;",
          },
          {
            filePath: "tests/ok.test.ts",
            category: "test",
            additions: 2,
            deletions: 0,
            hunkPreview:
              "@@ -0,0 +1,2 @@\n+test('ok', () => expect(true).toBe(true));",
          },
        ],
      },
      testCommandOutput: "[PASS] vitest (20ms): 4 passed",
      securitySummary: {
        scanId: null,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        scannersRun: ["native_secrets"],
        skippedScanners: [],
        gatePassed: true,
      },
      tokenSummary: {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCacheReadTokens: 0,
        estimatedCostUsd: 0.001,
      },
      verifierVerdict: "approved",
      verifierNotes: "Semantic diff validado via API real.",
      finalizeInfo: null,
    });

    await db.insert(decisions).values({
      deliverableId,
      mastraStepId: "stage_decision",
      decisionType: "pr_evidence_approve",
      summary: "Decisão S23 com Semantic Diff",
      payloadJson: { gate: "pr_evidence_approve", evidencePack },
      status: "pending",
    });

    const sameTs = new Date("2026-11-24T20:00:00.000Z");
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ];
    orderedEventIds = ids;

    await db.insert(executionEvents).values([
      {
        id: ids[2]!,
        deliverableId,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "tool_call",
        tokensInput: 0,
        tokensOutput: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: "0",
        payloadJson: ToolCallTracePayloadSchema.parse({
          phase: "result",
          toolName: "verify_runner",
          durationMs: 42,
          status: "ok",
          summary: "2 checks aprovados",
        }),
        createdAt: sameTs,
      },
      {
        id: ids[0]!,
        deliverableId,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "tool_call",
        tokensInput: 0,
        tokensOutput: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: "0",
        payloadJson: ToolCallTracePayloadSchema.parse({
          phase: "start",
          toolName: "audit:tests",
          targetPath: "tests/",
          status: "running",
        }),
        createdAt: sameTs,
      },
      {
        id: ids[1]!,
        deliverableId,
        stage: "stage_verify",
        actorRole: "verifier",
        eventType: "tool_call",
        tokensInput: 0,
        tokensOutput: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: "0",
        payloadJson: ToolCallTracePayloadSchema.parse({
          phase: "result",
          toolName: "audit:tests",
          durationMs: 7,
          status: "ok",
          summary: "5 testes auditados",
        }),
        createdAt: sameTs,
      },
    ]);
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("listDeliverableEventsScoped ordena deterministicamente, retoma via afterEventId e faz fallback se cursor não existir", async () => {
    const { db } = await getDb();
    const allEvents = await listDeliverableEventsScoped(db, deliverableId);
    expect(allEvents.map((e) => e.id)).toEqual(orderedEventIds);

    const afterFirst = await listDeliverableEventsScoped(db, deliverableId, {
      afterEventId: orderedEventIds[0],
    });
    expect(afterFirst.map((e) => e.id)).toEqual(orderedEventIds.slice(1));

    const afterLast = await listDeliverableEventsScoped(db, deliverableId, {
      afterEventId: orderedEventIds[2],
    });
    expect(afterLast).toEqual([]);

    const missingCursor = await listDeliverableEventsScoped(db, deliverableId, {
      afterEventId: crypto.randomUUID(),
    });
    expect(missingCursor.map((e) => e.id)).toEqual(orderedEventIds);
  });

  test("GET /api/deliverables/[id]/events parseia frames JSON, prioriza Last-Event-ID e bloqueia 401/400/404", async () => {
    const unauthRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true`
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(unauthRes.status).toBe(401);

    const invalidUuidRes = await getDeliverableEvents(
      new Request(
        "http://localhost:3000/api/deliverables/not-a-uuid/events?snapshot=true",
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(invalidUuidRes.status).toBe(400);

    const queryRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true&afterEventId=${orderedEventIds[0]}`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(queryRes.status).toBe(200);
    const queryFrames = parseSseFrames(await queryRes.text());
    const queryEventIds = queryFrames
      .filter((f) => f.event === "tool_call")
      .map((f) => ExecutionEventSchema.parse(f.data).id);
    expect(queryEventIds).toEqual(orderedEventIds.slice(1));
    expect(queryFrames.some((f) => f.event === "snapshot_end")).toBe(true);

    // Header Last-Event-ID prevalece sobre query afterEventId
    const headerRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true&afterEventId=${orderedEventIds[0]}`,
        {
          headers: {
            cookie: ownerCookie,
            "last-event-id": orderedEventIds[1]!,
          },
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(headerRes.status).toBe(200);
    const headerFrames = parseSseFrames(await headerRes.text());
    const headerEventIds = headerFrames
      .filter((f) => f.event === "tool_call")
      .map((f) => ExecutionEventSchema.parse(f.data).id);
    expect(headerEventIds).toEqual([orderedEventIds[2]]);

    const crossOrgRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true`,
        { headers: { cookie: otherOrgCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(crossOrgRes.status).toBe(404);
  });

  test("GET /api/decisions devolve evidencePack persistido com fileDiffs e testCommandOutput", async () => {
    const res = await getDecisions(
      new Request("http://localhost:3000/api/decisions?status=pending", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(res.status).toBe(200);
    const body = DecisionListResponseSchema.parse(await res.json());
    const found = body.items.find((d) => d.deliverableId === deliverableId);
    expect(found).not.toBeUndefined();

    const parsedPack = EvidencePackSchema.parse(found!.payloadJson.evidencePack);
    expect(parsedPack.diffSummary.fileDiffs?.map((f) => f.filePath)).toEqual([
      "src/ok.ts",
      "tests/ok.test.ts",
    ]);
    expect(parsedPack.testCommandOutput).toBe(
      "[PASS] vitest (20ms): 4 passed"
    );
  });
});
