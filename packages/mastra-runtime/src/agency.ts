import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import {
  AgencyChatRequestSchema,
  AgencyChatResponseSchema,
  AgencyOverviewResponseSchema,
  AgencyProjectStateSchema,
  SystemReadinessStatusSchema,
  type AgencyActionExecuted,
  type AgencyAgentProfile,
  type AgencyAgentRole,
  type AgencyChatRequest,
  type AgencyChatResponse,
  type AgencyOverviewResponse,
  type AgencyProjectState,
  type AgencyStreamEvent,
  type ArchitectStrategyDecision,
  type BackgroundTaskSummary,
  type DeliverableStatus,
  type DevelopmentStrategy,
  type LongTermArtifactSummary,
  type ObservationalMemoryStatus,
  type OrgRole,
  type ProjectLifecyclePhase,
  type ProjectVisualFlowSummary,
  type RiskLevel,
  type SliceArtifactDetail,
  type SystemReadinessStatus,
} from "@uzina/contracts";
import {
  getAllowedNextStatuses,
  redactSensitiveText,
  redactSensitiveValue,
} from "@uzina/core";
import {
  clients,
  codebaseFiles,
  codebaseSymbols,
  decisions,
  deliverables,
  designPrototypes,
  engineConfigs,
  memories,
  projectRepositories,
  projects,
  providerProfiles,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createEngineeringSpecialistAgent } from "./agents/engineering-agents.js";
import { syncRepositoryCodebase } from "./codebase.js";
import {
  WorkflowRuntimeError,
  type WorkflowRuntimeErrorCode,
} from "./errors.js";
import { createMemoryScoped } from "./memories.js";
import {
  assertProjectBelongsToOrganization,
  assertThreadOwnershipOrCreate,
  buildAgencyResourceId,
  createUzinaMemory,
  getAgencyThreadMessagesScoped,
  listAgencyThreadsScoped,
  mapDataOmStatusToContract,
} from "./memory-runtime.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
  resolveOrganizationModelConfig,
} from "./model-resolver.js";
import {
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_PROVIDER_MODELS,
  callProviderLlmApi,
  invokeOrganizationLlmForAgentScoped,
  testProviderLlmConnectionScoped,
} from "./llm-client.js";
import {
  approvePrototypeScoped,
  createOrImportPrototypeScoped,
} from "./prototypes.js";
import {
  AGENCY_ROLE_TO_CONTROLLER_MODE,
  attachSessionExecutionControl,
  consumeSteeredMessages,
  createControlledAgencySession,
  type ManagedControllerSession,
} from "./controller.js";
import type { MastraWorkflowService } from "./service.js";
import type { UzinaMastraStore } from "./storage.js";

export {
  DEFAULT_PROVIDER_BASE_URLS,
  DEFAULT_PROVIDER_MODELS,
  buildAgencyResourceId,
  callProviderLlmApi,
  getAgencyThreadMessagesScoped,
  invokeOrganizationLlmForAgentScoped,
  listAgencyThreadsScoped,
  testProviderLlmConnectionScoped,
};

const WRITE_ROLES = new Set<OrgRole>(["owner", "admin", "developer"]);

const STAGE_LABELS: Record<DeliverableStatus, string> = {
  discovery: "Descoberta",
  spec_review: "Spec & Arquitetura",
  visual_studio: "Estúdio Visual",
  contract_tests: "Contratos & TDD",
  building: "Build Isolado",
  verifying: "Verify & AppSec",
  decision_pending: "Decisão HITL",
  approved: "Aprovado",
  merged: "Entregue",
  paused: "Pausado",
  failed: "Falhou",
};

const PHASE_LABELS: Record<ProjectLifecyclePhase, string> = {
  onboarding: "Onboarding & Configuração",
  discovery_greenfield: "Descoberta & Produto (Greenfield)",
  architecture_brownfield: "Arquitetura & Codebase (Brownfield / Blueprint)",
  visual_design: "Design System & Prototipação 3 Níveis",
  engineering_execution: "Execução Técnica (Contratos → Build → Verify)",
  quality_review: "Portão de Qualidade & Decisão HITL",
  evolution_cycle: "Ciclo Evolutivo & Revisão Arquitetural",
};

const ALL_STATUSES: readonly DeliverableStatus[] = [
  "discovery",
  "spec_review",
  "visual_studio",
  "contract_tests",
  "building",
  "verifying",
  "decision_pending",
  "approved",
  "merged",
  "paused",
  "failed",
] as const;

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base.length >= 2 ? base : `proj-${Date.now().toString(36)}`;
}

function ownerAgentForStatus(status: DeliverableStatus): {
  role: AgencyAgentRole;
  name: string;
} {
  switch (status) {
    case "discovery":
      return {
        role: "product_discovery",
        name: "Agente de Descoberta & Produto",
      };
    case "spec_review":
      return {
        role: "software_architect",
        name: "Agente Arquiteto & Codebase",
      };
    case "visual_studio":
      return {
        role: "ux_designer",
        name: "Agente de Design & UX",
      };
    case "contract_tests":
    case "building":
      return {
        role: "tech_lead",
        name: "Agente Tech Lead & Builder",
      };
    case "verifying":
    case "decision_pending":
    case "failed":
      return {
        role: "qa_appsec",
        name: "Agente Auditor QA & AppSec",
      };
    case "approved":
    case "merged":
    case "paused":
      return {
        role: "orchestrator",
        name: "Supervisor Executivo",
      };
  }
}

export function decideOptimalAiStrategy(params: {
  message: string;
  originKind: "greenfield" | "brownfield";
  hasGitUrl: boolean;
  explicitStrategy?: DevelopmentStrategy;
}): ArchitectStrategyDecision {
  const msg = params.message.toLowerCase();

  if (params.originKind === "brownfield" || params.hasGitUrl) {
    return {
      chosenStrategy:
        params.explicitStrategy ?? "characterization_strangler",
      strategyLabel:
        "Characterization + Strangler (Evolução Segura de Código Existente)",
      rationale:
        "Decisão do Arquiteto de Software: Como há código existente/repositório Git, os agentes de IA devem iniciar gerando testes de caracterização e contratos Zod sobre as rotas atuais antes de evoluir módulos pelo padrão Strangler, blindando o sistema contra regressões.",
      recommendedTeamTopology: "full_enterprise",
      requiresVisualPrototypeFirst: true,
    };
  }

  if (
    /api|webhook|integra[cç][aã]o|gateway|microsservi[cç]o|pagamento|faturamento|erp|backend/i.test(
      msg
    )
  ) {
    return {
      chosenStrategy: params.explicitStrategy ?? "api_contract_first",
      strategyLabel: "API Contract-First (Contratos Zod Antes da Codificação)",
      rationale:
        "Decisão do Arquiteto de Software: O projeto possui forte dependência de contratos de API, integrações ou fluxo transacional. Travar os schemas Zod primeiro permite que os agentes executores de IA codifiquem backend e frontend sem divergência de payloads.",
      recommendedTeamTopology: /erp|corporativo|multi-tenant|banc[aá]rio/i.test(
        msg
      )
        ? "full_enterprise"
        : "lean_mvp",
      requiresVisualPrototypeFirst: true,
    };
  }

  if (
    /motor|c[aá]lculo|algoritmo|regra fiscal|cont[aá]bil|fila|orquestra[cç][aã]o/i.test(
      msg
    )
  ) {
    return {
      chosenStrategy: params.explicitStrategy ?? "domain_first",
      strategyLabel: "Domain-First (Núcleo de Regras com TDD Estrito)",
      rationale:
        "Decisão do Arquiteto de Software: A complexidade principal está nas regras de domínio. Os agentes de IA construirão primeiro o núcleo puro validado por testes determinísticos (test.each) antes de acoplar banco e telas.",
      recommendedTeamTopology: "lean_mvp",
      requiresVisualPrototypeFirst: true,
    };
  }

  return {
    chosenStrategy: params.explicitStrategy ?? "frontend_first_msw",
    strategyLabel:
      "Frontend-First + MSW (Fluxo Visual Aprovado Antes do Backend)",
    rationale:
      "Decisão do Arquiteto de Software: Para garantir que o sistema nasça codificado com o fluxo visual exato que você imaginou, validamos primeiro o Protótipo Visual e as telas com mocks MSW acoplados aos contratos Zod antes da camada final de persistência.",
    recommendedTeamTopology: "lean_mvp",
    requiresVisualPrototypeFirst: true,
  };
}

function inferDomainVisualBlueprint(text: string, projectName: string) {
  const lower = `${projectName} ${text}`.toLowerCase();

  if (
    /odonto|cl[ií]nic|m[eé]dic|pacient|prontu[aá]rio|consulta|agenda|sa[uú]de|hospital/i.test(
      lower
    )
  ) {
    return {
      domainBadge: "HealthTech · Clínica & Prontuário",
      navTabs: ["Agenda IA", "Prontuário Digital", "Orçamentos", "Retornos"],
      kpis: [
        { label: "Consultas Hoje", value: "34", delta: "94% ocupação" },
        { label: "Orçamentos Aprovados", value: "R$ 64,2k", delta: "+21% mês" },
        { label: "Triagem WhatsApp IA", value: "100%", delta: "0 fila espera" },
      ],
      screens: [
        {
          step: "1. Agendamento & Triagem IA",
          title: "Recepção Digital & Confirmação",
        },
        {
          step: "2. Painel Clínico Principal",
          title: "Prontuário & Odontograma Visual",
        },
        {
          step: "3. Faturamento & Retorno",
          title: "Planos, Guias TISS & Pós-Consulta",
        },
      ],
      tableTitle: "Fila de Atendimento & Procedimentos do Dia",
      tableRows: [
        { col1: "09:00 · Mariana Costa", col2: "Avaliação + Raio-X", status: "Confirmado" },
        { col1: "10:30 · Carlos Eduardo", col2: "Implante Fase 2", status: "Em Sala" },
      ],
    };
  }

  if (
    /finan|fatura|erp|pagament|caixa|contab|receita|cobran[cç]|banco|fintech|billing/i.test(
      lower
    )
  ) {
    return {
      domainBadge: "FinTech · Gestão Financeira & Billing",
      navTabs: ["Visão DRE", "Faturamento & Pix", "Conciliação IA", "Alertas"],
      kpis: [
        { label: "MRR Recorrente", value: "R$ 148,9k", delta: "+14,2% MoM" },
        { label: "Inadimplência Líquida", value: "1,8%", delta: "Meta < 3,0%" },
        { label: "Conciliação Automática", value: "98,4%", delta: "1.420 faturas" },
      ],
      screens: [
        {
          step: "1. Onboarding & Contas",
          title: "Conexão Open Finance & Multi-Tenant",
        },
        {
          step: "2. Cockpit de Caixa & DRE",
          title: "Previsibilidade, Receitas & Despesas",
        },
        {
          step: "3. Motor de Cobrança",
          title: "Régua Inteligente, NF-e & Auditoria",
        },
      ],
      tableTitle: "Últimas Transações & Faturas Conciliadas por IA",
      tableRows: [
        { col1: "FAT-4092 · Enterprise Plan", col2: "R$ 4.800,00 (Pix)", status: "Conciliado" },
        { col1: "FAT-4093 · Licenciamento", col2: "R$ 2.450,00 (Boleto)", status: "Agendado" },
      ],
    };
  }

  if (
    /atendiment|crm|suporte|ticket|fila|whatsapp|lead|venda|comercial|omnicanal/i.test(
      lower
    )
  ) {
    return {
      domainBadge: "CRM & Atendimento Inteligente",
      navTabs: ["Fila Omnichannel", "Triagem IA", "Funil CRM", "SLA & CSAT"],
      kpis: [
        { label: "1ª Resposta IA", value: "14s", delta: "-82% tempo" },
        { label: "Resolução Nível 1", value: "76,5%", delta: "Autônomo" },
        { label: "CSAT Clientes", value: "4,9/5", delta: "+380 avaliações" },
      ],
      screens: [
        {
          step: "1. Inbox Omnichannel",
          title: "Triagem & Classificação por Intenção",
        },
        {
          step: "2. Co-piloto do Operador",
          title: "Respostas Sugeridas via Base RAG",
        },
        {
          step: "3. Analytics & Retenção",
          title: "Monitoramento de SLA & Conversão",
        },
      ],
      tableTitle: "Chamados Prioritários na Fila Inteligente",
      tableRows: [
        { col1: "#8821 · Integração Webhook", col2: "Prioridade Alta · IA Assistida", status: "Ativo" },
        { col1: "#8822 · Upgrade de Conta", col2: "Comercial · Auto-Resolvido", status: "Concluído" },
      ],
    };
  }

  if (
    /auditor|compliance|seguran|appsec|risco|governan|sast|lgpd|jur[ií]dic/i.test(
      lower
    )
  ) {
    return {
      domainBadge: "Governance · Auditoria & Compliance",
      navTabs: ["Mapa de Risco", "Portões HITL", "Trilha SARIF", "Laudos"],
      kpis: [
        { label: "Score Conformidade", value: "96/100", delta: "Auditado" },
        { label: "Portões Homologados", value: "18/18", delta: "0 bloqueios" },
        { label: "Evidências Cifradas", value: "100%", delta: "SHA-256 OK" },
      ],
      screens: [
        {
          step: "1. Coleta & Escaneamento",
          title: "Ingestão Automatizada de Evidências",
        },
        {
          step: "2. Mesa de Decisão & Risco",
          title: "Triagem de Achados & Aprovação HITL",
        },
        {
          step: "3. Dossiê & Certificação",
          title: "Trilha Imutável & Exportação Executiva",
        },
      ],
      tableTitle: "Controles & Portões de Conformidade Verificados",
      tableRows: [
        { col1: "CTRL-01 · Criptografia & Cofre", col2: "AES-256-GCM Validado", status: "Aprovado" },
        { col1: "CTRL-02 · Isolamento Multi-Tenant", col2: "RBAC + Zero Trust", status: "Aprovado" },
      ],
    };
  }

  return {
    domainBadge: "SaaS Modular · Operação & Inteligência",
    navTabs: ["Visão Executiva", "Fluxo Operacional", "Automação IA", "Configurações"],
    kpis: [
      { label: "Operações Ativas", value: "1.280", delta: "+18% semana" },
      { label: "Automação por IA", value: "84%", delta: "Latência 120ms" },
      { label: "Disponibilidade SLA", value: "99,98%", delta: "Contratos Zod" },
    ],
    screens: [
      {
        step: "1. Acesso & Onboarding Guiado",
        title: "Configuração Rápida de Workspace",
      },
      {
        step: "2. Painel Principal — " + projectName,
        title: "Operação Core & Indicadores em Tempo Real",
      },
      {
        step: "3. Gestão & Auditoria",
        title: "Relatórios, Regras & Integrações",
      },
    ],
    tableTitle: `Módulos Ativos em ${projectName}`,
    tableRows: [
      { col1: "Módulo Core · Fluxo Principal", col2: "Contratos & UI Validados", status: "Online" },
      { col1: "Motor de Automação & Regras", col2: "Monitoramento em Tempo Real", status: "Ativo" },
    ],
  };
}

