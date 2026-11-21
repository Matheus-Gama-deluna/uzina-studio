import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BrownfieldMapSchema,
  DeliverableWorkflowStateSchema,
  DesignAssetListResponseSchema,
  DesignAssetSchema,
  GenerateDesignMdResponseSchema,
} from "@uzina/contracts";
import { closeDb, getDb, users } from "@uzina/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GET as getAssetBinary } from "../src/app/api/assets/[id]/route";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as getClients } from "../src/app/api/clients/route";
import { GET as getWorkflow } from "../src/app/api/deliverables/[id]/workflow/route";
import { POST as resumeWorkflow } from "../src/app/api/deliverables/[id]/workflow/resume/route";
import { POST as startWorkflow } from "../src/app/api/deliverables/[id]/workflow/start/route";
import { POST as runBrownfieldScan } from "../src/app/api/projects/[id]/brownfield-scan/route";
import { POST as createDeliverable } from "../src/app/api/projects/[id]/deliverables/route";
import {
  DELETE as deleteDesignAsset,
  PATCH as patchDesignAsset,
} from "../src/app/api/projects/[id]/design-assets/[assetId]/route";
import { POST as generateDesignMd } from "../src/app/api/projects/[id]/design-assets/generate-design-md/route";
import {
  GET as getDesignAssets,
  POST as createDesignAsset,
} from "../src/app/api/projects/[id]/design-assets/route";
import { POST as createProject } from "../src/app/api/projects/route";
import { POST as createRepository } from "../src/app/api/projects/[id]/repositories/route";
import { resetAuthForTests } from "../src/lib/auth";
import { getUploadsRootDir } from "../src/lib/uploads";
import { resetWebWorkflowRuntimeForTests } from "../src/lib/workflow-runtime";

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

async function signUpAndGetCookie(name: string, email: string): Promise<string> {
  const res = await authPost(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "StrongPassword!123" }),
    })
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}

// PNG 1x1 válido mínimo (assinatura PNG + IHDR)
const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

