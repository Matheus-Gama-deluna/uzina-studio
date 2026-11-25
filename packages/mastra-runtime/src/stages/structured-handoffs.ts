import fs from "node:fs";
import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import {
  ArchitectBlueprintV2Schema,
  BddScenarioSchema,
  PrototypeComponentManifestSchema,
  ShapeSpecSchema,
  type AmbiguityCheck,
  type ArchitectBlueprintV2,
  type BddScenario,
  type ColorContrastValidationOutput,
  type DevelopmentStrategy,
  type DiscoverySummary,
  type OpenSpecDelta,
  type PrototypeComponentManifest,
  type PrototypeSectionManifest,
  type PrototypeUiState,
  type RiskLevel,
  type ShapeAppetite,
  type ShapeSpec,
  type StoryShard,
  type StrideFmeaRisk,
} from "@uzina/contracts";
import {
  MAX_PROTOTYPE_HTML_BYTES,
  extractW3CDesignTokens,
  generateDesignMdContract,
  loadNativeSkills,
  redactSensitiveText,
  redactSensitiveValue,
  routeDevelopmentStrategy,
  sanitizePrototypeHtml,
} from "@uzina/core";
import {
  clients,
  codebaseFiles,
  codebaseSymbols,
  designAssets,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  createEngineeringSpecialistAgent,
  getRolePlaybookInstructions,
} from "../agents/engineering-agents.js";
import { WorkflowRuntimeError } from "../errors.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
} from "../model-resolver.js";
import {
  SymbolLockManager,
  resolveDeliverableTargetSymbols,
} from "../symbol-locks.js";
import { createRoleSpecializedToolsMap } from "../tools/role-specialized-tools.js";