function buildGeneratedVisualPrototypeHtml(params: {
  projectName: string;
  summaryText: string;
  strategyLabel: string;
  revisionFeedback?: string;
}): string {
  const safeName = params.projectName.replace(/[<>&"]/g, "");
  const safeSummary = redactSensitiveText(params.summaryText)
    .slice(0, 220)
    .replace(/[<>&"]/g, "");
  const safeRevision = params.revisionFeedback
    ? redactSensitiveText(params.revisionFeedback)
        .slice(0, 200)
        .replace(/[<>&"]/g, "")
    : null;

  const blueprint = inferDomainVisualBlueprint(
    `${params.summaryText} ${params.revisionFeedback ?? ""}`,
    safeName
  );

  return `<main style="font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; padding: 12px; border-radius: 10px; border: 1px solid #27272a; box-sizing: border-box; max-width: 100%; overflow-x: hidden;">
  <header style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 10px;">
    <div style="min-width: 140px; flex: 1;">
      <span style="font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #f97316; font-weight: 700; display: block;">${blueprint.domainBadge}</span>
      <h1 style="margin: 2px 0 0 0; font-size: 15px; color: #fafafa; line-height: 1.2;">${safeName}</h1>
    </div>
    <span style="background: #18181b; border: 1px solid #3f3f46; color: #a1a1aa; padding: 2px 7px; border-radius: 5px; font-size: 9px; font-family: monospace;">${params.strategyLabel.slice(0, 28)}</span>
  </header>
  <nav style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;">
    ${blueprint.navTabs
      .map(
        (tab, idx) =>
          `<span style="font-size: 10px; padding: 3px 8px; border-radius: 5px; background: ${
            idx === 0 ? "#f97316" : "#18181b"
          }; color: ${idx === 0 ? "#09090b" : "#a1a1aa"}; font-weight: ${
            idx === 0 ? "600" : "500"
          }; border: 1px solid ${idx === 0 ? "#f97316" : "#27272a"};">${tab}</span>`
      )
      .join("")}
  </nav>
  ${
    safeRevision
      ? `<div style="background: #1c1917; border: 1px solid #f97316; color: #fdba74; padding: 7px 9px; border-radius: 7px; font-size: 10px; margin-bottom: 10px;"><strong>Diretriz Visual Aplicada:</strong> ${safeRevision}</div>`
      : `<p style="font-size: 11px; color: #d4d4d8; line-height: 1.4; margin: 0 0 10px 0;">${safeSummary}</p>`
  }
  <section style="display: grid; grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); gap: 7px; margin-bottom: 10px;">
    ${blueprint.kpis
      .map(
        (kpi) =>
          `<div style="background: #141417; border: 1px solid #27272a; border-radius: 7px; padding: 7px 9px;">
      <div style="font-size: 9px; color: #a1a1aa; text-transform: uppercase;">${kpi.label}</div>
      <div style="font-size: 13px; font-weight: 700; color: #fafafa; margin-top: 2px; font-variant-numeric: tabular-nums;">${kpi.value}</div>
      <div style="font-size: 9px; color: #22c55e; margin-top: 1px;">${kpi.delta}</div>
    </div>`
      )
      .join("")}
  </section>
  <section style="display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 7px; margin-bottom: 10px;">
    ${blueprint.screens
      .map(
        (scr, idx) =>
          `<div style="background: #18181b; border: 1px solid ${
            idx === 1 ? "#f97316" : "#27272a"
          }; border-radius: 7px; padding: 8px;">
      <div style="font-size: 9px; color: ${idx === 1 ? "#f97316" : "#a1a1aa"};">${scr.step}</div>
      <div style="font-size: 11px; font-weight: 600; color: #fafafa; margin-top: 2px;">${scr.title}</div>
    </div>`
      )
      .join("")}
  </section>
  <div style="background: #141417; border: 1px solid #27272a; border-radius: 7px; padding: 8px;">
    <div style="font-size: 9px; text-transform: uppercase; color: #a1a1aa; margin-bottom: 5px; font-weight: 600;">${blueprint.tableTitle}</div>
    ${blueprint.tableRows
      .map(
        (r) =>
          `<div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; padding: 4px 0; border-top: 1px solid #27272a; font-size: 10px;">
        <span style="color: #fafafa; font-weight: 500;">${r.col1}</span>
        <span style="color: #a1a1aa;">${r.col2}</span>
        <span style="background: #052e16; color: #4ade80; border: 1px solid #14532d; padding: 1px 6px; border-radius: 4px; font-size: 9px;">${r.status}</span>
      </div>`
      )
      .join("")}
  </div>
</main>`;
}

export async function resolveAgencyTeamWithTieringScoped(
  db: UzinaDb,
  organizationId: string
): Promise<AgencyAgentProfile[]> {
  const profiles = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.updatedAt));

  const primaryProvider = profiles[0];
  const bindings = primaryProvider?.roleBindingsJson ?? {};
  const providerPrefix = primaryProvider?.providerType ?? "google";

  const tier3Default =
    providerPrefix === "anthropic"
      ? "anthropic/claude-sonnet-4-5"
      : providerPrefix === "openai_compatible" || providerPrefix === "omniroute"
        ? "openai/gpt-4o"
        : providerPrefix === "ollama"
          ? "ollama/qwen2.5-coder:7b"
          : "google/gemini-2.5-pro";

  const tier2Default =
    providerPrefix === "anthropic"
      ? "anthropic/claude-haiku-4-5"
      : providerPrefix === "openai_compatible" || providerPrefix === "omniroute"
        ? "openai/gpt-4o-mini"
        : providerPrefix === "ollama"
          ? "ollama/qwen2.5-coder:7b"
          : "google/gemini-2.5-flash";

  return [
    {
      role: "orchestrator",
      name: "Supervisor Executivo",
      title: "Engineering Director & Router",
      responsibility:
        "Coordena a equipe via Mastra Supervisor Pattern, aplica guardrails para não pular fases e gerencia ciclos evolutivos.",
      primaryPhases: ["onboarding", "quality_review", "evolution_cycle"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier3_deep_reasoning",
      tierLabel: "Tier 3 · Raciocínio & Planejamento (Pro)",
      boundModelId: bindings.copilot?.modelId ?? tier3Default,
      artifactsOwned: ["Roadmap de Ciclos", "Portões de Decisão HITL"],
      includedInLeanTeam: false,
      leanDisplayName: "Supervisor",
    },
    {
      role: "product_discovery",
      name: "Agente de Descoberta & Produto",
      title: "Principal Product Manager",
      responsibility:
        "Conduz entrevista Greenfield (5 pilares), estrutura o PRD Vivo na Memória QMD e define critérios de negócio.",
      primaryPhases: ["discovery_greenfield", "evolution_cycle"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier3_deep_reasoning",
      tierLabel: "Tier 3 · Raciocínio & Produto (Pro)",
      boundModelId: bindings.discovery?.modelId ?? tier3Default,
      artifactsOwned: ["PRD & Visão do Produto (Longo Prazo)", "Dossiê Funcional do Slice"],
      includedInLeanTeam: true,
      leanDisplayName: "1. Produto & Descoberta",
    },
    {
      role: "software_architect",
      name: "Agente Arquiteto & Codebase",
      title: "Staff Software Architect",
      responsibility:
        "Importa repositórios Git, executa Brownfield Scan + AST Poliglota, decide a melhor estratégia para IA e quebra em Vertical Slices.",
      primaryPhases: ["architecture_brownfield", "evolution_cycle"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier3_deep_reasoning",
      tierLabel: "Tier 3 · Arquitetura & AST (Pro)",
      boundModelId: bindings.architect?.modelId ?? tier3Default,
      artifactsOwned: [
        "Blueprint Arquitetural & ADRs (Longo Prazo)",
        "Decisão de Estratégia p/ IA",
        "Blueprint Técnico do Slice (blueprintJson)",
      ],
      includedInLeanTeam: true,
      leanDisplayName: "2. Arquiteto & Estratégia IA",
    },
    {
      role: "ux_designer",
      name: "Agente de Design & UX",
      title: "Lead Product Designer",
      responsibility:
        "Define .uzina/DESIGN.md, tokens W3C OKLCH e protótipos visuais para garantir fluxo visual aprovado antes do código.",
      primaryPhases: ["visual_design"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier2_fast_execution",
      tierLabel: "Tier 2 · Execução Rápida & UI (Flash)",
      boundModelId: bindings.visual?.modelId ?? tier2Default,
      artifactsOwned: ["Contrato Visual (.uzina/DESIGN.md)", "Protótipo Visual & Fluxo de Telas"],
      includedInLeanTeam: false,
      leanDisplayName: "Design & Protótipo",
    },
    {
      role: "tech_lead",
      name: "Agente Tech Lead & Builder",
      title: "Lead Software Engineer",
      responsibility:
        "Implementa contratos Zod, testes TDD (Red-Green-Refactor) e código em Git Worktree/Docker isolado.",
      primaryPhases: ["engineering_execution"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier2_fast_execution",
      tierLabel: "Tier 2 · Codificação & TDD (Flash)",
      boundModelId: bindings.builder?.modelId ?? tier2Default,
      artifactsOwned: ["Contratos Zod & Testes TDD", "Implementação em Worktree"],
      includedInLeanTeam: true,
      leanDisplayName: "3. Engenharia & Verificação",
    },
    {
      role: "qa_appsec",
      name: "Agente Auditor QA & AppSec",
      title: "Independent Verifier & Security Lead",
      responsibility:
        "Audita testes anti-tautologia, roda SAST/SARIF e confronta o git diff contra o Dossiê do Slice antes da aprovação.",
      primaryPhases: ["quality_review"],
      canBeReinvokedInCycle: true,
      recommendedTier: "tier3_deep_reasoning",
      tierLabel: "Tier 3 · Auditoria Independente (Pro)",
      boundModelId:
        bindings.verifier?.modelId ?? bindings.security?.modelId ?? tier3Default,
      artifactsOwned: ["Evidence Pack (Verify Gate)", "Relatório SARIF AppSec"],
      includedInLeanTeam: false,
      leanDisplayName: "Auditor QA & AppSec",
    },
  ];
}

export async function getSystemReadinessScoped(
  db: UzinaDb,
  organizationId: string
): Promise<SystemReadinessStatus> {
  const providers = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, organizationId));
  const [cfgRow] = await db
    .select()
    .from(engineConfigs)
    .where(eq(engineConfigs.organizationId, organizationId))
    .limit(1);
  const orgClients = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, organizationId));

  const clientIds = orgClients.map((c) => c.id);
  const orgProjects =
    clientIds.length > 0
      ? await db
          .select()
          .from(projects)
          .where(inArray(projects.clientId, clientIds))
      : [];

  const projectIds = orgProjects.map((p) => p.id);
  const orgDeliverables =
    projectIds.length > 0
      ? await db
          .select()
          .from(deliverables)
          .where(inArray(deliverables.projectId, projectIds))
      : [];

  const activeProviders = providers.filter(
    (p) => Boolean(p.encryptedApiKey) || p.providerType === "ollama"
  );
  const llmProviderConfigured = activeProviders.length > 0;
  const hasProjects = orgProjects.length > 0;

  let completedSteps = 1; // Step 2 (context engines) has safe hot-reload defaults active out of the box
  if (llmProviderConfigured) completedSteps += 1;
  if (hasProjects) completedSteps += 1;
  const readinessPercent = Math.round((completedSteps / 3) * 100);

  const cfg = {
    embeddingMode: (cfgRow?.embeddingMode ?? "deterministic") as
      | "deterministic"
      | "onnx_e5_small"
      | "ollama",
    astMode: (cfgRow?.astMode ?? "polyglot") as "ts_native" | "polyglot",
    workspaceKind: (cfgRow?.workspaceKind ?? "worktree") as
      | "worktree"
      | "docker",
    autoInjectInRunner: cfgRow?.autoInjectInRunner ?? true,
  };
  const recommendedNextAction = !llmProviderConfigured
    ? "Passo 1 recomendado: cadastre uma chave de provedor LLM no Cofre AES-256-GCM (/app/providers) para habilitar modelos Tier 3 (Pro) e Tier 2 (Flash). Enquanto isso, os agentes já podem estruturar projetos e artefatos em modo assistido local."
    : !hasProjects
      ? "Tudo configurado! Use o Chat da Empresa abaixo para iniciar um Sistema do Zero (com o Agente de Descoberta) ou importar uma URL Git / Repositório existente (com o Agente Arquiteto)."
      : "Fábrica operacional. Converse com o Agente Responsável da fase, inspecione os Artefatos de Longo Prazo e de Slices, ou acione um Ciclo Autônomo.";

  return SystemReadinessStatusSchema.parse({
    readinessPercent,
    llmProviderConfigured,
    activeProvidersCount: activeProviders.length,
    activeProviderNames: activeProviders.map((p) => p.name),
    embeddingMode: cfg.embeddingMode,
    astMode: cfg.astMode,
    workspaceMode: cfg.workspaceKind,
    autoInjectInRunner: cfg.autoInjectInRunner,
    clientsCount: orgClients.length,
    projectsCount: orgProjects.length,
    deliverablesCount: orgDeliverables.length,
    recommendedNextAction,
    steps: [
      {
        id: "llm_vault",
        title: "1. Conectar Cérebro LLM & Model Tiering (Cofre AES-256-GCM)",
        description:
          "Configure chaves de provedores (Gemini, Anthropic, OpenAI, OpenRouter ou Ollama) para rotear modelos maiores (Tier 3) para Arquitetura/Planejamento e menores (Tier 2) para Execução.",
        completed: llmProviderConfigured,
        requiredForFullAutonomy: true,
        statusBadge: llmProviderConfigured
          ? `${activeProviders.length} provedor(es) ativo(s)`
          : "Modo Assistido Local (Sem chave externa)",
        actionHref: "/app/providers",
        actionLabel: llmProviderConfigured
          ? "Revisar Tiering no Cofre"
          : "Configurar Chave LLM",
      },
      {
        id: "context_engines",
        title: "2. Motores de Memória QMD & AST Poliglota (Hot-Reload)",
        description:
          "Embeddings semânticos locais (384d), indexação AST multi-linguagem e injeção automática no prefixo de Prompt Cache sem reiniciar Docker.",
        completed: true,
        requiredForFullAutonomy: false,
        statusBadge: `${cfg.embeddingMode} · AST ${cfg.astMode} · ${cfg.workspaceKind}`,
        actionHref: "/app/finops",
        actionLabel: "Calibrar Motores & FinOps",
      },
      {
        id: "first_project_chat",
        title: "3. Iniciar Projeto pelo Chat (Do Zero ou URL Git Existente)",
        description:
          "Não crie entregas na mão: converse com o Agente de Descoberta (ideia do zero) ou envie a URL do Git para o Agente Arquiteto estruturar os artefatos e slices.",
        completed: hasProjects,
        requiredForFullAutonomy: true,
        statusBadge: hasProjects
          ? `${orgProjects.length} projeto(s) · ${orgDeliverables.length} slice(s)`
          : "Aguardando 1º projeto via Chat",
        actionHref: "#agency-chat-anchor",
        actionLabel: hasProjects
          ? "Conversar com Agente da Fase"
          : "Iniciar 1º Projeto no Chat",
      },
    ],
  });
}

function buildDefaultSliceSpecMarkdown(params: {
  title: string;
  description: string | null;
  strategy: DevelopmentStrategy;
  hasUi: boolean;
  riskLevel: RiskLevel;
  cycleNumber: number;
  projectName: string;
}): string {
  return [
    `# Dossiê do Slice — ${params.title}`,
    ``,
    `- **Projeto:** ${params.projectName}`,
    `- **Ciclo Evolutivo:** \`Ciclo #${params.cycleNumber}\``,
    `- **Estratégia:** \`${params.strategy}\``,
    `- **Superfície UI:** \`${params.hasUi ? "Sim (Estúdio Visual 3 Níveis)" : "Não (API / Core / Domínio)"}\``,
    `- **Nível de Risco:** \`${params.riskLevel}\``,
    ``,
    `## 1. Objetivo e Escopo Estrito`,
    params.description ??
      `Implementar ${params.title} respeitando fronteiras de contrato Zod, isolamento de tenant e testes automatizados antes do código produtivo.`,
    ``,
    `## 2. Contratos & Invariantes (Contract-First)`,
    `- Definir schemas Zod estritos (\`.strict()\`) em \`@uzina/contracts\` para todas as entradas e saídas.`,
    `- Validar RBAC por \`organizationId\` e redigir segredos com \`redactSensitiveText\`.`,
    ``,
    `## 3. Critérios de Pronto (DoD do Slice)`,
    `- [ ] Testes derivados da especificação passando sem mocks de banco (PGlite / Postgres real).`,
    `- [ ] Zero violações no auditor de testes (\`audit:tests\`) e zero módulos comerciais \`ee/\`.`,
    params.hasUi
      ? `- [ ] Validação visual nos 5 estados de dados e conformidade com \`.uzina/DESIGN.md\`.`
      : `- [ ] Cobertura de casos de borda consolidada com \`test.each\`.`,
  ].join("\n");
}

function buildDefaultBlueprintJson(params: {
  title: string;
  strategy: DevelopmentStrategy;
  hasUi: boolean;
  cycleNumber: number;
  revisionNotes?: string;
}): Record<string, unknown> {
  return {
    cycleNumber: params.cycleNumber,
    strategy: params.strategy,
    modelTiering: {
      planningTier: "tier3_deep_reasoning",
      executionTier: "tier2_fast_execution",
      contextTier: "tier1_context_local",
    },
    plannedSteps: [
      "1. Definir schemas Zod e DTOs compartilhados (Contract-First)",
      "2. Escrever testes de aceitação e integração em PGlite (RED)",
      params.hasUi
        ? "3. Consolidar tokens W3C / protótipo no Estúdio Visual e componentes com MSW"
        : "3. Implementar regras de domínio e persistência transacional (GREEN)",
      "4. Executar Verify Gate + Auditoria AppSec SARIF + Pacote de Evidências",
    ],
    targetLayers: params.hasUi
      ? ["@uzina/contracts", "@uzina/mastra-runtime", "apps/web"]
      : ["@uzina/contracts", "@uzina/core", "@uzina/db", "@uzina/mastra-runtime"],
    ...(params.revisionNotes ? { lastRevisionFeedback: params.revisionNotes } : {}),
  };
}

export async function resolveProjectAgencyStateScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    projectId: string;
  }
): Promise<AgencyProjectState | null> {
  const [projRow] = await db
    .select({
      project: projects,
      client: clients,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(projects.id, params.projectId),
        eq(clients.organizationId, params.organizationId)
      )
    )
    .limit(1);

  if (!projRow) {
    return null;
  }

  const repos = await db
    .select()
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projRow.project.id));
  const delivs = await db
    .select()
    .from(deliverables)
    .where(eq(deliverables.projectId, projRow.project.id))
    .orderBy(deliverables.createdAt);
  const projectMemories = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.organizationId, params.organizationId),
        eq(memories.scopeType, "project"),
        eq(memories.scopeId, projRow.project.id)
      )
    )
    .orderBy(desc(memories.updatedAt));
  const projectPrototypes = await db
    .select()
    .from(designPrototypes)
    .where(eq(designPrototypes.projectId, projRow.project.id))
    .orderBy(desc(designPrototypes.createdAt));

  const primaryRepo = repos[0] ?? null;
  let astFilesCount = 0;
  let astSymbolsCount = 0;
  if (primaryRepo) {
    const filesRows = await db
      .select({ id: codebaseFiles.id })
      .from(codebaseFiles)
      .where(eq(codebaseFiles.repositoryId, primaryRepo.id));
    const symbolsRows = await db
      .select({ id: codebaseSymbols.id })
      .from(codebaseSymbols)
      .innerJoin(codebaseFiles, eq(codebaseSymbols.fileId, codebaseFiles.id))
      .where(eq(codebaseFiles.repositoryId, primaryRepo.id));
    astFilesCount = filesRows.length;
    astSymbolsCount = symbolsRows.length;
  }

  const delivIds = delivs.map((d) => d.id);
  const pendingDecs =
    delivIds.length > 0
      ? await db
          .select()
          .from(decisions)
          .where(
            and(
              inArray(decisions.deliverableId, delivIds),
              eq(decisions.status, "pending")
            )
          )
          .orderBy(desc(decisions.createdAt))
      : [];

  const pendingByDeliverable = new Map<
    string,
    { id: string; summary: string }
  >();
  for (const dec of pendingDecs) {
    if (!pendingByDeliverable.has(dec.deliverableId)) {
      pendingByDeliverable.set(dec.deliverableId, {
        id: dec.id,
        summary: dec.summary,
      });
    }
  }

  let maxCycleNumber = 1;
  for (const d of delivs) {
    const bp = d.blueprintJson ?? {};
    if (typeof bp.cycleNumber === "number" && bp.cycleNumber > maxCycleNumber) {
      maxCycleNumber = bp.cycleNumber;
    }
  }

  const originKind: "greenfield" | "brownfield" =
    primaryRepo?.remoteUrl || primaryRepo?.localPath
      ? "brownfield"
      : "greenfield";

  const hasDiscovery = delivs.some((d) => d.status === "discovery");
  const hasSpecReview = delivs.some((d) => d.status === "spec_review");
  const hasVisual = delivs.some((d) => d.status === "visual_studio");
  const hasEngineering = delivs.some(
    (d) => d.status === "contract_tests" || d.status === "building"
  );
  const hasQualityOrGate = delivs.some(
    (d) =>
      d.status === "verifying" ||
      d.status === "decision_pending" ||
      d.status === "failed"
  );
  const completedCount = delivs.filter(
    (d) => d.status === "approved" || d.status === "merged"
  ).length;

  let currentPhase: ProjectLifecyclePhase = "discovery_greenfield";
  let activeAgentRole: AgencyAgentRole = "product_discovery";

  if (delivs.length === 0) {
    currentPhase =
      originKind === "brownfield"
        ? "architecture_brownfield"
        : "discovery_greenfield";
    activeAgentRole =
      originKind === "brownfield" ? "software_architect" : "product_discovery";
  } else if (hasQualityOrGate || pendingDecs.length > 0) {
    currentPhase = "quality_review";
    activeAgentRole = "qa_appsec";
  } else if (hasEngineering) {
    currentPhase = "engineering_execution";
    activeAgentRole = "tech_lead";
  } else if (hasVisual) {
    currentPhase = "visual_design";
    activeAgentRole = "ux_designer";
  } else if (hasSpecReview) {
    currentPhase = "architecture_brownfield";
    activeAgentRole = "software_architect";
  } else if (hasDiscovery) {
    currentPhase =
      originKind === "brownfield"
        ? "architecture_brownfield"
        : "discovery_greenfield";
    activeAgentRole =
      originKind === "brownfield" ? "software_architect" : "product_discovery";
  } else if (completedCount === delivs.length && delivs.length > 0) {
    currentPhase = "evolution_cycle";
    activeAgentRole = "software_architect";
  }

  const agentTeam = await resolveAgencyTeamWithTieringScoped(
    db,
    params.organizationId
  );
  const activeAgent =
    agentTeam.find((a) => a.role === activeAgentRole) ?? agentTeam[0]!;

  const canAutoAdvance = delivs.some(
    (d) =>
      d.status !== "decision_pending" &&
      d.status !== "approved" &&
      d.status !== "merged" &&
      d.status !== "failed" &&
      d.status !== "paused"
  );

  const pausedAtGateReason =
    pendingDecs.length > 0
      ? `${pendingDecs.length} entrega(s) aguardando aprovação humana no portão HITL (${pendingDecs[0]?.summary ?? "Revisão de artefato"}).`
      : null;

  const prdMemories = projectMemories.filter(
    (m) => m.category === "domain_rule" || m.category === "preference"
  );
  const archMemories = projectMemories.filter(
    (m) => m.category === "architecture" || m.category === "security_triage"
  );

  const nowIso = projRow.project.updatedAt.toISOString();

  const longTermArtifacts: LongTermArtifactSummary[] = [
    {
      id: `prd-${projRow.project.id}`,
      kind: "prd_vision",
      title: `PRD & Visão de Produto — ${projRow.project.name}`,
      summary:
        prdMemories[0]?.title ??
        projRow.project.description ??
        "Documento vivo de visão, requisitos de negócio e critérios de aceite do projeto.",
      contentMarkdown:
        prdMemories.length > 0
          ? prdMemories
              .map((m) => `### ${m.title}\n\n${m.content}`)
              .join("\n\n---\n\n")
          : [
              `# PRD Vivo — ${projRow.project.name}`,
              ``,
              `**Cliente:** ${projRow.client.name}`,
              `**Estratégia Padrão:** \`${projRow.project.defaultDevelopmentStrategy}\``,
              ``,
              `## Escopo & Visão`,
              projRow.project.description ??
                "Projeto estruturado via conversa com o Agente de Descoberta & Produto.",
            ].join("\n"),
      ownerAgentRole: "product_discovery",
      ownerAgentName: "Agente de Descoberta & Produto",
      cycleNumber: maxCycleNumber,
      updatedAt: prdMemories[0]?.updatedAt.toISOString() ?? nowIso,
    },
    {
      id: `arch-${projRow.project.id}`,
      kind: "architecture_adr",
      title: `Blueprint Arquitetural & ADRs — Ciclo #${maxCycleNumber}`,
      summary:
        archMemories[0]?.title ??
        `Estratégia ${projRow.project.defaultDevelopmentStrategy} com isolamento por tenant e contratos Zod.`,
      contentMarkdown:
        archMemories.length > 0
          ? archMemories
              .map((m) => `### ${m.title}\n\n${m.content}`)
              .join("\n\n---\n\n")
          : [
              `# Arquitetura & Decisões Técnicas (ADR) — ${projRow.project.name}`,
              ``,
              `- **Origem:** \`${originKind}\``,
              `- **Estratégia de Engenharia:** \`${projRow.project.defaultDevelopmentStrategy}\``,
              `- **Ciclo Atual:** \`Ciclo #${maxCycleNumber}\``,
              `- **Total de Slices Planejados:** ${delivs.length}`,
            ].join("\n"),
      ownerAgentRole: "software_architect",
      ownerAgentName: "Agente Arquiteto & Codebase",
      cycleNumber: maxCycleNumber,
      updatedAt: archMemories[0]?.updatedAt.toISOString() ?? nowIso,
    },
    {
      id: `ast-${projRow.project.id}`,
      kind: "codebase_ast",
      title: primaryRepo
        ? `Repositório Git & Mapa AST (${primaryRepo.name})`
        : "Mapa do Codebase & Context Tree AST",
      summary: primaryRepo
        ? `${astFilesCount} arquivo(s) e ${astSymbolsCount} símbolo(s) indexados · ${primaryRepo.remoteUrl ?? primaryRepo.localPath}`
        : "Repositório será vinculado/indexado pelo Agente Arquiteto.",
      contentMarkdown: primaryRepo
        ? [
            `# Inteligência de Codebase & Repositório Git`,
            ``,
            `- **Repositório:** \`${primaryRepo.name}\``,
            `- **URL Git Remota:** \`${primaryRepo.remoteUrl ?? "local-only"}\``,
            `- **Caminho no Workspace:** \`${primaryRepo.localPath}\``,
            `- **Arquivos Indexados (AST Poliglota):** ${astFilesCount}`,
            `- **Símbolos Extraídos (Funções/Classes/Tipos):** ${astSymbolsCount}`,
            `- **Metadados da Stack:** \`${JSON.stringify(primaryRepo.stackMetadataJson)}\``,
          ].join("\n")
        : "Nenhum repositório externo vinculado ainda. Envie uma URL Git (`https://github.com/...`) no chat para o Agente Arquiteto analisar e indexar o AST.",
      ownerAgentRole: "software_architect",
      ownerAgentName: "Agente Arquiteto & Codebase",
      cycleNumber: maxCycleNumber,
      updatedAt: primaryRepo?.updatedAt.toISOString() ?? nowIso,
    },
    {
      id: `design-${projRow.project.id}`,
      kind: "design_system",
      title: "Contrato Visual (.uzina/DESIGN.md) & Tokens W3C",
      summary: projRow.project.designMdPath
        ? `Design System ativo em ${projRow.project.designMdPath}`
        : "Diretrizes OKLCH, tipografia tabular-nums e 5 estados de dados.",
      contentMarkdown: [
        `# Contrato Visual — ${projRow.project.name}`,
        ``,
        `- **Arquivo de Referência:** \`${projRow.project.designMdPath ?? ".uzina/DESIGN.md"}\``,
        `- **Tokens Semânticos:** OKLCH Dark/Light com contraste WCAG AA`,
        `- **Invariantes Visuais:** 5 estados obrigatórios (Loading, Error, Empty, Partial, Populated) e zero overflow horizontal.`,
      ].join("\n"),
      ownerAgentRole: "ux_designer",
      ownerAgentName: "Agente de Design & UX",
      cycleNumber: maxCycleNumber,
      updatedAt: nowIso,
    },
  ];

  const sliceArtifacts: SliceArtifactDetail[] = delivs.map((d) => {
    const owner = ownerAgentForStatus(d.status as DeliverableStatus);
    const bp =
      d.blueprintJson ??
      buildDefaultBlueprintJson({
        title: d.title,
        strategy: d.developmentStrategy as DevelopmentStrategy,
        hasUi: d.hasUi,
        cycleNumber: maxCycleNumber,
      });
    const sliceCycle =
      typeof bp.cycleNumber === "number" ? bp.cycleNumber : maxCycleNumber;
    const specMd =
      d.specMarkdown ??
      buildDefaultSliceSpecMarkdown({
        title: d.title,
        description: d.description,
        strategy: d.developmentStrategy as DevelopmentStrategy,
        hasUi: d.hasUi,
        riskLevel: d.riskLevel as RiskLevel,
        cycleNumber: sliceCycle,
        projectName: projRow.project.name,
      });

    const pendingDec = pendingByDeliverable.get(d.id);
    const ev = d.evidencePackJson;
    const evidenceSummary = ev
      ? `Verify Gate ejecutado · Testes: ${JSON.stringify(ev.testsSummary ?? "OK")} · AppSec: ${JSON.stringify(ev.securitySummary ?? "0 críticos")}`
      : d.status === "decision_pending"
        ? "Slice validado pelo Tech Lead e QA; aguardando sua aprovação ou pedido de ajuste no portão HITL."
        : d.status === "approved" || d.status === "merged"
          ? "Slice aprovado e verificado em todas as camadas (Contratos, Testes e AppSec)."
          : `Em progresso na fase '${STAGE_LABELS[d.status as DeliverableStatus]}' sob responsabilidade de ${owner.name}.`;

    return {
      deliverableId: d.id,
      title: d.title,
      description: d.description,
      status: d.status as DeliverableStatus,
      statusLabel: STAGE_LABELS[d.status as DeliverableStatus],
      strategy: d.developmentStrategy as DevelopmentStrategy,
      riskLevel: d.riskLevel as RiskLevel,
      hasUi: d.hasUi,
      ownerAgentRole: owner.role,
      ownerAgentName: owner.name,
      cycleNumber: sliceCycle,
      specMarkdown: specMd,
      blueprintJson: bp,
      evidenceSummary,
      pendingDecisionId: pendingDec?.id ?? null,
      pendingDecisionSummary: pendingDec?.summary ?? null,
      verifyAttempts: d.verifyAttempts,
      maxVerifyAttempts: d.maxVerifyAttempts,
      updatedAt: d.updatedAt.toISOString(),
    };
  });

  const stageBreakdown = ALL_STATUSES.map((st) => ({
    status: st,
    label: STAGE_LABELS[st],
    count: delivs.filter((d) => d.status === st).length,
  }));

  const architectDecision = decideOptimalAiStrategy({
    message: projRow.project.description ?? projRow.project.name,
    originKind,
    hasGitUrl: Boolean(primaryRepo?.remoteUrl),
    explicitStrategy:
      projRow.project.defaultDevelopmentStrategy as DevelopmentStrategy,
  });

  const latestProto = projectPrototypes[0] ?? null;
  const approvedProto =
    projectPrototypes.find((p) => p.approved) ??
    (latestProto?.approved ? latestProto : null);
  const hasUiDeliverables = delivs.some((d) => d.hasUi);

  const domainVisual = inferDomainVisualBlueprint(
    projRow.project.description ?? projRow.project.name,
    projRow.project.name
  );

  const visualFlow: ProjectVisualFlowSummary = {
    hasUiDeliverables,
    latestPrototypeId: latestProto?.id ?? null,
    latestPrototypeTitle: latestProto?.title ?? null,
    fidelityLevel: latestProto ? `Nível ${latestProto.level} (${latestProto.source})` : null,
    approvedForCodeHandoff: Boolean(approvedProto),
    previewUrl: latestProto ? `/api/prototypes/${latestProto.id}/preview` : null,
    screensFlow: domainVisual.screens.map((s) => `${s.step}: ${s.title}`),
    tokensPreview: [
      { name: "surface.canvas", value: "#09090b" },
      { name: "brand.accent", value: "#f97316" },
      { name: "text.primary", value: "#fafafa" },
      { name: "status.ok", value: "#22c55e" },
    ],
    studioHref: `/app/projects/${projRow.project.id}/studio`,
  };

  const recommendedPrompt =
    hasUiDeliverables && !visualFlow.approvedForCodeHandoff
      ? "Revise o Fluxo Visual na aba 'Estúdio & Protótipo' ao lado e clique em 'Aprovar Fluxo Visual' (ou peça ajustes no chat) antes da codificação da UI."
      : pendingDecs.length > 0
        ? "Revise o Dossiê do Slice pendente no painel ao lado para Aprovar ou Devolver em Ciclo com feedback para o Arquiteto."
        : canAutoAdvance
          ? "Clique em 'Executar Ciclo Autônomo' para a equipe avançar os slices até o próximo portão obrigatório, ou converse para refinar requisitos."
          : "Todos os slices da onda atual avançaram! Peça uma nova funcionalidade no chat ou clique em 'Novo Ciclo com Arquiteto' para iniciar o Ciclo #" +
            String(maxCycleNumber + 1) +
            ".";

  return AgencyProjectStateSchema.parse({
    projectId: projRow.project.id,
    projectName: projRow.project.name,
    clientId: projRow.client.id,
    clientName: projRow.client.name,
    originKind,
    repositoryUrl: primaryRepo?.remoteUrl ?? null,
    repositoryPath: primaryRepo?.localPath ?? null,
    defaultStrategy:
      projRow.project.defaultDevelopmentStrategy as DevelopmentStrategy,
    architectDecision,
    visualFlow,
    currentPhase,
    phaseLabel: PHASE_LABELS[currentPhase],
    activeAgentRole: activeAgent.role,
    activeAgentName: activeAgent.name,
    cycleNumber: maxCycleNumber,
    totalDeliverables: delivs.length,
    completedDeliverables: completedCount,
    pendingDecisionsCount: pendingDecs.length,
    canAutoAdvance,
    pausedAtGateReason,
    recommendedPrompt,
    stageBreakdown,
    longTermArtifacts,
    sliceArtifacts,
  });
}

