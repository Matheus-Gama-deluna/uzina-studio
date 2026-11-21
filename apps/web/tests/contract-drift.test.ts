import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ApiErrorSchema,
  BrownfieldMapSchema,
  ClientListResponseSchema,
  DeliverableListResponseSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignAssetSchema,
  GenerateDesignMdResponseSchema,
  ProjectListResponseSchema,
  ProviderProfileListResponseSchema,
} from "@uzina/contracts";
import { closeDb } from "@uzina/db";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getWorkflow } from "../src/app/api/deliverables/[id]/workflow/route";
import { POST as resumeWorkflow } from "../src/app/api/deliverables/[id]/workflow/resume/route";
import { POST as startWorkflow } from "../src/app/api/deliverables/[id]/workflow/start/route";
import { POST as runBrownfieldScan } from "../src/app/api/projects/[id]/brownfield-scan/route";
import { GET as getDeliverables, POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import {
  DELETE as deleteDesignAsset,
  PATCH as patchDesignAsset,
} from "../src/app/api/projects/[id]/design-assets/[assetId]/route";
import { POST as generateDesignMd } from "../src/app/api/projects/[id]/design-assets/generate-design-md/route";
import { GET as getDesignAssets, POST as createDesignAsset } from "../src/app/api/projects/[id]/design-assets/route";
import { GET as getProjects, POST as createProject } from "../src/app/api/projects/route";
import { GET as getProviders, POST as createProvider } from "../src/app/api/providers/route";
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
    } finally {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
