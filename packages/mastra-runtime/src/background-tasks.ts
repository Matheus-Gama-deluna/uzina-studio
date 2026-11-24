import crypto from "node:crypto";
import {
  BackgroundTaskSummarySchema,
  type BackgroundTaskKind,
  type BackgroundTaskStatus,
  type BackgroundTaskSummary,
} from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { clients, deliverables, projects, type UzinaDb } from "@uzina/db";
import { and, desc, eq, inArray } from "drizzle-orm";

interface ManagedBackgroundTask {
  summary: BackgroundTaskSummary;
  abortController: AbortController;
  promise: Promise<void>;
}

const ACTIVE_DELIVERABLE_STATUSES = [
  "discovery",
  "spec_review",
  "visual_studio",
  "contract_tests",
  "building",
  "verifying",
  "decision_pending",
  "paused",
] as const;

/**
 * Registro gerenciado de tarefas em background por instância de runtime:
 * acompanha execuções de workflow/ciclo com AbortController e garante
 * drenagem segura no teardown/close() antes de fechar PGlite/LibSQL.
 */
export class BackgroundTasksRegistry {
  private readonly tasks = new Map<string, ManagedBackgroundTask>();

  enqueue(params: {
    id?: string;
    organizationId: string;
    projectId: string;
    deliverableId?: string | null;
    kind: BackgroundTaskKind;
    summary: string;
    mastraRunId?: string | null;
    work: (ctx: {
      taskId: string;
      signal: AbortSignal;
      updateTask: (patch: {
        status?: BackgroundTaskStatus;
        summary?: string;
        mastraRunId?: string | null;
      }) => void;
    }) => Promise<void>;
  }): BackgroundTaskSummary {
    const taskId = params.id ?? `bg-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const abortController = new AbortController();

    const initial = BackgroundTaskSummarySchema.parse({
      id: taskId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      deliverableId: params.deliverableId ?? null,
      kind: params.kind,
      status: "running",
      summary: redactSensitiveText(params.summary).slice(0, 1000),
      mastraRunId: params.mastraRunId ?? null,
      startedAt: now,
      updatedAt: now,
    });

    const updateTask = (patch: {
      status?: BackgroundTaskStatus;
      summary?: string;
      mastraRunId?: string | null;
    }) => {
      const current = this.tasks.get(taskId);
      if (!current) return;
      current.summary = BackgroundTaskSummarySchema.parse({
        ...current.summary,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined
          ? { summary: redactSensitiveText(patch.summary).slice(0, 1000) }
          : {}),
        ...(patch.mastraRunId !== undefined
          ? { mastraRunId: patch.mastraRunId }
          : {}),
        updatedAt: new Date().toISOString(),
      });
    };

    const runPromise = (async () => {
      try {
        await params.work({
          taskId,
          signal: abortController.signal,
          updateTask,
        });
        const entry = this.tasks.get(taskId);
        if (entry && entry.summary.status === "running") {
          updateTask({
            status: abortController.signal.aborted ? "aborted" : "completed",
          });
        }
      } catch (err) {
        const entry = this.tasks.get(taskId);
        if (entry && entry.summary.status === "running") {
          updateTask({
            status: abortController.signal.aborted ? "aborted" : "failed",
            summary:
              err instanceof Error
                ? err.message
                : "Falha durante execução em background.",
          });
        }
      }
    })();

    this.tasks.set(taskId, {
      summary: initial,
      abortController,
      promise: runPromise,
    });

    return initial;
  }

  getActiveAbortSignalForDeliverable(
    organizationId: string,
    deliverableId: string
  ): AbortSignal | undefined {
    for (const item of this.tasks.values()) {
      if (
        item.summary.organizationId === organizationId &&
        item.summary.deliverableId === deliverableId &&
        item.summary.status === "running"
      ) {
        return item.abortController.signal;
      }
    }
    return undefined;
  }

  abortForDeliverable(
    organizationId: string,
    deliverableId: string,
    reason = "ABORTED_BY_USER"
  ): boolean {
    let abortedAny = false;
    for (const item of this.tasks.values()) {
      if (
        item.summary.organizationId === organizationId &&
        item.summary.deliverableId === deliverableId &&
        (item.summary.status === "running" || item.summary.status === "queued")
      ) {
        item.abortController.abort(reason);
        item.summary = {
          ...item.summary,
          status: "aborted",
          summary: redactSensitiveText(`Cancelado: ${reason}`).slice(0, 1000),
          updatedAt: new Date().toISOString(),
        };
        abortedAny = true;
      }
    }
    return abortedAny;
  }

  async listForProject(
    db: UzinaDb,
    params: { organizationId: string; projectId: string }
  ): Promise<BackgroundTaskSummary[]> {
    const inMemory = Array.from(this.tasks.values())
      .map((entry) => entry.summary)
      .filter(
        (s) =>
          s.organizationId === params.organizationId &&
          s.projectId === params.projectId
      );

    const knownDeliverableIds = new Set(
      inMemory.map((t) => t.deliverableId).filter((v): v is string => Boolean(v))
    );

    const activeDeliverables = await db
      .select({ deliv: deliverables })
      .from(deliverables)
      .innerJoin(projects, eq(deliverables.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(deliverables.projectId, params.projectId),
          eq(clients.organizationId, params.organizationId)
        )
      )
      .orderBy(desc(deliverables.updatedAt))
      .limit(15);

    const recovered: BackgroundTaskSummary[] = [];
    for (const { deliv } of activeDeliverables) {
      if (
        !deliv.mastraRunId ||
        knownDeliverableIds.has(deliv.id) ||
        !ACTIVE_DELIVERABLE_STATUSES.includes(
          deliv.status as (typeof ACTIVE_DELIVERABLE_STATUSES)[number]
        )
      ) {
        continue;
      }

      const derivedStatus: BackgroundTaskStatus =
        deliv.status === "paused" || deliv.status === "decision_pending"
          ? "suspended"
          : deliv.lockedBy
            ? "running"
            : "suspended";

      recovered.push(
        BackgroundTaskSummarySchema.parse({
          id: `run-${deliv.mastraRunId}`,
          organizationId: params.organizationId,
          projectId: params.projectId,
          deliverableId: deliv.id,
          kind: "workflow_cycle",
          status: derivedStatus,
          summary: `${redactSensitiveText(deliv.title)} (${deliv.status})`,
          mastraRunId: deliv.mastraRunId,
          startedAt: deliv.createdAt.toISOString(),
          updatedAt: deliv.updatedAt.toISOString(),
        })
      );
    }

    return [...inMemory, ...recovered].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async waitForIdle(timeoutMs = 10_000): Promise<void> {
    const active = Array.from(this.tasks.values());
    if (active.length === 0) return;
    await Promise.race([
      Promise.allSettled(active.map((a) => a.promise)),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  }

  async drainAll(timeoutMs = 2000): Promise<void> {
    const active = Array.from(this.tasks.values());
    for (const item of active) {
      if (
        item.summary.status === "running" ||
        item.summary.status === "queued"
      ) {
        item.abortController.abort("RUNTIME_SHUTDOWN");
      }
    }
    if (active.length > 0) {
      await Promise.race([
        Promise.allSettled(active.map((a) => a.promise)),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          timer.unref();
        }),
      ]);
    }
    this.tasks.clear();
  }
}

export { inArray };