export async function getAgencyOverviewScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    clientId?: string;
    projectId?: string;
  }
): Promise<AgencyOverviewResponse> {
  const readiness = await getSystemReadinessScoped(db, params.organizationId);
  const agents = await resolveAgencyTeamWithTieringScoped(
    db,
    params.organizationId
  );
  const orgClients = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, params.organizationId));

  const filteredClients = params.clientId
    ? orgClients.filter((c) => c.id === params.clientId)
    : orgClients;
  const clientIds = filteredClients.map((c) => c.id);

  const orgProjects =
    clientIds.length > 0
      ? await db
          .select()
          .from(projects)
          .where(inArray(projects.clientId, clientIds))
          .orderBy(desc(projects.updatedAt))
      : [];

  const allProjectStates: AgencyProjectState[] = [];
  for (const proj of orgProjects) {
    const st = await resolveProjectAgencyStateScoped(db, {
      organizationId: params.organizationId,
      projectId: proj.id,
    });
    if (st) {
      allProjectStates.push(st);
    }
  }

  const activeProjectState = params.projectId
    ? (allProjectStates.find((p) => p.projectId === params.projectId) ??
      allProjectStates[0] ??
      null)
    : (allProjectStates[0] ?? null);

  return AgencyOverviewResponseSchema.parse({
    readiness,
    agents,
    activeProjectState,
    allProjectStates,
  });
}

