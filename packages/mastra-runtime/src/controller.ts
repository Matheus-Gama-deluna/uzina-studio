import crypto from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { AgentController, type Session } from "@mastra/core/agent-controller";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { ProcessInputStepArgs } from "@mastra/core/processors";
import { RequestContext } from "@mastra/core/request-context";
import {
  AgencySessionControlResponseSchema,
  type AgencyAgentRole,
  type AgencyControllerModeId,
  type AgencySessionAbortRequest,
  type AgencySessionControlResponse,
  type AgencySessionPlanDecisionRequest,
  type AgencySessionSteerRequest,
  type OrgRole,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { clients, deliverables, projects, type UzinaDb } from "@uzina/db";
import { and, eq } from "drizzle-orm";
import { WorkflowRuntimeError } from "./errors.js";
import {
  assertProjectBelongsToOrganization,
  buildAgencyResourceId,
  createUzinaMemory,
} from "./memory-runtime.js";
import {
  collectOrganizationKnownSecrets,
  createTenantModelResolver,
  type ResolvedOrganizationModel,
} from "./model-resolver.js";
import {
  createUzinaErrorProcessors,
  createUzinaInputProcessors,
  createUzinaOutputProcessors,
  createUzinaSemanticRecallProcessor,
  createUzinaSkillsCatalogProcessor,
} from "./processors.js";
import { getMastraStorageSingleton, type UzinaMastraStore } from "./storage.js";
import { createWorkspaceToolsForRole } from "./tools/workspace-tools.js";
import { getRolePlaybookInstructions } from "./agents/engineering-agents.js";

const CONTROLLER_SINGLETON_KEY = Symbol.for("@uzina/mastra/controller-v1");
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const THREAD_LOCK_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 200;

export const AGENCY_ROLE_TO_CONTROLLER_MODE: Record<
  AgencyAgentRole,
  AgencyControllerModeId
> = {
  orchestrator: "discovery",
  product_discovery: "discovery",
  software_architect: "architect",
  ux_designer: "visual",
  tech_lead: "build",
  qa_appsec: "review",
};

export const CONTROLLER_MODE_TO_AGENCY_ROLE: Record<
  AgencyControllerModeId,
  AgencyAgentRole
> = {
  discovery: "product_discovery",
  architect: "software_architect",
  visual: "ux_designer",
  build: "tech_lead",
  review: "qa_appsec",
};

export async function resolveControllerModelForMode(params: {
  db: UzinaDb;
  organizationId: string;
  mode: AgencyControllerModeId;
  masterKey?: Buffer | string | null;
}): Promise<ResolvedOrganizationModel> {
  const resolver = createTenantModelResolver({
    db: params.db,
    masterKey: params.masterKey,
  });
  const role = CONTROLLER_MODE_TO_AGENCY_ROLE[params.mode];
  const resolved = await resolver.resolveForRole(params.organizationId, role);
  if (!resolved) {
    throw new WorkflowRuntimeError({
      statusCode: 400,
      code: "MISSING_PRECONDITION",
      message:
        "AGENT_PROVIDER_UNAVAILABLE: Organização sem provedor LLM ativo configurado no Cofre de Provedores.",
    });
  }
  return resolved;
}

export const CONTROLLER_MODE_TOOLS: Record<AgencyControllerModeId, string[]> = {
  discovery: [
    "search_qmd_memories",
    "read_project_deliverables",
    "load_uzina_skill",
    "ask_user",
    "submit_plan",
    "task_write",
    "task_update",
    "task_complete",
    "task_check",
  ],
  architect: [
    "search_qmd_memories",
    "read_project_deliverables",
    "inspect_codebase_skeleton",
    "query_codebase_symbols",
    "create_qmd_memory",
    "load_uzina_skill",
    "ask_user",
    "submit_plan",
    "task_write",
    "task_update",
    "task_complete",
    "task_check",
  ],
  visual: [
    "search_qmd_memories",
    "read_project_deliverables",
    "load_uzina_skill",
    "ask_user",
    "task_write",
    "task_update",
    "task_complete",
    "task_check",
  ],
  build: [
    "search_qmd_memories",
    "read_project_deliverables",
    "inspect_codebase_skeleton",
    "query_codebase_symbols",
    "create_qmd_memory",
    "load_uzina_skill",
    "task_write",
    "task_update",
    "task_complete",
    "task_check",
  ],
  review: [
    "search_qmd_memories",
    "read_project_deliverables",
    "inspect_codebase_skeleton",
    "query_codebase_symbols",
    "load_uzina_skill",
    "task_check",
  ],
};

interface ThreadLockEntry {
  ownerSessionId: string;
  acquiredAt: number;
}

export interface ManagedControllerSession {
  sessionId: string;
  organizationId: string;
  projectId: string | null;
  createdByUserId: string;
  resourceId: string;
  threadId: string;
  actorRole: OrgRole;
  currentMode: AgencyControllerModeId;
  session: Session;
  activeAbortController: AbortController | null;
  steerQueuedMessages: string[];
  lastActivityAt: number;
}

interface ControllerRuntimeSingleton {
  controller: AgentController | null;
  backingAgent: Agent | null;
  sessions: Map<string, ManagedControllerSession>;
  threadLocks: Map<string, ThreadLockEntry>;
  sweeperTimer: ReturnType<typeof setInterval> | null;
  initKey: string | null;
}

function getControllerRegistry(): ControllerRuntimeSingleton {
  const g = globalThis as Record<symbol, unknown>;
  const existing = g[CONTROLLER_SINGLETON_KEY];
  if (existing && typeof existing === "object") {
    return existing as ControllerRuntimeSingleton;
  }
  const created: ControllerRuntimeSingleton = {
    controller: null,
    backingAgent: null,
    sessions: new Map(),
    threadLocks: new Map(),
    sweeperTimer: null,
    initKey: null,
  };
  g[CONTROLLER_SINGLETON_KEY] = created;
  return created;
}

export function getControllerBackingAgent(): Agent | null {
  return getControllerRegistry().backingAgent;
}

function ensureSweeperStarted(registry: ControllerRuntimeSingleton): void {
  if (registry.sweeperTimer) return;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of registry.sessions.entries()) {
      if (now - entry.lastActivityAt > SESSION_IDLE_TTL_MS && !entry.activeAbortController) {
        entry.session.abort({ localOnly: true });
        registry.sessions.delete(id);
        void registry.controller?.deleteSession({ sessionId: id }).catch(() => undefined);
      }
    }
    for (const [threadId, lock] of registry.threadLocks.entries()) {
      if (now - lock.acquiredAt > THREAD_LOCK_TTL_MS) {
        registry.threadLocks.delete(threadId);
      }
    }
  }, 60_000);
  timer.unref();
  registry.sweeperTimer = timer;
}

