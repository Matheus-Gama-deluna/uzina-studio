import { describe, expect, it } from "vitest";
import {
  AgencyChatRequestSchema,
  AgencyChatResponseSchema,
  AgencyOverviewResponseSchema,
  TestProviderConnectionRequestSchema,
  TestProviderConnectionResponseSchema,
} from "../src/index.js";

describe("Slice 12 Contracts — Onboarding, Agency Chat, Model Tiering & Artifacts", () => {
  it.each([
    {
      label: "mensagem Greenfield do zero com autonomia semi_autonomous",
      payload: {
        message:
          "Quero criar um SaaS de gestão logística com painel em tempo real e API de rastreamento.",
        intent: "start_greenfield",
        projectName: "LogiTrack Pro",
        autonomyMode: "semi_autonomous",
      },
      shouldPass: true,
    },
    {
      label: "importação Brownfield via URL Git HTTPS válida",
      payload: {
        message:
          "Importe nosso repositório existente e organize a refatoração para multi-tenant.",
        intent: "import_git_or_repo",
        projectName: "ERP Legado V2",
        gitUrl: "https://github.com/uzina-org/erp-legado.git",
        autonomyMode: "full_autonomous",
      },
      shouldPass: true,
    },
    {
      label: "revisão cíclica de artefato de slice com deliverableId",
      payload: {
        message:
          "Separe a autenticação em contrato dedicado e use API Contract-First.",
        intent: "request_slice_revision",
        projectId: "00000000-0000-4000-8000-000000000001",
        deliverableId: "00000000-0000-4000-8000-000000000002",
        targetAgentRole: "software_architect",
      },
      shouldPass: true,
    },
    {
      label: "aprovação de fluxo de prototipação visual com teamTopology lean_mvp",
      payload: {
        message: "O fluxo visual e as cores estão aprovados para codificação.",
        intent: "approve_visual_flow",
        projectId: "00000000-0000-4000-8000-000000000001",
        teamTopology: "lean_mvp",
      },
      shouldPass: true,
    },
    {
      label: "bloqueia URL Git apontando para IMDS 169.254.169.254 (SSRF)",
      payload: {
        message: "Importar repo interno",
        intent: "import_git_or_repo",
        gitUrl: "http://169.254.169.254/latest/meta-data",
      },
      shouldPass: false,
    },
    {
      label: "bloqueia campos desconhecidos (.strict())",
      payload: {
        message: "Avançar ciclo",
        unexpectedRootField: true,
      },
      shouldPass: false,
    },
  ])("valida AgencyChatRequestSchema: $label", ({ payload, shouldPass }) => {
    const parsed = AgencyChatRequestSchema.safeParse(payload);
    expect(parsed.success).toBe(shouldPass);
  });

  it("valida AgencyOverviewResponseSchema e AgencyChatResponseSchema com Model Tiering e Artefatos", () => {
    const readiness = {
      readinessPercent: 100,
      llmProviderConfigured: true,
      activeProvidersCount: 1,
      activeProviderNames: ["google"],
      embeddingMode: "onnx_e5_small" as const,
      astMode: "polyglot" as const,
      workspaceMode: "worktree" as const,
      autoInjectInRunner: true,
      clientsCount: 1,
      projectsCount: 1,
      deliverablesCount: 2,
      recommendedNextAction:
        "Sistema pronto. Converse com o Agente Responsável da fase ou inspecione os artefatos.",
      steps: [
        {
          id: "llm_vault" as const,
          title: "1. Conectar Cérebro LLM & Model Tiering (Cofre AES-256-GCM)",
          description: "Cadastre ao menos uma chave de provedor.",
          completed: true,
          requiredForFullAutonomy: true,
          statusBadge: "1 provedor ativo (google)",
          actionHref: "/app/providers",
          actionLabel: "Gerenciar Provedores",
        },
        {
          id: "context_engines" as const,
          title: "2. Motores de Memória QMD & AST Poliglota",
          description: "Configure embeddings e indexação AST sem restart.",
          completed: true,
          requiredForFullAutonomy: false,
          statusBadge: "onnx_e5_small · AST polyglot",
          actionHref: "/app/finops",
          actionLabel: "Ajustar Motores",
        },
        {
          id: "first_project_chat" as const,
          title: "3. Iniciar Projeto via Chat (Do Zero ou URL Git)",
          description: "Converse com o Agente de Descoberta ou Arquiteto.",
          completed: true,
          requiredForFullAutonomy: true,
          statusBadge: "1 projeto ativo",
          actionHref: "/app",
          actionLabel: "Abrir Chat de Projeto",
        },
      ],
    };

    const agent = {
      role: "software_architect" as const,
      name: "Agente Arquiteto & Codebase",
      title: "Staff Software Architect",
      responsibility:
        "Analisa repositórios Git, executa Brownfield Scan + AST Poliglota e define arquitetura em ciclos.",
      primaryPhases: [
        "architecture_brownfield" as const,
        "evolution_cycle" as const,
      ],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier3_deep_reasoning" as const,
      tierLabel: "Tier 3 · Raciocínio & Arquitetura (Pro)",
      boundModelId: "google/gemini-2.5-pro",
      artifactsOwned: ["Blueprint Arquitetural & ADRs", "Plano Técnico de Slices"],
    };

    const overview = AgencyOverviewResponseSchema.parse({
      readiness,
      agents: [agent],
      activeProjectState: null,
      allProjectStates: [],
    });
    expect(overview.agents[0]?.recommendedTier).toBe("tier3_deep_reasoning");

    const chatRes = AgencyChatResponseSchema.parse({
      activeAgent: agent,
      handedOffFrom: "tech_lead",
      lifecyclePhase: "evolution_cycle",
      cycleNumber: 2,
      autonomyMode: "semi_autonomous",
      reply:
        "Reavaliei a arquitetura no Ciclo #2 e atualizei o blueprint dos slices.",
      actionsExecuted: [
        {
          type: "cycled_back_to_architect",
          label: "Retorno cíclico ao Agente Arquiteto para o Ciclo #2",
        },
      ],
      projectState: null,
      readiness,
    });
    expect(chatRes.cycleNumber).toBe(2);
    expect(chatRes.handedOffFrom).toBe("tech_lead");
    expect(chatRes.executionMode).toBe("local_assisted");

    const pingReq = TestProviderConnectionRequestSchema.parse({
      providerType: "google",
      apiKey: "AIzaSyTestKey123456",
      modelId: "gemini-2.5-flash",
    });
    expect(pingReq.providerType).toBe("google");

    const pingRes = TestProviderConnectionResponseSchema.parse({
      ok: true,
      providerType: "google",
      modelId: "gemini-2.5-flash",
      latencyMs: 245,
      replyPreview: "OK · Uzina Studio conectado ao Google Gemini.",
      error: null,
    });
    expect(pingRes.ok).toBe(true);
  });
});