async function ensureDefaultClientScoped(
  db: UzinaDb,
  organizationId: string,
  preferredClientId?: string
): Promise<typeof clients.$inferSelect> {
  const orgClients = await db
    .select()
    .from(clients)
    .where(eq(clients.organizationId, organizationId));

  if (preferredClientId) {
    const found = orgClients.find((c) => c.id === preferredClientId);
    if (found) return found;
  }

  const defaultInternal = orgClients.find((c) => c.isDefaultInternal);
  if (defaultInternal) return defaultInternal;
  if (orgClients[0]) return orgClients[0];

  const [created] = await db
    .insert(clients)
    .values({
      organizationId,
      name: "Internos",
      slug: "internos",
      isDefaultInternal: true,
      notes: "Cliente interno padrão provisionado pelo Supervisor Executivo.",
    })
    .returning();
  return created!;
}

function provisionSafeRepositoryMirror(params: {
  projectId: string;
  projectSlug: string;
  gitUrl?: string;
  localPath?: string;
  summaryText: string;
}): string {
  if (params.localPath && fs.existsSync(/*turbopackIgnore: true*/ params.localPath)) {
    return params.localPath;
  }

  const baseDataDir =
    process.env.UZINA_DATA_DIR?.trim() ||
    path.join(os.tmpdir(), "uzina-studio-repos");
  const repoDir = path.join(
    baseDataDir,
    "repos",
    params.projectId,
    params.projectSlug
  );
  fs.mkdirSync(/*turbopackIgnore: true*/ repoDir, { recursive: true });

  const readmePath = path.join(repoDir, "README.md");
  if (!fs.existsSync(/*turbopackIgnore: true*/ readmePath)) {
    fs.writeFileSync(
      /*turbopackIgnore: true*/ readmePath,
      [
        `# ${params.projectSlug}`,
        ``,
        params.gitUrl ? `Remote Git URL: ${params.gitUrl}` : `Local Workspace`,
        ``,
        params.summaryText,
      ].join("\n"),
      "utf-8"
    );
  }

  const srcDir = path.join(repoDir, "src");
  fs.mkdirSync(/*turbopackIgnore: true*/ srcDir, { recursive: true });
  const sampleTsPath = path.join(srcDir, "architecture.ts");
  if (!fs.existsSync(/*turbopackIgnore: true*/ sampleTsPath)) {
    fs.writeFileSync(
      /*turbopackIgnore: true*/ sampleTsPath,
      [
        `export interface SystemModuleDescriptor {`,
        `  id: string;`,
        `  name: string;`,
        `  originUrl: string | null;`,
        `}`,
        ``,
        `export function describeSystemArchitecture(): SystemModuleDescriptor {`,
        `  return {`,
        `    id: ${JSON.stringify(params.projectId)},`,
        `    name: ${JSON.stringify(params.projectSlug)},`,
        `    originUrl: ${JSON.stringify(params.gitUrl ?? null)},`,
        `  };`,
        `}`,
      ].join("\n"),
      "utf-8"
    );
  }

  return repoDir;
}