function enforceLruCap(registry: ControllerRuntimeSingleton): void {
  while (registry.sessions.size >= MAX_ACTIVE_SESSIONS) {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, entry] of registry.sessions.entries()) {
      if (!entry.activeAbortController && entry.lastActivityAt < oldestTime) {
        oldestTime = entry.lastActivityAt;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    const evicted = registry.sessions.get(oldestId);
    evicted?.session.abort({ localOnly: true });
    registry.sessions.delete(oldestId);
    void registry.controller?.deleteSession({ sessionId: oldestId }).catch(() => undefined);
  }
}

export async function getOrCreateUzinaAgentController(params: {
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  dataDir?: string;
  databaseUrl?: string;
  storage?: UzinaMastraStore;
  modelOverride?: MastraModelConfig;
}): Promise<AgentController> {
  const registry = getControllerRegistry();
  const key = `${params.databaseUrl ?? ""}|${params.dataDir ?? "default"}|${params.modelOverride ? "mock" : "live"}|${params.masterKey ? "keyed" : "nokey"}`;

  if (registry.controller && registry.initKey === key) {
    return registry.controller;
  }

  if (registry.controller) {
    await destroyAgentController();
  }

  const storage =
    params.storage ??
    (await getMastraStorageSingleton({
      dataDir: params.dataDir,
      databaseUrl: params.databaseUrl,
    }));

  const { memory } = await createUzinaMemory({
    storage,
    db: params.db,
    masterKey: params.masterKey,
    dataDir: params.dataDir,
    databaseUrl: params.databaseUrl,
    observationalMemoryEnabled: !params.modelOverride,
    modelOverride: params.modelOverride,
  });

  const sharedTools = createWorkspaceToolsForRole({
    db: params.db,
    role: "software_architect",
    actorRole: "developer",
    masterKey: params.masterKey,
  });

  const dynamicControllerModel:
    | MastraModelConfig
    | (({
        requestContext,
      }: {
        requestContext: { get: (key: string) => unknown };
      }) => Promise<MastraModelConfig>) = params.modelOverride
    ? params.modelOverride
    : async ({ requestContext }) => {
        const actor = requestContext.get("actor") as
          | { organizationId?: string }
          | undefined;
        const orgId = actor?.organizationId;
        if (!orgId) {
          throw new Error(
            "CONTROLLER_ORG_REQUIRED: organizationId ausente no RequestContext."
          );
        }
        const rawMode = requestContext.get("controllerMode") as
          | AgencyControllerModeId
          | undefined;
        const mode: AgencyControllerModeId =
          rawMode && rawMode in CONTROLLER_MODE_TO_AGENCY_ROLE
            ? rawMode
            : "discovery";
        const resolved = await resolveControllerModelForMode({
          db: params.db,
          organizationId: orgId,
          mode,
          masterKey: params.masterKey,
        });
        return resolved.mastraModel.model;
      };

  const modePlaybookProcessor = {
    id: "uzina-controller-mode-playbook",
    name: "Uzina Controller Mode Playbook",
    async processInputStep({
      systemMessages,
      requestContext,
    }: ProcessInputStepArgs) {
      const rawMode = requestContext?.get("controllerMode") as
        | AgencyControllerModeId
        | undefined;
      const mode: AgencyControllerModeId =
        rawMode && rawMode in CONTROLLER_MODE_TO_AGENCY_ROLE
          ? rawMode
          : "discovery";
      const role = CONTROLLER_MODE_TO_AGENCY_ROLE[mode];
      const playbook = getRolePlaybookInstructions(role);
      const already = systemMessages.some(
        (m) =>
          typeof m.content === "string" &&
          m.content.includes("### Step 0 Obrigatório")
      );
      if (already) {
        return { systemMessages };
      }
      return {
        systemMessages: [
          ...systemMessages,
          { role: "system" as const, content: playbook },
        ],
      };
    },
  };

  const backingAgent = new Agent({
    id: "uzina_controller_backing",
    name: "Uzina Engineering Controller",
    instructions:
      "Você é o controlador central de engenharia do Uzina Studio. Responda em Português do Brasil respeitando o escopo do projeto e nunca vaze segredos.",
    model: dynamicControllerModel as MastraModelConfig,
    tools: sharedTools,
    memory,
    inputProcessors: [
      ...createUzinaInputProcessors({ toolsCatalog: sharedTools }),
      modePlaybookProcessor,
      createUzinaSkillsCatalogProcessor({ role: "software_architect" }),
      createUzinaSemanticRecallProcessor({ db: params.db }),
    ],
    outputProcessors: createUzinaOutputProcessors({}),
    errorProcessors: createUzinaErrorProcessors(),
  });

  const controller = new AgentController({
    id: "uzina-agent-controller",
    storage,
    memory,
    agent: backingAgent,
    disableBuiltinTools: ["subagent"],
    threadLock: {
      acquire: (threadId: string) => {
        const now = Date.now();
        const existing = registry.threadLocks.get(threadId);
        if (existing && now - existing.acquiredAt < THREAD_LOCK_TTL_MS) {
          return;
        }
        registry.threadLocks.set(threadId, {
          ownerSessionId: threadId,
          acquiredAt: now,
        });
      },
      release: (threadId: string) => {
        registry.threadLocks.delete(threadId);
      },
    },
    modes: [
      {
        id: "discovery",
        name: "Descoberta & Produto",
        description: "Coleta requisitos, busca memórias QMD e propõe plano.",
        transitionsTo: "architect",
        availableTools: CONTROLLER_MODE_TOOLS.discovery,
        metadata: { default: true },
      },
      {
        id: "architect",
        name: "Arquiteto de Software",
        description: "Inspeciona AST, ADRs e define blueprint técnico.",
        transitionsTo: "build",
        availableTools: CONTROLLER_MODE_TOOLS.architect,
      },
      {
        id: "visual",
        name: "Estúdio Visual",
        description: "Alinha fluxos de design e tokens visuais.",
        availableTools: CONTROLLER_MODE_TOOLS.visual,
      },
      {
        id: "build",
        name: "Tech Lead & Builder",
        description: "Coordena slices, TDD e execução técnica.",
        availableTools: CONTROLLER_MODE_TOOLS.build,
      },
      {
        id: "review",
        name: "Auditor QA & AppSec",
        description: "Revisão estrita somente leitura de segurança e qualidade.",
        availableTools: CONTROLLER_MODE_TOOLS.review,
      },
    ],
    defaultModeId: "discovery",
  });

  await controller.initStorage();
  registry.controller = controller;
  registry.backingAgent = backingAgent;
  registry.initKey = key;
  ensureSweeperStarted(registry);

  return controller;
}

