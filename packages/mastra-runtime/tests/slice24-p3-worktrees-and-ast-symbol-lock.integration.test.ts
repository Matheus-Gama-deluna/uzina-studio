import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptSecret } from "@uzina/core";
import {
  closeDb,
  codebaseEdges,
  codebaseFiles,
  codebaseSymbols,
  deliverables,
  ensureDefaultOrgAndInternalClient,
  getDb,
  projectRepositories,
  projects,
  providerProfiles,
  type UzinaDb,
} from "@uzina/db";
import { LocalGitWorktreeWorkspace } from "@uzina/opencode-bridge";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  SymbolLockManager,
  createMastraRuntime,
  resetAgentControllerForTests,
  resetControllerProjectCostsForTests,
  resetMastraStorageForTests,
  resolveDeliverableTargetSymbols,
} from "../src/index.js";

describe("Slice 24 — Worktrees Governance & AST Symbol-Locking", () => {
  let db: UzinaDb;
  let organizationId: string;
  let internalClientId: string;
  const masterKey = crypto.randomBytes(32);
  const tempDirs: string[] = [];

  beforeAll(async () => {
    await resetAgentControllerForTests();
    resetControllerProjectCostsForTests();
    await resetMastraStorageForTests();
    await closeDb();
    const conn = await getDb({ dataDir: ":memory:" });
    db = conn.db;
    const seed = await ensureDefaultOrgAndInternalClient(db);
    organizationId = seed.organizationId;
    internalClientId = seed.internalClientId;

    await db.insert(providerProfiles).values({
      organizationId,
      name: "OmniRouter S24",
      providerType: "omniroute",
      baseUrl: "https://omnirouter.example.com/v1",
      encryptedApiKey: encryptSecret({
        plaintext: "sk-s24-dummy-key-123456",
        masterKey,
        organizationId,
        providerType: "omniroute",
      }),
      keyPreview: "sk-s...3456",
      roleBindingsJson: {
        builder: { modelId: "omni-fast" },
      },
      customPricingJson: {},
      isDefault: true,
    });
  });

  afterAll(async () => {
    await resetAgentControllerForTests();
    resetControllerProjectCostsForTests();
    await resetMastraStorageForTests();
    await closeDb();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function initGitRepo(): string {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "uzina-s24-rt-"));
    tempDirs.push(repoDir);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Uzina S24"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "s24@uzina.studio"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(repoDir, "README.md"), "# S24 Runtime\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: initial"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    return repoDir;
  }

  test("resolveDeliverableTargetSymbols consulta grafo AST e SymbolLockManager enfileira sobrepostos e libera disjuntos/abortados", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj AST Lock ${suffix}`,
        slug: `proj-ast-lock-${suffix}`,
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: proj!.id,
        name: "ast-repo",
        localPath: os.tmpdir(),
        defaultBranch: "main",
      })
      .returning();

    const [fileA] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/billing.ts",
        sha256: "a".repeat(64),
        language: "typescript",
        size: 320,
      })
      .returning();

    const [fileB] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/auth.ts",
        sha256: "b".repeat(64),
        language: "typescript",
        size: 280,
      })
      .returning();

    const [symCalcTotal] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileA!.id,
        kind: "function",
        name: "calcTotal",
        signature: "function calcTotal(items: Item[]): number",
        lineStart: 1,
        lineEnd: 12,
        exported: true,
      })
      .returning();

    const [symTaxHelper] = await db
      .insert(codebaseSymbols)
      .values({
        fileId: fileA!.id,
        kind: "function",
        name: "applyTaxRate",
        signature: "function applyTaxRate(amount: number): number",
        lineStart: 14,
        lineEnd: 22,
        exported: false,
      })
      .returning();

    await db.insert(codebaseSymbols).values({
      fileId: fileB!.id,
      kind: "function",
      name: "verifySession",
      signature: "function verifySession(token: string): boolean",
      lineStart: 1,
      lineEnd: 10,
      exported: true,
    });

    await db.insert(codebaseEdges).values({
      fromSymbolId: symCalcTotal!.id,
      toSymbolId: symTaxHelper!.id,
      relation: "calls",
    });

    const symbolsA = await resolveDeliverableTargetSymbols(db, {
      projectId: proj!.id,
      title: "Refatorar `calcTotal`",
      description: "Ajustar arredondamento em calcTotal.",
    });
    expect(symbolsA).toContain("src/billing.ts::calcTotal");
    expect(symbolsA).toContain("src/billing.ts::applyTaxRate");

    const symbolsB = await resolveDeliverableTargetSymbols(db, {
      projectId: proj!.id,
      title: "Otimizar `applyTaxRate`",
    });
    expect(symbolsB).toContain("src/billing.ts::applyTaxRate");

    const symbolsC = await resolveDeliverableTargetSymbols(db, {
      projectId: proj!.id,
      title: "Validar `verifySession`",
    });
    expect(symbolsC).toContain("src/auth.ts::verifySession");

    // Projeto sem AST indexado usa fallback `symbol::<name>` e entrada vazia retorna []
    const fallbackProjectId = crypto.randomUUID();
    const fallbackSymbols = await resolveDeliverableTargetSymbols(db, {
      projectId: fallbackProjectId,
      title: "Implementar `computePayroll`",
    });
    expect(fallbackSymbols).toContain("symbol::computepayroll");
    expect(
      await resolveDeliverableTargetSymbols(db, {
        projectId: fallbackProjectId,
        title: "   ",
      })
    ).toEqual([]);

    const lockMgr = new SymbolLockManager();
    const delivA = crypto.randomUUID();
    const delivB = crypto.randomUUID();
    const delivC = crypto.randomUUID();

    // A adquire primeiro
    const resA = lockMgr.tryAcquire({
      projectId: proj!.id,
      deliverableId: delivA,
      symbols: symbolsA,
    });
    expect(resA).toMatchObject({ acquired: true });

    // C (disjunto) adquire imediatamente sem conflito
    const resC = lockMgr.tryAcquire({
      projectId: proj!.id,
      deliverableId: delivC,
      symbols: symbolsC,
    });
    expect(resC).toMatchObject({ acquired: true });

    // B (sobreposto em applyTaxRate / calcTotal) entra em espera e só adquire após release(A)
    const events: string[] = [];
    const waitB = lockMgr.acquireOrWait({
      projectId: proj!.id,
      deliverableId: delivB,
      symbols: symbolsB,
      onWaiting: (conflicts, holders) => {
        events.push(`waiting:${conflicts.join(",")}:${holders.join(",")}`);
      },
    });

    // AbortSignal durante espera cancela sem vazar lock
    const delivAborted = crypto.randomUUID();
    const abortCtrl = new AbortController();
    const abortedWait = lockMgr.acquireOrWait({
      projectId: proj!.id,
      deliverableId: delivAborted,
      symbols: symbolsB,
      signal: abortCtrl.signal,
    });
    abortCtrl.abort("USER_CANCEL");
    expect(await abortedWait).toMatchObject({ acquired: false, aborted: true });

    // Libera A e verifica que B acordou e adquiriu
    lockMgr.release({ projectId: proj!.id, deliverableId: delivA });
    const acquiredB = await waitB;
    expect(acquiredB).toMatchObject({ acquired: true, aborted: false });
    expect(events[0]).toContain("waiting:");
    expect(events[0]).toContain(delivA);

    lockMgr.release({ projectId: proj!.id, deliverableId: delivB });
    lockMgr.release({ projectId: proj!.id, deliverableId: delivC });
    expect(lockMgr.listActiveLocks(proj!.id)).toEqual([]);
  });

  test("listProjectWorktrees e cleanupProjectWorktrees removem órfãos e bloqueiam remoção de execução ativa (409)", async () => {
    const repoDir = initGitRepo();
    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj WT ${suffix}`,
        slug: `proj-wt-${suffix}`,
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: proj!.id,
        name: "wt-repo",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [mergedDeliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega Merged Órfã",
        status: "merged",
      })
      .returning();

    const [activeDeliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Entrega Ativa Bloqueada",
        status: "building",
      })
      .returning();

    const ws1 = new LocalGitWorktreeWorkspace();
    const handleOrphan = await ws1.prepare(repoDir, "main", mergedDeliv!.id);
    const ws2 = new LocalGitWorktreeWorkspace();
    const handleActive = await ws2.prepare(repoDir, "main", activeDeliv!.id);

    await db
      .update(deliverables)
      .set({
        worktreePath: handleOrphan.workspacePath,
        branchName: handleOrphan.branchName,
      })
      .where(eq(deliverables.id, mergedDeliv!.id));

    await db
      .update(deliverables)
      .set({
        worktreePath: handleActive.workspacePath,
        branchName: handleActive.branchName,
      })
      .where(eq(deliverables.id, activeDeliv!.id));

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
    });

    // Marca task ativa para activeDeliv para simular execução em andamento
    const holdTask = runtime.backgroundTasks.enqueue({
      organizationId,
      projectId: proj!.id,
      deliverableId: activeDeliv!.id,
      kind: "workflow_cycle",
      summary: "Build ativo",
      work: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    });
    expect(holdTask.status).toBe("running");

    try {
      const listed = await runtime.listProjectWorktrees({
        projectId: proj!.id,
        organizationId,
      });
      expect(listed.items.length).toBeGreaterThanOrEqual(3);
      expect(listed.orphanCount).toBe(1);

      // Tentativa de remover worktree ativo específico deve falhar com 409 WORKFLOW_ALREADY_RUNNING
      await expect(
        runtime.cleanupProjectWorktrees({
          projectId: proj!.id,
          organizationId,
          input: {
            worktreePath: handleActive.workspacePath,
            pruneAllOrphans: false,
          },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "WORKFLOW_ALREADY_RUNNING",
      });

      // Tentativa de remover worktree principal também falha com 409
      await expect(
        runtime.cleanupProjectWorktrees({
          projectId: proj!.id,
          organizationId,
          input: { worktreePath: repoDir, pruneAllOrphans: false },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "WORKFLOW_ALREADY_RUNNING",
      });

      // GC em lote remove o órfão, zera deliverables.worktreePath e pula o ativo
      const gcRes = await runtime.cleanupProjectWorktrees({
        projectId: proj!.id,
        organizationId,
        input: { pruneAllOrphans: true },
      });
      expect(gcRes.removedPaths).toHaveLength(1);
      expect(gcRes.skippedActivePaths).toHaveLength(1);
      expect(fs.existsSync(handleOrphan.workspacePath)).toBe(false);
      expect(fs.existsSync(handleActive.workspacePath)).toBe(true);

      const [orphanRowAfter] = await db
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, mergedDeliv!.id));
      expect(orphanRowAfter?.worktreePath).toBeNull();

      const listedAfter = await runtime.listProjectWorktrees({
        projectId: proj!.id,
        organizationId,
      });
      expect(listedAfter.orphanCount).toBe(0);
    } finally {
      runtime.backgroundTasks.abortForDeliverable(
        organizationId,
        activeDeliv!.id,
        "CLEANUP"
      );
      await runtime.close();
    }
  });

  test("runProjectAutonomousCycle entra em queued_waiting_lock quando símbolo AST colide e sai ao cancelar", async () => {
    const repoDir = initGitRepo();
    const suffix = crypto.randomUUID().slice(0, 8);
    const [proj] = await db
      .insert(projects)
      .values({
        clientId: internalClientId,
        name: `Proj Queue Lock ${suffix}`,
        slug: `proj-q-lock-${suffix}`,
      })
      .returning();

    const [repo] = await db
      .insert(projectRepositories)
      .values({
        projectId: proj!.id,
        name: "q-lock-repo",
        localPath: repoDir,
        defaultBranch: "main",
      })
      .returning();

    const [fileRow] = await db
      .insert(codebaseFiles)
      .values({
        repositoryId: repo!.id,
        path: "src/pricing.ts",
        sha256: "c".repeat(64),
        language: "typescript",
        size: 180,
      })
      .returning();

    await db.insert(codebaseSymbols).values({
      fileId: fileRow!.id,
      kind: "function",
      name: "calculateDiscount",
      signature: "function calculateDiscount(price: number): number",
      lineStart: 1,
      lineEnd: 10,
      exported: true,
    });

    const [waitingDeliv] = await db
      .insert(deliverables)
      .values({
        projectId: proj!.id,
        repositoryId: repo!.id,
        title: "Ajustar `calculateDiscount`",
        status: "discovery",
      })
      .returning();

    const runtime = await createMastraRuntime({
      db,
      dataDir: ":memory:",
      masterKey,
    });

    const holderId = crypto.randomUUID();
    const acquireRes = runtime.symbolLockManager.tryAcquire({
      projectId: proj!.id,
      deliverableId: holderId,
      symbols: ["src/pricing.ts::calculateDiscount"],
    });
    expect(acquireRes.acquired).toBe(true);

    try {
      const cycleRes = await runtime.runProjectAutonomousCycle({
        projectId: proj!.id,
        organizationId,
      });
      expect(cycleRes.dispatched).toBe(true);
      expect(cycleRes.deliverableId).toBe(waitingDeliv!.id);

      let queuedTask = undefined;
      for (let i = 0; i < 200; i += 1) {
        const tasks = await runtime.listProjectBackgroundTasks({
          organizationId,
          projectId: proj!.id,
        });
        queuedTask = tasks.find((t) => t.deliverableId === waitingDeliv!.id);
        if (queuedTask?.status === "queued_waiting_lock") break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      expect(queuedTask?.status).toBe("queued_waiting_lock");
      expect(queuedTask?.summary).toContain("src/pricing.ts::calculateDiscount");

      const abortRes = await runtime.abortDeliverableRun({
        deliverableId: waitingDeliv!.id,
        organizationId,
        reason: "CANCEL_QUEUE_TEST",
      });
      expect(abortRes.aborted).toBe(true);
      expect(abortRes.status).toBe("paused");
    } finally {
      runtime.symbolLockManager.release({
        projectId: proj!.id,
        deliverableId: holderId,
      });
      await runtime.close();
    }
  });
});
