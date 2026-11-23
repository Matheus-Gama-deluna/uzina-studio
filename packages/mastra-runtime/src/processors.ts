import type { MastraDBMessage, ToolsInput } from "@mastra/core/agent";
import {
  TokenLimiterProcessor,
  ToolSearchProcessor,
  defaultStabilityErrorProcessors,
  type ErrorProcessorOrWorkflow,
  type InputProcessorOrWorkflow,
  type OutputProcessorOrWorkflow,
  type ProcessInputArgs,
  type ProcessOutputResultArgs,
  type ProcessOutputStreamArgs,
  type ProcessToolResultArgs,
} from "@mastra/core/processors";
import { redactSensitiveText, redactSensitiveValue } from "@uzina/core";

const DEFAULT_STREAM_HOLDBACK_CHARS = 256;
const TOOL_SEARCH_THRESHOLD = 8;

const CONTROL_TAG_RE =
  /<\/?(?:system-reminder|system_instruction|assistant|tool_call|system)(?:\s[^>]*)?>/gi;

const SUSPICIOUS_TAIL_RE =
  /(?:sk(?:-[A-Za-z0-9_-]*)?|gh(?:[pousr]_[A-Za-z0-9_]*)?|github_pat_[A-Za-z0-9_]*|xox(?:[baprs]-[A-Za-z0-9-]*)?|AIz(?:a[0-9A-Za-z_-]*)?|AK(?:I(?:A[0-9A-Z]*)?)?|AS(?:I(?:A[0-9A-Z]*)?)?|ey(?:J[A-Za-z0-9_.-]*)?|Bear(?:e(?:r(?:\s+[A-Za-z0-9._~+/-]*)?)?)?|-----(?:BEGIN[\s\S]*)?|(?:password|passwd|secret|api_key|apikey|token|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]*|[a-z][a-z0-9+.-]*:\/\/[^\s]*|s)$/i;

function computeSuspiciousSuffixStart(
  text: string,
  knownSecrets: readonly string[],
  maxHoldback: number
): number {
  let holdFrom = text.length;
  const tailWindowStart = Math.max(0, text.length - maxHoldback);
  const windowText = text.slice(tailWindowStart);

  const match = SUSPICIOUS_TAIL_RE.exec(windowText);
  if (match && match[0].length < maxHoldback) {
    holdFrom = Math.min(holdFrom, tailWindowStart + match.index);
  }

  for (const secret of knownSecrets) {
    if (!secret || secret.length < 4) continue;
    const maxCheck = Math.min(secret.length - 1, text.length, maxHoldback);
    for (let prefixLen = maxCheck; prefixLen >= 1; prefixLen--) {
      const prefix = secret.slice(0, prefixLen);
      if (text.endsWith(prefix)) {
        holdFrom = Math.min(holdFrom, text.length - prefixLen);
        break;
      }
    }
  }

  return holdFrom;
}

export function sanitizeUntrustedToolOutput(
  value: unknown,
  knownSecrets: readonly string[] = []
): unknown {
  const redacted = redactSensitiveValue(value, knownSecrets);
  if (typeof redacted === "string") {
    return redacted.replace(CONTROL_TAG_RE, "[control-tag-escaped]");
  }
  if (Array.isArray(redacted)) {
    return redacted.map((item) =>
      sanitizeUntrustedToolOutput(item, knownSecrets)
    );
  }
  if (redacted && typeof redacted === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(redacted)) {
      out[k] = sanitizeUntrustedToolOutput(v, knownSecrets);
    }
    return out;
  }
  return redacted;
}

export function redactMastraDbMessage(
  msg: MastraDBMessage,
  knownSecrets: readonly string[] = []
): MastraDBMessage {
  const content = msg.content;
  if (!content) return msg;

  const redactedParts = Array.isArray(content.parts)
    ? content.parts.map((part) => {
        if (part.type === "text" && typeof part.text === "string") {
          return {
            ...part,
            text: redactSensitiveText(part.text, knownSecrets),
          };
        }
        if (part.type === "tool-invocation") {
          return {
            ...part,
            toolInvocation: redactSensitiveValue(
              part.toolInvocation,
              knownSecrets
            ),
          };
        }
        return part;
      })
    : content.parts;

  const redactedText =
    typeof content.content === "string"
      ? redactSensitiveText(content.content, knownSecrets)
      : content.content;

  return {
    ...msg,
    content: {
      ...content,
      ...(redactedText !== undefined ? { content: redactedText } : {}),
      ...(redactedParts ? { parts: redactedParts } : {}),
    },
  };
}

export interface SecretRedactionProcessorOptions {
  knownSecrets?: readonly string[] | (() => readonly string[]);
  holdbackChars?: number;
  onTailFlushed?: (flushedTail: string) => void;
}

export interface UzinaSecretRedactionProcessor {
  readonly id: "uzina-secret-redaction";
  readonly name: string;
  processInput: (
    args: ProcessInputArgs
  ) => Promise<ProcessInputArgs["messageList"]>;
  processToolResult: (
    args: ProcessToolResultArgs
  ) => Promise<ProcessToolResultArgs["messageList"]>;
  processOutputStream: (
    args: ProcessOutputStreamArgs
  ) => Promise<ProcessOutputStreamArgs["part"] | null>;
  processOutputResult: (
    args: ProcessOutputResultArgs
  ) => Promise<ProcessOutputResultArgs["messageList"]>;
}