export async function createControlledAgencySession(params: {
  db: UzinaDb;
  organizationId: string;
  projectId: string | null;
  createdByUserId: string;
  actorRole: OrgRole;
  resourceId: string;
  threadId: string;
  initialMode?: AgencyControllerModeId;
  masterKey?: Buffer | string | null;
  dataDir?: string;
  databaseUrl?: string;
  storage?: UzinaMastraStore;
  modelOverride?: MastraModelConfig;
}): Promise<ManagedControllerSession> {
  if (params.projectId) {
    await assertProjectBelongsToOrganization(
      params.db,
      params.projectId,
      params.organizationId
    );
  }
  const expectedAgencyPrefix = buildAgencyResourceId(
    params.organizationId,
    params.projectId
  );
  const expectedLegacyPrefix = params.projectId
    ? `agency:${params.organizationId}:${params.projectId}`
    : `agency:${params.organizationId}`;
  const isValidScopedResource =
    params.resourceId === expectedAgencyPrefix ||
    params.resourceId.startsWith(`${expectedAgencyPrefix}:`) ||
    params.resourceId === expectedLegacyPrefix ||
    params.resourceId.startsWith(`${expectedLegacyPrefix}:`);
  if (!isValidScopedResource) {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "FORBIDDEN_PROJECT_SCOPE",
      message: "resourceId fora do escopo da organização/projeto autenticado.",
    });
  }

  const registry = getControllerRegistry();
  enforceLruCap(registry);

  const controller = await getOrCreateUzinaAgentController({
    db: params.db,
    masterKey: params.masterKey,
    dataDir: params.dataDir,
    databaseUrl: params.databaseUrl,
    storage: params.storage,
    modelOverride: params.modelOverride,
  });

  const knownSecrets = await collectOrganizationKnownSecrets(params.db, {
    organizationId: params.organizationId,
    masterKey: params.masterKey,
  }).catch(() => [] as string[]);

  const sessionId = crypto.randomUUID();
  const safeMode: AgencyControllerModeId =
    params.actorRole === "auditor"
      ? "review"
      : (params.initialMode ?? "discovery");

  const rc = new RequestContext();
  rc.set("actor", {
    organizationId: params.organizationId,
    userId: params.createdByUserId,
    role: params.actorRole,
  });
  rc.set("controllerMode", safeMode);
  rc.set("agencyRole", CONTROLLER_MODE_TO_AGENCY_ROLE[safeMode]);
  rc.set("knownSecrets", knownSecrets);
  if (params.projectId) {
    rc.set("projectId", params.projectId);
  }

  const session = await controller.createSession({
    id: sessionId,
    ownerId: params.organizationId,
    resourceId: params.resourceId,
    threadId: params.threadId,
    createInitialThread: false,
    requestContext: rc,
  });

  if (safeMode !== "discovery") {
    await session.mode.switch({ modeId: safeMode }).catch(() => undefined);
  }

  const record: ManagedControllerSession = {
    sessionId,
    organizationId: params.organizationId,
    projectId: params.projectId,
    createdByUserId: params.createdByUserId,
    resourceId: params.resourceId,
    threadId: params.threadId,
    actorRole: params.actorRole,
    currentMode: safeMode,
    session,
    activeAbortController: null,
    steerQueuedMessages: [],
    lastActivityAt: Date.now(),
  };

  registry.sessions.set(sessionId, record);
  return record;
}

