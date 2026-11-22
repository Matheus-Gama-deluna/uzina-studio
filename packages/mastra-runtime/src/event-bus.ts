import { EventEmitter } from "node:events";
import {
  ExecutionEventSchema,
  type ExecutionEvent,
  type ExecutionEventType,
} from "@uzina/contracts";
import { estimateTokenCostUsd, redactSensitiveValue } from "@uzina/core";
import { executionEvents, type UzinaDb } from "@uzina/db";

const BUS_KEY = Symbol.for("@uzina/mastra-runtime/executionEventBus");

export class ExecutionEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: ExecutionEvent): void {
    this.emitter.emit(`deliverable:${event.deliverableId}`, event);
  }

  subscribe(
    deliverableId: string,
    listener: (event: ExecutionEvent) => void
  ): () => void {
    const channel = `deliverable:${deliverableId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}

export function getExecutionEventBus(): ExecutionEventBus {
  const holder = globalThis as Record<symbol, ExecutionEventBus | undefined>;
  if (!holder[BUS_KEY]) {
    holder[BUS_KEY] = new ExecutionEventBus();
  }
  return holder[BUS_KEY];
}

export async function recordExecutionEvent(
  db: UzinaDb,
  params: {
    deliverableId: string;
    stage: string;
    actorRole: string;
    eventType: ExecutionEventType;
    tokensInput?: number;
    tokensOutput?: number;
    cacheReadTokens?: number;
    modelId?: string | null;
    estimatedCostUsd?: number;
    payload?: Record<string, unknown>;
  }
): Promise<ExecutionEvent> {
  const tokensInput = Math.max(0, Math.trunc(params.tokensInput ?? 0));
  const tokensOutput = Math.max(0, Math.trunc(params.tokensOutput ?? 0));
  const cacheReadTokens = Math.max(0, Math.trunc(params.cacheReadTokens ?? 0));
  const computedCost =
    params.estimatedCostUsd ??
    estimateTokenCostUsd(params.modelId, {
      inputTokens: tokensInput,
      outputTokens: tokensOutput,
      cacheReadTokens,
    });

  const cleanPayload = redactSensitiveValue(params.payload ?? {});

  const [row] = await db
    .insert(executionEvents)
    .values({
      deliverableId: params.deliverableId,
      stage: params.stage,
      actorRole: params.actorRole,
      eventType: params.eventType,
      tokensInput,
      tokensOutput,
      cacheReadTokens,
      estimatedCostUsd: computedCost.toFixed(6),
      payloadJson: cleanPayload,
    })
    .returning();

  const event = ExecutionEventSchema.parse({
    id: row!.id,
    deliverableId: row!.deliverableId,
    stage: row!.stage,
    actorRole: row!.actorRole,
    eventType: row!.eventType,
    tokensInput: row!.tokensInput,
    tokensOutput: row!.tokensOutput,
    cacheReadTokens: row!.cacheReadTokens,
    estimatedCostUsd: Number(row!.estimatedCostUsd),
    payloadJson: row!.payloadJson,
    createdAt: row!.createdAt.toISOString(),
  });

  getExecutionEventBus().publish(event);
  return event;
}