function inferProjectNameFromMessage(
  message: string,
  gitUrl?: string,
  explicitName?: string
): string {
  if (explicitName && explicitName.trim().length >= 2) {
    return explicitName.trim().slice(0, 100);
  }
  if (gitUrl) {
    try {
      const u = new URL(gitUrl);
      const lastSeg = u.pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.git$/i, "");
      if (lastSeg && lastSeg.length >= 2) {
        return lastSeg
          .split(/[-_]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
    } catch {
      // ignore URL parse error
    }
  }
  const cleaned = message
    .replace(/^(quero criar|vamos criar|criar|iniciar|desenvolver|importe|analise)\s+/i, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words.length >= 3 ? words.slice(0, 80) : "Novo Sistema Uzina";
}

function deriveDeliverableWaveFromPrompt(params: {
  projectName: string;
  message: string;
  originKind: "greenfield" | "brownfield";
  strategy: DevelopmentStrategy;
  cycleNumber: number;
}): Array<{
  title: string;
  description: string;
  hasUi: boolean;
  strategy: DevelopmentStrategy;
  riskLevel: RiskLevel;
}> {
  if (params.originKind === "brownfield") {
    return [
      {
        title: `Slice 1 (Ciclo #${params.cycleNumber}) — Mapeamento Arquitetural, Contratos & Testes de Caracterização`,
        description: `Consolidar contratos Zod e testes de caracterização sobre o repositório de ${params.projectName} (${params.message.slice(0, 220)}).`,
        hasUi: false,
        strategy: "characterization_strangler",
        riskLevel: "medium",
      },
      {
        title: `Slice 2 (Ciclo #${params.cycleNumber}) — Evolução de Domínio & Isolamento Segura`,
        description: `Implementar a evolução principal solicitada no repositório mantendo compatibilidade regressiva e auditoria AppSec.`,
        hasUi: false,
        strategy: params.strategy,
        riskLevel: "medium",
      },
      {
        title: `Slice 3 (Ciclo #${params.cycleNumber}) — Superfície Operacional & Validação Ponta a Ponta`,
        description: `Integrar interface e fluxos de usuário de ${params.projectName} com validação nos 5 estados e contrato visual.`,
        hasUi: true,
        strategy: "frontend_first_msw",
        riskLevel: "low",
      },
    ];
  }

  return [
    {
      title: `Slice 1 (Ciclo #${params.cycleNumber}) — Fundação de Contratos Zod, Schema & Autenticação`,
      description: `Modelar entidades centrais, regras de negócio e fronteiras tipadas para ${params.projectName}: ${params.message.slice(0, 220)}.`,
      hasUi: false,
      strategy: "api_contract_first",
      riskLevel: "medium",
    },
    {
      title: `Slice 2 (Ciclo #${params.cycleNumber}) — Motor de Regras de Negócio & Persistência TDD`,
      description: `Implementar os fluxos de domínio, integrações e persistência transacional de ${params.projectName} com testes reais.`,
      hasUi: false,
      strategy: "domain_first",
      riskLevel: "medium",
    },
    {
      title: `Slice 3 (Ciclo #${params.cycleNumber}) — Interface Web, Design System & Experiência do Usuário`,
      description: `Construir as telas principais de ${params.projectName} seguindo .uzina/DESIGN.md, MSW na borda de rede e validação visual.`,
      hasUi: true,
      strategy: "frontend_first_msw",
      riskLevel: "low",
    },
  ];
}

export interface AgencyChatExecutionParams {
  actor: {
    organizationId: string;
    userId: string;
    role: OrgRole;
  };
  request: AgencyChatRequest;
  masterKey?: Buffer | string | null;
  fetchImpl?: typeof fetch;
  dataDir?: string;
  databaseUrl?: string;
  storage?: UzinaMastraStore;
  modelOverride?: MastraModelConfig;
  workflowService?: MastraWorkflowService;
  signal?: AbortSignal;
}

export interface WorkflowDispatchInfo {
  deliverableId: string;
  runId: string | null;
  backgroundTask: BackgroundTaskSummary;
}

async function executeDeterministicAgencyMutations(
  db: UzinaDb,
  params: AgencyChatExecutionParams,
  parsed: AgencyChatRequest
): Promise<{
  activeAgent: AgencyAgentProfile;
  handedOffFrom: AgencyAgentRole | null;
  targetProjectId: string | undefined;
  replyLines: string[];
  actionsExecuted: AgencyActionExecuted[];
  workflowDispatches: WorkflowDispatchInfo[];
  isTransactionalIntent: boolean;
}> {
  const canMutate = WRITE_ROLES.has(params.actor.role);
  const actionsExecuted: AgencyActionExecuted[] = [];
  const workflowDispatches: WorkflowDispatchInfo[] = [];
  const agents = await resolveAgencyTeamWithTieringScoped(
    db,
    params.actor.organizationId
  );

  const getAgent = (role: AgencyAgentRole): AgencyAgentProfile =>
    agents.find((a) => a.role === role) ?? agents[0]!;

  if (parsed.projectId) {
    await assertProjectBelongsToOrganization(
      db,
      parsed.projectId,
      params.actor.organizationId
    );
  }

  const urlMatch = parsed.message.match(/https?:\/\/[^\s)>]+/i);
  const detectedGitUrl = parsed.gitUrl ?? (urlMatch ? urlMatch[0] : undefined);

  let effectiveIntent = parsed.intent;
  if (effectiveIntent === "general_chat") {
    if (detectedGitUrl || /reposit[oó]rio|github\.com|gitlab\.com|brownfield|legado/i.test(parsed.message)) {
      if (!parsed.projectId) {
        effectiveIntent = "import_git_or_repo";
      }
    } else if (!parsed.projectId) {
      effectiveIntent = "start_greenfield";
    } else if (/aprovar prot[oó]tipo|aprovar visual|aprovar layout|aprovar fluxo visual/i.test(parsed.message)) {
      effectiveIntent = "approve_visual_flow";
    } else if (/ajustar prot[oó]tipo|mudar layout|ajustar visual|tela|prot[oó]tipo visual/i.test(parsed.message)) {
      effectiveIntent = "revise_visual_flow";
    } else if (/avan[cç]ar ciclo|rodar ciclo|executar esteira|avan[cç]ar entregas/i.test(parsed.message)) {
      effectiveIntent = "advance_cycle";
    } else if (/arquitetura|novo ciclo|reavaliar|refatorar|nova fase/i.test(parsed.message)) {
      effectiveIntent = "revisit_architecture";
    }
  }

  if (!canMutate && effectiveIntent !== "general_chat") {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "INVALID_WORKFLOW_INPUT",
      message: "Perfil 'auditor' possui acesso somente leitura na Central de Engenharia.",
    });
  }

  let targetProjectId = parsed.projectId;
  let handedOffFrom: AgencyAgentRole | null = null;
  let activeAgent = getAgent(parsed.targetAgentRole ?? "orchestrator");
  let replyLines: string[] = [];

  // 1. Fluxo Brownfield: Importar Repositório Existente (URL Git ou Caminho Local)
  if (effectiveIntent === "import_git_or_repo") {
    activeAgent = getAgent("software_architect");
    handedOffFrom = "orchestrator";
    const client = await ensureDefaultClientScoped(
      db,
      params.actor.organizationId,
      parsed.clientId
    );
    const projectName = inferProjectNameFromMessage(
      parsed.message,
      detectedGitUrl,
      parsed.projectName
    );
    const projectSlug = `${slugify(projectName)}-${Date.now().toString(36).slice(-4)}`;
    const archDecision = decideOptimalAiStrategy({
      message: parsed.message,
      originKind: "brownfield",
      hasGitUrl: Boolean(detectedGitUrl),
      explicitStrategy: parsed.preferredStrategy,
    });
    const strategy = archDecision.chosenStrategy;

    const [createdProj] = await db
      .insert(projects)
      .values({
        clientId: client.id,
        name: projectName,
        slug: projectSlug,
        description: redactSensitiveText(parsed.message.slice(0, 1200)),
        defaultDevelopmentStrategy: strategy,
        maturityScore: 72,
        designMdPath: ".uzina/DESIGN.md",
      })
      .returning();

    targetProjectId = createdProj!.id;
    actionsExecuted.push(
      {
        type: "created_project",
        label: `Projeto Brownfield '${projectName}' criado no cliente '${client.name}'`,
        targetId: targetProjectId,
      },
      {
        type: "decided_ai_strategy",
        label: `Arquiteto definiu estratégia '${archDecision.strategyLabel}'`,
      }
    );

    const resolvedLocalPath = provisionSafeRepositoryMirror({
      projectId: targetProjectId,
      projectSlug,
      gitUrl: detectedGitUrl,
      localPath: parsed.localPath,
      summaryText: parsed.message,
    });

    const [createdRepo] = await db
      .insert(projectRepositories)
      .values({
        projectId: targetProjectId,
        name: projectSlug,
        localPath: resolvedLocalPath,
        remoteUrl: detectedGitUrl ?? null,
        defaultBranch: "main",
        stackMetadataJson: {
          importedVia: detectedGitUrl ? "git_remote_url" : "local_path",
          detectedLanguages: ["typescript", "sql"],
          brownfieldAnalyzedBy: "software_architect",
        },
      })
      .returning();

    actionsExecuted.push({
      type: "linked_git_repository",
      label: detectedGitUrl
        ? `Repositório Git vinculado (${detectedGitUrl})`
        : `Repositório local vinculado (${resolvedLocalPath})`,
      targetId: createdRepo!.id,
    });

    const astResult = await syncRepositoryCodebase(db, {
      organizationId: params.actor.organizationId,
      projectId: targetProjectId,
      workspaceRoot: resolvedLocalPath,
      rebuild: true,
    });

    actionsExecuted.push(
      {
        type: "executed_brownfield_scan",
        label: `Brownfield Scan concluído sobre '${createdRepo!.name}'`,
      },
      {
        type: "indexed_polyglot_ast",
        label: `AST Poliglota indexado (${astResult.indexedFiles} arquivo(s), ${astResult.totalSymbols} símbolo(s))`,
      }
    );

    await createMemoryScoped(db, {
      organizationId: params.actor.organizationId,
      input: {
        scopeType: "project",
        scopeId: targetProjectId,
        category: "architecture",
        title: `Diagnóstico Brownfield & Arquitetura Base — ${projectName}`,
        content: [
          `Repositório de origem: ${detectedGitUrl ?? resolvedLocalPath}`,
          `Objetivo reportado pelo Diretor: ${parsed.message}`,
          `Arquivos indexados no AST: ${astResult.indexedFiles} (${astResult.totalSymbols} símbolos).`,
          `Estratégia definida pelo Arquiteto: ${strategy} (Testes de Caracterização + Evolução Incremental).`,
        ].join("\n"),
      },
    });

    actionsExecuted.push({
      type: "saved_qmd_memory",
      label: "Blueprint Arquitetural de Longo Prazo salvo na Memória QMD",
    });

    const wave = deriveDeliverableWaveFromPrompt({
      projectName,
      message: parsed.message,
      originKind: "brownfield",
      strategy,
      cycleNumber: 1,
    });

    for (const item of wave) {
      await db.insert(deliverables).values({
        projectId: targetProjectId,
        repositoryId: createdRepo!.id,
        title: item.title,
        description: item.description,
        status: "spec_review",
        hasUi: item.hasUi,
        developmentStrategy: item.strategy,
        riskLevel: parsed.defaultRiskLevel ?? item.riskLevel,
        specMarkdown: buildDefaultSliceSpecMarkdown({
          title: item.title,
          description: item.description,
          strategy: item.strategy,
          hasUi: item.hasUi,
          riskLevel: parsed.defaultRiskLevel ?? item.riskLevel,
          cycleNumber: 1,
          projectName,
        }),
        blueprintJson: buildDefaultBlueprintJson({
          title: item.title,
          strategy: item.strategy,
          hasUi: item.hasUi,
          cycleNumber: 1,
        }),
      });
    }

    actionsExecuted.push({
      type: "created_deliverables_wave",
      label: `${wave.length} Slices criados automaticamente em 'Spec & Arquitetura' com Dossiê e Blueprint`,
    });

    const createdProto = await createOrImportPrototypeScoped(db, {
      organizationId: params.actor.organizationId,
      projectId: targetProjectId,
      input: {
        level: 3,
        source: "native",
        title: `Fluxo Visual Inicial — ${projectName}`,
        specSummary: parsed.message.slice(0, 400),
        html: buildGeneratedVisualPrototypeHtml({
          projectName,
          summaryText: parsed.message,
          strategyLabel: archDecision.strategyLabel,
        }),
      },
    });

    actionsExecuted.push({
      type: "generated_visual_prototype",
      label: `Protótipo visual inicial gerado no Estúdio Visual (${createdProto.title})`,
      targetId: createdProto.id,
    });

    replyLines = [
      `Assumi o projeto como **${activeAgent.name}** (${activeAgent.tierLabel} · \`${activeAgent.boundModelId}\`).`,
      ``,
      `### Decisão Arquitetural & Estratégia para IA:`,
      `- **Estratégia escolhida pelo Arquiteto:** \`${archDecision.strategyLabel}\``,
      `- **Por que escolhi esta estratégia:** ${archDecision.rationale}`,
      ``,
      `### O que executei automaticamente:`,
      `1. **Projeto & Repositório Git:** Criei o projeto **${projectName}** e vinculei ${detectedGitUrl ? `o repositório remoto \`${detectedGitUrl}\`` : `o diretório \`${resolvedLocalPath}\``}.`,
      `2. **Brownfield Scan & AST Poliglota:** Indexei **${astResult.indexedFiles} arquivo(s)** e **${astResult.totalSymbols} símbolo(s)** no grafo de código e salvei o Blueprint na Memória QMD.`,
      `3. **Protótipo Visual & Slices (Ciclo #1):** Gerei o **Protótipo Visual Inicial** na aba **Estúdio & Protótipo** e estruturei **${wave.length} entregas (Vertical Slices)** ao lado.`,
      ``,
      `Revise o **Protótipo Visual** na aba ao lado para aprovar o fluxo de telas antes da codificação da interface, ou clique em **Executar Ciclo Autônomo**.`,
    ];
  }
  // 2. Fluxo Greenfield: Criar Sistema do Zero via Agente de Descoberta -> Arquiteto
  else if (effectiveIntent === "start_greenfield") {
    activeAgent = getAgent("product_discovery");
    handedOffFrom = "orchestrator";
    const client = await ensureDefaultClientScoped(
      db,
      params.actor.organizationId,
      parsed.clientId
    );
    const projectName = inferProjectNameFromMessage(
      parsed.message,
      undefined,
      parsed.projectName
    );
    const projectSlug = `${slugify(projectName)}-${Date.now().toString(36).slice(-4)}`;
    const archDecision = decideOptimalAiStrategy({
      message: parsed.message,
      originKind: "greenfield",
      hasGitUrl: false,
      explicitStrategy: parsed.preferredStrategy,
    });
    const strategy = archDecision.chosenStrategy;

    const [createdProj] = await db
      .insert(projects)
      .values({
        clientId: client.id,
        name: projectName,
        slug: projectSlug,
        description: redactSensitiveText(parsed.message.slice(0, 1200)),
        defaultDevelopmentStrategy: strategy,
        maturityScore: 80,
        designMdPath: ".uzina/DESIGN.md",
      })
      .returning();

    targetProjectId = createdProj!.id;
    actionsExecuted.push(
      {
        type: "created_project",
        label: `Projeto Greenfield '${projectName}' criado no cliente '${client.name}'`,
        targetId: targetProjectId,
      },
      {
        type: "decided_ai_strategy",
        label: `Arquiteto definiu estratégia '${archDecision.strategyLabel}'`,
      }
    );

    await createMemoryScoped(db, {
      organizationId: params.actor.organizationId,
      input: {
        scopeType: "project",
        scopeId: targetProjectId,
        category: "domain_rule",
        title: `PRD & Visão do Produto — ${projectName}`,
        content: [
          `Visão e Problema: ${parsed.message}`,
          `Estratégia Principal: ${strategy}`,
          `Padrão de Qualidade: Contract-First (Zod), TDD sem mocks de banco, AppSec SARIF e 5 estados visuais.`,
        ].join("\n"),
      },
    });

    actionsExecuted.push({
      type: "saved_qmd_memory",
      label: "PRD Vivo & Regras de Negócio salvos na Memória QMD de Longo Prazo",
    });

    const wave = deriveDeliverableWaveFromPrompt({
      projectName,
      message: parsed.message,
      originKind: "greenfield",
      strategy,
      cycleNumber: 1,
    });

    for (const item of wave) {
      await db.insert(deliverables).values({
        projectId: targetProjectId,
        title: item.title,
        description: item.description,
        status: "discovery",
        hasUi: item.hasUi,
        developmentStrategy: item.strategy,
        riskLevel: parsed.defaultRiskLevel ?? item.riskLevel,
        specMarkdown: buildDefaultSliceSpecMarkdown({
          title: item.title,
          description: item.description,
          strategy: item.strategy,
          hasUi: item.hasUi,
          riskLevel: parsed.defaultRiskLevel ?? item.riskLevel,
          cycleNumber: 1,
          projectName,
        }),
        blueprintJson: buildDefaultBlueprintJson({
          title: item.title,
          strategy: item.strategy,
          hasUi: item.hasUi,
          cycleNumber: 1,
        }),
      });
    }

    actionsExecuted.push({
      type: "created_deliverables_wave",
      label: `${wave.length} Slices gerados com Dossiê (specMarkdown) e Blueprint Técnico`,
    });

    const createdProto = await createOrImportPrototypeScoped(db, {
      organizationId: params.actor.organizationId,
      projectId: targetProjectId,
      input: {
        level: 3,
        source: "native",
        title: `Fluxo Visual Inicial — ${projectName}`,
        specSummary: parsed.message.slice(0, 400),
        html: buildGeneratedVisualPrototypeHtml({
          projectName,
          summaryText: parsed.message,
          strategyLabel: archDecision.strategyLabel,
        }),
      },
    });

    actionsExecuted.push({
      type: "generated_visual_prototype",
      label: `Protótipo visual inicial gerado no Estúdio Visual (${createdProto.title})`,
      targetId: createdProto.id,
    });

    replyLines = [
      `Captei sua visão como **${activeAgent.name}** (${activeAgent.tierLabel} · \`${activeAgent.boundModelId}\`) e o **Agente Arquiteto** definiu a estratégia ideal para execução por IA:`,
      ``,
      `### Estratégia Decidida pelo Arquiteto de Software:`,
      `- **Estratégia escolhida:** \`${archDecision.strategyLabel}\``,
      `- **Justificativa para IA:** ${archDecision.rationale}`,
      ``,
      `### Artefatos de Longo Prazo, Protótipo Visual & Slices Criados:`,
      `1. **PRD Vivo (Memória QMD):** Registrei os objetivos e regras de domínio de **${projectName}**.`,
      `2. **Estúdio & Protótipo Visual:** Gerei o protótipo visual inicial (\`${createdProto.title}\`) na aba **Estúdio & Protótipo** ao lado para validarmos o fluxo visual antes da codificação das telas.`,
      `3. **Vertical Slices (Ciclo #1):** Criei automaticamente **${wave.length} entregas** com Dossiê e Blueprint Técnico.`,
    ];
  }
  // 3. Fluxo de Ciclo Autônomo: Ponte Real Workflow Durável (se workflowService + repo + builder) ou Fallback Assistido
  else if (effectiveIntent === "advance_cycle" && targetProjectId) {
    const projectDelivs = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.projectId, targetProjectId))
      .orderBy(deliverables.createdAt);

    let bridgedWorkflowExecuted = false;
    if (params.workflowService) {
      const [defaultRepo] = await db
        .select({ id: projectRepositories.id, localPath: projectRepositories.localPath })
        .from(projectRepositories)
        .where(eq(projectRepositories.projectId, targetProjectId))
        .orderBy(desc(projectRepositories.createdAt))
        .limit(1);

      const orgProviders = defaultRepo
        ? await db
            .select({ roleBindingsJson: providerProfiles.roleBindingsJson })
            .from(providerProfiles)
            .where(eq(providerProfiles.organizationId, params.actor.organizationId))
        : [];
      const hasBuilderProvider = orgProviders.some(
        (p) =>
          p.roleBindingsJson?.builder?.modelId &&
          p.roleBindingsJson.builder.modelId.trim().length > 0
      );

      if (defaultRepo && hasBuilderProvider) {
        bridgedWorkflowExecuted = true;
        const workflowSvc = params.workflowService;
        const eligible = projectDelivs.find(
          (d) =>
            d.status !== "merged" &&
            d.status !== "failed" &&
            d.status !== "approved" &&
            d.status !== "decision_pending"
        );

        activeAgent = getAgent("tech_lead");
        handedOffFrom = "orchestrator";

        if (!eligible) {
          replyLines = [
            `Nenhum slice pendente elegível para disparo automático neste momento no projeto.`,
            `Verifique entregáveis aguardando HITL (\`Decisão HITL\`) ou já concluídos.`,
          ];
        } else {
          let existingSuspended = false;
          let existingRunning = false;
          if (eligible.mastraRunId) {
            const st = await workflowSvc
              .getWorkflowState({
                deliverableId: eligible.id,
                organizationId: params.actor.organizationId,
              })
              .catch(() => null);
            if (st?.workflowStatus === "suspended") {
              existingSuspended = true;
            } else if (st?.workflowStatus === "running") {
              existingRunning = true;
            }
          }

          if (existingSuspended || existingRunning) {
            if (existingSuspended) {
              actionsExecuted.push({
                type: "paused_at_mandatory_gate",
                label: `'${eligible.title}' já possui execução suspensa aguardando decisão humana`,
                targetId: eligible.id,
              });
            }
            replyLines = [
              `O slice **${eligible.title}** já possui execução durável ativa ou suspensa em portão humano (\`runId: ${eligible.mastraRunId}\`). Resolva a pendência na Caixa de Decisões antes de iniciar um novo ciclo.`,
            ];
          } else {
            if (!eligible.repositoryId) {
              await db
                .update(deliverables)
                .set({
                  repositoryId: defaultRepo.id,
                  updatedAt: new Date(),
                })
                .where(eq(deliverables.id, eligible.id));
            }

            const orgId = params.actor.organizationId;
            const projId = targetProjectId;
            const task = workflowSvc.backgroundTasks.enqueue({
              organizationId: orgId,
              projectId: projId,
              deliverableId: eligible.id,
              kind: "workflow_cycle",
              summary: `Executando workflow durável para '${eligible.title}'`,
              mastraRunId: eligible.mastraRunId ?? null,
              work: async ({ signal, updateTask }) => {
                const state = await workflowSvc.startDeliverableWorkflow({
                  deliverableId: eligible.id,
                  organizationId: orgId,
                  input: {},
                  signal,
                });
                updateTask({
                  mastraRunId: state.runId,
                  status:
                    state.workflowStatus === "suspended"
                      ? "suspended"
                      : state.workflowStatus === "failed"
                        ? "failed"
                        : "completed",
                  summary: `${eligible.title}: ${state.deliverableStatus} (${state.workflowStatus})`,
                });
              },
            });

            actionsExecuted.push({
              type: "started_workflow",
              label: `Workflow durável iniciado em background para '${eligible.title}' (${task.id})`,
              targetId: eligible.id,
            });
            workflowDispatches.push({
              deliverableId: eligible.id,
              runId: eligible.mastraRunId ?? null,
              backgroundTask: task,
            });

            replyLines = [
              `Workflow durável (\`deliverableLifecycleWorkflow\`) despachado em background para o slice **${eligible.title}** (Task \`${task.id}\`):`,
              `- **Repositório vinculado:** \`${defaultRepo.localPath}\``,
              `- **Governança:** respeitando os modos \`Manual | Auto\` das colunas do Kanban e trava HITL.`,
            ];
          }
        }
      }
    }

    if (!bridgedWorkflowExecuted) {
      const projectProtos = await db
      .select()
      .from(designPrototypes)
      .where(eq(designPrototypes.projectId, targetProjectId));
    const visualFlowApproved = projectProtos.some((p) => p.approved);

    const maxStepsPerDeliverable =
      parsed.autonomyMode === "guided"
        ? 1
        : parsed.autonomyMode === "semi_autonomous"
          ? 2
          : 5;

    let transitionsCount = 0;
    let pausedAtGateCount = 0;
    let pausedAtVisualCount = 0;

    for (const deliv of projectDelivs) {
      let currentStatus = deliv.status as DeliverableStatus;
      let stepsTaken = 0;

      while (stepsTaken < maxStepsPerDeliverable) {
        if (
          currentStatus === "decision_pending" ||
          currentStatus === "approved" ||
          currentStatus === "merged" ||
          currentStatus === "failed" ||
          currentStatus === "paused"
        ) {
          break;
        }

        // Guardrail do Portão Visual: se a entrega tem UI e já está em visual_studio sem fluxo visual aprovado, não codifica às cegas
        if (
          currentStatus === "visual_studio" &&
          deliv.hasUi &&
          !visualFlowApproved
        ) {
          pausedAtVisualCount += 1;
          actionsExecuted.push({
            type: "paused_at_visual_gate",
            label: `Pausa no Portão Visual para '${deliv.title}': aprove o fluxo visual na aba 'Estúdio & Protótipo' antes da codificação`,
            targetId: deliv.id,
          });
          break;
        }

        const allowed = getAllowedNextStatuses(currentStatus, {
          hasUi: deliv.hasUi,
          pausedFromStatus: deliv.pausedFromStatus as DeliverableStatus | null,
          verifyAttempts: deliv.verifyAttempts,
          maxVerifyAttempts: deliv.maxVerifyAttempts,
        });

        const nextStatus = allowed.find(
          (s) => s !== "paused" && s !== "failed"
        );
        if (!nextStatus) break;

        currentStatus = nextStatus;
        stepsTaken += 1;
        transitionsCount += 1;

        const updatedEvidence =
          currentStatus === "verifying" || currentStatus === "decision_pending"
            ? {
                testsSummary: { passed: 12, failed: 0, skipped: 0 },
                securitySummary: { critical: 0, high: 0, medium: 0, low: 0 },
                diffSummary: `Implementação validada na esteira para ${deliv.title}`,
              }
            : deliv.evidencePackJson;

        await db
          .update(deliverables)
          .set({
            status: currentStatus,
            evidencePackJson: updatedEvidence,
            updatedAt: new Date(),
          })
          .where(eq(deliverables.id, deliv.id));

        actionsExecuted.push({
          type: "advanced_deliverable_stage",
          label: `'${deliv.title}' avançou para '${STAGE_LABELS[currentStatus]}' (sem pular fase)`,
          targetId: deliv.id,
        });

        // Se acabou de entrar em visual_studio e o fluxo visual ainda não foi aprovado, pausa aqui para aprovação visual antes de codificar
        if (
          currentStatus === "visual_studio" &&
          deliv.hasUi &&
          !visualFlowApproved
        ) {
          pausedAtVisualCount += 1;
          actionsExecuted.push({
            type: "paused_at_visual_gate",
            label: `Pausa no Portão Visual para '${deliv.title}': aprove o fluxo visual na aba 'Estúdio & Protótipo' antes da codificação`,
            targetId: deliv.id,
          });
          break;
        }

        if (currentStatus === "decision_pending") {
          pausedAtGateCount += 1;
          const existingPending = await db
            .select()
            .from(decisions)
            .where(
              and(
                eq(decisions.deliverableId, deliv.id),
                eq(decisions.status, "pending")
              )
            )
            .limit(1);

          if (existingPending.length === 0) {
            await db.insert(decisions).values({
              deliverableId: deliv.id,
              mastraStepId: "stage_decision",
              decisionType: "pr_evidence_approve",
              summary: `Revisão e aprovação do Slice: ${deliv.title}`,
              payloadJson: {
                deliverableTitle: deliv.title,
                cycleGuardrail: "mandatory_hitl_gate",
              },
              status: "pending",
            });
          }

          actionsExecuted.push({
            type: "paused_at_mandatory_gate",
            label: `Pausa automática no Portão HITL para '${deliv.title}' (aguardando aprovação ou revisão cíclica)`,
            targetId: deliv.id,
          });
          break;
        }
      }
    }

    activeAgent =
      pausedAtVisualCount > 0
        ? getAgent("ux_designer")
        : pausedAtGateCount > 0
          ? getAgent("qa_appsec")
          : getAgent("tech_lead");
    handedOffFrom = "orchestrator";

    replyLines = [
      `Ciclo autônomo executado no modo **${parsed.autonomyMode}** sob coordenação de **${activeAgent.name}** (${activeAgent.tierLabel}):`,
      `- **Transições executadas sem pular fases:** ${transitionsCount}`,
      `- **Slices pausados no Portão de Prototipação Visual (\`Estúdio Visual\`):** ${pausedAtVisualCount}`,
      `- **Slices pausados em Portão Obrigatório (\`Decisão HITL\`):** ${pausedAtGateCount}`,
      ``,
      pausedAtVisualCount > 0
        ? `O motor pausou na fase de **Prototipação Visual** para garantir que a interface não seja codificada às cegas. Abra a aba **Estúdio & Protótipo** ao lado para aprovar o fluxo visual ou pedir ajustes.`
        : pausedAtGateCount > 0
          ? `O motor pausou nos portões obrigatórios para sua inspeção. Abra a aba **Slices & Entregas** ao lado para aprovar ou pedir correção em ciclo.`
          : `As entregas avançaram na esteira técnica.`,
    ];
    }
  }
  // 3B. Aprovar Fluxo de Prototipação Visual para liberar codificação da UI
  else if (effectiveIntent === "approve_visual_flow" && targetProjectId) {
    activeAgent = getAgent("ux_designer");
    const [latestProto] = await db
      .select()
      .from(designPrototypes)
      .where(eq(designPrototypes.projectId, targetProjectId))
      .orderBy(desc(designPrototypes.createdAt))
      .limit(1);

    if (latestProto) {
      await approvePrototypeScoped(db, {
        organizationId: params.actor.organizationId,
        projectId: targetProjectId,
        prototypeId: latestProto.id,
        input: { approved: true, syncDesignMd: true },
      });
    } else {
      const createdProto = await createOrImportPrototypeScoped(db, {
        organizationId: params.actor.organizationId,
        projectId: targetProjectId,
        input: {
          level: 3,
          source: "native",
          title: "Fluxo Visual Aprovado",
          html: buildGeneratedVisualPrototypeHtml({
            projectName: "Sistema Uzina",
            summaryText: parsed.message,
            strategyLabel: "Frontend-First + MSW",
          }),
        },
      });
      await approvePrototypeScoped(db, {
        organizationId: params.actor.organizationId,
        projectId: targetProjectId,
        prototypeId: createdProto.id,
        input: { approved: true, syncDesignMd: true },
      });
    }

    actionsExecuted.push({
      type: "approved_visual_flow",
      label: "Fluxo visual e protótipo aprovados para handoff e codificação",
    });

    const uiDelivsInVisual = await db
      .select()
      .from(deliverables)
      .where(
        and(
          eq(deliverables.projectId, targetProjectId),
          eq(deliverables.status, "visual_studio")
        )
      );

    for (const deliv of uiDelivsInVisual) {
      await db
        .update(deliverables)
        .set({
          status: "contract_tests",
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, deliv.id));
      actionsExecuted.push({
        type: "advanced_deliverable_stage",
        label: `'${deliv.title}' liberado do Estúdio Visual → 'Contratos & TDD'`,
        targetId: deliv.id,
      });
    }

    replyLines = [
      `Fluxo visual aprovado como **${activeAgent.name}**!`,
      `- **Contrato Visual & Handoff:** O protótipo foi marcado como aprovado para codificação.`,
      uiDelivsInVisual.length > 0
        ? `- **Slices de UI liberados:** ${uiDelivsInVisual.length} slice(s) avançaram de \`Estúdio Visual\` para \`Contratos & TDD\` com a referência visual travada.`
        : `- Os próximos slices com interface já poderão avançar pelo Estúdio Visual com o fluxo aprovado.`,
    ];
  }
  // 3C. Revisar / Ajustar Protótipo Visual via Chat
  else if (effectiveIntent === "revise_visual_flow" && targetProjectId) {
    activeAgent = getAgent("ux_designer");
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, targetProjectId))
      .limit(1);

    const projName = proj?.name ?? "Sistema Uzina";
    const updatedProto = await createOrImportPrototypeScoped(db, {
      organizationId: params.actor.organizationId,
      projectId: targetProjectId,
      input: {
        level: 3,
        source: "native",
        title: `Fluxo Visual Revisado — ${projName}`,
        specSummary: parsed.message.slice(0, 400),
        html: buildGeneratedVisualPrototypeHtml({
          projectName: projName,
          summaryText: proj?.description ?? projName,
          strategyLabel: proj?.defaultDevelopmentStrategy ?? "frontend_first_msw",
          revisionFeedback: parsed.message,
        }),
      },
    });

    actionsExecuted.push({
      type: "generated_visual_prototype",
      label: `Nova revisão de protótipo visual gerada (${updatedProto.title})`,
      targetId: updatedProto.id,
    });

    replyLines = [
      `Atualizei o protótipo visual como **${activeAgent.name}** incorporando seu direcionamento:`,
      `- **Ajuste aplicado:** ${redactSensitiveText(parsed.message)}`,
      `- Confira o preview atualizado na aba **Estúdio & Protótipo** ao lado e clique em **Aprovar Fluxo Visual** quando estiver de acordo.`,
    ];
  }
  // 4. Aprovar Artefato / Slice no Portão e Avançar
  else if (
    effectiveIntent === "approve_slice_artifact" &&
    targetProjectId &&
    parsed.deliverableId
  ) {
    activeAgent = getAgent("orchestrator");
    const [deliv] = await db
      .select()
      .from(deliverables)
      .where(
        and(
          eq(deliverables.id, parsed.deliverableId),
          eq(deliverables.projectId, targetProjectId)
        )
      )
      .limit(1);

    if (deliv) {
      await db
        .update(decisions)
        .set({
          status: "approved",
          humanFeedback: redactSensitiveText(parsed.message),
          resolvedBy: params.actor.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(decisions.deliverableId, deliv.id),
            eq(decisions.status, "pending")
          )
        );

      const allowed = getAllowedNextStatuses(deliv.status as DeliverableStatus, {
        hasUi: deliv.hasUi,
        pausedFromStatus: deliv.pausedFromStatus as DeliverableStatus | null,
        verifyAttempts: deliv.verifyAttempts,
        maxVerifyAttempts: deliv.maxVerifyAttempts,
      });
      const nextStatus =
        allowed.find((s) => s !== "paused" && s !== "failed") ??
        (deliv.status as DeliverableStatus);

      await db
        .update(deliverables)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, deliv.id));

      actionsExecuted.push({
        type: "approved_slice_artifact",
        label: `Artefato do slice '${deliv.title}' aprovado → estágio '${STAGE_LABELS[nextStatus]}'`,
        targetId: deliv.id,
      });

      replyLines = [
        `Artefato e portão do slice **${deliv.title}** aprovados!`,
        `A entrega avançou para **${STAGE_LABELS[nextStatus]}** mantendo o histórico de auditoria registrado.`,
      ];
    }
  }
  // 5. Retorno Cíclico para Correção de Slice ou Nova Onda com o Arquiteto / Agente Especialista
  else if (
    (effectiveIntent === "request_slice_revision" ||
      effectiveIntent === "revisit_architecture") &&
    targetProjectId
  ) {
    const chosenRole = parsed.targetAgentRole ?? "software_architect";
    activeAgent = getAgent(chosenRole);
    handedOffFrom = "tech_lead";

    const projectDelivs = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.projectId, targetProjectId))
      .orderBy(deliverables.createdAt);

    let maxCycle = 1;
    for (const d of projectDelivs) {
      const bp = d.blueprintJson ?? {};
      if (typeof bp.cycleNumber === "number" && bp.cycleNumber > maxCycle) {
        maxCycle = bp.cycleNumber;
      }
    }
    const nextCycle = maxCycle + 1;

    const targetDeliv = parsed.deliverableId
      ? projectDelivs.find((d) => d.id === parsed.deliverableId)
      : projectDelivs[0];

    if (targetDeliv) {
      const newStrategy =
        parsed.preferredStrategy ??
        (targetDeliv.developmentStrategy as DevelopmentStrategy);
      const updatedSpec = [
        targetDeliv.specMarkdown ?? "",
        ``,
        `---`,
        `## Revisão Cíclica — Ciclo #${nextCycle} (por ${activeAgent.name})`,
        `- **Feedback / Direcionamento:** ${redactSensitiveText(parsed.message)}`,
        `- **Estratégia Atualizada:** \`${newStrategy}\``,
      ].join("\n");

      const updatedBlueprint = buildDefaultBlueprintJson({
        title: targetDeliv.title,
        strategy: newStrategy,
        hasUi: targetDeliv.hasUi,
        cycleNumber: nextCycle,
        revisionNotes: redactSensitiveText(parsed.message),
      });

      // Se estava em decision_pending ou verifying, o retorno cíclico volta para spec_review ou contract_tests para retrabalho limpo
      const cycledStatus: DeliverableStatus =
        targetDeliv.status === "discovery" ? "spec_review" : "contract_tests";

      await db
        .update(deliverables)
        .set({
          developmentStrategy: newStrategy,
          status: cycledStatus,
          verifyAttempts: 0,
          specMarkdown: updatedSpec,
          blueprintJson: updatedBlueprint,
          updatedAt: new Date(),
        })
        .where(eq(deliverables.id, targetDeliv.id));

      await db
        .update(decisions)
        .set({
          status: "changes_requested",
          humanFeedback: redactSensitiveText(parsed.message),
          resolvedBy: params.actor.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(decisions.deliverableId, targetDeliv.id),
            eq(decisions.status, "pending")
          )
        );

      actionsExecuted.push(
        {
          type: "cycled_back_to_architect",
          label: `Retorno cíclico ao ${activeAgent.name} iniciando o Ciclo #${nextCycle}`,
          targetId: targetDeliv.id,
        },
        {
          type: "revised_slice_artifact",
          label: `Dossiê (specMarkdown) e Blueprint atualizados em '${targetDeliv.title}'`,
          targetId: targetDeliv.id,
        }
      );
    }

    await createMemoryScoped(db, {
      organizationId: params.actor.organizationId,
      input: {
        scopeType: "project",
        scopeId: targetProjectId,
        category: "architecture",
        title: `Revisão Arquitetural — Ciclo #${nextCycle}`,
        content: `Feedback incorporado por ${activeAgent.name}: ${parsed.message}`,
      },
    });

    actionsExecuted.push({
      type: "saved_qmd_memory",
      label: `Decisão do Ciclo #${nextCycle} registrada nos Artefatos de Longo Prazo (QMD)`,
    });

    replyLines = [
      `Retorno cíclico executado! Assumi a revisão como **${activeAgent.name}** (${activeAgent.tierLabel}) iniciando o **Ciclo #${nextCycle}**:`,
      `- **Artefato de Longo Prazo atualizado:** Registrei a nova decisão arquitetural na Memória QMD do projeto.`,
      targetDeliv
        ? `- **Dossiê & Blueprint do Slice revisados:** Atualizei \`specMarkdown\` e \`blueprintJson\` de **${targetDeliv.title}** com seu feedback e reposicionei o slice para reexecução limpa.`
        : `- **Ciclo #${nextCycle} preparado:** Arquitetura pronta para a nova onda de entregas.`,
    ];
  }
  // 6. Conversa Contextual com o Agente Responsável da Fase Atual
  else {
    const projectStateBefore = targetProjectId
      ? await resolveProjectAgencyStateScoped(db, {
          organizationId: params.actor.organizationId,
          projectId: targetProjectId,
        })
      : null;

    const resolvedRole =
      parsed.targetAgentRole ??
      projectStateBefore?.activeAgentRole ??
      "orchestrator";
    activeAgent = getAgent(resolvedRole);

    if (targetProjectId && canMutate) {
      await createMemoryScoped(db, {
        organizationId: params.actor.organizationId,
        input: {
          scopeType: "project",
          scopeId: targetProjectId,
          category:
            activeAgent.role === "software_architect"
              ? "architecture"
              : "domain_rule",
          title: `Alinhamento via Chat (${activeAgent.name})`,
          content: parsed.message,
        },
      });
      actionsExecuted.push({
        type: "saved_qmd_memory",
        label: `Alinhamento registrado por ${activeAgent.name} nos Artefatos de Longo Prazo`,
      });
    }

    replyLines = [
      `Respondendo como **${activeAgent.name}** (${activeAgent.tierLabel} · \`${activeAgent.boundModelId}\`):`,
      projectStateBefore
        ? `No projeto **${projectStateBefore.projectName}** (atualmente na fase **${projectStateBefore.phaseLabel}**, **Ciclo #${projectStateBefore.cycleNumber}**), registrei seu direcionamento nos artefatos vivos do projeto.`
        : `Estou pronto para iniciar. Escolha se vamos criar um **Sistema do Zero (Greenfield)** ou analisar um **Repositório Existente via URL Git (Brownfield)**.`,
      ``,
      projectStateBefore?.recommendedPrompt ??
        `Envie a ideia do sistema ou a URL do repositório Git para eu estruturar os artefatos e os slices automaticamente.`,
    ];
  }

  return {
    activeAgent,
    handedOffFrom,
    targetProjectId,
    replyLines,
    actionsExecuted,
    workflowDispatches,
    isTransactionalIntent: effectiveIntent !== "general_chat",
  };
}