export function attachSessionExecutionControl(
  sessionId: string,
  abortController: AbortController | null
): void {
  const registry = getControllerRegistry();
  const record = registry.sessions.get(sessionId);
  if (!record) return;
  record.activeAbortController = abortController;
  record.lastActivityAt = Date.now();
}

export function consumeSteeredMessages(sessionId: string): string[] {
  const registry = getControllerRegistry();
  const record = registry.sessions.get(sessionId);
  if (!record || record.steerQueuedMessages.length === 0) return [];
  const copy = [...record.steerQueuedMessages];
  record.steerQueuedMessages = [];
  return copy;
}

export function getManagedSessionForOrg(
  sessionId: string,
  organizationId: string,
  projectId?: string
): ManagedControllerSession {
  const registry = getControllerRegistry();
  const record = registry.sessions.get(sessionId);
  if (!record || record.organizationId !== organizationId) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
      message: "Sessão de controle não encontrada.",
    });
  }
  if (projectId && record.projectId && record.projectId !== projectId) {
    throw new WorkflowRuntimeError({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
      message: "Sessão não pertence ao projeto informado.",
    });
  }
  return record;
}

export async function steerSessionScoped(
  _db: UzinaDb,
  params: {
    sessionId: string;
    actor: {
      organizationId: string;
      userId: string;
      role: OrgRole;
    };
    request: AgencySessionSteerRequest;
  }
): Promise<AgencySessionControlResponse> {
  const record = getManagedSessionForOrg(
    params.sessionId,
    params.actor.organizationId,
    params.request.projectId
  );

  if (params.actor.role === "auditor") {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "FORBIDDEN_SESSION_ACCESS",
      message: "Perfil 'auditor' possui acesso somente leitura e não pode intervir em sessões.",
    });
  }

  const isRunning =
    Boolean(
      record.activeAbortController && !record.activeAbortController.signal.aborted
    ) || Boolean(record.session.getCurrentRunId());

  if (!isRunning) {
    throw new WorkflowRuntimeError({
      statusCode: 409,
      code: "SESSION_NOT_ACTIVE",
      message: "Nenhuma execução ativa nesta sessão para intervir (steer).",
    });
  }

  if (params.request.targetMode) {
    await record.session.mode
      .switch({ modeId: params.request.targetMode })
      .catch(() => undefined);
    record.currentMode = params.request.targetMode;
  }

  const cleanMessage = redactSensitiveText(params.request.message);
  record.steerQueuedMessages.push(cleanMessage);
  record.lastActivityAt = Date.now();

  if (record.activeAbortController && !record.activeAbortController.signal.aborted) {
    record.activeAbortController.abort("STEERED");
  }

  // Dispara steer desacoplado (untilIdle: false) se houver run ativo no Session
  if (record.session.getCurrentRunId()) {
    const rc = new RequestContext();
    rc.set("actor", params.actor);
    rc.set("controllerMode", record.currentMode);
    rc.set("agencyRole", CONTROLLER_MODE_TO_AGENCY_ROLE[record.currentMode]);
    if (record.projectId) rc.set("projectId", record.projectId);
    void record.session
      .steer({ content: cleanMessage, requestContext: rc })
      .catch(() => undefined);
  }

  return AgencySessionControlResponseSchema.parse({
    ok: true,
    sessionId: record.sessionId,
    action: "steered",
    status: "accepted",
    mode: record.currentMode,
  });
}

