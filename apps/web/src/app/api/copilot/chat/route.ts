import { CopilotChatRequestSchema } from "@uzina/contracts";
import { getDb } from "@uzina/db";
import { streamExecutiveCopilot } from "@uzina/mastra-runtime";
import { parseJsonBody } from "@/lib/api-utils";
import { READ_ROLES, requireOrgRole } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guard = await requireOrgRole(request, READ_ROLES);
  if (!guard.ok) return guard.response;

  const body = await parseJsonBody(request, CopilotChatRequestSchema);
  if (!body.ok) return body.response;

  const { db } = await getDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const closeSafe = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream já fechado
        }
      };

      const onAbort = () => closeSafe();
      request.signal.addEventListener("abort", onAbort, { once: true });

      try {
        for await (const event of streamExecutiveCopilot({
          db,
          actor: {
            organizationId: guard.actor.organizationId,
            userId: guard.actor.userId,
            role: guard.actor.role,
          },
          request: body.data,
          signal: request.signal,
        })) {
          if (closed) break;
          const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        if (!closed) {
          const errFrame = {
            type: "error",
            code: "COPILOT_STREAM_ERROR",
            message: "Erro ao transmitir resposta do Co-piloto.",
          };
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify(errFrame)}\n\n`
            )
          );
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        closeSafe();
      }
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