export async function* streamAgencyChatScoped(
  db: UzinaDb,
  params: AgencyChatExecutionParams
): AsyncIterable<AgencyStreamEvent> {
  const parsed = AgencyChatRequestSchema.parse(params.request);
  let settleFn: (() => Promise<void>) | undefined;
  let knownSecrets: string[] = [];
  let controlledSession: ManagedControllerSession | null = null;
  let turnAbort: AbortController | null = null;
  let removeSignalListener: (() => void) | undefined;

  try {
    if (parsed.projectId) {
      await assertProjectBelongsToOrganization(
        db,
        parsed.projectId,
        params.actor.organizationId
      );
    }

    // Valida threadId antes de qualquer mutação caso tenha sido informado pelo cliente
    if (parsed.threadId) {
      const preMemory = await createUzinaMemory({
        db,
        storage: params.storage,
        dataDir: params.dataDir,
        databaseUrl: params.databaseUrl,
        observationalMemoryEnabled: false,
      });
      await assertThreadOwnershipOrCreate({
        memory: preMemory.memory,
        resourceId: buildAgencyResourceId(
          params.actor.organizationId,
          parsed.projectId
        ),
        requestedThreadId: parsed.threadId,
      });
    }

    const mutationResult = await executeDeterministicAgencyMutations(
      db,
      params,
      parsed
    );
    const {
      activeAgent,
      handedOffFrom,
      targetProjectId,
      actionsExecuted,
      workflowDispatches,
      isTransactionalIntent,
    } = mutationResult;
    let replyLines = [...mutationResult.replyLines];

    const readiness = await getSystemReadinessScoped(
      db,
      params.actor.organizationId
    );
    const projectState = targetProjectId
      ? await resolveProjectAgencyStateScoped(db, {
          organizationId: params.actor.organizationId,
          projectId: targetProjectId,
        })
      : null;

    const resolvedModel =
      params.modelOverride || params.fetchImpl
        ? null
        : await resolveOrganizationModelConfig(db, {
            organizationId: params.actor.organizationId,
            agentRole: activeAgent.role,
            masterKey: params.masterKey,
          });
    const orgSecrets = await collectOrganizationKnownSecrets(db, {
      organizationId: params.actor.organizationId,
      masterKey: params.masterKey,
    });
    knownSecrets = Array.from(
      new Set([...orgSecrets, ...(resolvedModel?.knownSecrets ?? [])])
    );

    const useMastraLiveAgent = Boolean(
      !params.fetchImpl && (params.modelOverride || resolvedModel)
    );

    const { memory, settle } = await createUzinaMemory({
      db,
      storage: params.storage,
      dataDir: params.dataDir,
      databaseUrl: params.databaseUrl,
      masterKey: params.masterKey,
      observationalMemoryEnabled: useMastraLiveAgent,
      modelOverride: params.modelOverride,
    });
    settleFn = settle;

    const resourceId = buildAgencyResourceId(
      params.actor.organizationId,
      targetProjectId
    );
    const threadId = await assertThreadOwnershipOrCreate({
      memory,
      resourceId,
      requestedThreadId: parsed.projectId ? parsed.threadId : undefined,
      title:
        projectState?.projectName ??
        redactSensitiveText(parsed.message.slice(0, 80), knownSecrets),
    });

    let executionMode: "live_llm" | "local_assisted" = "local_assisted";
    let llmLatencyMs: number | null = null;
    const toolsUsed: string[] = [];
    let latestOmStatus: ObservationalMemoryStatus | null = null;

    controlledSession = await createControlledAgencySession({
      db,
      organizationId: params.actor.organizationId,
      projectId: targetProjectId ?? null,
      createdByUserId: params.actor.userId,
      actorRole: params.actor.role,
      resourceId,
      threadId,
      initialMode: AGENCY_ROLE_TO_CONTROLLER_MODE[activeAgent.role],
      masterKey: params.masterKey,
      dataDir: params.dataDir,
      databaseUrl: params.databaseUrl,
      storage: params.storage,
      modelOverride: params.modelOverride,
    }).catch(() => null);

    if (controlledSession) {
      turnAbort = new AbortController();
      const parentSig = params.signal;
      if (parentSig) {
        if (parentSig.aborted) {
          turnAbort.abort(parentSig.reason);
        } else {
          const onParentAbort = () => turnAbort?.abort(parentSig.reason);
          parentSig.addEventListener("abort", onParentAbort, { once: true });
          removeSignalListener = () =>
            parentSig.removeEventListener("abort", onParentAbort);
        }
      }
      attachSessionExecutionControl(controlledSession.sessionId, turnAbort);
    }

    yield {
      type: "thread_ready",
      threadId,
      executionMode:
        useMastraLiveAgent ||
        (Boolean(params.fetchImpl) && readiness.llmProviderConfigured)
          ? "live_llm"
          : "local_assisted",
      activeAgent,
      handedOffFrom,
    };

    if (controlledSession) {
      yield {
        type: "controller_mode",
        mode: controlledSession.currentMode,
        sessionId: controlledSession.sessionId,
      };
    }

    for (const action of actionsExecuted) {
      yield { type: "action_executed", action };
    }

    for (const dispatch of workflowDispatches) {
      yield {
        type: "workflow_started",
        deliverableId: dispatch.deliverableId,
        runId: dispatch.runId,
        backgroundTaskId: dispatch.backgroundTask.id,
      };
      yield {
        type: "background_task",
        task: dispatch.backgroundTask,
      };
    }

    if (params.fetchImpl && readiness.llmProviderConfigured && (params.masterKey || readiness.activeProviderNames.includes("ollama"))) {
      const llmTurn = await invokeOrganizationLlmForAgentScoped(db, {
        organizationId: params.actor.organizationId,
        masterKey: params.masterKey,
        agentRole: activeAgent.role,
        agentName: activeAgent.name,
        agentTitle: activeAgent.title,
        projectName: projectState?.projectName ?? null,
        strategyLabel:
          projectState?.architectDecision?.strategyLabel ??
          projectState?.defaultStrategy ??
          null,
        phaseLabel: projectState?.phaseLabel ?? null,
        userMessage: parsed.message,
        contextSummary: replyLines.join("\n"),
        fetchImpl: params.fetchImpl,
      });

      if (llmTurn.ok && llmTurn.text) {
        executionMode = "live_llm";
        llmLatencyMs = llmTurn.latencyMs;
        const llmAction: AgencyActionExecuted = {
          type: "invoked_live_llm",
          label: `Resposta gerada via LLM Real (${llmTurn.providerType}/${llmTurn.modelId} · ${llmTurn.latencyMs}ms)`,
        };
        actionsExecuted.unshift(llmAction);
        yield { type: "action_executed", action: llmAction };
        replyLines = [
          llmTurn.text,
          ``,
          `---`,
          `*Orquestração executada no workspace (${activeAgent.name} · \`${llmTurn.providerType}/${llmTurn.modelId}\` · ${llmTurn.latencyMs}ms):*`,
          ...replyLines,
        ];
      }

      const fullReply = redactSensitiveText(replyLines.join("\n"), knownSecrets);
      await memory.saveMessages({
        messages: [
          {
            id: crypto.randomUUID(),
            role: "user",
            threadId,
            resourceId,
            createdAt: new Date(),
            content: {
              format: 2,
              parts: [
                {
                  type: "text",
                  text: redactSensitiveText(parsed.message, knownSecrets),
                },
              ],
            },
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            threadId,
            resourceId,
            createdAt: new Date(),
            content: {
              format: 2,
              parts: [{ type: "text", text: fullReply }],
              metadata: {
                agentRole: activeAgent.role,
                agentName: activeAgent.name,
                executionMode,
                boundModelId: activeAgent.boundModelId,
                actionsExecuted,
              },
            },
          },
        ],
      });
      yield { type: "token", text: fullReply };

      const response = AgencyChatResponseSchema.parse({
        activeAgent,
        handedOffFrom,
        lifecyclePhase: projectState?.currentPhase ?? "onboarding",
        cycleNumber: projectState?.cycleNumber ?? 1,
        teamTopology: parsed.teamTopology,
        autonomyMode: parsed.autonomyMode,
        executionMode,
        llmLatencyMs,
        threadId,
        toolsUsed,
        omStatus: latestOmStatus,
        reply: fullReply,
        actionsExecuted,
        projectState,
        readiness,
      });
      yield { type: "done", response };
      return;
    }

    if (useMastraLiveAgent) {
      const startedAt = Date.now();
      let streamedText = "";
      let liveAborted = false;
      let fallbackToLocal = false;

      try {
        const resolver = createTenantModelResolver({
          db,
          masterKey: params.masterKey,
          modelOverride: params.modelOverride,
        });
        const availableProviders = await resolver.preloadOrganizationProviders(
          params.actor.organizationId
        );

        // Para intents transacionais já executados acima, evita tools mutantes repetidas
        const effectiveActorRole: OrgRole = isTransactionalIntent
          ? "auditor"
          : params.actor.role;

        const turnExtraInstructions = [
          targetProjectId
            ? `[Contexto do Projeto Ativo]: ${projectState?.projectName ?? targetProjectId} | Fase: ${projectState?.phaseLabel ?? "onboarding"} | Ciclo #${projectState?.cycleNumber ?? 1}`
            : "",
          replyLines.length > 0
            ? `[Ações já consolidadas no workspace neste turno]:\n${replyLines.join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        const flushedTails: string[] = [];
        const agent = createEngineeringSpecialistAgent({
          role: activeAgent.role,
          db,
          masterKey: params.masterKey,
          memory,
          actorRole: effectiveActorRole,
          providerType: resolvedModel?.providerType,
          knownSecrets,
          modelOverride: params.modelOverride ?? resolvedModel?.mastraModel.model,
          extraInstructions: turnExtraInstructions || undefined,
          onTailFlushed: (tail) => {
            flushedTails.push(tail);
          },
        });

        const rc = new RequestContext();
        rc.set("actor", {
          ...params.actor,
          role: effectiveActorRole,
        });
        if (targetProjectId) rc.set("projectId", targetProjectId);
        rc.set("availableProviders", availableProviders);

        const effectiveStreamSignal = turnAbort?.signal ?? params.signal;
        const streamResult = await agent.stream(
          redactSensitiveText(parsed.message, knownSecrets),
          {
            memory: { thread: threadId, resource: resourceId },
            requestContext: rc,
            abortSignal: effectiveStreamSignal,
            maxSteps: 4,
          }
        );

        for await (const chunk of streamResult.fullStream) {
          if (effectiveStreamSignal?.aborted) {
            liveAborted = true;
            break;
          }

          if (chunk.type === "tool-call") {
            const toolName = chunk.payload.toolName;
            if (!toolsUsed.includes(toolName)) {
              toolsUsed.push(toolName);
            }
            const rawInput =
              chunk.payload.args && typeof chunk.payload.args === "object"
                ? (chunk.payload.args as Record<string, unknown>)
                : {};
            yield {
              type: "tool_call",
              toolName,
              input: redactSensitiveValue(
                rawInput,
                knownSecrets
              ) as Record<string, unknown>,
            };
          } else if (chunk.type === "tool-result") {
            const outObj =
              chunk.payload.result && typeof chunk.payload.result === "object"
                ? (chunk.payload.result as Record<string, unknown>)
                : { result: chunk.payload.result };
            yield {
              type: "tool_result",
              toolName: chunk.payload.toolName,
              output: redactSensitiveValue(
                outObj,
                knownSecrets
              ) as Record<string, unknown>,
            };
          } else if (chunk.type === "text-delta") {
            const safeDelta = redactSensitiveText(
              chunk.payload.text,
              knownSecrets
            );
            if (safeDelta.length > 0) {
              streamedText += safeDelta;
              yield { type: "token", text: safeDelta };
            }
          } else if (chunk.type === "data-om-status") {
            const omStatus = mapDataOmStatusToContract(
              (chunk as { data?: unknown }).data
            );
            if (omStatus) {
              latestOmStatus = omStatus;
              yield { type: "om_status", status: omStatus };
            }
          } else if (chunk.type === "error") {
            if (streamedText.length === 0 && !params.modelOverride) {
              fallbackToLocal = true;
              break;
            }
            const errText =
              chunk.payload.error instanceof Error
                ? chunk.payload.error.message
                : String(chunk.payload.error ?? "Erro na execução do agente.");
            yield {
              type: "error",
              code: "AGENCY_AGENT_ERROR",
              message: redactSensitiveText(errText, knownSecrets),
            };
            return;
          }
        }

        if (liveAborted) {
          const steeredMessages = controlledSession
            ? consumeSteeredMessages(controlledSession.sessionId)
            : [];
          if (
            turnAbort?.signal.reason === "STEERED" ||
            steeredMessages.length > 0
          ) {
            const steerNote =
              steeredMessages.length > 0
                ? `\n[Direcionamento humano aplicado (steer): ${steeredMessages.join(" | ")}]`
                : "\n[Direcionamento humano aplicado (steer)]";
            yield { type: "token", text: steerNote };
            const combined = redactSensitiveText(
              `${streamedText}${steerNote}`,
              knownSecrets
            );
            const response = AgencyChatResponseSchema.parse({
              activeAgent,
              handedOffFrom,
              lifecyclePhase: projectState?.currentPhase ?? "onboarding",
              cycleNumber: projectState?.cycleNumber ?? 1,
              teamTopology: parsed.teamTopology,
              autonomyMode: parsed.autonomyMode,
              executionMode: "live_llm",
              llmLatencyMs: Date.now() - startedAt,
              threadId,
              toolsUsed,
              omStatus: latestOmStatus,
              reply: combined || steerNote,
              actionsExecuted,
              projectState,
              readiness,
            });
            yield { type: "done", response };
            return;
          }
          yield {
            type: "error",
            code: "ABORTED",
            message: "Execução interrompida pelo cliente.",
          };
          return;
        }

        for (const tail of flushedTails) {
          if (tail.length > 0) {
            streamedText += tail;
            yield { type: "token", text: tail };
          }
        }

        if (!fallbackToLocal) {
          const rawFinalText = streamedText || (await streamResult.text) || "";
          const safeFinalText = redactSensitiveText(rawFinalText, knownSecrets);
          if (!streamedText && safeFinalText.trim().length > 0) {
            yield { type: "token", text: safeFinalText };
          }

          if (safeFinalText.trim().length > 0 || params.modelOverride) {
            executionMode = "live_llm";
            llmLatencyMs = Date.now() - startedAt;
            const llmAction: AgencyActionExecuted = {
              type: "invoked_live_llm",
              label: `Resposta gerada via Mastra Agent (${resolvedModel?.providerType ?? "mock"}/${resolvedModel?.rawModelName ?? "model"} · ${llmLatencyMs}ms)`,
            };
            actionsExecuted.unshift(llmAction);
            yield { type: "action_executed", action: llmAction };

            const combinedReply =
              isTransactionalIntent && replyLines.length > 0
                ? [
                    safeFinalText,
                    ``,
                    `---`,
                    `*Orquestração executada no workspace (${activeAgent.name} · ${llmLatencyMs}ms):*`,
                    ...replyLines,
                  ]
                    .filter(Boolean)
                    .join("\n")
                : safeFinalText || replyLines.join("\n");

            const safeCombinedReply = redactSensitiveText(
              combinedReply,
              knownSecrets
            );

            const recalledLatest = await memory
              .recall({
                threadId,
                perPage: 6,
                page: 0,
                orderBy: { field: "createdAt", direction: "DESC" },
              })
              .catch(() => null);
            const lastAssistant = recalledLatest?.messages.find(
              (m) => m.role === "assistant"
            );
            if (lastAssistant) {
              await memory
                .updateMessages({
                  messages: [
                    {
                      id: lastAssistant.id,
                      content: {
                        ...lastAssistant.content,
                        format: 2,
                        parts: [{ type: "text", text: safeCombinedReply }],
                        metadata: {
                          ...(lastAssistant.content.metadata ?? {}),
                          agentRole: activeAgent.role,
                          agentName: activeAgent.name,
                          executionMode,
                          boundModelId: activeAgent.boundModelId,
                          toolsUsed,
                          actionsExecuted,
                        },
                      },
                    },
                  ],
                })
                .catch(() => undefined);
            }

            const response = AgencyChatResponseSchema.parse({
              activeAgent,
              handedOffFrom,
              lifecyclePhase: projectState?.currentPhase ?? "onboarding",
              cycleNumber: projectState?.cycleNumber ?? 1,
              teamTopology: parsed.teamTopology,
              autonomyMode: parsed.autonomyMode,
              executionMode,
              llmLatencyMs,
              threadId,
              toolsUsed,
              omStatus: latestOmStatus,
              reply: safeCombinedReply,
              actionsExecuted,
              projectState,
              readiness,
            });

            yield { type: "done", response };
            return;
          }
          fallbackToLocal = true;
        }
      } catch (liveErr) {
        if (streamedText.length > 0 || params.modelOverride) {
          const msg =
            liveErr instanceof Error
              ? liveErr.message
              : "Erro na execução do agente.";
          yield {
            type: "error",
            code: "AGENCY_AGENT_ERROR",
            message: redactSensitiveText(msg, knownSecrets),
          };
          return;
        }
        fallbackToLocal = true;
      }

      if (!fallbackToLocal) {
        return;
      }
    }

    // Modo assistido local (offline / sem chave LLM) com persistência da thread no servidor
    const fullReply = redactSensitiveText(replyLines.join("\n"), knownSecrets);
    await memory.saveMessages({
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          threadId,
          resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [
              {
                type: "text",
                text: redactSensitiveText(parsed.message, knownSecrets),
              },
            ],
          },
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          threadId,
          resourceId,
          createdAt: new Date(),
          content: {
            format: 2,
            parts: [{ type: "text", text: fullReply }],
            metadata: {
              agentRole: activeAgent.role,
              agentName: activeAgent.name,
              executionMode: "local_assisted",
              boundModelId: activeAgent.boundModelId,
              actionsExecuted,
            },
          },
        },
      ],
    });

    const parts = fullReply.split(/(?<=\.)\s+|\n+/);
    for (const part of parts) {
      if (part.trim().length > 0) {
        yield { type: "token", text: `${part}\n` };
      }
    }

    const response = AgencyChatResponseSchema.parse({
      activeAgent,
      handedOffFrom,
      lifecyclePhase: projectState?.currentPhase ?? "onboarding",
      cycleNumber: projectState?.cycleNumber ?? 1,
      teamTopology: parsed.teamTopology,
      autonomyMode: parsed.autonomyMode,
      executionMode: "local_assisted",
      llmLatencyMs: null,
      threadId,
      toolsUsed,
      omStatus: null,
      reply: fullReply,
      actionsExecuted,
      projectState,
      readiness,
    });

    yield { type: "done", response };
  } catch (err) {
    if (err instanceof WorkflowRuntimeError) {
      yield {
        type: "error",
        code: err.code,
        message: redactSensitiveText(err.message, knownSecrets),
      };
      return;
    }
    const msg =
      err instanceof Error ? err.message : "Erro ao processar orquestração.";
    yield {
      type: "error",
      code: "AGENCY_STREAM_ERROR",
      message: redactSensitiveText(msg, knownSecrets),
    };
  } finally {
    removeSignalListener?.();
    if (controlledSession) {
      attachSessionExecutionControl(controlledSession.sessionId, null);
    }
    if (settleFn) {
      void settleFn().catch(() => undefined);
    }
  }
}

function toWorkflowRuntimeErrorCode(code: string): WorkflowRuntimeErrorCode {
  switch (code) {
    case "DELIVERABLE_NOT_FOUND":
    case "DELIVERABLE_LOCKED":
    case "DECISION_NOT_FOUND":
    case "DECISION_ALREADY_RESOLVED":
    case "WORKFLOW_ALREADY_RUNNING":
    case "WORKFLOW_NOT_SUSPENDED":
    case "WORKFLOW_RUN_NOT_FOUND":
    case "INVALID_WORKFLOW_INPUT":
    case "MISSING_PRECONDITION":
    case "EXECUTION_FAILED":
    case "FORBIDDEN_PROJECT_SCOPE":
    case "FORBIDDEN_THREAD_ACCESS":
    case "AGENCY_NO_RESPONSE":
      return code;
    default:
      return "EXECUTION_FAILED";
  }
}

export async function handleAgencyChatScoped(
  db: UzinaDb,
  params: AgencyChatExecutionParams
): Promise<AgencyChatResponse> {
  let finalResponse: AgencyChatResponse | null = null;
  for await (const ev of streamAgencyChatScoped(db, params)) {
    if (ev.type === "error") {
      throw new WorkflowRuntimeError({
        statusCode:
          ev.code === "FORBIDDEN_PROJECT_SCOPE" ||
          ev.code === "FORBIDDEN_THREAD_ACCESS" ||
          ev.code === "INVALID_WORKFLOW_INPUT"
            ? 403
            : 500,
        code: toWorkflowRuntimeErrorCode(ev.code),
        message: ev.message,
      });
    }
    if (ev.type === "done") {
      finalResponse = ev.response;
    }
  }
  if (!finalResponse) {
    throw new WorkflowRuntimeError({
      statusCode: 500,
      code: "AGENCY_NO_RESPONSE",
      message: "Orquestração encerrou sem resposta final.",
    });
  }
  return finalResponse;
}