export async function abortSessionScoped(
  db: UzinaDb,
  params: {
    sessionId: string;
    actor: {
      organizationId: string;
      userId: string;
      role: OrgRole;
    };
    request: AgencySessionAbortRequest;
    onAbortDeliverable?: (deliverableId: string, reason?: string) => boolean | Promise<boolean>;
  }
): Promise<AgencySessionControlResponse> {
  if (params.actor.role === "auditor") {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "FORBIDDEN_SESSION_ACCESS",
      message: "Perfil 'auditor' não pode abortar sessões ativas.",
    });
  }

  const record = getManagedSessionForOrg(
    params.sessionId,
    params.actor.organizationId,
    params.request.projectId
  );

  if (params.request.deliverableId) {
    const [deliv] = await db
      .select({ id: deliverables.id, projectId: deliverables.projectId })
      .from(deliverables)
      .innerJoin(projects, eq(deliverables.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(deliverables.id, params.request.deliverableId),
          eq(clients.organizationId, params.actor.organizationId)
        )
      )
      .limit(1);

    if (!deliv || (record.projectId && deliv.projectId !== record.projectId)) {
      throw new WorkflowRuntimeError({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
        message: "Entregável informado não encontrado no escopo desta sessão.",
      });
    }

    if (params.onAbortDeliverable) {
      await params.onAbortDeliverable(deliv.id, params.request.reason);
    }
  }

  const reason = params.request.reason ?? "ABORTED_BY_USER";
  record.lastActivityAt = Date.now();
  record.session.abort({ localOnly: false });
  if (record.activeAbortController && !record.activeAbortController.signal.aborted) {
    record.activeAbortController.abort(reason);
  }
  record.activeAbortController = null;

  return AgencySessionControlResponseSchema.parse({
    ok: true,
    sessionId: record.sessionId,
    action: "aborted",
    status: "aborted",
    mode: record.currentMode,
  });
}

