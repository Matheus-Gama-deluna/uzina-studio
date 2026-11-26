import { CopilotChatRequestSchema } from "@uzina/contracts";
import { redactSensitiveText } from "@uzina/core";
import { getDb } from "@uzina/db";
import { buildSpokenSummary, streamExecutiveCopilot } from "@uzina/mastra-runtime";
import { parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";
import { tryGetServerMasterKey } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CopilotChatRequestSchema);
  if (!body.ok) return body.response;

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
        let accumulatedReply = "";
        for await (const event of streamExecutiveCopilot({
          db,
          actor: {
            organizationId: guard.actor.organizationId,
            userId: guard.actor.userId,
            role: guard.actor.role,
          },
          masterKey: tryGetServerMasterKey(),
          request: body.data,
          signal: abortController.signal,
        })) {
          if (closed || abortController.signal.aborted) break;
          if (event.type === "token") {
            accumulatedReply += event.text;
          }
          const enrichedEvent =
            event.type === "done"
              ? {
                  ...event,
                  spokenSummary:
                    event.spokenSummary ?? buildSpokenSummary(accumulatedReply),
                }
              : event;
          const chunk = `event: ${enrichedEvent.type}\ndata: ${JSON.stringify(enrichedEvent)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        if (!closed && !abortController.signal.aborted) {
          const errFrame = {
            type: "error",
            code: "COPILOT_STREAM_ERROR",
            message: redactSensitiveText(
              err instanceof Error
                ? err.message
                : "Erro ao transmitir resposta do Co-piloto."
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
