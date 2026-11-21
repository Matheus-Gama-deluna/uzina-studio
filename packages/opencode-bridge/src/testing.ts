import type { TokenUsage } from "@uzina/contracts";
import type {
  OpenCodeTransport,
  TransportCreateSessionInput,
  TransportRunInput,
  TransportRunOutput,
  TransportSessionHandle,
  TransportTurnEvent,
} from "./transport.js";

export interface InMemoryTurnScript {
  observation: TransportTurnEvent["observation"];
  modelId?: string;
  touchedFiles?: string[];
  commandsExecuted?: string[];
}

export interface InMemoryOpenCodeTransportOptions {
  turns?: InMemoryTurnScript[];
  finalText?: string;
  structuredOutput?: unknown;
  tokenUsage?: TokenUsage;
  delayPerTurnMs?: number;
  throwError?: Error;
  onRunSideEffect?: () => void;
}

export interface RecordedSessionHandle {
  sessionId: string;
  aborted: boolean;
  closed: boolean;
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(!signal?.aborted);
  }
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class InMemoryOpenCodeTransport implements OpenCodeTransport {
  private readonly script: InMemoryOpenCodeTransportOptions;
  public lastSessionInput: TransportCreateSessionInput | null = null;
  public lastRunInput: TransportRunInput | null = null;
  public lastHandle: RecordedSessionHandle | null = null;
  private counter = 0;

  constructor(options: InMemoryOpenCodeTransportOptions = {}) {
    this.script = options;
  }

  async createSession(
    input: TransportCreateSessionInput
  ): Promise<TransportSessionHandle> {
    this.lastSessionInput = input;
    this.counter += 1;
    const sessionId = `inmem-sess-${this.counter}`;
    const state: RecordedSessionHandle = {
      sessionId,
      aborted: false,
      closed: false,
    };
    this.lastHandle = state;
    const script = this.script;
    const setLastRunInput = (runInput: TransportRunInput) => {
      this.lastRunInput = runInput;
    };

    return {
      sessionId,
      async run(runInput: TransportRunInput): Promise<TransportRunOutput> {
        setLastRunInput(runInput);
        if (script.throwError) {
          throw script.throwError;
        }
        if (script.onRunSideEffect) {
          script.onRunSideEffect();
        }

        const turns = script.turns ?? [];
        let executed = 0;
        const limit = Math.min(turns.length, runInput.maxSteps);

        for (let i = 0; i < limit; i++) {
          if (state.aborted || runInput.signal?.aborted) {
            return {
              finalText: "",
              tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
              },
              turnsExecuted: executed,
              aborted: true,
            };
          }

          if (script.delayPerTurnMs) {
            const ok = await waitWithSignal(
              script.delayPerTurnMs,
              runInput.signal
            );
            if (!ok || state.aborted) {
              return {
                finalText: "",
                tokenUsage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                },
                turnsExecuted: executed,
                aborted: true,
              };
            }
          }

          const step = turns[i]!;
          executed += 1;
          await runInput.onTurn({
            observation: step.observation,
            modelId: step.modelId ?? input.lockedTarget.canonicalId,
            touchedFiles: step.touchedFiles,
            commandsExecuted: step.commandsExecuted,
          });
        }

        return {
          finalText: script.finalText ?? "Execução concluída.",
          structuredOutput: script.structuredOutput,
          tokenUsage: script.tokenUsage ?? {
            inputTokens: 50,
            outputTokens: 25,
            cacheReadTokens: 10,
          },
          turnsExecuted: executed,
          aborted: state.aborted || Boolean(runInput.signal?.aborted),
        };
      },
      async abort(): Promise<void> {
        state.aborted = true;
      },
      async close(): Promise<void> {
        state.closed = true;
      },
    };
  }
}