export async function resolveSessionPlanScoped(
  _db: UzinaDb,
  params: {
    sessionId: string;
    actor: {
      organizationId: string;
      userId: string;
      role: OrgRole;
    };
    request: AgencySessionPlanDecisionRequest;
  }
): Promise<AgencySessionControlResponse> {
  if (params.actor.role === "auditor") {
    throw new WorkflowRuntimeError({
      statusCode: 403,
      code: "FORBIDDEN_SESSION_ACCESS",
      message: "Perfil 'auditor' possui acesso somente leitura.",
    });
  }

  const record = getManagedSessionForOrg(
    params.sessionId,
    params.actor.organizationId
  );

  await record.session.respondToToolSuspension({
    toolCallId: params.request.toolCallId,
    resumeData: {
      approved: params.request.approved,
      feedback: params.request.feedback,
    },
  });

  if (params.request.approved && record.currentMode === "discovery") {
    record.currentMode = "architect";
  } else if (params.request.approved && record.currentMode === "architect") {
    record.currentMode = "build";
  }

  record.lastActivityAt = Date.now();

  return AgencySessionControlResponseSchema.parse({
    ok: true,
    sessionId: record.sessionId,
    action: "plan_resolved",
    status: "resumed",
    mode: record.currentMode,
  });
}

export function listActiveControllerSessionsForOrg(
  organizationId: string,
  projectId?: string
): Array<{
  sessionId: string;
  projectId: string | null;
  mode: AgencyControllerModeId;
  active: boolean;
}> {
  const registry = getControllerRegistry();
  const out: Array<{
    sessionId: string;
    projectId: string | null;
    mode: AgencyControllerModeId;
    active: boolean;
  }> = [];
  for (const rec of registry.sessions.values()) {
    if (rec.organizationId !== organizationId) continue;
    if (projectId && rec.projectId !== projectId) continue;
    out.push({
      sessionId: rec.sessionId,
      projectId: rec.projectId,
      mode: rec.currentMode,
      active: Boolean(
        rec.activeAbortController && !rec.activeAbortController.signal.aborted
      ),
    });
  }
  return out;
}

export async function destroyAgentController(): Promise<void> {
  const registry = getControllerRegistry();
  if (registry.sweeperTimer) {
    clearInterval(registry.sweeperTimer);
    registry.sweeperTimer = null;
  }
  for (const rec of registry.sessions.values()) {
    rec.session.abort({ localOnly: true });
    if (rec.activeAbortController && !rec.activeAbortController.signal.aborted) {
      rec.activeAbortController.abort("CONTROLLER_SHUTDOWN");
    }
  }
  registry.sessions.clear();
  registry.threadLocks.clear();
  registry.controller = null;
  registry.backingAgent = null;
  registry.initKey = null;
}

export async function resetAgentControllerForTests(): Promise<void> {
  await destroyAgentController();
}
