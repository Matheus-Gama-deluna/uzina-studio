import { AgencyChatRequestSchema } from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { getDb } from "@uzina/db";
import { streamAgencyChatScoped } from "@uzina/mastra-runtime/agency";
import { parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { tryGetServerMasterKey } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireOrgRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = await parseJsonBody(request, AgencyChatRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { db } = await getDb();
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  const onRequestAbort = () => abortController.abort();
  request.signal.addEventListener("abort", onRequestAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // Stream já fechado
        }
      }, 15_000);

      const closeSafe = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Stream já fechado
        }
      };

      const onAbort = () => closeSafe();
      abortController.signal.addEventListener("abort", onAbort, { once: true });

      try {
        for await (const event of streamAgencyChatScoped(db, {
          actor: {
            organizationId: auth.actor.organizationId,
            userId: auth.actor.userId,
            role: auth.actor.role,
          },
          masterKey: tryGetServerMasterKey(),
          request: parsed.data,
          signal: abortController.signal,
        })) {
          if (closed || abortController.signal.aborted) break;
          const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        if (!closed && !abortController.signal.aborted) {
          const errFrame = {
            type: "error",
            code: "AGENCY_STREAM_ERROR",
            message: redactSensitiveText(
              err instanceof Error
                ? err.message
                : "Erro ao transmitir orquestração de agentes."
            ),
          };
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify(errFrame)}\n\n`
            )
          );
        }
      } finally {
        request.signal.removeEventListener("abort", onRequestAbort);
        abortController.signal.removeEventListener("abort", onAbort);
        closeSafe();
      }
    },
    cancel() {
      abortController.abort();
      request.signal.removeEventListener("abort", onRequestAbort);
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