export function createSecretRedactionProcessor(
  options: SecretRedactionProcessorOptions = {}
): UzinaSecretRedactionProcessor {
  const holdbackChars = Math.max(
    64,
    options.holdbackChars ?? DEFAULT_STREAM_HOLDBACK_CHARS
  );

  const getSecrets = (): readonly string[] => {
    if (!options.knownSecrets) return [];
    return typeof options.knownSecrets === "function"
      ? options.knownSecrets()
      : options.knownSecrets;
  };

  return {
    id: "uzina-secret-redaction",
    name: "Uzina Secret Redaction & Prompt Guard",

    async processInput({ messages, messageList }: ProcessInputArgs) {
      const secrets = getSecrets();
      for (const msg of messages) {
        const cleaned = redactMastraDbMessage(msg, secrets);
        if (cleaned !== msg) {
          msg.content = cleaned.content;
        }
      }
      return messageList;
    },

    async processToolResult({
      toolName,
      toolCallId,
      args,
      result,
      messageList,
    }: ProcessToolResultArgs) {
      const secrets = getSecrets();
      const sanitizedResult = sanitizeUntrustedToolOutput(result, secrets);
      const sanitizedArgs = redactSensitiveValue(args, secrets);
      messageList.updateToolInvocation({
        type: "tool-invocation",
        toolInvocation: {
          state: "result",
          toolCallId,
          toolName,
          args: sanitizedArgs,
          result: sanitizedResult,
        },
      });
      return messageList;
    },

    async processOutputStream({ part, state }: ProcessOutputStreamArgs) {
      const secrets = getSecrets();
      const stateKey = "__uzinaHoldbackBuffer";
      const currentBuffer =
        typeof state[stateKey] === "string" ? (state[stateKey] as string) : "";

      if (part.type === "text-delta") {
        const deltaText =
          typeof part.payload?.text === "string" ? part.payload.text : "";
        const combined = redactSensitiveText(
          currentBuffer + deltaText,
          secrets
        );
        const holdFrom = computeSuspiciousSuffixStart(
          combined,
          secrets,
          holdbackChars
        );

        const readyText = combined.slice(0, holdFrom);
        const tailText = combined.slice(holdFrom);
        state[stateKey] = tailText;

        if (!readyText) {
          return null;
        }

        return {
          ...part,
          payload: {
            ...part.payload,
            text: readyText,
          },
        };
      }

      if (part.type === "finish" || part.type === "step-finish") {
        if (currentBuffer.length > 0) {
          const flushed = redactSensitiveText(currentBuffer, secrets);
          state["__uzinaTailFlushed"] = flushed;
          state[stateKey] = "";
          if (flushed.length > 0) {
            options.onTailFlushed?.(flushed);
          }
        }
      }

      return part;
    },

    async processOutputResult({
      messages,
      messageList,
      state,
    }: ProcessOutputResultArgs) {
      const secrets = getSecrets();
      state["__uzinaHoldbackBuffer"] = "";
      state["__uzinaTailFlushed"] = "";

      for (const msg of messages) {
        const cleaned = redactMastraDbMessage(msg, secrets);
        msg.content = cleaned.content;
      }
      return messageList;
    },
  };
}

export function resolveContextTokenLimit(providerType?: string): number {
  if (providerType === "ollama") {
    return 24_000;
  }
  return 96_000;
}

export function createUzinaInputProcessors(params: {
  knownSecrets?: readonly string[] | (() => readonly string[]);
  toolsCatalog?: ToolsInput;
  providerType?: string;
}): InputProcessorOrWorkflow[] {
  const processors: InputProcessorOrWorkflow[] = [
    createSecretRedactionProcessor({ knownSecrets: params.knownSecrets }),
  ];

  const toolsCount = params.toolsCatalog
    ? Object.keys(params.toolsCatalog).length
    : 0;
  if (params.toolsCatalog && toolsCount >= TOOL_SEARCH_THRESHOLD) {
    processors.push(
      new ToolSearchProcessor({
        tools: {},
        includeResolvedTools: true,
        storage: "context",
        search: {
          topK: 5,
          autoLoad: true,
        },
      })
    );
  }

  processors.push(
    new TokenLimiterProcessor({
      limit: resolveContextTokenLimit(params.providerType),
      trimMode: "best-fit",
    })
  );

  return processors;
}

export function createUzinaOutputProcessors(params: {
  knownSecrets?: readonly string[] | (() => readonly string[]);
  onTailFlushed?: (flushedTail: string) => void;
}): OutputProcessorOrWorkflow[] {
  return [
    createSecretRedactionProcessor({
      knownSecrets: params.knownSecrets,
      onTailFlushed: params.onTailFlushed,
    }),
  ];
}

export function createUzinaErrorProcessors(): ErrorProcessorOrWorkflow[] {
  return defaultStabilityErrorProcessors();
}