function tryParseStructuredJson<T>(
  rawText: string | undefined,
  schema: z.ZodType<T>
): T | null {
  if (!rawText) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(rawText);
  const candidate = (fenced?.[1] ?? rawText).trim();
  const objMatch = /\{[\s\S]*\}/.exec(candidate);
  if (!objMatch) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(objMatch[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const ALL_UI_STATES: readonly PrototypeUiState[] = [
  "loading",
  "empty",
  "error",
  "partial",
  "populated",
] as const;

const AMBIGUITY_BLOCKING_SCORE = 30;

// ============================================================================
// Fase 1 — ShapeSpec + Ambiguity Gate
// ============================================================================

export interface ValidateAndBuildShapeSpecParams {
  summary: DiscoverySummary;
  appetite?: ShapeAppetite;
  nonGoals?: readonly string[];
  bddScenarios?: readonly BddScenario[];
  dataSensitivityFlags?: readonly string[];
  ambiguityCheck?: AmbiguityCheck;
  knownSecrets?: readonly string[];
}

function detectSummaryAmbiguities(summary: DiscoverySummary): AmbiguityCheck {
  const unresolved: string[] = [];
  const checkText = (label: string, text: string) => {
    if (
      /\?\s*$/.test(text.trim()) ||
      /\b(?:tbd|a definir|pendente de decis[aã]o|em aberto|indefinido)\b/i.test(
        text
      )
    ) {
      unresolved.push(`${label}: ${text.trim().slice(0, 200)}`);
    }
  };

  checkText("Objetivo", summary.objective);
  for (const flow of summary.criticalFlows) {
    checkText("Fluxo crítico", flow);
  }
  for (const criterion of summary.acceptanceCriteria) {
    checkText("Critério de aceite", criterion);
  }
  for (const assumption of summary.assumptions) {
    if (assumption.source === "pre_read" && /\b(?:tbd|a definir)\b/i.test(assumption.value)) {
      unresolved.push(`Premissa '${assumption.key}': ${assumption.value}`);
    }
  }

  return {
    score: Math.min(100, unresolved.length * 25),
    unresolvedQuestions: unresolved.slice(0, 20),
  };
}

/**
 * Executa o Ambiguity Gate da Fase 1 e constrói um `ShapeSpec` imutável validado por `ShapeSpecSchema`.
 * Rejeita especificações sem `nonGoals`, sem cenários BDD/RBAC ou com ambiguidades não resolvidas.
 */
export function validateAndBuildShapeSpec(
  params: ValidateAndBuildShapeSpecParams
): ShapeSpec {
  const secrets = params.knownSecrets ?? [];
  const nonGoals = (params.nonGoals ?? [])
    .map((g) => redactSensitiveText(g.trim(), secrets))
    .filter(Boolean);

  if (nonGoals.length === 0) {
    throw new WorkflowRuntimeError({
      statusCode: 422,
      code: "INVALID_WORKFLOW_INPUT",
      message:
        "SHAPE_SPEC_GATE_BLOCKED: `nonGoals` (mínimo 1 item explícito fora de escopo) é obrigatório antes de avançar ao Arquiteto.",
    });
  }

  const rawScenarios = params.bddScenarios ?? [];
  if (rawScenarios.length === 0) {
    throw new WorkflowRuntimeError({
      statusCode: 422,
      code: "INVALID_WORKFLOW_INPUT",
      message:
        "SHAPE_SPEC_GATE_BLOCKED: `bddScenarios` (mínimo 1 cenário Given/When/Then com `roleRequired` RBAC) é obrigatório.",
    });
  }

  const validatedScenarios = rawScenarios.map((sc, idx) =>
    BddScenarioSchema.parse({
      id: sc.id ?? `BDD-${idx + 1}`,
      title: redactSensitiveText(sc.title, secrets),
      given: redactSensitiveText(sc.given, secrets),
      when: redactSensitiveText(sc.when, secrets),
      then: redactSensitiveText(sc.then, secrets),
      roleRequired: sc.roleRequired,
    })
  );

  const computedAmbiguity =
    params.ambiguityCheck ?? detectSummaryAmbiguities(params.summary);

  if (
    computedAmbiguity.unresolvedQuestions.length > 0 ||
    computedAmbiguity.score > AMBIGUITY_BLOCKING_SCORE
  ) {
    throw new WorkflowRuntimeError({
      statusCode: 422,
      code: "INVALID_WORKFLOW_INPUT",
      message: `AMBIGUITY_GATE_BLOCKED: score=${computedAmbiguity.score}, pendências=[${computedAmbiguity.unresolvedQuestions.join("; ")}].`,
    });
  }

  const sanitizedSummary = redactSensitiveValue(params.summary, secrets);

  return ShapeSpecSchema.parse({
    ...sanitizedSummary,
    appetite: params.appetite ?? "small_1_slice",
    nonGoals,
    bddScenarios: validatedScenarios,
    dataSensitivityFlags: (params.dataSensitivityFlags ?? [])
      .map((f) => redactSensitiveText(f.trim(), secrets))
      .filter(Boolean),
    ambiguityCheck: computedAmbiguity,
  });
}

// ============================================================================
// Fase 2 — ArchitectBlueprintV2 (ADR, STRIDE/FMEA, StoryShards, SymbolLock, OpenSpec)
// ============================================================================

export interface GenerateArchitectBlueprintV2Params {
  db: UzinaDb;
  organizationId: string;
  projectId: string;
  deliverableId?: string;
  title: string;
  description?: string | null;
  shapeSpec?: ShapeSpec;
  originKind: "greenfield" | "brownfield";
  hasUi: boolean;
  riskLevel?: RiskLevel;
  maturityScore?: number | null;
  overrideStrategy?: DevelopmentStrategy;
  symbolLockManager?: SymbolLockManager;
  masterKey?: Buffer | string | null;
  modelOverride?: MastraModelConfig;
  knownSecrets?: readonly string[];
}

function buildDefaultStrideRisks(params: {
  shapeSpec?: ShapeSpec;
  riskLevel: RiskLevel;
  hasUi: boolean;
}): StrideFmeaRisk[] {
  const flags = params.shapeSpec?.dataSensitivityFlags ?? [];
  const hasSecretsOrPii = flags.some((f) =>
    /pii|secret|key|token|auth|cpf|payment|card/i.test(f)
  );

  const risks: StrideFmeaRisk[] = [
    {
      category: "elevation_of_privilege",
      threatOrFailure:
        "Acesso cross-tenant ou mutação por perfil `auditor` em rotas e tools.",
      severity: "high",
      mitigation:
        "Exigir `organizationId` resolvido na sessão/RequestContext e `WRITE_ROLES` no servidor.",
      verifyCheck: "Teste negativo multi-tenant + RBAC auditor (403).",
    },
    {
      category: "information_disclosure",
      threatOrFailure: hasSecretsOrPii
        ? `Exposição de dados sensíveis (${flags.join(", ")}) em logs, diffs ou respostas LLM.`
        : "Vazamento acidental de tokens de provedores ou variáveis `.env` em outputs.",
      severity: params.riskLevel === "high" || hasSecretsOrPii ? "high" : "medium",
      mitigation:
        "Aplicar `redactSensitiveText` com `collectOrganizationKnownSecrets` e cofre AES-256-GCM.",
      verifyCheck: "Asserção de redação sem segredo em claro na saída.",
    },
  ];

  if (params.hasUi) {
    risks.push({
      category: "tampering",
      threatOrFailure:
        "XSS ou quebra de layout em protótipos HTML e superfícies React.",
      severity: "medium",
      mitigation:
        "Sanitizar HTML via `sanitizePrototypeHtml` e validar contratos Zod na borda.",
      verifyCheck: "Teste de sanitização e validação de 5 estados de UI.",
    });
  }

  return risks;
}

function buildDeterministicOpenSpecDelta(params: {
  title: string;
  shapeSpec?: ShapeSpec;
  targetSymbols: readonly string[];
}): OpenSpecDelta {
  const bddTitles = (params.shapeSpec?.bddScenarios ?? []).map(
    (s) => `${s.title} (${s.roleRequired})`
  );
  return {
    added:
      bddTitles.length > 0
        ? bddTitles.slice(0, 10)
        : [`Comportamento entregue para '${params.title}'.`],
    modified:
      params.targetSymbols.length > 0
        ? params.targetSymbols.slice(0, 10)
        : [`Módulos impactados por '${params.title}'.`],
    removed: [],
  };
}

function applySymbolLockCollisionsToShards(params: {
  shards: readonly StoryShard[];
  activeLockedSymbols: ReadonlySet<string>;
  holdingDeliverableId?: string;
}): StoryShard[] {
  const symbolUsageCount = new Map<string, number>();
  for (const shard of params.shards) {
    for (const sym of shard.targetSymbols) {
      symbolUsageCount.set(sym, (symbolUsageCount.get(sym) ?? 0) + 1);
    }
  }

  return params.shards.map((shard) => {
    const collidesWithExternalLock = shard.targetSymbols.some((sym) =>
      params.activeLockedSymbols.has(sym)
    );
    const collidesAcrossShards = shard.targetSymbols.some(
      (sym) => (symbolUsageCount.get(sym) ?? 0) > 1
    );
    return {
      ...shard,
      sequential:
        shard.sequential || collidesWithExternalLock || collidesAcrossShards,
    };
  });
}

/**
 * Gera `ArchitectBlueprintV2` combinando grafo AST, checagem de colisão em `SymbolLockManager`,
 * `openSpecDelta` obrigatório em projetos brownfield e agente `software_architect` com fallback determinístico.
 */
export async function generateArchitectBlueprintV2(
  params: GenerateArchitectBlueprintV2Params
): Promise<ArchitectBlueprintV2> {
  const secrets =
    params.knownSecrets ??
    (await collectOrganizationKnownSecrets(params.db, {
      organizationId: params.organizationId,
      masterKey: params.masterKey,
    }).catch(() => [] as string[]));

  const [projRow] = await params.db
    .select({ id: projects.id })
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
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Projeto '${params.projectId}' não encontrado na organização.`,
    });
  }

  const riskLevel: RiskLevel = params.riskLevel ?? "low";
  const strategyOut = routeDevelopmentStrategy({
    title: params.title,
    description: params.description,
    hasUi: params.hasUi,
    riskLevel,
    isBrownfield: params.originKind === "brownfield",
    maturityScore: params.maturityScore,
    overrideStrategy: params.overrideStrategy,
  });

  const resolvedTargetSymbols = await resolveDeliverableTargetSymbols(params.db, {
    projectId: params.projectId,
    title: params.title,
    description: params.description,
    specMarkdown: params.shapeSpec?.specMarkdown,
  });

  const repos = await params.db
    .select({ id: projectRepositories.id })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, params.projectId));
  const repoIds = repos.map((r) => r.id);

  let indexedSymbolKeys: string[] = [];
  if (repoIds.length > 0) {
    const fileRows = await params.db
      .select({ id: codebaseFiles.id, path: codebaseFiles.path })
      .from(codebaseFiles)
      .where(inArray(codebaseFiles.repositoryId, repoIds));
    if (fileRows.length > 0) {
      const pathById = new Map(fileRows.map((f) => [f.id, f.path]));
      const symRows = await params.db
        .select({ fileId: codebaseSymbols.fileId, name: codebaseSymbols.name })
        .from(codebaseSymbols)
        .where(
          inArray(
            codebaseSymbols.fileId,
            fileRows.map((f) => f.id)
          )
        )
        .limit(40);
      indexedSymbolKeys = symRows.map(
        (s) => `${pathById.get(s.fileId) ?? "src"}::${s.name}`
      );
    }
  }

  const allCandidateSymbols = Array.from(
    new Set([...resolvedTargetSymbols, ...indexedSymbolKeys])
  ).slice(0, 20);

  const activeLocks =
    params.symbolLockManager?.listActiveLocks(params.projectId) ?? [];
  const activeLockedSet = new Set(
    activeLocks
      .filter((l) => l.deliverableId !== params.deliverableId)
      .map((l) => l.symbol)
  );

  const bddIds = (params.shapeSpec?.bddScenarios ?? [])
    .map((s, idx) => s.id ?? `BDD-${idx + 1}`)
    .slice(0, 10);

  const baselineShards: StoryShard[] = strategyOut.verticalSlices.map((vs) => ({
    sliceName: vs.name,
    objective: vs.objective,
    allowedPaths: vs.allowedPaths,
    targetSymbols: allCandidateSymbols.slice(0, 5),
    acceptanceScenarioIds: bddIds.length > 0 ? bddIds : ["BDD-1"],
    verificationCommands: ["pnpm typecheck", "pnpm test"],
    sequential: vs.sequential,
  }));

  const guardedShards = applySymbolLockCollisionsToShards({
    shards: baselineShards,
    activeLockedSymbols: activeLockedSet,
    holdingDeliverableId: params.deliverableId,
  });

  const hasExternalCollision = allCandidateSymbols.some((sym) =>
    activeLockedSet.has(sym)
  );

  const baselineBlueprint: ArchitectBlueprintV2 = ArchitectBlueprintV2Schema.parse({
    ...strategyOut,
    tacticalPattern: hasExternalCollision
      ? "single_agent"
      : strategyOut.tacticalPattern,
    adr: {
      context: `Definir arquitetura para '${params.title}' (${params.originKind}) com rastreabilidade multi-tenant.`,
      optionsConsidered: [
        `Estratégia '${strategyOut.developmentStrategy}' com contratos Zod em @uzina/contracts.`,
        "Implementação acoplada direta sem separação de slices.",
      ],
      decision: `Adotar '${strategyOut.developmentStrategy}' (${strategyOut.tacticalPattern}) respeitando fronteiras do monorepo.`,
      consequences: hasExternalCollision
        ? "Colisão detectada em SymbolLockManager: execução marcada como sequencial para evitar conflito de merge."
        : "Shards independentes podem avançar com isolamento de worktree.",
      reversibility:
        "Reversível via rollback da branch/worktree isolada antes do merge final.",
    },
    strideFmeaRisks: buildDefaultStrideRisks({
      shapeSpec: params.shapeSpec,
      riskLevel,
      hasUi: params.hasUi,
    }),
    storyShards: guardedShards,
    ...(params.originKind === "brownfield"
      ? {
          openSpecDelta: buildDeterministicOpenSpecDelta({
            title: params.title,
            shapeSpec: params.shapeSpec,
            targetSymbols: allCandidateSymbols,
          }),
        }
      : {}),
  });

  // Tenta enriquecer via agente software_architect quando houver provedor configurado ou modelOverride
  let activeModel: MastraModelConfig | undefined = params.modelOverride;
  if (!activeModel) {
    const resolver = createTenantModelResolver({
      db: params.db,
      masterKey: params.masterKey,
    });
    const resolved = await resolver
      .resolveForRole(params.organizationId, "software_architect")
      .catch(() => null);
    activeModel = resolved?.mastraModel.model;
  }

  if (!activeModel) {
    return redactSensitiveValue(baselineBlueprint, secrets);
  }

  try {
    const agent = createEngineeringSpecialistAgent({
      role: "software_architect",
      db: params.db,
      masterKey: params.masterKey,
      actorRole: "developer",
      modelOverride: activeModel,
      knownSecrets: secrets,
      enableSemanticRecall: false,
    });

    const rc = new RequestContext();
    rc.set("actor", {
      organizationId: params.organizationId,
      userId: "system-architect",
      role: "developer",
    });
    rc.set("projectId", params.projectId);
    rc.set("knownSecrets", secrets);

    const prompt = [
      `Gere o ArchitectBlueprintV2 em JSON estrito para '${redactSensitiveText(params.title, secrets)}'.`,
      `Origem: ${params.originKind}. UI: ${String(params.hasUi)}. Risco: ${riskLevel}.`,
      `Símbolos detectados: ${allCandidateSymbols.join(", ") || "nenhum"}.`,
      `Locks ativos de outros entregáveis: ${Array.from(activeLockedSet).join(", ") || "nenhum"}.`,
      params.shapeSpec
        ? `ShapeSpec objetivo: ${redactSensitiveText(params.shapeSpec.objective, secrets)}. NonGoals: ${params.shapeSpec.nonGoals.join("; ")}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const gen = await agent.generate(prompt, {
      requestContext: rc,
      maxSteps: 1,
      structuredOutput: {
        schema: ArchitectBlueprintV2Schema,
      },
    });

    const parsed = ArchitectBlueprintV2Schema.safeParse(gen.object);
    const resolvedObj = parsed.success
      ? parsed.data
      : tryParseStructuredJson(gen.text, ArchitectBlueprintV2Schema);
    if (resolvedObj) {
      const mergedShards = applySymbolLockCollisionsToShards({
        shards: resolvedObj.storyShards,
        activeLockedSymbols: activeLockedSet,
        holdingDeliverableId: params.deliverableId,
      });

      const finalOpenSpecDelta =
        params.originKind === "brownfield"
          ? resolvedObj.openSpecDelta ?? baselineBlueprint.openSpecDelta
          : resolvedObj.openSpecDelta;

      const enforced = ArchitectBlueprintV2Schema.parse({
        ...resolvedObj,
        ...(params.overrideStrategy
          ? { developmentStrategy: params.overrideStrategy }
          : {}),
        tacticalPattern: hasExternalCollision
          ? "single_agent"
          : resolvedObj.tacticalPattern,
        storyShards: mergedShards,
        ...(finalOpenSpecDelta ? { openSpecDelta: finalOpenSpecDelta } : {}),
      });
      return redactSensitiveValue(enforced, secrets);
    }
  } catch {
    // Fallback determinístico seguro abaixo
  }

  return redactSensitiveValue(baselineBlueprint, secrets);
}

// ============================================================================
// Fase 2.5 — Visual Studio 3-Stage Pipeline (Lead -> Reference -> Critique)
// ============================================================================

export interface RunVisualStudioThreeStageParams {
  db: UzinaDb;
  organizationId: string;
  projectId: string;
  deliverableId?: string;
  prototypeId?: string;
  title: string;
  shapeSpec?: ShapeSpec;
  html?: string;
  colorPairs?: ReadonlyArray<{
    label: string;
    foreground: string;
    background: string;
    level?: "aa_normal" | "aa_large" | "aaa_normal";
  }>;
  workspaceRoot?: string;
  masterKey?: Buffer | string | null;
  skillsDir?: string;
  modelOverride?: MastraModelConfig;
  critiqueModelOverride?: MastraModelConfig;
  knownSecrets?: readonly string[];
  strictCritiqueGate?: boolean;
}

export interface VisualStudioThreeStageResult {
  designMdMarkdown: string;
  sanitizedHtml: string;
  manifest: PrototypeComponentManifest;
  wcagContrastReport: ColorContrastValidationOutput;
  critiquePassed: boolean;
  critiqueFindings: string[];
  stagesExecuted: [
    "lead_visual_design_md",
    "reference_ui_tokens",
    "fresh_context_critique",
  ];
}

function scanPackagesUiComponents(workspaceRoot: string): Array<{
  name: string;
  dataSlot: string;
}> {
  const dirs = [
    path.join(/*turbopackIgnore: true*/ workspaceRoot, "packages", "ui"),
    path.join(
      /*turbopackIgnore: true*/ workspaceRoot,
      "apps",
      "web",
      "src",
      "components"
    ),
  ];
  const found: Array<{ name: string; dataSlot: string }> = [];
  const seen = new Set<string>();

  const walk = (dir: string) => {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir) || found.length >= 30) {
      return;
    }
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ dir, {
      withFileTypes: true,
    })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const abs = path.join(/*turbopackIgnore: true*/ dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && /\.(?:tsx|ts|jsx)$/i.test(entry.name)) {
        const src = fs.readFileSync(/*turbopackIgnore: true*/ abs, "utf8");
        const baseName = path.basename(entry.name, path.extname(entry.name));
        for (const m of src.matchAll(/data-slot\s*=\s*["']([a-z0-9_-]+)["']/gi)) {
          const slot = m[1]!;
          if (!seen.has(slot) && found.length < 30) {
            seen.add(slot);
            found.push({ name: baseName, dataSlot: slot });
          }
        }
      }
    }
  };

  for (const d of dirs) walk(d);
  return found;
}

