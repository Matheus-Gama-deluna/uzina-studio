import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import {
  clients,
  closeDb,
  deliverables,
  designPrototypes,
  ensureDefaultOrgAndInternalClient,
  executionEvents,
  getDb,
  memoryChunks,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createMastraRuntime,
  formatDevelopmentStrategyLabel,
  generateVisualPrototypeHtmlWithLlm,
  handleAgencyChatScoped,
  listAgencyThreadsScoped,
  readPrototypePreviewHtmlScoped,
  readWorkspaceOverviewScoped,
  reindexWorkspaceQmd,
  resetAgentControllerForTests,
  resetMastraStorageForTests,
  searchQmdScoped,
} from "../src/index.js";

function createVisualAndChatMockModel(htmlText: string) {
  const usage = {
    inputTokens: 110,
    outputTokens: 64,
    totalTokens: 174,
  };
  return new MastraLanguageModelV2Mock({
    provider: "mock-visual-provider",
    modelId: "mock-v2-visual",
    doGenerate: async () => ({
      content: [{ type: "text", text: htmlText }],
      finishReason: "stop",
      usage,
      warnings: [],
      rawCall: { rawPrompt: null, rawSettings: {} },
      request: { body: {} },
      response: { headers: {} },
      stream: simulateReadableStream({ chunks: [] }),
    }),
    doStream: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      warnings: [],
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "response-metadata",
            id: "id-s21-vis",
            modelId: "mock-v2-visual",
            timestamp: new Date(0),
          },
          { type: "text-start", id: "txt-1" },
          {
            type: "text-delta",
            id: "txt-1",
            delta: "Protótipo revisado com foco operacional.",
          },
          { type: "text-end", id: "txt-1" },
          { type: "finish", finishReason: "stop", usage },
        ],
      }),
    }),
  });
}