describe("Slice 3 APIs — Design Assets, Uploads Seguros, Brownfield Scan & Workflow", () => {
  let ownerCookie = "";
  let sameOrgAuditorCookie = "";
  let otherOrgCookie = "";
  let projectId = "";
  let deliverableId = "";
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();

    ownerCookie = await signUpAndGetCookie(
      "Owner Slice 3",
      "owner-s3@uzina.studio"
    );
    otherOrgCookie = await signUpAndGetCookie(
      "Outro Tenant",
      "other-s3@uzina.studio"
    );
    sameOrgAuditorCookie = await signUpAndGetCookie(
      "Auditor Mesma Org",
      "auditor-same-s3@uzina.studio"
    );

    const clientsRes = await getClients(
      new Request("http://localhost:3000/api/clients", {
        headers: { cookie: ownerCookie },
      })
    );
    const clientsBody = (await clientsRes.json()) as {
      items: Array<{ id: string; organizationId: string }>;
    };
    const clientId = clientsBody.items[0]?.id ?? "";
    const ownerOrgId = clientsBody.items[0]?.organizationId ?? "";

    const { db } = await getDb();
    await db
      .update(users)
      .set({ organizationId: ownerOrgId, role: "auditor" })
      .where(eq(users.email, "auditor-same-s3@uzina.studio"));

    const projRes = await createProject(
      new Request("http://localhost:3000/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          clientId,
          name: "Projeto Studio Slice 3",
          defaultDevelopmentStrategy: "frontend_first_msw",
        }),
      })
    );
    expect(projRes.status).toBe(201);
    const proj = (await projRes.json()) as { id: string };
    projectId = proj.id;

    const delivRes = await createDeliverable(
      new Request(`http://localhost:3000/api/projects/${projectId}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({
          title: "Estúdio Visual Integrado",
          description: "Upload de moodboard e contrato DESIGN.md",
          hasUi: true,
        }),
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(delivRes.status).toBe(201);
    deliverableId = ((await delivRes.json()) as { id: string }).id;
  });

  afterAll(async () => {
    await resetWebWorkflowRuntimeForTests();
    resetAuthForTests();
    await closeDb();
    const projectUploads = path.join(getUploadsRootDir(), projectId);
    if (projectId && fs.existsSync(projectUploads)) {
      fs.rmSync(projectUploads, { recursive: true, force: true });
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("impõe RBAC (403/401) e valida upload magic bytes vs SVG/forjado e Content-Length 413", async () => {
    // 1. Sem sessão -> 401 em GET /api/assets/:id e design-assets
    const unauthRes = await getDesignAssets(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(unauthRes.status).toBe(401);

    // 2. Auditor da mesma org -> 403 RBAC em POST design-assets; outro tenant -> 404 anti-IDOR
    const auditorPost = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sameOrgAuditorCookie,
          },
          body: JSON.stringify({
            assetType: "reference_url",
            title: "Tentativa Auditor",
            sourceUrl: "https://example.com",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(auditorPost.status).toBe(403);

    const otherOrgPost = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: otherOrgCookie,
          },
          body: JSON.stringify({
            assetType: "reference_url",
            title: "Tentativa Cross-Tenant",
            sourceUrl: "https://example.com",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(otherOrgPost.status).toBe(404);

    // 3. Content-Length > 5.5 MiB -> 413 antes de parsear formData
    const tooLargeReq = new Request(
      `http://localhost:3000/api/projects/${projectId}/design-assets`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "multipart/form-data; boundary=---test",
          "content-length": String(6 * 1024 * 1024),
        },
        body: "dummy",
      }
    );
    const res413 = await createDesignAsset(tooLargeReq, {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res413.status).toBe(413);

    // 4. Rejeita SVG mesmo declarado como image/png
    const svgForm = new FormData();
    svgForm.append("title", "SVG Malicioso");
    svgForm.append(
      "file",
      new File(["<svg onload=alert(1)></svg>"], "evil.png", {
        type: "image/png",
      })
    );
    const svgRes = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        {
          method: "POST",
          headers: { cookie: ownerCookie },
          body: svgForm,
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(svgRes.status).toBe(400);

    // 5. Upload PNG válido + entrega protegida GET /api/assets/[id] + anti-IDOR 404
    const pngForm = new FormData();
    pngForm.append("title", "Moodboard Cockpit");
    pngForm.append("assetType", "moodboard_image");
    pngForm.append("deliverableId", deliverableId);
    pngForm.append("intentionTags", JSON.stringify(["copiar:layout", "dark"]));
    pngForm.append(
      "file",
      new File([VALID_PNG_BYTES], "moodboard.png", { type: "image/png" })
    );

    const uploadRes = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        {
          method: "POST",
          headers: { cookie: ownerCookie },
          body: pngForm,
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(uploadRes.status).toBe(201);
    const uploadedAsset = DesignAssetSchema.parse(await uploadRes.json());
    expect(uploadedAsset.mimeType).toBe("image/png");
    expect(uploadedAsset.assetUrl).toBe(`/api/assets/${uploadedAsset.id}`);
    expect(uploadedAsset.intentionTags).toEqual(["copiar:layout", "dark"]);

    // Cross-tenant GET /api/assets/[id] -> 404 (nunca 403 revelando existência)
    const crossTenantGet = await getAssetBinary(
      new Request(`http://localhost:3000/api/assets/${uploadedAsset.id}`, {
        headers: { cookie: otherOrgCookie },
      }),
      { params: Promise.resolve({ id: uploadedAsset.id }) }
    );
    expect(crossTenantGet.status).toBe(404);

    // Dono GET /api/assets/[id] -> 200 + nosniff + CSP sandbox
    const ownerAssetGet = await getAssetBinary(
      new Request(`http://localhost:3000/api/assets/${uploadedAsset.id}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: uploadedAsset.id }) }
    );
    expect(ownerAssetGet.status).toBe(200);
    expect(ownerAssetGet.headers.get("content-type")).toBe("image/png");
    expect(ownerAssetGet.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ownerAssetGet.headers.get("content-security-policy")).toContain(
      "sandbox"
    );

    // PATCH + DELETE
    const patchRes = await patchDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets/${uploadedAsset.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ approved: true, notes: "Aprovado" }),
        }
      ),
      { params: Promise.resolve({ id: projectId, assetId: uploadedAsset.id }) }
    );
    expect(patchRes.status).toBe(200);
    expect(DesignAssetSchema.parse(await patchRes.json()).approved).toBe(true);

    const delRes = await deleteDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets/${uploadedAsset.id}`,
        {
          method: "DELETE",
          headers: { cookie: ownerCookie },
        }
      ),
      { params: Promise.resolve({ id: projectId, assetId: uploadedAsset.id }) }
    );
    expect(delRes.status).toBe(200);

    // Após DELETE, GET /api/assets/[id] devolve 404
    const afterDeleteGet = await getAssetBinary(
      new Request(`http://localhost:3000/api/assets/${uploadedAsset.id}`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: uploadedAsset.id }) }
    );
    expect(afterDeleteGet.status).toBe(404);
  });

  test("generate-design-md funciona sem repo em disco e brownfield-scan resolve repo exclusivamente do DB", async () => {
    // Projeto ainda sem repositório: generate-design-md funciona, brownfield-scan retorna 422
    const designMdRes = await generateDesignMd(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets/generate-design-md`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            themePreference: "dual_theme",
            notes: "Foco em densidade técnica",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(designMdRes.status).toBe(201);
    const designMdBody = GenerateDesignMdResponseSchema.parse(
      await designMdRes.json()
    );
    expect(designMdBody.designMdPath).toBe(".uzina/DESIGN.md");
    expect(designMdBody.markdown).toContain("oklch(0.13 0.006 260)");

    const bfWithoutRepo = await runBrownfieldScan(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(bfWithoutRepo.status).toBe(422);

    // Vincula repositório real em temp dir
    const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-web-bf-"));
    tempDirs.push(tempRepo);
    fs.writeFileSync(
      path.join(tempRepo, "package.json"),
      JSON.stringify({
        name: "web-bf-target",
        dependencies: { next: "16.4.6" },
        scripts: { test: "vitest", lint: "eslint ." },
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(tempRepo, ".gitignore"), "node_modules\n", "utf8");

    const addRepoRes = await createRepository(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/repositories`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            name: "repo-studio",
            localPath: tempRepo,
            defaultBranch: "main",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(addRepoRes.status).toBe(201);

    // Rejeita campo extra arbitrário no request (strict)
    const strictReject = await runBrownfieldScan(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ localPath: "/etc/passwd" }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(strictReject.status).toBe(400);

    const bfOk = await runBrownfieldScan(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(bfOk.status).toBe(200);
    const bfMap = BrownfieldMapSchema.parse(await bfOk.json());
    expect(bfMap.repoPath).toBe(tempRepo);
    expect(bfMap.maturityScore).toBeGreaterThanOrEqual(0);
    expect(bfMap.maturityScore).toBeLessThanOrEqual(100);

    const listAssets = await getDesignAssets(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(listAssets.status).toBe(200);
    expect(
      DesignAssetListResponseSchema.parse(await listAssets.json()).items.some(
        (item) => item.assetType === "design_md"
      )
    ).toBe(true);
  });

  test("workflow/start -> 409 duplicado -> workflow/resume avança Discovery -> Blueprint -> Estúdio Visual", async () => {
    const startRes = await startWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(startRes.status).toBe(200);
    const started = DeliverableWorkflowStateSchema.parse(await startRes.json());
    expect(started.workflowStatus).toBe("suspended");
    expect(started.gate).toBe("discovery_confirm");

    // Duplicado deve retornar 409
    const dupRes = await startWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(dupRes.status).toBe(409);

    // Resume Discovery -> Blueprint
    const toBlueprintRes = await resumeWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            decision: "approved",
            answers: [
              {
                questionId: "q-objective-user",
                pillar: "objective_and_user",
                answer: "Operador interno",
              },
            ],
          }),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(toBlueprintRes.status).toBe(200);
    const bpState = DeliverableWorkflowStateSchema.parse(
      await toBlueprintRes.json()
    );
    expect(bpState.gate).toBe("blueprint_approve");
    expect(bpState.deliverableStatus).toBe("spec_review");

    // Resume Blueprint -> Estúdio Visual (sem ainda disparar OpenCode local)
    const toVisualRes = await resumeWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow/resume`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ decision: "approved" }),
        }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(toVisualRes.status).toBe(200);
    const visualState = DeliverableWorkflowStateSchema.parse(
      await toVisualRes.json()
    );
    expect(visualState.gate).toBe("visual_approve");
    expect(visualState.deliverableStatus).toBe("visual_studio");

    const getWfRes = await getWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(getWfRes.status).toBe(200);
    expect(
      DeliverableWorkflowStateSchema.parse(await getWfRes.json()).gate
    ).toBe("visual_approve");
  });

  test("valida magic bytes JPEG/WEBP, rejeita buffers corrompidos/vazios/>5MiB sem Content-Length e impõe RBAC/anti-IDOR completo nas 8 rotas", async () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const validWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]);
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const badJpegMarker = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

    // 1. Casos válidos JPEG e WEBP + headers completos e ausência de storagePath
    for (const [label, buf, expectedMime] of [
      ["JPEG válido", validJpeg, "image/jpeg"],
      ["WEBP válido", validWebp, "image/webp"],
    ] as const) {
      const form = new FormData();
      form.append("title", label);
      form.append("file", new File([buf], "img.bin", { type: expectedMime }));
      const up = await createDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets`,
          { method: "POST", headers: { cookie: ownerCookie }, body: form }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(up.status).toBe(201);
      const rawJson = (await up.json()) as Record<string, unknown>;
      expect("storagePath" in rawJson).toBe(false);
      const parsed = DesignAssetSchema.parse(rawJson);
      expect(parsed.mimeType).toBe(expectedMime);

      // Auditor na mesma org consegue ler GET /api/assets/[id] e GET design-assets (200)
      const binRes = await getAssetBinary(
        new Request(`http://localhost:3000/api/assets/${parsed.id}`, {
          headers: { cookie: sameOrgAuditorCookie },
        }),
        { params: Promise.resolve({ id: parsed.id }) }
      );
      expect(binRes.status).toBe(200);
      expect(binRes.headers.get("content-disposition")).toContain("inline; filename=");
      expect(binRes.headers.get("cache-control")).toContain("private");

      await deleteDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets/${parsed.id}`,
          { method: "DELETE", headers: { cookie: ownerCookie } }
        ),
        { params: Promise.resolve({ id: projectId, assetId: parsed.id }) }
      );
    }

    // 2. Rejeita PNG truncado, JPEG marcador inválido, 0 bytes e multipart sem 'file'
    for (const badBuf of [truncatedPng, badJpegMarker, Buffer.alloc(0)]) {
      const badForm = new FormData();
      badForm.append("title", "Arquivo Inválido");
      badForm.append("file", new File([badBuf], "bad.png", { type: "image/png" }));
      const res = await createDesignAsset(
        new Request(
          `http://localhost:3000/api/projects/${projectId}/design-assets`,
          { method: "POST", headers: { cookie: ownerCookie }, body: badForm }
        ),
        { params: Promise.resolve({ id: projectId }) }
      );
      expect(res.status).toBe(400);
    }

    const noFileForm = new FormData();
    noFileForm.append("title", "Sem Arquivo");
    const noFileRes = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        { method: "POST", headers: { cookie: ownerCookie }, body: noFileForm }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(noFileRes.status).toBe(400);

    // 3. Arquivo > 5 MiB sem Content-Length -> 413 via saveProjectImageUpload
    const over5MiB = Buffer.alloc(5 * 1024 * 1024 + 64, 0xaa);
    const bigForm = new FormData();
    bigForm.append("title", "Oversized");
    bigForm.append("file", new File([over5MiB], "big.png", { type: "image/png" }));
    const bigRes = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        { method: "POST", headers: { cookie: ownerCookie }, body: bigForm }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(bigRes.status).toBe(413);

    // 4. RBAC auditor (200 leitura / 403 escrita), anti-IDOR (404) e UUID inválido (400) nas demais rotas
    const refCreate = await createDesignAsset(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({
            assetType: "reference_url",
            title: "Ref RBAC",
            sourceUrl: "https://linear.app",
          }),
        }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    const refAsset = DesignAssetSchema.parse(await refCreate.json());

    const auditorReadAssets = await getDesignAssets(
      new Request(
        `http://localhost:3000/api/projects/${projectId}/design-assets`,
        { headers: { cookie: sameOrgAuditorCookie } }
      ),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(auditorReadAssets.status).toBe(200);

    const auditorReadWf = await getWorkflow(
      new Request(
        `http://localhost:3000/api/deliverables/${deliverableId}/workflow`,
        { headers: { cookie: sameOrgAuditorCookie } }
      ),
      { params: Promise.resolve({ id: deliverableId }) }
    );
    expect(auditorReadWf.status).toBe(200);

    expect(
      (
        await patchDesignAsset(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets/${refAsset.id}`,
            {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                cookie: sameOrgAuditorCookie,
              },
              body: JSON.stringify({ approved: true }),
            }
          ),
          { params: Promise.resolve({ id: projectId, assetId: refAsset.id }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await deleteDesignAsset(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets/${refAsset.id}`,
            { method: "DELETE", headers: { cookie: sameOrgAuditorCookie } }
          ),
          { params: Promise.resolve({ id: projectId, assetId: refAsset.id }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await generateDesignMd(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets/generate-design-md`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: sameOrgAuditorCookie,
              },
              body: JSON.stringify({}),
            }
          ),
          { params: Promise.resolve({ id: projectId }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await runBrownfieldScan(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: sameOrgAuditorCookie,
              },
              body: JSON.stringify({}),
            }
          ),
          { params: Promise.resolve({ id: projectId }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await startWorkflow(
          new Request(
            `http://localhost:3000/api/deliverables/${deliverableId}/workflow/start`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: sameOrgAuditorCookie,
              },
              body: JSON.stringify({}),
            }
          ),
          { params: Promise.resolve({ id: deliverableId }) }
        )
      ).status
    ).toBe(403);

    expect(
      (
        await resumeWorkflow(
          new Request(
            `http://localhost:3000/api/deliverables/${deliverableId}/workflow/resume`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                cookie: sameOrgAuditorCookie,
              },
              body: JSON.stringify({ decision: "approved" }),
            }
          ),
          { params: Promise.resolve({ id: deliverableId }) }
        )
      ).status
    ).toBe(403);

    // Cross-tenant 404 em todas as rotas
    expect(
      (
        await getDesignAssets(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets`,
            { headers: { cookie: otherOrgCookie } }
          ),
          { params: Promise.resolve({ id: projectId }) }
        )
      ).status
    ).toBe(404);

    expect(
      (
        await patchDesignAsset(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets/${refAsset.id}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json", cookie: otherOrgCookie },
              body: JSON.stringify({ approved: true }),
            }
          ),
          { params: Promise.resolve({ id: projectId, assetId: refAsset.id }) }
        )
      ).status
    ).toBe(404);

    expect(
      (
        await runBrownfieldScan(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/brownfield-scan`,
            {
              method: "POST",
              headers: { "content-type": "application/json", cookie: otherOrgCookie },
              body: JSON.stringify({}),
            }
          ),
          { params: Promise.resolve({ id: projectId }) }
        )
      ).status
    ).toBe(404);

    expect(
      (
        await getWorkflow(
          new Request(
            `http://localhost:3000/api/deliverables/${deliverableId}/workflow`,
            { headers: { cookie: otherOrgCookie } }
          ),
          { params: Promise.resolve({ id: deliverableId }) }
        )
      ).status
    ).toBe(404);

    // deliverableId de outro projeto -> 404
    const foreignDeliverableId = "00000000-0000-4000-8000-000000000999";
    expect(
      (
        await createDesignAsset(
          new Request(
            `http://localhost:3000/api/projects/${projectId}/design-assets`,
            {
              method: "POST",
              headers: { "content-type": "application/json", cookie: ownerCookie },
              body: JSON.stringify({
                assetType: "reference_url",
                title: "Foreign Deliv",
                sourceUrl: "https://linear.app",
                deliverableId: foreignDeliverableId,
              }),
            }
          ),
          { params: Promise.resolve({ id: projectId }) }
        )
      ).status
    ).toBe(404);

    // UUID inválido -> 400
    expect(
      (
        await getWorkflow(
          new Request("http://localhost:3000/api/deliverables/not-a-uuid/workflow", {
            headers: { cookie: ownerCookie },
          }),
          { params: Promise.resolve({ id: "not-a-uuid" }) }
        )
      ).status
    ).toBe(400);

    expect(
      (
        await getAssetBinary(
          new Request("http://localhost:3000/api/assets/not-a-uuid", {
            headers: { cookie: ownerCookie },
          }),
          { params: Promise.resolve({ id: "not-a-uuid" }) }
        )
      ).status
    ).toBe(400);
  });
});