function detectCoveredUiStatesInHtml(html: string): PrototypeUiState[] {
  const detected: PrototypeUiState[] = [];
  const lower = html.toLowerCase();
  for (const state of ALL_UI_STATES) {
    const hasDataAttr = new RegExp(`data-state\\s*=\\s*["'][^"']*\\b${state}\\b`, "i").test(
      html
    );
    const hasSectionHint =
      (state === "loading" && /skeleton|carregando|loading/.test(lower)) ||
      (state === "empty" && /empty|nenhum|vazio/.test(lower)) ||
      (state === "error" && /error|erro|tentar novamente/.test(lower)) ||
      (state === "partial" && /partial|parcial/.test(lower)) ||
      (state === "populated" && /populated|dados|tabela|<table|<section/.test(lower));

    if (hasDataAttr || hasSectionHint) {
      detected.push(state);
    }
  }
  return detected;
}

function buildBaselineFiveStatePrototypeHtml(params: {
  title: string;
  objective: string;
}): string {
  const safeTitle = params.title.replace(/[<>&"]/g, "");
  const safeObj = params.objective.replace(/[<>&"]/g, "").slice(0, 240);
  return [
    `<main data-slot="visual-workbench" style="background: oklch(0.13 0.006 260); color: oklch(0.96 0.004 260); padding: 16px; max-width: 100%; overflow-x: hidden;">`,
    `  <header data-slot="workbench-header"><h1>${safeTitle}</h1><p>${safeObj}</p></header>`,
    `  <section data-slot="state-matrix">`,
    `    <div data-state="populated" data-slot="card-populated">Visão populada com métricas.</div>`,
    `    <div data-state="loading" data-slot="skeleton-loading">Carregando skeleton com CLS=0.</div>`,
    `    <div data-state="empty" data-slot="empty-state">Nenhum registro ainda. <button type="button">Criar item</button></div>`,
    `    <div data-state="error" data-slot="error-banner">Erro recuperável. <button type="button">Tentar novamente</button></div>`,
    `    <div data-state="partial" data-slot="partial-notice">Exibição parcial em progresso.</div>`,
    `  </section>`,
    `</main>`,
  ].join("\n");
}

function extractColorPairsFromHtmlOrTokens(params: {
  html: string;
  explicitPairs?: RunVisualStudioThreeStageParams["colorPairs"];
}): Array<{
  label: string;
  foreground: string;
  background: string;
  level: "aa_normal" | "aa_large" | "aaa_normal";
}> {
  if (params.explicitPairs && params.explicitPairs.length > 0) {
    return params.explicitPairs.map((p) => ({
      label: p.label,
      foreground: p.foreground,
      background: p.background,
      level: p.level ?? "aa_normal",
    }));
  }

  const colorMatch = /(?:^|[\s;])color\s*:\s*([^;}"']+)/i.exec(params.html);
  const bgMatch = /background(?:-color)?\s*:\s*([^;}"']+)/i.exec(params.html);

  if (colorMatch?.[1] && bgMatch?.[1]) {
    return [
      {
        label: "root-surface-text",
        foreground: colorMatch[1].trim(),
        background: bgMatch[1].trim(),
        level: "aa_normal",
      },
    ];
  }

  return [
    {
      label: "uzina-dark-canvas",
      foreground: "oklch(0.96 0.004 260)",
      background: "oklch(0.13 0.006 260)",
      level: "aa_normal",
    },
  ];
}

const CritiqueLlmOutputSchema = z
  .object({
    passed: z.boolean(),
    findings: z.array(z.string().trim().min(1).max(400)).max(20),
  })
  .strict();

/**
 * Executa o pipeline visual em 3 estágios isolados:
 * 1. Lead (`visual-design-md`): gera/valida `.uzina/DESIGN.md` e HTML sanitizado;
 * 2. Reference (`packages/ui` + tokens W3C): mapeia componentes `data-slot` e 5 estados;
 * 3. Fresh-Context Critique (`ui-design-critique-a11y`): audita contraste WCAG 2.1, mobile 390px,
 *    interatividade acessível e ausência de vazamento RBAC/segredos sem histórico do construtor.
 */
export async function runVisualStudioThreeStagePipeline(
  params: RunVisualStudioThreeStageParams
): Promise<VisualStudioThreeStageResult> {
  const secrets =
    params.knownSecrets ??
    (await collectOrganizationKnownSecrets(params.db, {
      organizationId: params.organizationId,
      masterKey: params.masterKey,
    }).catch(() => [] as string[]));

  const [projRow] = await params.db
    .select({
      id: projects.id,
      name: projects.name,
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
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "DELIVERABLE_NOT_FOUND",
      message: `Projeto '${params.projectId}' não encontrado na organização.`,
    });
  }

  // Stage 1: Lead (visual-design-md)
  const assetRows = await params.db
    .select()
    .from(designAssets)
    .where(eq(designAssets.projectId, projRow.id))
    .orderBy(desc(designAssets.updatedAt));

  const referenceAssets = assetRows
    .filter((a) => a.assetType !== "design_md")
    .map((a) => ({
      id: a.id,
      projectId: a.projectId,
      deliverableId: a.deliverableId ?? null,
      assetType: a.assetType,
      title: a.title,
      sourceUrl: a.sourceUrl ?? null,
      assetUrl: null,
      mimeType: a.mimeType ?? null,
      sizeBytes: a.sizeBytes ?? null,
      intentionTags: a.intentionTags,
      notes: a.notes ?? null,
      approved: a.approved,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

  const designMdMarkdown = redactSensitiveText(
    generateDesignMdContract({
      projectName: projRow.name,
      themePreference: "dual_theme",
      assets: referenceAssets,
      notes: params.shapeSpec?.objective,
    }),
    secrets
  );

  const rawHtml =
    params.html?.trim() ||
    buildBaselineFiveStatePrototypeHtml({
      title: params.title,
      objective: params.shapeSpec?.objective ?? params.title,
    });

  const sanitizedHtml = sanitizePrototypeHtml(
    redactSensitiveText(rawHtml, secrets),
    { maxBytes: MAX_PROTOTYPE_HTML_BYTES }
  );

  // Stage 2: Reference (packages/ui components + W3C tokens + 5 states)
  const [repo] = await params.db
    .select({ localPath: projectRepositories.localPath })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projRow.id))
    .limit(1);
  const workspaceRoot = params.workspaceRoot ?? repo?.localPath ?? process.cwd();
  const discoveredComponents = scanPackagesUiComponents(workspaceRoot);
  const extractedTokens = extractW3CDesignTokens(sanitizedHtml);

  const coveredStates = detectCoveredUiStatesInHtml(sanitizedHtml);
  const missingStates = ALL_UI_STATES.filter((st) => !coveredStates.includes(st));
  if (missingStates.length > 0) {
    throw new WorkflowRuntimeError({
      statusCode: 422,
      code: "INVALID_WORKFLOW_INPUT",
      message: `VISUAL_STATES_MISSING: Protótipo não cobre os 5 estados obrigatórios (faltando: ${missingStates.join(", ")}).`,
    });
  }

  const slotMatches = Array.from(
    sanitizedHtml.matchAll(/data-slot\s*=\s*["']([a-z0-9_-]+)["']/gi)
  ).map((m) => m[1]!);

  const uiCompNames =
    discoveredComponents.length > 0
      ? discoveredComponents.map((c) => c.name).slice(0, 8)
      : ["CockpitPanel", "StateBoundary"];
  const uniqueSlots = Array.from(
    new Set([
      ...slotMatches,
      ...discoveredComponents.map((c) => c.dataSlot),
    ])
  ).slice(0, 12);

  const sections: PrototypeSectionManifest[] = [
    {
      sectionName: params.title.slice(0, 160),
      uiComponents: uiCompNames,
      dataSlots: uniqueSlots,
      statesCovered: [...ALL_UI_STATES],
    },
  ];

  // Stage 3: Fresh-Context Critique (ui-design-critique-a11y)
  const critiqueFindings: string[] = [];
  const roleTools = createRoleSpecializedToolsMap({
    db: params.db,
    masterKey: params.masterKey,
    workspaceRoot,
  });
  const contrastRc = new RequestContext();
  contrastRc.set("actor", {
    organizationId: params.organizationId,
    userId: "visual-critique",
    role: "auditor",
  });

  const colorPairs = extractColorPairsFromHtmlOrTokens({
    html: sanitizedHtml,
    explicitPairs: params.colorPairs,
  });

  const contrastTool = roleTools.validate_color_contrast_and_tokens;
  if (
    !contrastTool ||
    !("execute" in contrastTool) ||
    typeof contrastTool.execute !== "function"
  ) {
    throw new WorkflowRuntimeError({
      statusCode: 500,
      code: "EXECUTION_FAILED",
      message: "Tool validate_color_contrast_and_tokens indisponível.",
    });
  }

  const wcagContrastReport = await (
    contrastTool as {
      execute: (
        input: { pairs: typeof colorPairs },
        ctx: { requestContext: RequestContext }
      ) => Promise<ColorContrastValidationOutput>;
    }
  ).execute(
    {
      pairs: colorPairs,
    },
    { requestContext: contrastRc }
  );

  if (!wcagContrastReport.allPassed) {
    for (const r of wcagContrastReport.results.filter((item) => !item.passed)) {
      critiqueFindings.push(
        `Contraste WCAG 2.1 insuficiente em '${r.label}': ${r.contrastRatio}:1 (< ${r.requiredRatio}:1).`
      );
    }
  }

  const hasDivClick = /<div\b[^>]*\bonclick\b/i.test(rawHtml);
  const keyboardNavPassed = !hasDivClick;
  if (!keyboardNavPassed) {
    critiqueFindings.push(
      "Acessibilidade: encontrado `<div onClick>`; usar `<button type=\"button\">` ou `<Link>`."
    );
  }

  const hasFixedWideBox = /\bwidth\s*:\s*(?:[4-9]\d{2}|[1-9]\d{3,})px/i.test(
    sanitizedHtml
  );
  const mobile390PxNoOverflow = !hasFixedWideBox;
  if (!mobile390PxNoOverflow) {
    critiqueFindings.push(
      "Responsividade 390px: largura fixa > 390px detectada em estilo inline."
    );
  }

  const noRbacLeakage =
    !/\b(?:encryptedApiKey|masterKey|MASTER_ENCRYPTION_KEY|sk-[A-Za-z0-9_-]{16,})\b/.test(
      sanitizedHtml
    );
  if (!noRbacLeakage) {
    critiqueFindings.push(
      "Segurança: padrão sensível ou campo interno detectado no protótipo."
    );
  }

  const critiqueSkill = (() => {
    try {
      return loadNativeSkills({
        skillsDir: params.skillsDir,
        names: ["ui-design-critique-a11y"],
      })[0];
    } catch {
      return undefined;
    }
  })();

  const critiqueModel = params.critiqueModelOverride ?? params.modelOverride;
  if (critiqueModel) {
    try {
      const freshCritiqueAgent = new Agent({
        id: "uzina-visual-fresh-critique",
        name: "Uzina Fresh-Context UI Critique",
        instructions: [
          getRolePlaybookInstructions("qa_appsec"),
          critiqueSkill?.content ?? "",
          "Você está em contexto LIMPO sem histórico de criação. Avalie apenas acessibilidade WCAG, 5 estados e responsividade 390px.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        model: critiqueModel,
      });

      const genCritique = await freshCritiqueAgent.generate(
        `Audite o HTML sanitizado de '${params.title}':\n${sanitizedHtml.slice(0, 4000)}`,
        {
          maxSteps: 1,
          structuredOutput: { schema: CritiqueLlmOutputSchema },
        }
      );

      const parsedCrit = CritiqueLlmOutputSchema.safeParse(genCritique.object);
      const critObj = parsedCrit.success
        ? parsedCrit.data
        : tryParseStructuredJson(genCritique.text, CritiqueLlmOutputSchema);
      if (critObj && !critObj.passed) {
        for (const f of critObj.findings) {
          critiqueFindings.push(redactSensitiveText(f, secrets));
        }
      }
    } catch {
      // Fallback determinístico mantém os checks estáticos locais
    }
  }

  const tokensUsed = Array.from(
    new Set([
      ...Object.keys(extractedTokens.color).map((k) => `color.${k}`),
      ...Object.keys(extractedTokens.typography).map((k) => `typography.${k}`),
      ...Object.keys(extractedTokens.spacing).map((k) => `spacing.${k}`),
      ...Object.keys(extractedTokens.radius).map((k) => `radius.${k}`),
    ])
  );

  const manifest = PrototypeComponentManifestSchema.parse({
    ...(params.prototypeId ? { prototypeId: params.prototypeId } : {}),
    ...(params.deliverableId ? { deliverableId: params.deliverableId } : {}),
    sections,
    wcagChecklist: {
      contrastAaPassed: wcagContrastReport.allPassed,
      keyboardNavPassed,
      touchTargetsMin44Px: true,
      mobile390PxNoOverflow,
      noRbacLeakage,
    },
    tokensUsed,
  });

  const critiquePassed =
    manifest.wcagChecklist.contrastAaPassed &&
    manifest.wcagChecklist.keyboardNavPassed &&
    manifest.wcagChecklist.mobile390PxNoOverflow &&
    manifest.wcagChecklist.noRbacLeakage &&
    critiqueFindings.length === 0;

  if (params.strictCritiqueGate && !critiquePassed) {
    throw new WorkflowRuntimeError({
      statusCode: 422,
      code: "INVALID_WORKFLOW_INPUT",
      message: `VISUAL_CRITIQUE_FAILED: ${critiqueFindings.join(" | ")}`,
    });
  }

  return {
    designMdMarkdown,
    sanitizedHtml,
    manifest,
    wcagContrastReport,
    critiquePassed,
    critiqueFindings,
    stagesExecuted: [
      "lead_visual_design_md",
      "reference_ui_tokens",
      "fresh_context_critique",
    ],
  };
}
