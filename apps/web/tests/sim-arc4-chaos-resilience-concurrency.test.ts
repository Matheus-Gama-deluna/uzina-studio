import {
  closeDb,
  decisions,
  deliverables,
  executionEvents,
  getDb,
  projects,
  users,
} from "@uzina/db";
import { SymbolLockManager } from "@uzina/mastra-runtime";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getDeliverableEvents } from "../src/app/api/deliverables/[id]/events/route";
import { POST as abortDeliverableWorkflow } from "../src/app/api/deliverables/[id]/workflow/abort/route";
import { POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import { POST as createProject } from "../src/app/api/projects/route";
import { resetAuthForTests } from "../src/lib/auth";
import { getWebWorkflowRuntime } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function parseSseFrames(raw: string): Array<{
  id: string;
  event: string;
  data: Record<string, unknown>;
}> {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => {
      const lines = block.split("\n");
      const id =
        lines.find((l) => l.startsWith("id:"))?.slice(3).trim() ?? "";
      const event =
        lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "";
      const dataRaw =
        lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "{}";
      return {
        id,
        event,
        data: JSON.parse(dataRaw) as Record<string, unknown>,
      };
    });
}

describe("Simulação Arco 4 — Resiliência SSE, Abort em Voo, Budget Cap & AST Symbol Lock", () => {
  let ownerCookie = "";
  let organizationId = "";
  let clientId = "";
  let projectId = "";

  beforeAll(async () => {
    resetAuthForTests();
    await closeDb();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Chaos Owner",
          email: `arc4-chaos-${suffix}@uzina.studio`,
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    ownerCookie = cookieOf(signUpRes);

    const clientsRes = await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );
    expect(clientsRes.status).toBe(200);
    const clientsJson = (await clientsRes.json()) as {
      items: Array<{ id: string }>;
    };
    clientId = clientsJson.items[0]!.id;

    const { db } = await getDb();
    const [ownerRow] = await db
      .select()
      .from(users)
      .where(eq(users.email, `arc4-chaos-${suffix}@uzina.studio`));
    organizationId = ownerRow!.organizationId!;

    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          clientId,
          name: `Projeto Caos ${suffix}`,
          defaultDevelopmentStrategy: "domain_first",
        }),
      })
    );
    expect(projRes.status).toBe(201);
    const projJson = (await projRes.json()) as { id: string };
    projectId = projJson.id;
  });

  afterAll(async () => {
    resetAuthForTests();
    await closeDb();
  });

  test("retoma stream SSE via Last-Event-ID e afterEventId sem perder nem duplicar eventos", async () => {
    const delivRes = await createDeliverable(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/deliverables`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          body: JSON.stringify({
            title: "Entrega Reconexão SSE",
            hasUi: false,
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(delivRes.status).toBe(201);
    const delivId = ((await delivRes.json()) as { id: string }).id;

    const { db } = await getDb();
    const t0 = new Date("2026-11-26T18:00:00.000Z");
    const t1 = new Date("2026-11-26T18:00:01.000Z");
    const id1 = "00000000-0000-4000-8000-000000000101";
    const id2 = "00000000-0000-4000-8000-000000000102";
    const id3 = "00000000-0000-4000-8000-000000000103";

    await db.insert(executionEvents).values([
      {
        id: id1,
        deliverableId: delivId,
        stage: "discovery",
        actorRole: "discovery",
        eventType: "stage_change",
        payloadJson: { seq: 1 },
        createdAt: t0,
      },
      {
        id: id2,
        deliverableId: delivId,
        stage: "building",
        actorRole: "builder",
        eventType: "tool_call",
        payloadJson: { seq: 2 },
        createdAt: t0,
      },
      {
        id: id3,
        deliverableId: delivId,
        stage: "verifying",
        actorRole: "verifier",
        eventType: "stage_change",
        payloadJson: { seq: 3 },
        createdAt: t1,
      },
    ]);

    const resumeViaHeaderRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${delivId}/events?snapshot=true`,
        {
          headers: {
            cookie: ownerCookie,
            "last-event-id": id1,
          },
        }
      ),
      { params: Promise.resolve({ id: delivId }) }
    );
    expect(resumeViaHeaderRes.status).toBe(200);
    const frames = parseSseFrames(await resumeViaHeaderRes.text());
    const dataFrames = frames.filter((f) => f.event !== "snapshot_end");
    expect(dataFrames.map((f) => f.id)).toEqual([id2, id3]);

    const resumeViaQueryRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${delivId}/events?snapshot=true&afterEventId=${id2}`,
        {
          headers: { cookie: ownerCookie },
        }
      ),
      { params: Promise.resolve({ id: delivId }) }
    );
    expect(resumeViaQueryRes.status).toBe(200);
    const tailFrames = parseSseFrames(await resumeViaQueryRes.text()).filter(
      (f) => f.event !== "snapshot_end"
    );
    expect(tailFrames.map((f) => f.id)).toEqual([id3]);

    const invalidCursorRes = await getDeliverableEvents(
      new Request(
        `http://localhost:3000/api/deliverables/${delivId}/events?snapshot=true`,
        {
          headers: {
            cookie: ownerCookie,
            "last-event-id": "not-a-valid-uuid",
          },
        }
      ),
      { params: Promise.resolve({ id: delivId }) }
    );
    expect(invalidCursorRes.status).toBe(400);
  });

  test("abort em execução ativa transiciona entregável para paused e registra evento", async () => {
    const delivRes = await createDeliverable(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/deliverables`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          body: JSON.stringify({
            title: "Entrega Abortar em Voo",
            hasUi: false,
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(delivRes.status).toBe(201);
    const delivId = ((await delivRes.json()) as { id: string }).id;

    const { db } = await getDb();
    await db
      .update(deliverables)
      .set({ status: "building" })
      .where(eq(deliverables.id, delivId));

    const abortRes = await abortDeliverableWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${delivId}/workflow/abort`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          body: JSON.stringify({ reason: "Intervenção manual de QA" }),
        }
      ),
      { params: Promise.resolve({ id: delivId }) }
    );
    expect(abortRes.status).toBe(200);
    const abortJson = (await abortRes.json()) as {
      aborted: boolean;
      status: string;
    };
    expect(abortJson.aborted).toBe(true);
    expect(abortJson.status).toBe("paused");

    const [persisted] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, delivId));
    expect(persisted?.status).toBe("paused");
    expect(persisted?.pausedFromStatus).toBe("building");

    // Idempotência: novo abort sobre item já paused não falha nem altera pausedFromStatus
    const repeatAbortRes = await abortDeliverableWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${delivId}/workflow/abort`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          body: JSON.stringify({ reason: "Reenvio idempotente" }),
        }
      ),
      { params: Promise.resolve({ id: delivId }) }
    );
    expect(repeatAbortRes.status).toBe(200);
    const repeatJson = (await repeatAbortRes.json()) as {
      aborted: boolean;
      status: string;
    };
    expect(repeatJson.aborted).toBe(false);
    expect(repeatJson.status).toBe("paused");
  });

  test("budgetCapUsd baixo dispara pausa budget_cap_pause e exige revisão HITL", async () => {
    const { db } = await getDb();
    await db
      .update(projects)
      .set({ budgetCapUsd: "0.001000" })
      .where(eq(projects.id, projectId));

    const delivRes = await createDeliverable(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/deliverables`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ownerCookie,
          },
          body: JSON.stringify({
            title: "Entrega Estouro Budget Cap",
            hasUi: false,
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(delivRes.status).toBe(201);
    const delivId = ((await delivRes.json()) as { id: string }).id;

    // Simula consumo acumulado acima do teto ($0.005 > $0.001) e status pronto para stage_contract_and_tests
    await db.insert(executionEvents).values({
      deliverableId: delivId,
      stage: "discovery",
      actorRole: "discovery",
      eventType: "token_usage",
      tokensInput: 500,
      tokensOutput: 300,
      estimatedCostUsd: "0.005000",
      payloadJson: { provider: "google" },
    });
    await db
      .update(deliverables)
      .set({
        status: "visual_studio",
        specMarkdown: "# Spec resumida para teste de teto",
        blueprintJson: { strategy: "domain_first", tasks: ["t1"] },
      })
      .where(eq(deliverables.id, delivId));

    const runtimeSvc = await getWebWorkflowRuntime();
    const state = await runtimeSvc.startDeliverableWorkflow({
      deliverableId: delivId,
      organizationId,
      input: {
        overrideStrategy: "domain_first",
      },
    });

    expect(state.deliverableStatus).toBe("paused");
    expect(state.gate).toBe("budget_cap_pause");

    const gates = await db
      .select()
      .from(decisions)
      .where(eq(decisions.deliverableId, delivId));
    expect(
      gates.some(
        (g) => g.decisionType === "budget_cap_pause" && g.status === "pending"
      )
    ).toBe(true);

    // Restaura teto do projeto para não interferir em outros testes
    await db
      .update(projects)
      .set({ budgetCapUsd: null })
      .where(eq(projects.id, projectId));
  });

  test("SymbolLockManager enfileira entrega concorrente no mesmo símbolo até liberação", async () => {
    const lockManager = new SymbolLockManager();
    const targetProject = "proj-lock-sim";

    const firstAcquire = lockManager.tryAcquire({
      projectId: targetProject,
      deliverableId: "deliv-1",
      symbols: ["processPaymentCapture", "LedgerReconciler"],
    });
    expect(firstAcquire.acquired).toBe(true);

    const conflictingAttempt = lockManager.tryAcquire({
      projectId: targetProject,
      deliverableId: "deliv-2",
      symbols: ["LedgerReconciler"],
    });
    expect(conflictingAttempt.acquired).toBe(false);
    if (!conflictingAttempt.acquired) {
      expect(conflictingAttempt.conflictingSymbols).toEqual([
        "LedgerReconciler",
      ]);
      expect(conflictingAttempt.holdingDeliverableIds).toEqual(["deliv-1"]);
    }

    let waitedOnSymbols: string[] = [];
    const waitPromise = lockManager.acquireOrWait({
      projectId: targetProject,
      deliverableId: "deliv-2",
      symbols: ["LedgerReconciler"],
      onWaiting: (syms) => {
        waitedOnSymbols = syms;
      },
    });

    lockManager.release({
      projectId: targetProject,
      deliverableId: "deliv-1",
    });

    const secondAcquire = await waitPromise;
    expect(waitedOnSymbols).toEqual(["LedgerReconciler"]);
    expect(secondAcquire.acquired).toBe(true);
    expect(secondAcquire.lockedSymbols).toEqual(["LedgerReconciler"]);

    lockManager.release({
      projectId: targetProject,
      deliverableId: "deliv-2",
    });

    // AbortSignal cancela espera bloqueada por lock ativo
    const holder = lockManager.tryAcquire({
      projectId: targetProject,
      deliverableId: "deliv-holder",
      symbols: ["calculateFeeBasisPoints"],
    });
    expect(holder.acquired).toBe(true);
    const ac = new AbortController();
    const abortedWaitPromise = lockManager.acquireOrWait({
      projectId: targetProject,
      deliverableId: "deliv-aborted",
      symbols: ["calculateFeeBasisPoints"],
      signal: ac.signal,
    });
    ac.abort();
    const abortedRes = await abortedWaitPromise;
    expect(abortedRes.acquired).toBe(false);
    expect(abortedRes.aborted).toBe(true);
    lockManager.release({
      projectId: targetProject,
      deliverableId: "deliv-holder",
    });
  });
});
