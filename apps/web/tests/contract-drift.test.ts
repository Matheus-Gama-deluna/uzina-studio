import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgencyChatResponseSchema,
  AgencyOverviewResponseSchema,
  ApiErrorSchema,
  BrownfieldMapSchema,
  ClientListResponseSchema,
  CodebaseReindexResponseSchema,
  CodebaseTreeResponseSchema,
  DecisionListResponseSchema,
  ProvenanceListResponseSchema,
  SymbolGraphResponseSchema,
  DeliverableListResponseSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignAssetSchema,
  DesignPrototypeListResponseSchema,
  DesignPrototypeSchema,
  EngineConfigResponseSchema,
  FinopsSummarySchema,
  GenerateDesignMdResponseSchema,
  MemoryListResponseSchema,
  MemorySchema,
  ProjectListResponseSchema,
  ProviderProfileListResponseSchema,
  QmdReindexResponseSchema,
  QmdSearchResponseSchema,
  ResolveDecisionResponseSchema,
  SecurityFindingDTOSchema,
  SecurityScanListResponseSchema,
  SecurityScanResultSchema,
  StitchMcpSyncResponseSchema,
} from "@uzina/contracts";
import { closeDb } from "@uzina/db";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { POST as postCopilotChat } from "../src/app/api/copilot/chat/route";
import { POST as postAgencyChatRoute } from "../src/app/api/agency/chat/route";
import { GET as getAgencyStatusRoute } from "../src/app/api/agency/status/route";
import { GET as getEngineConfigRoute } from "../src/app/api/finops/config/route";
import { GET as getFinopsSummaryRoute } from "../src/app/api/finops/summary/route";
import { GET as getDecisions } from "../src/app/api/decisions/route";
import { POST as resolveDecisionRoute } from "../src/app/api/decisions/[id]/resolve/route";
import { GET as getDeliverableEvents } from "../src/app/api/deliverables/[id]/events/route";
import { GET as getWorkflow } from "../src/app/api/deliverables/[id]/workflow/route";
import { POST as resumeWorkflow } from "../src/app/api/deliverables/[id]/workflow/resume/route";
import { POST as startWorkflow } from "../src/app/api/deliverables/[id]/workflow/start/route";
import {
  DELETE as deleteMemoryRoute,
  PATCH as patchMemoryRoute,
} from "../src/app/api/memories/[id]/route";
import {
  GET as getMemoriesRoute,
  POST as createMemoryRoute,
} from "../src/app/api/memories/route";
import { POST as searchMemoriesQmdRoute } from "../src/app/api/memories/search/route";
import { POST as reindexQmdRoute } from "../src/app/api/qmd/reindex/route";
import { POST as runBrownfieldScan } from "../src/app/api/projects/[id]/brownfield-scan/route";
import { GET as getCodebaseProvenanceRoute } from "../src/app/api/projects/[id]/codebase/provenance/route";
import { POST as reindexCodebaseRoute } from "../src/app/api/projects/[id]/codebase/reindex/route";
import { GET as getCodebaseRoute } from "../src/app/api/projects/[id]/codebase/route";
import { POST as queryCodebaseSymbolsRoute } from "../src/app/api/projects/[id]/codebase/symbols/route";
import { PATCH as approvePrototypeRoute } from "../src/app/api/projects/[id]/prototypes/[prototypeId]/route";
import { GET as listPrototypesRoute, POST as createPrototypeRoute } from "../src/app/api/projects/[id]/prototypes/route";
import { POST as syncStitchRoute } from "../src/app/api/projects/[id]/prototypes/stitch/route";
import { GET as getDeliverables, POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import {
  DELETE as deleteDesignAsset,
  PATCH as patchDesignAsset,
} from "../src/app/api/projects/[id]/design-assets/[assetId]/route";
import { POST as generateDesignMd } from "../src/app/api/projects/[id]/design-assets/generate-design-md/route";
import { GET as getDesignAssets, POST as createDesignAsset } from "../src/app/api/projects/[id]/design-assets/route";
import { GET as getProjects, POST as createProject } from "../src/app/api/projects/route";
import { GET as getProviders, POST as createProvider } from "../src/app/api/providers/route";
import { PATCH as patchSecurityFinding } from "../src/app/api/security/findings/[id]/route";
import { GET as getSecurityScanById } from "../src/app/api/security/scans/[id]/route";
import { POST as ingestSecurityScan } from "../src/app/api/security/scans/ingest/route";
import { GET as getSecurityScans, POST as runSecurityScanRoute } from "../src/app/api/security/scans/route";
import { resetAuthForTests } from "../src/lib/auth";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";
import { server } from "../src/mocks/server";

function getCookie(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

describe("Contract Drift Check — MSW vs Rotas REST Reais", () => {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
  });

  test("respostas dos handlers MSW passam nos mesmos schemas Zod que as rotas reais em PGlite", async () => {
    // 1. Validar respostas via MSW (borda HTTP interceptada)
    const mswClientsRes = await fetch("http://msw.local/api/clients");
    expect(mswClientsRes.status).toBe(200);
    const mswClients = ClientListResponseSchema.parse(await mswClientsRes.json());

    const mswProjectsRes = await fetch("http://msw.local/api/projects");
    expect(mswProjectsRes.status).toBe(200);
    const mswProjects = ProjectListResponseSchema.parse(await mswProjectsRes.json());
    const mswProjectId = mswProjects.items[0]?.id ?? "";

    const mswDeliverablesRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/deliverables`
    );
    expect(mswDeliverablesRes.status).toBe(200);
    const mswDeliverables = DeliverableListResponseSchema.parse(
      await mswDeliverablesRes.json()
    );
    const mswDeliverableId = mswDeliverables.items[0]?.id ?? "";

    const mswProvidersRes = await fetch("http://msw.local/api/providers");
    expect(mswProvidersRes.status).toBe(200);
    ProviderProfileListResponseSchema.parse(await mswProvidersRes.json());

    const mswAssetsRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/design-assets`
    );
    expect(mswAssetsRes.status).toBe(200);
    const mswAssets = DesignAssetListResponseSchema.parse(
      await mswAssetsRes.json()
    );
    const mswAssetId = mswAssets.items[0]?.id ?? "";

    const mswCreateAssetRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/design-assets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetType: "reference_url",
          title: "MSW Ref",
          sourceUrl: "https://linear.app",
          intentionTags: ["densidade"],
        }),
      }
    );
    expect(mswCreateAssetRes.status).toBe(201);
    DesignAssetSchema.parse(await mswCreateAssetRes.json());

    const mswPatchAssetRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/design-assets/${mswAssetId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }
    );
    expect(mswPatchAssetRes.status).toBe(200);
    DesignAssetSchema.parse(await mswPatchAssetRes.json());

    const mswDeleteAssetRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/design-assets/${mswAssetId}`,
      { method: "DELETE" }
    );
    expect(mswDeleteAssetRes.status).toBe(200);
    expect((await mswDeleteAssetRes.json()) as { deleted: boolean }).toMatchObject({
      deleted: true,
    });

    const mswDesignMdRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/design-assets/generate-design-md`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themePreference: "dual_theme" }),
      }
    );
    expect(mswDesignMdRes.status).toBe(201);
    GenerateDesignMdResponseSchema.parse(await mswDesignMdRes.json());

    const mswBfRes = await fetch(
      `http://msw.local/api/projects/${mswProjectId}/brownfield-scan`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    expect(mswBfRes.status).toBe(200);
    BrownfieldMapSchema.parse(await mswBfRes.json());

    const mswWfRes = await fetch(
      `http://msw.local/api/deliverables/${mswDeliverableId}/workflow`
    );
    expect(mswWfRes.status).toBe(200);
    DeliverableWorkflowStateSchema.parse(await mswWfRes.json());

    const mswEmptyRes = await fetch("http://msw.local/api/projects?state=empty");
    expect(mswEmptyRes.status).toBe(200);
    expect(ProjectListResponseSchema.parse(await mswEmptyRes.json()).items).toEqual([]);

    const mswErrorRes = await fetch("http://msw.local/api/clients?state=error");
    expect(mswErrorRes.status).toBe(500);
    ApiErrorSchema.parse(await mswErrorRes.json());

    // 2. Validar respostas das rotas reais contra os mesmos schemas Zod
    resetAuthForTests();
    await closeDb();

    const signUpRes = await authPost(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Operador Drift",
          email: "drift@uzina.studio",
          password: "StrongPassword!123",
        }),
      })
    );
    expect(signUpRes.status).toBe(200);
    const cookie = getCookie(signUpRes);

    const realClientsRes = await getClients(
      new Request("http://localhost:3000/api/clients", { headers: { cookie } })
    );
    expect(realClientsRes.status).toBe(200);
    const realClients = ClientListResponseSchema.parse(await realClientsRes.json());
    const internalClient = realClients.items.find((c) => c.isDefaultInternal);
    expect(internalClient?.slug).toBe(mswClients.items[0]?.slug);

    const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-drift-repo-"));
    try {
      fs.writeFileSync(
        path.join(tempRepo, "package.json"),
        JSON.stringify({ name: "drift-repo", scripts: { test: "vitest" } }),
        "utf8"
      );
      const createProjRes = await createProject(
        new Request("http://localhost:3000/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            clientId: internalClient?.id,
            name: "Projeto Drift",
            defaultDevelopmentStrategy: "frontend_first_msw",
            repository: { name: "repo-drift", localPath: tempRepo },
          }),
        })
      );
      expect(createProjRes.status).toBe(201);

      const realProjectsRes = await getProjects(
        new Request("http://localhost:3000/api/projects", { headers: { cookie } })
      );
      expect(realProjectsRes.status).toBe(200);
      const realProjects = ProjectListResponseSchema.parse(
        await realProjectsRes.json()
      );
      const projectId = realProjects.items[0]?.id ?? "";

      const createDelivRes = await createDeliverable(
        new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ title: "Entrega Drift", hasUi: true }),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(createDelivRes.status).toBe(201);

      const realDelivRes = await getDeliverables(
        new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realDelivRes.status).toBe(200);
      DeliverableListResponseSchema.parse(await realDelivRes.json());

      const createProvRes = await createProvider(
        new Request("http://localhost:3000/api/providers", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            name: "OmniRoute Real",
            providerType: "omniroute",
            baseUrl: "http://localhost:8080/v1",
            apiKey: "sk-drift-secret-9988",
            isDefault: true,
          }),
        })
      );
      expect(createProvRes.status).toBe(201);

      const realProvRes = await getProviders(
        new Request("http://localhost:3000/api/providers", { headers: { cookie } })
      );
      expect(realProvRes.status).toBe(200);
      ProviderProfileListResponseSchema.parse(await realProvRes.json());

      const realDeliverablesParsed = DeliverableListResponseSchema.parse(
        await (
          await getDeliverables(
            new Request(
              `http://localhost:3000/api/projects/${projectId}/deliverables`,
              { headers: { cookie } }
            ),
            { params: Promise.resolve({ id: projectId }) }
          )
        ).json()
      );
      const deliverableId = realDeliverablesParsed.items[0]?.id ?? "";

      const createAssetRes = await createDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({
              assetType: "reference_url",
              title: "Referência Drift",
              sourceUrl: "https://linear.app",
              intentionTags: ["copiar:grid"],
            }),
          }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(createAssetRes.status).toBe(201);
      const createdAsset = DesignAssetSchema.parse(await createAssetRes.json());

      const realPatchAssetRes = await patchDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets/${createdAsset.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ approved: true }),
          }
        ),
        { params: Promise.resolve({ id: projectId, assetId: createdAsset.id }) }
      );
      expect(realPatchAssetRes.status).toBe(200);
      DesignAssetSchema.parse(await realPatchAssetRes.json());

      const realAssetsRes = await getDesignAssets(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets`,
          { headers: { cookie } }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realAssetsRes.status).toBe(200);
      DesignAssetListResponseSchema.parse(await realAssetsRes.json());

      const realDesignMdRes = await generateDesignMd(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets/generate-design-md`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ themePreference: "dual_theme" }),
          }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realDesignMdRes.status).toBe(201);
      GenerateDesignMdResponseSchema.parse(await realDesignMdRes.json());

      const realDeleteAssetRes = await deleteDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets/${createdAsset.id}`,
          { method: "DELETE", headers: { cookie } }
        ),
        { params: Promise.resolve({ id: projectId, assetId: createdAsset.id }) }
      );
      expect(realDeleteAssetRes.status).toBe(200);
      expect((await realDeleteAssetRes.json()) as { deleted: boolean }).toMatchObject({
        deleted: true,
      });

      const realBfRes = await runBrownfieldScan(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({}),
          }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realBfRes.status).toBe(200);
      BrownfieldMapSchema.parse(await realBfRes.json());

      const realWfBefore = await getWorkflow(
        new Request(
          `http://localhost:3000/api/deliverables/${deliverableId}/workflow`,
          { headers: { cookie } }
        ),
        { params: Promise.resolve({ id: deliverableId }) }
      );
      expect(realWfBefore.status).toBe(200);
      DeliverableWorkflowStateSchema.parse(await realWfBefore.json());

      const realWfStarted = await startWorkflow(
        new Request(
          `http://localhost:3000/api/deliverables/${deliverableId}/workflow/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({}),
          }
        ),
        { params: Promise.resolve({ id: deliverableId }) }
      );
      expect(realWfStarted.status).toBe(200);
      DeliverableWorkflowStateSchema.parse(await realWfStarted.json());

      const realWfResumed = await resumeWorkflow(
        new Request(
          `http://localhost:3000/api/deliverables/${deliverableId}/workflow/resume`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ decision: "approved" }),
          }
        ),
        { params: Promise.resolve({ id: deliverableId }) }
      );
      expect(realWfResumed.status).toBe(200);
      DeliverableWorkflowStateSchema.parse(await realWfResumed.json());

      // Slice 4: Decisões, Security Scans, Findings Triage e Events SSE (MSW vs Rotas Reais)
      const mswDecRes = await fetch("http://msw.local/api/decisions");
      expect(mswDecRes.status).toBe(200);
      const mswDecs = DecisionListResponseSchema.parse(await mswDecRes.json());
      const mswDecId = mswDecs.items[0]!.id;

      const mswResolveRes = await fetch(
        `http://msw.local/api/decisions/${mswDecId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        }
      );
      expect(mswResolveRes.status).toBe(200);
      ResolveDecisionResponseSchema.parse(await mswResolveRes.json());

      const mswScansRes = await fetch("http://msw.local/api/security/scans");
      expect(mswScansRes.status).toBe(200);
      const mswScans = SecurityScanListResponseSchema.parse(
        await mswScansRes.json()
      );
      const mswScanId = mswScans.items[0]!.id;

      const mswScanDetailRes = await fetch(
        `http://msw.local/api/security/scans/${mswScanId}`
      );
      expect(mswScanDetailRes.status).toBe(200);
      const mswScanDetail = SecurityScanResultSchema.parse(
        await mswScanDetailRes.json()
      );
      const mswFindingId = mswScanDetail.findings![0]!.id;

      const mswTriageRes = await fetch(
        `http://msw.local/api/security/findings/${mswFindingId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ triageVerdict: "confirmed" }),
        }
      );
      expect(mswTriageRes.status).toBe(200);
      SecurityFindingDTOSchema.parse(await mswTriageRes.json());

      const realDecRes = await getDecisions(
        new Request("http://localhost:3000/api/decisions?status=pending", {
          headers: { cookie },
        })
      );
      expect(realDecRes.status).toBe(200);
      const realDecs = DecisionListResponseSchema.parse(await realDecRes.json());
      const realDecId = realDecs.items[0]!.id;

      const realResolveRes = await resolveDecisionRoute(
        new Request(`http://localhost:3000/api/decisions/${realDecId}/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ status: "approved" }),
        }),
        { params: Promise.resolve({ id: realDecId }) }
      );
      expect(realResolveRes.status).toBe(200);
      ResolveDecisionResponseSchema.parse(await realResolveRes.json());

      const realRunScanRes = await runSecurityScanRoute(
        new Request("http://localhost:3000/api/security/scans", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ projectId, targetType: "git_repo" }),
        })
      );
      expect(realRunScanRes.status).toBe(201);
      const realCreatedScan = SecurityScanResultSchema.parse(
        await realRunScanRes.json()
      );

      const realIngestRes = await ingestSecurityScan(
        new Request("http://localhost:3000/api/security/scans/ingest", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            projectId,
            deliverableId,
            targetType: "git_repo",
            targetRef: "HEAD",
            scannersRun: ["native_secrets"],
            scannerStatuses: [
              {
                scanner: "native_secrets",
                status: "executed",
                binaryName: null,
                installHint: null,
                findingsCount: 1,
                durationMs: 2,
                errorMessage: null,
              },
            ],
            sarifRawJson: {
              version: "2.1.0",
              runs: [{ tool: { driver: { name: "uzina-sec" } }, results: [] }],
            },
            summaryCountsJson: {
              critical: 0,
              high: 0,
              medium: 1,
              low: 0,
              info: 0,
              total: 1,
              confirmedCount: 0,
              suppressedCount: 0,
              skippedScannersCount: 0,
            },
            findings: [
              {
                ruleId: "uzina/drift-check",
                scanner: "native_secrets",
                severity: "medium",
                title: "Check de drift",
                description: "Descrição limpa",
                fingerprint: "9".repeat(64),
              },
            ],
          }),
        })
      );
      expect(realIngestRes.status).toBe(201);
      const ingestedScan = SecurityScanResultSchema.parse(
        await realIngestRes.json()
      );
      const realFindingId = ingestedScan.findings![0]!.id;

      const realScansRes = await getSecurityScans(
        new Request("http://localhost:3000/api/security/scans", {
          headers: { cookie },
        })
      );
      expect(realScansRes.status).toBe(200);
      SecurityScanListResponseSchema.parse(await realScansRes.json());

      const realScanByIdRes = await getSecurityScanById(
        new Request(
          `http://localhost:3000/api/security/scans/${realCreatedScan.id}`,
          { headers: { cookie } }
        ),
        { params: Promise.resolve({ id: realCreatedScan.id }) }
      );
      expect(realScanByIdRes.status).toBe(200);
      SecurityScanResultSchema.parse(await realScanByIdRes.json());

      const realPatchFindingRes = await patchSecurityFinding(
        new Request(
          `http://localhost:3000/api/security/findings/${realFindingId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ triageVerdict: "confirmed" }),
          }
        ),
        { params: Promise.resolve({ id: realFindingId }) }
      );
      expect(realPatchFindingRes.status).toBe(200);
      SecurityFindingDTOSchema.parse(await realPatchFindingRes.json());

      const realEventsRes = await getDeliverableEvents(
        new Request(
          `http://localhost:3000/api/deliverables/${deliverableId}/events?snapshot=true`,
          { headers: { cookie } }
        ),
        { params: Promise.resolve({ id: deliverableId }) }
      );
      expect(realEventsRes.status).toBe(200);
      expect(realEventsRes.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      const sseBody = await realEventsRes.text();
      expect(sseBody).toContain("event: stage_change");

      // Slice 5: Memories & Executive Copilot SSE (MSW vs Rotas Reais)
      const mswMemRes = await fetch("http://msw.local/api/memories");
      expect(mswMemRes.status).toBe(200);
      MemoryListResponseSchema.parse(await mswMemRes.json());

      const mswCreateMemRes = await fetch("http://msw.local/api/memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: "project",
          scopeId: mswProjectId,
          category: "convention",
          title: "Drift Memória",
          content: "Validação Zod alinhada.",
        }),
      });
      expect(mswCreateMemRes.status).toBe(201);
      MemorySchema.parse(await mswCreateMemRes.json());

      const mswCopilotRes = await fetch("http://msw.local/api/copilot/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Resumo" }],
        }),
      });
      expect(mswCopilotRes.status).toBe(200);
      expect(await mswCopilotRes.text()).toContain("event: token");

      const realCreateMemRes = await createMemoryRoute(
        new Request("http://localhost:3000/api/memories", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            scopeType: "project",
            scopeId: projectId,
            category: "architecture",
            title: "Regra Real Drift",
            content: "Arquitetura modular verificada.",
          }),
        })
      );
      expect(realCreateMemRes.status).toBe(201);
      const createdMem = MemorySchema.parse(await realCreateMemRes.json());

      const realListMemRes = await getMemoriesRoute(
        new Request(`http://localhost:3000/api/memories?projectId=${projectId}`, {
          headers: { cookie },
        })
      );
      expect(realListMemRes.status).toBe(200);
      MemoryListResponseSchema.parse(await realListMemRes.json());

      const realPatchMemRes = await patchMemoryRoute(
        new Request(`http://localhost:3000/api/memories/${createdMem.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ title: "Regra Atualizada" }),
        }),
        { params: Promise.resolve({ id: createdMem.id }) }
      );
      expect(realPatchMemRes.status).toBe(200);
      MemorySchema.parse(await realPatchMemRes.json());

      const mswQmdSearchRes = await fetch("http://msw.local/api/memories/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Arquitetura modular", mode: "hybrid" }),
      });
      expect(mswQmdSearchRes.status).toBe(200);
      QmdSearchResponseSchema.parse(await mswQmdSearchRes.json());

      const realQmdSearchRes = await searchMemoriesQmdRoute(
        new Request("http://localhost:3000/api/memories/search", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            query: "Arquitetura modular",
            mode: "hybrid",
            projectId,
          }),
        })
      );
      expect(realQmdSearchRes.status).toBe(200);
      QmdSearchResponseSchema.parse(await realQmdSearchRes.json());

      const mswQmdReindexRes = await fetch("http://msw.local/api/qmd/reindex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeDocs: false }),
      });
      expect(mswQmdReindexRes.status).toBe(200);
      QmdReindexResponseSchema.parse(await mswQmdReindexRes.json());

      const realQmdReindexRes = await reindexQmdRoute(
        new Request("http://localhost:3000/api/qmd/reindex", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ includeDocs: false }),
        })
      );
      expect(realQmdReindexRes.status).toBe(200);
      QmdReindexResponseSchema.parse(await realQmdReindexRes.json());

      const realCopilotRes = await postCopilotChat(
        new Request("http://localhost:3000/api/copilot/chat", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Resuma o projeto" }],
            projectId,
          }),
        })
      );
      expect(realCopilotRes.status).toBe(200);
      expect(realCopilotRes.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      expect(await realCopilotRes.text()).toContain("event: done");

      const realDeleteMemRes = await deleteMemoryRoute(
        new Request(`http://localhost:3000/api/memories/${createdMem.id}`, {
          method: "DELETE",
          headers: { cookie },
        }),
        { params: Promise.resolve({ id: createdMem.id }) }
      );
      expect(realDeleteMemRes.status).toBe(200);
      expect(
        (await realDeleteMemRes.json()) as { deleted: boolean }
      ).toMatchObject({ deleted: true });

      const mswCbTree = await fetch(
        `http://msw.local/api/projects/${projectId}/codebase`
      );
      expect(mswCbTree.status).toBe(200);
      CodebaseTreeResponseSchema.parse(await mswCbTree.json());

      const realCbReindex = await reindexCodebaseRoute(
        new Request(`http://localhost:3000/api/projects/${projectId}/codebase/reindex`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realCbReindex.status).toBe(200);
      CodebaseReindexResponseSchema.parse(await realCbReindex.json());

      const realCbTree = await getCodebaseRoute(
        new Request(`http://localhost:3000/api/projects/${projectId}/codebase`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realCbTree.status).toBe(200);
      CodebaseTreeResponseSchema.parse(await realCbTree.json());

      const mswCbSymbols = await fetch(
        `http://msw.local/api/projects/${projectId}/codebase/symbols`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ symbol: "createDeliverable" }),
        }
      );
      expect(mswCbSymbols.status).toBe(200);
      SymbolGraphResponseSchema.parse(await mswCbSymbols.json());

      const realCbSymbols = await queryCodebaseSymbolsRoute(
        new Request(`http://localhost:3000/api/projects/${projectId}/codebase/symbols`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ symbol: "hello" }),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realCbSymbols.status).toBe(200);
      SymbolGraphResponseSchema.parse(await realCbSymbols.json());

      const mswCbProv = await fetch(
        `http://msw.local/api/projects/${projectId}/codebase/provenance`
      );
      expect(mswCbProv.status).toBe(200);
      ProvenanceListResponseSchema.parse(await mswCbProv.json());

      const realCbProv = await getCodebaseProvenanceRoute(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/codebase/provenance`,
          { headers: { cookie } }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realCbProv.status).toBe(200);
      ProvenanceListResponseSchema.parse(await realCbProv.json());

      const mswProtoPost = await fetch(
        `http://msw.local/api/projects/${projectId}/prototypes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Proto Drift",
            level: 3,
            source: "stitch_import",
            html: "<main>Drift</main>",
          }),
        }
      );
      expect(mswProtoPost.status).toBe(201);
      DesignPrototypeSchema.parse(await mswProtoPost.json());

      const realProtoPost = await createPrototypeRoute(
        new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            title: "Proto Drift",
            level: 3,
            source: "stitch_import",
            html: "<main>Drift</main>",
          }),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realProtoPost.status).toBe(201);
      const createdProto = DesignPrototypeSchema.parse(
        await realProtoPost.json()
      );

      const mswProtoList = await fetch(
        `http://msw.local/api/projects/${projectId}/prototypes`
      );
      expect(mswProtoList.status).toBe(200);
      DesignPrototypeListResponseSchema.parse(await mswProtoList.json());

      const realProtoList = await listPrototypesRoute(
        new Request(`http://localhost:3000/api/projects/${projectId}/prototypes`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realProtoList.status).toBe(200);
      DesignPrototypeListResponseSchema.parse(await realProtoList.json());

      const realProtoApprove = await approvePrototypeRoute(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/prototypes/${createdProto.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ approved: true, syncDesignMd: false }),
          }
        ),
        {
          params: Promise.resolve({
            id: projectId,
            prototypeId: createdProto.id,
          }),
        }
      );
      expect(realProtoApprove.status).toBe(200);
      DesignPrototypeSchema.parse(await realProtoApprove.json());

      const mswStitchSync = await fetch(
        `http://msw.local/api/projects/${projectId}/prototypes/stitch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "list_screens" }),
        }
      );
      expect(mswStitchSync.status).toBe(200);
      StitchMcpSyncResponseSchema.parse(await mswStitchSync.json());

      const realStitchSync = await syncStitchRoute(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/prototypes/stitch`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie },
            body: JSON.stringify({ action: "list_screens" }),
          }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(realStitchSync.status).toBe(200);
      StitchMcpSyncResponseSchema.parse(await realStitchSync.json());

      const mswFinops = await fetch("http://msw.local/api/finops/summary");
      expect(mswFinops.status).toBe(200);
      FinopsSummarySchema.parse(await mswFinops.json());

      const realFinops = await getFinopsSummaryRoute(
        new Request("http://localhost:3000/api/finops/summary", {
          headers: { cookie },
        })
      );
      expect(realFinops.status).toBe(200);
      FinopsSummarySchema.parse(await realFinops.json());

      const mswEngineCfg = await fetch("http://msw.local/api/finops/config");
      expect(mswEngineCfg.status).toBe(200);
      EngineConfigResponseSchema.parse(await mswEngineCfg.json());

      const realEngineCfg = await getEngineConfigRoute(
        new Request("http://localhost:3000/api/finops/config", {
          headers: { cookie },
        })
      );
      expect(realEngineCfg.status).toBe(200);
      EngineConfigResponseSchema.parse(await realEngineCfg.json());

      const mswAgencyStatus = await fetch("http://msw.local/api/agency/status");
      expect(mswAgencyStatus.status).toBe(200);
      AgencyOverviewResponseSchema.parse(await mswAgencyStatus.json());

      const realAgencyStatus = await getAgencyStatusRoute(
        new Request("http://localhost:3000/api/agency/status", {
          headers: { cookie },
        })
      );
      expect(realAgencyStatus.status).toBe(200);
      AgencyOverviewResponseSchema.parse(await realAgencyStatus.json());

      const mswAgencyChat = await fetch("http://msw.local/api/agency/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Analise o status da arquitetura do projeto.",
          projectId,
        }),
      });
      expect(mswAgencyChat.status).toBe(200);
      AgencyChatResponseSchema.parse(await mswAgencyChat.json());

      const realAgencyChat = await postAgencyChatRoute(
        new Request("http://localhost:3000/api/agency/chat", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            message: "Analise o status da arquitetura do projeto.",
            projectId,
          }),
        })
      );
      expect(realAgencyChat.status).toBe(200);
      AgencyChatResponseSchema.parse(await realAgencyChat.json());
    } finally {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
