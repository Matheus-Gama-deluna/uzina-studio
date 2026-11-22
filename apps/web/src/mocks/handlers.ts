import {
  ApiErrorSchema,
  BrownfieldMapSchema,
  ClientListResponseSchema,
  ClientSchema,
  CodebaseReindexRequestSchema,
  CodebaseReindexResponseSchema,
  CodebaseTreeResponseSchema,
  CopilotChatRequestSchema,
  CreateClientSchema,
  CreateDeliverableSchema,
  CreateDesignAssetReferenceSchema,
  CreateMemorySchema,
  CreateProjectSchema,
  CreatePrototypeRequestSchema,
  CreateProviderProfileSchema,
  DecisionListResponseSchema,
  DeliverableListResponseSchema,
  DeliverableSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignAssetSchema,
  DesignPrototypeListResponseSchema,
  DesignPrototypeSchema,
  FinopsSummarySchema,
  GenerateDesignMdInputSchema,
  GenerateDesignMdResponseSchema,
  IngestSecurityScanSchema,
  MemoryListResponseSchema,
  MemorySchema,
  ProjectListResponseSchema,
  ProjectSchema,
  ProviderProfileListResponseSchema,
  ProviderProfilePublicSchema,
  ProvenanceListResponseSchema,
  QmdReindexRequestSchema,
  QmdReindexResponseSchema,
  QmdSearchRequestSchema,
  QmdSearchResponseSchema,
  RecordTokenSavingsSchema,
  ResolveDecisionResponseSchema,
  ResolveDecisionSchema,
  RunSecurityScanSchema,
  SecurityFindingDTOSchema,
  SecurityScanListResponseSchema,
  SecurityScanResultSchema,
  StitchMcpSyncRequestSchema,
  StitchMcpSyncResponseSchema,
  SymbolGraphQuerySchema,
  SymbolGraphResponseSchema,
  SymbolSliceRequestSchema,
  SymbolSliceResponseSchema,
  UpdateDesignAssetSchema,
  UpdateFindingTriageSchema,
  UpdateMemorySchema,
  UpdatePrototypeApprovalSchema,
  WorkflowResumeInputSchema,
  WorkflowStartInputSchema,
} from "@uzina/contracts";
import { generateDesignMdContract } from "@uzina/core/design-md";
import { http, HttpResponse } from "msw";
import {
  MOCK_DECISION_ID,
  MOCK_FINDING_ID,
  MOCK_MEMORY_ID,
  MOCK_ORG_ID,
  MOCK_PROJECT_ID,
  MOCK_SCAN_ID,
  mockBrownfieldMap,
  mockClients,
  mockCodebaseReindexResponse,
  mockCodebaseTreeResponse,
  mockDecisions,
  mockDeliverables,
  mockDesignAssets,
  mockDesignPrototypes,
  mockExecutionEvents,
  mockFinopsSummary,
  mockMemories,
  mockProjects,
  mockProvenanceListResponse,
  mockProviders,
  mockQmdReindexResponse,
  mockQmdSearchResponse,
  mockSecurityScanDetail,
  mockSecurityScans,
  mockStitchSyncResponse,
  mockSymbolGraphResponse,
  mockSymbolSliceResponse,
  mockWorkflowState,
} from "./fixtures";

function checkSimulatedState(url: URL) {
  const state = url.searchParams.get("state");
  if (state === "unauthorized") {
    return HttpResponse.json(
      ApiErrorSchema.parse({ error: "Não autorizado", code: "UNAUTHORIZED" }),
      { status: 401 }
    );
  }
  if (state === "error") {
    return HttpResponse.json(
      ApiErrorSchema.parse({
        error: "Erro simulado de infraestrutura",
        code: "INTERNAL_ERROR",
      }),
      { status: 500 }
    );
  }
  return null;
}