describe("@uzina/mastra-runtime — Slice 21 (P1 Estúdio Visual LLM, QMD Isolado, Entregas Agnósticas, Co-piloto & Abortar)", () => {
  let db: UzinaDb;
  let organizationId: string;
  let userId: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetMastraStorageForTests();
    resetAgentControllerForTests();
    await closeDb();
    const ctx = await getDb({ dataDir: ":memory:" });
    db = ctx.db;
    const seeded = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seeded.organizationId;
    userId = seeded.ownerUserId;
  });

  afterAll(async () => {
    await resetMastraStorageForTests();
    resetAgentControllerForTests();
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each([
    ["frontend_first_msw", "Frontend-First + MSW"],
    ["api_contract_first", "API Contract-First"],
    ["domain_first", "Domain-First (DDD)"],
    ["characterization_strangler", "Characterization + Strangler"],
    ["spike_prototype", "Spike / Protótipo"],
    ["custom_strategy_x", "custom_strategy_x"],
  ])(
    "formatDevelopmentStrategyLabel(%s) retorna rótulo amigável (%s)",
    (input, expected) => {
      expect(formatDevelopmentStrategyLabel(input)).toBe(expected);
    }
  );

  test("Estúdio Visual usa LLM para gerar/revisar HTML específico do domínio, sanitiza XSS e redige segredos", async () => {
    const fakeSecret = "sk-or-v1-secret9876543210abcdef123456";
    const mockHtml = [
      "```html",
      `<main data-domain="logistica-frio" onload="alert('xss')">`,
      `  <header><h1>Painel TermoLog SLA</h1></header>`,
      `  <svg/onload=alert('svg')><iframe src="https://evil.example"></iframe></svg>`,
      `  <scr<script/>ipt>alert('nested')</script>`,
      `  <section><p>Monitoramento de câmara fria e entregas em rota (${fakeSecret}).</p></section>`,
      `  <script>fetch("https://evil.example")</script>`,
      `</main>`,
      "```",
    ].join("\n");

    const visualModel = createVisualAndChatMockModel(mockHtml);
    const llmResult = await generateVisualPrototypeHtmlWithLlm(db, {
      organizationId,
      projectName: "TermoLog Frio",
      summaryText: "Monitoramento térmico de frotas refrigeradas e SLA de entregas",
      strategyLabel: formatDevelopmentStrategyLabel("api_contract_first"),
      revisionFeedback: "Destacar temperatura máxima por câmara fria",
      modelOverride: visualModel,
      knownSecrets: [fakeSecret],
    });

    expect(llmResult.generatedByLlm).toBe(true);
    expect(llmResult.html).toContain("Painel TermoLog SLA");
    expect(llmResult.html).not.toContain("<script");
    expect(llmResult.html).not.toContain("<iframe");
    expect(llmResult.html).not.toContain("onload=");
    expect(llmResult.html).not.toContain("alert('nested')");
    expect(llmResult.html).not.toContain(fakeSecret);

    // Fallback seguro quando LLM retorna HTML inválido/curto (< 120 chars)
    const shortModel = createVisualAndChatMockModel("<p>curto</p>");
    const shortFallback = await generateVisualPrototypeHtmlWithLlm(db, {
      organizationId,
      projectName: "TermoLog Frio",
      summaryText: "Sistema logístico",
      strategyLabel: formatDevelopmentStrategyLabel("api_contract_first"),
      modelOverride: shortModel,
    });
    expect(shortFallback.generatedByLlm).toBe(false);
    expect(shortFallback.html).toContain("API Contract-First");

    const fallbackResult = await generateVisualPrototypeHtmlWithLlm(db, {
      organizationId,
      projectName: "TermoLog Frio",
      summaryText: "Sistema logístico",
      strategyLabel: formatDevelopmentStrategyLabel("api_contract_first"),
    });
    expect(fallbackResult.generatedByLlm).toBe(false);
    expect(fallbackResult.html).toContain("API Contract-First");
    expect(fallbackResult.html).not.toContain("api_contract_first");

    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Visual S21",
        slug: `cli-vis-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: "TermoLog S21",
        slug: `termolog-${crypto.randomUUID().slice(0, 6)}`,
        defaultDevelopmentStrategy: "api_contract_first",
        description: "Plataforma logística de cadeia fria.",
      })
      .returning();

    const chatRev = await handleAgencyChatScoped(db, {
      actor: { organizationId, userId, role: "owner" },
      modelOverride: visualModel,
      dataDir: ":memory:",
      request: {
        message: "Ajustar topo com card de alertas térmicos críticos",
        intent: "revise_visual_flow",
        projectId: proj!.id,
        teamTopology: "lean_mvp",
        autonomyMode: "semi_autonomous",
      },
    });
    expect(
      chatRev.actionsExecuted.some((a) => a.type === "generated_visual_prototype")
    ).toBe(true);

    const [savedProto] = await db
      .select()
      .from(designPrototypes)
      .where(eq(designPrototypes.projectId, proj!.id))
      .orderBy(desc(designPrototypes.createdAt))
      .limit(1);
    expect(savedProto?.title).toContain("Fluxo Visual Revisado");
    const persistedPreview = await readPrototypePreviewHtmlScoped(db, {
      organizationId,
      prototypeId: savedProto!.id,
      dataDir: ":memory:",
    });
    expect(persistedPreview.html).toContain("Painel TermoLog SLA");
    expect(persistedPreview.html).not.toContain("<script");
    expect(persistedPreview.html).not.toContain("onload=");
  });

  test("QMD isola markdown por projectId e impede vazamento de docs da plataforma quando allowDirectRootDocs=false", async () => {
    const suffix = crypto.randomUUID().slice(0, 6);
    const [cliA] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Tenant Alpha QMD",
        slug: `tenant-a-${suffix}`,
      })
      .returning();
    const [cliB] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Tenant Beta QMD",
        slug: `tenant-b-${suffix}`,
      })
      .returning();

    const [projA] = await db
      .insert(projects)
      .values({
        clientId: cliA!.id,
        name: "Projeto Alpha QMD",
        slug: `proj-a-${suffix}`,
      })
      .returning();
    const [projB] = await db
      .insert(projects)
      .values({
        clientId: cliB!.id,
        name: "Projeto Beta QMD",
        slug: `proj-b-${suffix}`,
      })
      .returning();

    const repoA = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s21-qmd-a-"));
    tempDirs.push(repoA);
    fs.writeFileSync(
      path.join(repoA, "README.md"),
      "# Alpha Core\n## Token Exclusivo\nIDENTIFICADOR_ALPHA_EXCLUSIVO_S21.\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(repoA, ".env"),
      "OPENAI_API_KEY=sk-proj-forbidden-leak\n",
      "utf8"
    );

    await db.insert(projectRepositories).values({
      projectId: projA!.id,
      name: "alpha-repo",
      localPath: repoA,
      defaultBranch: "main",
    });

    // Sem projectId e allowDirectRootDocs=false não deve indexar docs do monorepo hospedeiro
    const noLeakReindex = await reindexWorkspaceQmd(db, {
      organizationId,
      allowDirectRootDocs: false,
      request: { includeDocs: true, force: false, includePlatformDocs: false },
    });
    expect(noLeakReindex.indexedDocFiles).toBe(0);

    // Reindex escopado ao projeto A indexa apenas arquivos .md do repositório de A com scopeType="project"
    const projAReindex = await reindexWorkspaceQmd(db, {
      organizationId,
      allowDirectRootDocs: false,
      request: { includeDocs: true, force: true, projectId: projA!.id },
    });
    expect(projAReindex.indexedDocFiles).toBe(1);

    const alphaChunks = await db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.scopeId, projA!.id));
    expect(alphaChunks.length).toBeGreaterThanOrEqual(1);
    expect(alphaChunks.every((c) => c.scopeType === "project")).toBe(true);

    const searchA = await searchQmdScoped(db, {
      organizationId,
      request: {
        query: "IDENTIFICADOR_ALPHA_EXCLUSIVO_S21",
        mode: "lexical",
        projectId: projA!.id,
      },
    });
    expect(searchA.hits.length).toBeGreaterThanOrEqual(1);
    expect(searchA.hits[0]?.scopeId).toBe(projA!.id);

    const searchB = await searchQmdScoped(db, {
      organizationId,
      request: {
        query: "IDENTIFICADOR_ALPHA_EXCLUSIVO_S21",
        mode: "hybrid",
        projectId: projB!.id,
      },
    });
    expect(searchB.hits).toHaveLength(0);

    // Cross-org reindex falha com FORBIDDEN_PROJECT_SCOPE (404)
    await expect(
      reindexWorkspaceQmd(db, {
        organizationId: crypto.randomUUID(),
        allowDirectRootDocs: false,
        request: { includeDocs: true, force: false, projectId: projA!.id },
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "FORBIDDEN_PROJECT_SCOPE" });
  });

  test("Deliverables de projetos externos são agnósticos (sem boilerplate @uzina/*) e respeitam projeto headless CLI", async () => {
    const res = await handleAgencyChatScoped(db, {
      actor: { organizationId, userId, role: "owner" },
      request: {
        message: "Criar CLI headless de validação fiscal sem UI e apenas API",
        intent: "start_greenfield",
        projectName: "Fiscal Validator CLI",
        teamTopology: "lean_mvp",
        autonomyMode: "semi_autonomous",
      },
    });

    const createdProjId = res.projectState?.projectId;
    expect(createdProjId).toBeTypeOf("string");

    const delivs = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.projectId, createdProjId!));
    expect(delivs).toHaveLength(3);
    expect(delivs.every((d) => d.hasUi === false)).toBe(true);
    expect(delivs[2]?.developmentStrategy).toBe("api_contract_first");

    for (const d of delivs) {
      const spec = d.specMarkdown ?? "";
      const bp = JSON.stringify(d.blueprintJson ?? {});
      expect(spec).not.toContain("@uzina/");
      expect(spec).not.toContain("PGlite");
      expect(spec).not.toContain("ee/");
      expect(bp).not.toContain("@uzina/");
    }

    // Co-piloto Executivo retorna nomes reais dos projetos e clientes no escopo
    const overview = await readWorkspaceOverviewScoped(db, {
      organizationId,
      projectId: createdProjId!,
    });
    expect(overview.activeProject?.name).toBe("Fiscal Validator CLI");
    expect(overview.activeProject?.clientName).toBe("Internos");
    expect(overview.activeProject?.deliverablesCount).toBe(3);
    expect(overview.projects.some((p) => p.name === "Fiscal Validator CLI")).toBe(
      true
    );
  });

  test("abortDeliverableRun transiciona entrega ativa para paused e persiste histórico/metadados da thread", async () => {
    const [cli] = await db
      .insert(clients)
      .values({
        organizationId,
        name: "Cliente Abort S21",
        slug: `cli-abort-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: cli!.id,
        name: "Motor Fiscal Abort",
        slug: `proj-abort-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning();
    const [buildingDeliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        title: "Slice em Build Ativo",
        status: "building",
        hasUi: false,
      })
      .returning();

    const runtime = await createMastraRuntime({ db, dataDir: ":memory:" });
    const abortRes = await runtime.abortDeliverableRun({
      deliverableId: buildingDeliv!.id,
      organizationId,
      reason: "Teste de pausa manual no Slice 21",
    });

    expect(abortRes.aborted).toBe(true);
    expect(abortRes.status).toBe("paused");

    const [updatedDeliv] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, buildingDeliv!.id));
    expect(updatedDeliv?.status).toBe("paused");
    expect(updatedDeliv?.pausedFromStatus).toBe("building");

    const evs = await db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.deliverableId, buildingDeliv!.id));
    expect(
      evs.some(
        (e) =>
          e.eventType === "stage_change" &&
          e.stage === "paused" &&
          (e.payloadJson as Record<string, unknown> | null)?.eventKind === "aborted"
      )
    ).toBe(true);

    // Chat persistence com cycleNumber > 1 e targetAgentRole explícito
    await db
      .update(deliverables)
      .set({ blueprintJson: { cycleNumber: 2 } })
      .where(eq(deliverables.id, buildingDeliv!.id));

    const chatRes = await handleAgencyChatScoped(db, {
      actor: { organizationId, userId, role: "owner" },
      request: {
        message: "Validar resumo arquitetural do ciclo #2.",
        intent: "general_chat",
        projectId: proj!.id,
        targetAgentRole: "software_architect",
        teamTopology: "lean_mvp",
        autonomyMode: "semi_autonomous",
      },
    });
    expect(chatRes.cycleNumber).toBeGreaterThanOrEqual(2);
    expect(chatRes.activeAgent.role).toBe("software_architect");

    const threadsRes = await listAgencyThreadsScoped(db, {
      organizationId,
      projectId: proj!.id,
    });
    expect(threadsRes.activeThreadId).toBeTypeOf("string");
    expect(threadsRes.messages.length).toBeGreaterThanOrEqual(2);
    const lastMsg = threadsRes.messages[threadsRes.messages.length - 1]!;
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.cycleNumber).toBe(chatRes.cycleNumber);
    expect(lastMsg.agentRole).toBe("software_architect");
  });

  test.each([
    "merged" as const,
    "approved" as const,
    "failed" as const,
    "paused" as const,
    "decision_pending" as const,
  ])(
    "abortDeliverableRun NÃO sobrescreve entrega no estado terminal/protegido '%s'",
    async (protectedStatus) => {
      const [cli] = await db
        .insert(clients)
        .values({
          organizationId,
          name: `Cli ${protectedStatus}`,
          slug: `cli-${protectedStatus}-${crypto.randomUUID().slice(0, 6)}`,
        })
        .returning();
      const [proj] = await db
        .insert(projects)
        .values({
          clientId: cli!.id,
          name: `Proj ${protectedStatus}`,
          slug: `proj-${protectedStatus}-${crypto.randomUUID().slice(0, 6)}`,
        })
        .returning();
      const [deliv] = await db
        .insert(deliverables)
        .values({
          projectId: proj!.id,
          title: `Slice ${protectedStatus}`,
          status: protectedStatus,
          hasUi: false,
        })
        .returning();

      const runtime = await createMastraRuntime({ db, dataDir: ":memory:" });
      const res = await runtime.abortDeliverableRun({
        deliverableId: deliv!.id,
        organizationId,
      });

      expect(res.aborted).toBe(false);
      expect(res.status).toBe(protectedStatus);
      const [after] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, deliv!.id));
      expect(after?.status).toBe(protectedStatus);
      expect(after?.pausedFromStatus).toBeNull();
      const evs = await db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.deliverableId, deliv!.id));
      expect(evs).toHaveLength(0);
    }
  );
});
