import { getDb } from "@uzina/db";
import { getExecutionEventBus } from "@uzina/mastra-runtime";
import { isUuid, jsonError } from "@/lib/api-utils";
import {
  isScopedDeliverable,
  listDeliverableEventsScoped,
} from "@/lib/operations-queries";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const { id: deliverableId } = await context.params;
  if (!isUuid(deliverableId)) {
    return jsonError(400, {
      error: "ID de entregável inválido.",
      code: "INVALID_UUID",
    });
  }

  const { db } = await getDb();
  const allowed = await isScopedDeliverable(
    db,
    deliverableId,
    guard.actor.organizationId
  );
  if (!allowed) {
    return jsonError(404, {
      error: "Entregável não encontrado na organização.",
      code: "NOT_FOUND",
    });
  }

  const url = new URL(request.url);
  const afterEventId =
    request.headers.get("last-event-id") ?? url.searchParams.get("afterEventId");
  const snapshotOnly = url.searchParams.get("snapshot") === "true";

  const initialEvents = await listDeliverableEventsScoped(db, deliverableId, {
    afterEventId,
    limit: 100,
  });

  const encoder = new TextEncoder();
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Stream já encerrado
        }
      };
      cleanupFn = cleanup;

      const sendFrame = (eventName: string, id: string, payload: unknown) => {
        if (closed) return;
        const chunk = `id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      for (const ev of initialEvents) {
        sendFrame(ev.eventType, ev.id, ev);
      }

      if (snapshotOnly) {
        sendFrame("snapshot_end", "end", {
          deliverableId,
          count: initialEvents.length,
        });
        cleanup();
        return;
      }

      const bus = getExecutionEventBus();
      unsubscribe = bus.subscribe(deliverableId, (event) => {
        sendFrame(event.eventType, event.id, event);
      });

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