export const handlers = [
  http.get("*/api/clients", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(ClientListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(ClientListResponseSchema.parse(mockClients));
  }),

  http.post("*/api/clients", async ({ request }) => {
    const parsed = CreateClientSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      ClientSchema.parse({
        id: crypto.randomUUID(),
        organizationId: MOCK_ORG_ID,
        name: parsed.data.name,
        slug: parsed.data.slug ?? "novo-cliente",
        isDefaultInternal: false,
        notes: parsed.data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/projects", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(ProjectListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(ProjectListResponseSchema.parse(mockProjects));
  }),

  http.post("*/api/projects", async ({ request }) => {
    const parsed = CreateProjectSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    return HttpResponse.json(
      ProjectSchema.parse({
        id: projectId,
        clientId: parsed.data.clientId,
        name: parsed.data.name,
        slug: parsed.data.slug ?? "novo-projeto",
        description: parsed.data.description ?? null,
        defaultDevelopmentStrategy: parsed.data.defaultDevelopmentStrategy,
        maturityScore: null,
        designMdPath: null,
        status: "active",
        repositories: parsed.data.repository
          ? [
              {
                id: crypto.randomUUID(),
                projectId,
                name: parsed.data.repository.name,
                localPath: parsed.data.repository.localPath,
                remoteUrl: parsed.data.repository.remoteUrl ?? null,
                defaultBranch: parsed.data.repository.defaultBranch,
                stackMetadataJson: {},
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/projects/:id/deliverables", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        DeliverableListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(
      DeliverableListResponseSchema.parse(mockDeliverables)
    );
  }),

  http.post("*/api/projects/:id/deliverables", async ({ request, params }) => {
    const parsed = CreateDeliverableSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      DeliverableSchema.parse({
        id: crypto.randomUUID(),
        projectId: String(params.id),
        repositoryId: parsed.data.repositoryId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: "discovery",
        pausedFromStatus: null,
        hasUi: parsed.data.hasUi,
        developmentStrategy:
          parsed.data.developmentStrategy ?? "frontend_first_msw",
        tacticalPattern: parsed.data.tacticalPattern,
        riskLevel: parsed.data.riskLevel,
        worktreePath: null,
        branchName: null,
        verifyAttempts: 0,
        maxVerifyAttempts: 3,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/providers", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        ProviderProfileListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(
      ProviderProfileListResponseSchema.parse(mockProviders)
    );
  }),

  http.post("*/api/providers", async ({ request }) => {
    const parsed = CreateProviderProfileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      ProviderProfilePublicSchema.parse({
        id: crypto.randomUUID(),
        organizationId: MOCK_ORG_ID,
        name: parsed.data.name,
        providerType: parsed.data.providerType,
        baseUrl: parsed.data.baseUrl ?? null,
        hasApiKey: Boolean(parsed.data.apiKey),
        keyPreview: parsed.data.apiKey
          ? `${parsed.data.apiKey.slice(0, 3)}...${parsed.data.apiKey.slice(-4)}`
          : null,
        roleBindings: parsed.data.roleBindings,
        isDefault: parsed.data.isDefault,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/projects/:id/design-assets", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        DesignAssetListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(DesignAssetListResponseSchema.parse(mockDesignAssets));
  }),

  http.post("*/api/projects/:id/design-assets", async ({ request, params }) => {
    const projectId = String(params.id ?? MOCK_PROJECT_ID);
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const fileEntry = form.get("file");
      if (!(fileEntry instanceof File) || fileEntry.size <= 0) {
        return HttpResponse.json(
          ApiErrorSchema.parse({ error: "Arquivo de imagem obrigatório.", code: "MISSING_FILE" }),
          { status: 400 }
        );
      }
      const assetId = crypto.randomUUID();
      const now = new Date().toISOString();
      const rawTitle = form.get("title");
      const rawDeliverable = form.get("deliverableId");
      const rawNotes = form.get("notes");
      const rawType = form.get("assetType");
      let tags: string[] = [];
      const rawTags = form.get("intentionTags");
      if (typeof rawTags === "string" && rawTags.trim()) {
        try {
          const parsedTags = JSON.parse(rawTags) as unknown;
          if (Array.isArray(parsedTags)) {
            tags = parsedTags.filter((t): t is string => typeof t === "string");
          }
        } catch {
          tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
        }
      }
      return HttpResponse.json(
        DesignAssetSchema.parse({
          id: assetId,
          projectId,
          deliverableId:
            typeof rawDeliverable === "string" && rawDeliverable.length > 0
              ? rawDeliverable
              : null,
          assetType:
            rawType === "image_mockup" ? "image_mockup" : "moodboard_image",
          title:
            typeof rawTitle === "string" && rawTitle.trim().length > 0
              ? rawTitle.trim()
              : fileEntry.name,
          sourceUrl: null,
          assetUrl: `/api/assets/${assetId}`,
          mimeType: fileEntry.type || "image/png",
          sizeBytes: fileEntry.size,
          intentionTags: tags,
          notes: typeof rawNotes === "string" && rawNotes.length > 0 ? rawNotes : null,
          approved: false,
          createdAt: now,
          updatedAt: now,
        }),
        { status: 201 }
      );
    }

    const parsed = CreateDesignAssetReferenceSchema.safeParse(
      await request.json()
    );
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      DesignAssetSchema.parse({
        id: crypto.randomUUID(),
        projectId,
        deliverableId: parsed.data.deliverableId ?? null,
        assetType: parsed.data.assetType,
        title: parsed.data.title,
        sourceUrl: parsed.data.sourceUrl ?? null,
        assetUrl: null,
        mimeType: null,
        sizeBytes: null,
        intentionTags: parsed.data.intentionTags,
        notes: parsed.data.notes ?? null,
        approved: false,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.patch("*/api/projects/:id/design-assets/:assetId", async ({ request, params }) => {
    const parsed = UpdateDesignAssetSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const base = mockDesignAssets.items[0];
    const now = new Date().toISOString();
    return HttpResponse.json(
      DesignAssetSchema.parse({
        ...base,
        id: String(params.assetId ?? base?.id),
        projectId: String(params.id ?? MOCK_PROJECT_ID),
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        ...(parsed.data.intentionTags ? { intentionTags: parsed.data.intentionTags } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.approved !== undefined ? { approved: parsed.data.approved } : {}),
        updatedAt: now,
      })
    );
  }),

  http.delete("*/api/projects/:id/design-assets/:assetId", ({ params }) => {
    return HttpResponse.json({ deleted: true, id: String(params.assetId ?? "") });
  }),

  http.post("*/api/projects/:id/design-assets/generate-design-md", async ({ request, params }) => {
    const projectId = String(params.id ?? MOCK_PROJECT_ID);
    const parsed = GenerateDesignMdInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    const markdown = generateDesignMdContract({
      projectName: mockProjects.items[0]?.name ?? "Uzina Studio",
      themePreference: parsed.data.themePreference,
      assets: mockDesignAssets.items,
      notes: parsed.data.notes,
    });
    const now = new Date().toISOString();
    return HttpResponse.json(
      GenerateDesignMdResponseSchema.parse({
        asset: {
          id: crypto.randomUUID(),
          projectId,
          deliverableId: parsed.data.deliverableId ?? null,
          assetType: "design_md",
          title: "Contrato Visual .uzina/DESIGN.md",
          sourceUrl: null,
          assetUrl: null,
          mimeType: "text/markdown",
          sizeBytes: markdown.length,
          intentionTags: ["design-contract", parsed.data.themePreference],
          notes: markdown,
          approved: false,
          createdAt: now,
          updatedAt: now,
        },
        designMdPath: ".uzina/DESIGN.md",
        markdown,
      }),
      { status: 201 }
    );
  }),

  http.post("*/api/projects/:id/brownfield-scan", () => {
    return HttpResponse.json(BrownfieldMapSchema.parse(mockBrownfieldMap));
  }),

  http.get("*/api/deliverables/:id/workflow", ({ params }) => {
    return HttpResponse.json(
      DeliverableWorkflowStateSchema.parse({
        ...mockWorkflowState,
        deliverableId: String(params.id ?? mockWorkflowState.deliverableId),
      })
    );
  }),

  http.post("*/api/deliverables/:id/workflow/start", async ({ request, params }) => {
    const parsed = WorkflowStartInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      DeliverableWorkflowStateSchema.parse({
        ...mockWorkflowState,
        deliverableId: String(params.id ?? mockWorkflowState.deliverableId),
      })
    );
  }),

  http.post("*/api/deliverables/:id/workflow/resume", async ({ request, params }) => {
    const parsed = WorkflowResumeInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({ error: "Payload inválido", code: "VALIDATION_ERROR" }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      DeliverableWorkflowStateSchema.parse({
        ...mockWorkflowState,
        deliverableId: String(params.id ?? mockWorkflowState.deliverableId),
        deliverableStatus:
          parsed.data.decision === "rejected" ? "failed" : "spec_review",
        workflowStatus:
          parsed.data.decision === "rejected" ? "failed" : "suspended",
        gate: parsed.data.decision === "rejected" ? null : "blueprint_approve",
        suspendedStep:
          parsed.data.decision === "rejected" ? null : "stage_blueprint",
      })
    );
  }),

  http.get("*/api/decisions", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(DecisionListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(DecisionListResponseSchema.parse(mockDecisions));
  }),

  http.post("*/api/decisions/:id/resolve", async ({ request, params }) => {
    const parsed = ResolveDecisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const baseDecision = mockDecisions.items[0]!;
    const now = new Date().toISOString();
    return HttpResponse.json(
      ResolveDecisionResponseSchema.parse({
        decision: {
          ...baseDecision,
          id: String(params.id ?? MOCK_DECISION_ID),
          status: parsed.data.status,
          humanFeedback: parsed.data.humanFeedback ?? null,
          resolvedAt: now,
          updatedAt: now,
        },
        workflowState: {
          ...mockWorkflowState,
          workflowStatus: parsed.data.status === "changes_requested" ? "suspended" : "completed",
          deliverableStatus:
            parsed.data.status === "approved"
              ? "merged"
              : parsed.data.status === "rejected"
                ? "failed"
                : "building",
          gate:
            parsed.data.status === "changes_requested"
              ? "pr_evidence_approve"
              : null,
        },
      })
    );
  }),

  http.get("*/api/security/scans", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(
        SecurityScanListResponseSchema.parse({ items: [] })
      );
    }
    return HttpResponse.json(
      SecurityScanListResponseSchema.parse(mockSecurityScans)
    );
  }),

  http.post("*/api/security/scans", async ({ request }) => {
    const parsed = RunSecurityScanSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      SecurityScanResultSchema.parse({
        ...mockSecurityScanDetail,
        id: crypto.randomUUID(),
        targetType: parsed.data.targetType,
      }),
      { status: 201 }
    );
  }),

  http.post("*/api/security/scans/ingest", async ({ request }) => {
    const parsed = IngestSecurityScanSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      SecurityScanResultSchema.parse({
        ...mockSecurityScanDetail,
        id: crypto.randomUUID(),
        mode: "standalone",
        targetType: parsed.data.targetType,
        targetRef: parsed.data.targetRef,
      }),
      { status: 201 }
    );
  }),

  http.get("*/api/security/scans/:id", ({ params }) => {
    return HttpResponse.json(
      SecurityScanResultSchema.parse({
        ...mockSecurityScanDetail,
        id: String(params.id ?? MOCK_SCAN_ID),
      })
    );
  }),

  http.patch("*/api/security/findings/:id", async ({ request, params }) => {
    const parsed = UpdateFindingTriageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const baseFinding = mockSecurityScanDetail.findings![0]!;
    return HttpResponse.json(
      SecurityFindingDTOSchema.parse({
        ...baseFinding,
        id: String(params.id ?? MOCK_FINDING_ID),
        triageVerdict: parsed.data.triageVerdict,
        triageRationale:
          parsed.data.triageRationale ?? baseFinding.triageRationale,
        suppressedInMemory:
          parsed.data.suppressedInMemory ?? baseFinding.suppressedInMemory,
        povTestStatus: parsed.data.povTestStatus ?? baseFinding.povTestStatus,
        updatedAt: new Date().toISOString(),
      })
    );
  }),

  http.get("*/api/deliverables/:id/events", () => {
    const ev = mockExecutionEvents.items[0]!;
    const sse = `id: ${ev.id}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev)}\n\n`;
    return new HttpResponse(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }),

  http.get("*/api/memories", ({ request }) => {
    const url = new URL(request.url);
    const err = checkSimulatedState(url);
    if (err) return err;
    if (url.searchParams.get("state") === "empty") {
      return HttpResponse.json(MemoryListResponseSchema.parse({ items: [] }));
    }
    return HttpResponse.json(MemoryListResponseSchema.parse(mockMemories));
  }),

  http.post("*/api/memories", async ({ request }) => {
    const parsed = CreateMemorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    return HttpResponse.json(
      MemorySchema.parse({
        id: crypto.randomUUID(),
        organizationId: MOCK_ORG_ID,
        scopeType: parsed.data.scopeType,
        scopeId: parsed.data.scopeId,
        category: parsed.data.category,
        title: parsed.data.title,
        content: parsed.data.content,
        sourceDeliverableId: parsed.data.sourceDeliverableId ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      { status: 201 }
    );
  }),

  http.patch("*/api/memories/:id", async ({ request, params }) => {
    const parsed = UpdateMemorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const base = mockMemories.items[0]!;
    return HttpResponse.json(
      MemorySchema.parse({
        ...base,
        id: String(params.id ?? MOCK_MEMORY_ID),
        category: parsed.data.category ?? base.category,
        title: parsed.data.title ?? base.title,
        content: parsed.data.content ?? base.content,
        updatedAt: new Date().toISOString(),
      })
    );
  }),

  http.delete("*/api/memories/:id", () => {
    return HttpResponse.json({ deleted: true });
  }),

  http.post("*/api/copilot/chat", async ({ request }) => {
    const parsed = CopilotChatRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const frames = [
      `event: tool_call\ndata: ${JSON.stringify({ type: "tool_call", toolName: "read_workspace_overview", input: {} })}\n\n`,
      `event: token\ndata: ${JSON.stringify({ type: "token", text: "Resumo Executivo: workspace saudável com decisões e memórias isoladas." })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ type: "done", toolsUsed: ["read_workspace_overview"], finishReason: "completed" })}\n\n`,
    ].join("");
    return new HttpResponse(frames, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }),

  http.post("*/api/memories/search", async ({ request }) => {
    const parsed = QmdSearchRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      QmdSearchResponseSchema.parse({
        ...mockQmdSearchResponse,
        query: parsed.data.query,
        mode: parsed.data.mode,
      })
    );
  }),

  http.post("*/api/qmd/reindex", async ({ request }) => {
    const parsed = QmdReindexRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      QmdReindexResponseSchema.parse(mockQmdReindexResponse)
    );
  }),

  http.get("*/api/projects/:id/codebase", ({ params }) => {
    return HttpResponse.json(
      CodebaseTreeResponseSchema.parse({
        ...mockCodebaseTreeResponse,
        projectId: String(params.id ?? mockCodebaseTreeResponse.projectId),
      })
    );
  }),

  http.post("*/api/projects/:id/codebase/reindex", async ({ request, params }) => {
    const text = await request.text();
    const body = text.trim() ? JSON.parse(text) : {};
    const parsed = CodebaseReindexRequestSchema.safeParse(body);
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      CodebaseReindexResponseSchema.parse({
        ...mockCodebaseReindexResponse,
        projectId: String(params.id ?? mockCodebaseReindexResponse.projectId),
      })
    );
  }),

  http.post("*/api/projects/:id/codebase/symbols", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (body && body.mode === "slice") {
      const rest = { ...body };
      delete rest.mode;
      const parsedSlice = SymbolSliceRequestSchema.safeParse(rest);
      if (!parsedSlice.success) {
        return HttpResponse.json(
          ApiErrorSchema.parse({
            error: parsedSlice.error.issues[0]?.message ?? "Payload inválido",
            code: "VALIDATION_ERROR",
          }),
          { status: 400 }
        );
      }
      return HttpResponse.json(
        SymbolSliceResponseSchema.parse({
          ...mockSymbolSliceResponse,
          path: parsedSlice.data.path,
          symbol: parsedSlice.data.symbol,
        })
      );
    }

    const parsedGraph = SymbolGraphQuerySchema.safeParse(body);
    if (!parsedGraph.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsedGraph.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      SymbolGraphResponseSchema.parse({
        ...mockSymbolGraphResponse,
        query: parsedGraph.data.symbol,
      })
    );
  }),

  http.get("*/api/projects/:id/codebase/provenance", ({ params }) => {
    return HttpResponse.json(
      ProvenanceListResponseSchema.parse({
        ...mockProvenanceListResponse,
        projectId: String(params.id ?? mockProvenanceListResponse.projectId),
      })
    );
  }),

  http.get("*/api/projects/:id/prototypes", () => {
    return HttpResponse.json(
      DesignPrototypeListResponseSchema.parse(mockDesignPrototypes)
    );
  }),

  http.post("*/api/projects/:id/prototypes", async ({ request, params }) => {
    const parsed = CreatePrototypeRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    const base = mockDesignPrototypes.items[0]!;
    return HttpResponse.json(
      DesignPrototypeSchema.parse({
        ...base,
        projectId: String(params.id ?? base.projectId),
        level: parsed.data.level,
        source: parsed.data.source,
        title: parsed.data.title,
      }),
      { status: 201 }
    );
  }),

  http.patch(
    "*/api/projects/:id/prototypes/:prototypeId",
    async ({ request, params }) => {
      const parsed = UpdatePrototypeApprovalSchema.safeParse(
        await request.json()
      );
      if (!parsed.success) {
        return HttpResponse.json(
          ApiErrorSchema.parse({
            error: parsed.error.issues[0]?.message ?? "Payload inválido",
            code: "VALIDATION_ERROR",
          }),
          { status: 400 }
        );
      }
      const base = mockDesignPrototypes.items[0]!;
      return HttpResponse.json(
        DesignPrototypeSchema.parse({
          ...base,
          id: String(params.prototypeId ?? base.id),
          projectId: String(params.id ?? base.projectId),
          approved: parsed.data.approved,
          handoffPath: parsed.data.approved
            ? `.uzina/prototypes/${String(params.prototypeId ?? base.id)}`
            : null,
        })
      );
    }
  ),

  http.post("*/api/projects/:id/prototypes/stitch", async ({ request }) => {
    const text = await request.text();
    const body = text.trim() ? JSON.parse(text) : {};
    const parsed = StitchMcpSyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(
      StitchMcpSyncResponseSchema.parse(mockStitchSyncResponse)
    );
  }),

  http.get("*/api/prototypes/:id/preview", () => {
    return new HttpResponse("<main><h1>Preview Mock</h1></main>", {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:;",
      },
    });
  }),

  http.get("*/api/finops/summary", () => {
    return HttpResponse.json(FinopsSummarySchema.parse(mockFinopsSummary));
  }),

  http.post("*/api/finops/summary", async ({ request }) => {
    const parsed = RecordTokenSavingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        ApiErrorSchema.parse({
          error: parsed.error.issues[0]?.message ?? "Payload inválido",
          code: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }
    return HttpResponse.json(mockFinopsSummary.recentEvents[0]!, { status: 201 });
  }),
];
