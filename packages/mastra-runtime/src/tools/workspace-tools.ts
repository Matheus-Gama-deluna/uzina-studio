import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import type { AgencyAgentRole, OrgRole } from "@uzina/contracts";
import {
  loadNativeSkills,
  loadSkillResource,
  redactSensitiveText,
} from "@uzina/core";
import {
  clients,
  codebaseFiles,
  codebaseSymbols,
  decisions,
  deliverables,
  designPrototypes,
  projectRepositories,
  projects,
  type UzinaDb,
} from "@uzina/db";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { createMemoryScoped } from "../memories.js";
import { collectOrganizationKnownSecrets } from "../model-resolver.js";
import { searchQmdScoped } from "../qmd.js";
import type { SymbolLockManager } from "../symbol-locks.js";
import {
  WRITE_ROLES,
  assertProjectScopeForTool,
  createRoleSpecializedToolsMap,
  resolveActorFromContext,
  resolveProjectIdFromContext,
  selectRoleSpecializedTools,
  type WorkspaceToolActor,
} from "./role-specialized-tools.js";

export type { WorkspaceToolActor };

export function createWorkspaceToolsForRole(params: {
  db: UzinaDb;
  role: AgencyAgentRole;
  actorRole: OrgRole;
  masterKey?: Buffer | string | null;
  skillsDir?: string;
  dataDir?: string;
  workspaceRoot?: string;
  symbolLockManager?: SymbolLockManager;
}): ToolsInput {
  const searchQmdMemoriesTool = createTool({
    id: "search_qmd_memories",
    description:
      "Busca híbrida QMD (BM25 + vetor) nas memórias institucionais (organização, cliente e projeto).",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(400),
      projectId: z.uuid().optional(),
      limit: z.number().int().min(1).max(15).optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const projectId = resolveProjectIdFromContext(
        inputData.projectId,
        context
      );
      if (projectId) {
        await assertProjectScopeForTool(
          params.db,
          projectId,
          actor.organizationId
        );
      }

      const res = await searchQmdScoped(params.db, {
        organizationId: actor.organizationId,
        request: {
          query: inputData.query,
          projectId,
          limit: inputData.limit ?? 6,
        },
      });

      return {
        totalCandidates: res.totalCandidates,
        hits: res.hits.map((h) => ({
          title: redactSensitiveText(h.headingPath),
          scopeType: h.scopeType,
          sourceType: h.sourceType,
          sourcePath: h.sourcePath,
          snippet: redactSensitiveText(h.snippet),
          score: h.scores.rrf,
        })),
      };
    },
  });

  const createQmdMemoryTool = createTool({
    id: "create_qmd_memory",
    description:
      "Registra uma nova decisão arquitetural, regra de negócio ou convenção na Memória QMD do projeto.",
    inputSchema: z.object({
      projectId: z.uuid().optional(),
      category: z.enum([
        "architecture",
        "convention",
        "preference",
        "security_triage",
        "domain_rule",
      ]),
      title: z.string().trim().min(3).max(160),
      content: z.string().trim().min(5).max(4000),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      if (!WRITE_ROLES.has(actor.role)) {
        throw new Error(
          "Permissão insuficiente: perfil auditor não pode gravar memórias."
        );
      }
      const projectId = resolveProjectIdFromContext(
        inputData.projectId,
        context
      );
      if (!projectId) {
        throw new Error("projectId é obrigatório para salvar memória de projeto.");
      }
      await assertProjectScopeForTool(
        params.db,
        projectId,
        actor.organizationId
      );

      const saved = await createMemoryScoped(params.db, {
        organizationId: actor.organizationId,
        input: {
          scopeType: "project",
          scopeId: projectId,
          category: inputData.category,
          title: redactSensitiveText(inputData.title),
          content: redactSensitiveText(inputData.content),
        },
      });

      return {
        id: saved.id,
        title: saved.title,
        category: saved.category,
        scopeType: saved.scopeType,
      };
    },
  });

  const inspectCodebaseSkeletonTool = createTool({
    id: "inspect_codebase_skeleton",
    description:
      "Consulta somente leitura da árvore de arquivos indexados no grafo AST do projeto.",
    inputSchema: z.object({
      projectId: z.uuid().optional(),
      limit: z.number().int().min(1).max(60).optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const projectId = resolveProjectIdFromContext(
        inputData.projectId,
        context
      );
      if (!projectId) {
        return { filesCount: 0, files: [] };
      }
      await assertProjectScopeForTool(
        params.db,
        projectId,
        actor.organizationId
      );

      const files = await params.db
        .select({
          filePath: codebaseFiles.path,
          language: codebaseFiles.language,
          sizeBytes: codebaseFiles.size,
        })
        .from(codebaseFiles)
        .innerJoin(
          projectRepositories,
          eq(codebaseFiles.repositoryId, projectRepositories.id)
        )
        .where(eq(projectRepositories.projectId, projectId))
        .limit(inputData.limit ?? 30);

      return {
        filesCount: files.length,
        files: files.map((f) => ({
          filePath: f.filePath,
          language: f.language,
          sizeBytes: f.sizeBytes,
        })),
      };
    },
  });

  const queryCodebaseSymbolsTool = createTool({
    id: "query_codebase_symbols",
    description:
      "Pesquisa símbolos AST (funções, classes, contratos) indexados no projeto.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(120),
      projectId: z.uuid().optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const projectId = resolveProjectIdFromContext(
        inputData.projectId,
        context
      );
      if (!projectId) {
        return { total: 0, symbols: [] };
      }
      await assertProjectScopeForTool(
        params.db,
        projectId,
        actor.organizationId
      );

      const rows = await params.db
        .select({
          symbolName: codebaseSymbols.name,
          kind: codebaseSymbols.kind,
          signature: codebaseSymbols.signature,
          filePath: codebaseFiles.path,
        })
        .from(codebaseSymbols)
        .innerJoin(
          codebaseFiles,
          eq(codebaseSymbols.fileId, codebaseFiles.id)
        )
        .innerJoin(
          projectRepositories,
          eq(codebaseFiles.repositoryId, projectRepositories.id)
        )
        .where(
          and(
            eq(projectRepositories.projectId, projectId),
            ilike(codebaseSymbols.name, `%${inputData.query}%`)
          )
        )
        .limit(20);

      return {
        total: rows.length,
        symbols: rows.map((r) => ({
          symbolName: r.symbolName,
          kind: r.kind,
          filePath: r.filePath,
          signature: r.signature ? redactSensitiveText(r.signature) : null,
        })),
      };
    },
  });

  const readProjectDeliverablesTool = createTool({
    id: "read_project_deliverables",
    description:
      "Lê o estado atual dos slices/entregas, protótipos visuais e decisões HITL pendentes do projeto.",
    inputSchema: z.object({
      projectId: z.uuid().optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const projectId = resolveProjectIdFromContext(
        inputData.projectId,
        context
      );
      if (!projectId) {
        return {
          project: null,
          deliverables: [],
          pendingDecisions: [],
          prototypes: [],
        };
      }
      const proj = await assertProjectScopeForTool(
        params.db,
        projectId,
        actor.organizationId
      );

      const delivs = await params.db
        .select()
        .from(deliverables)
        .where(eq(deliverables.projectId, proj.id))
        .orderBy(desc(deliverables.updatedAt))
        .limit(20);

      const delivIds = delivs.map((d) => d.id);
      const pending =
        delivIds.length > 0
          ? await params.db
              .select()
              .from(decisions)
              .where(
                and(
                  inArray(decisions.deliverableId, delivIds),
                  eq(decisions.status, "pending")
                )
              )
              .limit(15)
          : [];

      const protos = await params.db
        .select({
          id: designPrototypes.id,
          title: designPrototypes.title,
          approved: designPrototypes.approved,
          level: designPrototypes.level,
        })
        .from(designPrototypes)
        .where(eq(designPrototypes.projectId, proj.id))
        .orderBy(desc(designPrototypes.createdAt))
        .limit(5);

      return {
        project: { id: proj.id, name: proj.name },
        deliverables: delivs.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          strategy: d.developmentStrategy,
          hasUi: d.hasUi,
          verifyAttempts: d.verifyAttempts,
        })),
        pendingDecisions: pending.map((p) => ({
          id: p.id,
          decisionType: p.decisionType,
          summary: redactSensitiveText(p.summary),
        })),
        prototypes: protos,
      };
    },
  });

  const loadUzinaSkillTool = createTool({
    id: "load_uzina_skill",
    description:
      "Carrega sob demanda o protocolo completo de uma skill nativa (SKILL.md) ou um arquivo de apoio em references/, templates/ ou scripts/.",
    inputSchema: z.object({
      skillName: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/, "skillName deve ser kebab-case"),
      resourcePath: z.string().trim().min(1).max(200).optional(),
    }),
    execute: async (inputData, context) => {
      const actor = resolveActorFromContext(context);
      const knownSecrets = await collectOrganizationKnownSecrets(params.db, {
        organizationId: actor.organizationId,
        masterKey: params.masterKey,
      }).catch(() => [] as string[]);

      if (inputData.resourcePath) {
        return loadSkillResource({
          skillName: inputData.skillName,
          resourcePath: inputData.resourcePath,
          skillsDir: params.skillsDir,
          knownSecrets,
        });
      }

      const loaded = loadNativeSkills({
        skillsDir: params.skillsDir,
        names: [inputData.skillName],
      });
      const skill = loaded[0];
      if (!skill) {
        throw new Error(`Skill '${inputData.skillName}' não encontrada.`);
      }

      return {
        name: skill.name,
        description: skill.description,
        phase: skill.phase ?? null,
        roleCategory: skill.roleCategory,
        ironLaw: skill.ironLaw ?? null,
        content: redactSensitiveText(skill.content, knownSecrets),
        references: skill.references,
        templates: skill.templates,
        scripts: skill.scripts,
      };
    },
  });

  const tools: ToolsInput = {
    search_qmd_memories: searchQmdMemoriesTool,
    read_project_deliverables: readProjectDeliverablesTool,
    load_uzina_skill: loadUzinaSkillTool,
  };

  if (
    params.role === "orchestrator" ||
    params.role === "software_architect" ||
    params.role === "tech_lead" ||
    params.role === "qa_appsec"
  ) {
    tools.inspect_codebase_skeleton = inspectCodebaseSkeletonTool;
  }

  if (
    params.role === "software_architect" ||
    params.role === "tech_lead" ||
    params.role === "qa_appsec"
  ) {
    tools.query_codebase_symbols = queryCodebaseSymbolsTool;
  }

  if (
    WRITE_ROLES.has(params.actorRole) &&
    (params.role === "orchestrator" ||
      params.role === "product_discovery" ||
      params.role === "software_architect" ||
      params.role === "tech_lead")
  ) {
    tools.create_qmd_memory = createQmdMemoryTool;
  }

  const allSpecialized = createRoleSpecializedToolsMap({
    db: params.db,
    masterKey: params.masterKey,
    dataDir: params.dataDir,
    workspaceRoot: params.workspaceRoot,
    symbolLockManager: params.symbolLockManager,
  });
  const roleSpecialized = selectRoleSpecializedTools({
    allTools: allSpecialized,
    role: params.role,
    actorRole: params.actorRole,
  });

  return {
    ...tools,
    ...roleSpecialized,
  };
}

/**
 * Monta o catálogo completo de tools do AgentController (filtradas por modo via `CONTROLLER_MODE_TOOLS`).
 */
export function createAllControllerWorkspaceTools(params: {
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  skillsDir?: string;
  dataDir?: string;
  workspaceRoot?: string;
  symbolLockManager?: SymbolLockManager;
}): ToolsInput {
  const baseTools = createWorkspaceToolsForRole({
    db: params.db,
    role: "software_architect",
    actorRole: "developer",
    masterKey: params.masterKey,
    skillsDir: params.skillsDir,
    dataDir: params.dataDir,
    workspaceRoot: params.workspaceRoot,
    symbolLockManager: params.symbolLockManager,
  });

  const specializedAll = createRoleSpecializedToolsMap({
    db: params.db,
    masterKey: params.masterKey,
    dataDir: params.dataDir,
    workspaceRoot: params.workspaceRoot,
    symbolLockManager: params.symbolLockManager,
  });

  return {
    ...baseTools,
    ...specializedAll,
  };
}
