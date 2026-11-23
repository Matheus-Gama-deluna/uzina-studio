import fs from "node:fs";
import path from "node:path";
import type { MastraDBMessage, ToolsInput } from "@mastra/core/agent";
import {
  AgentsMDInjector,
  TokenLimiterProcessor,
  ToolSearchProcessor,
  defaultStabilityErrorProcessors,
  formatSkillsCatalog,
  type ErrorProcessorOrWorkflow,
  type InputProcessorOrWorkflow,
  type OutputProcessorOrWorkflow,
  type ProcessInputArgs,
  type ProcessInputStepArgs,
  type ProcessOutputResultArgs,
  type ProcessOutputStepArgs,
  type ProcessOutputStreamArgs,
  type ProcessToolResultArgs,
  type SkillCatalogEntry,
} from "@mastra/core/processors";
import {
  assertPathInsideWorkspace,
  estimateTokenCostUsd,
  loadNativeSkills,
  redactSensitiveText,
  redactSensitiveValue,
} from "@uzina/core";
import type { UzinaDb } from "@uzina/db";
import { getProjectAccumulatedCostUsd } from "./finops.js";

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

const SENSITIVE_FILE_SEGMENT_RE =
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.master-key|\.git[\\/](?:config|hooks)|[^\\/]+\.(?:pem|key))$/i;

export function isSensitiveWorkspaceFile(filePath: string): boolean {
  const normalized = filePath.trim();
  if (!normalized) return true;
  if (SENSITIVE_FILE_SEGMENT_RE.test(normalized)) return true;
  const base = path.basename(normalized).toLowerCase();
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    base === ".master-key" ||
    base.endsWith(".pem") ||
    base.endsWith(".key")
  );
}

export function createUzinaAgentsMdInjector(options: {
  workspaceRoot?: string | null;
  untrustedCheckout?: boolean;
  maxTokens?: number;
} = {}): AgentsMDInjector {
  const resolveValidRoot = (args?: ProcessInputStepArgs): string | undefined => {
    const candidate =
      (args?.requestContext?.get("workspaceRoot") as string | undefined) ??
      options.workspaceRoot;
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      return undefined;
    }
    try {
      const resolved = path.resolve(candidate);
      if (!fs.existsSync(resolved)) return undefined;
      return assertPathInsideWorkspace(resolved, resolved, { allowRoot: true });
    } catch {
      return undefined;
    }
  };

  return new AgentsMDInjector({
    maxTokens: options.maxTokens ?? 1500,
    isEnabled: (args) => {
      if (options.untrustedCheckout) return false;
      if (args.requestContext?.get("untrustedCheckout") === true) return false;
      return resolveValidRoot(args) !== undefined;
    },
    getBasePath: (args) => resolveValidRoot(args),
    getReader: (args) => {
      const root = resolveValidRoot(args);
      if (!root) {
        return {
          pathExists: () => false,
          isDirectory: () => false,
          readFile: () => {
            throw new Error("AGENTS_READER_DISABLED: workspaceRoot ausente.");
          },
        };
      }
      return {
        pathExists: (targetPath: string) => {
          try {
            if (isSensitiveWorkspaceFile(targetPath)) return false;
            const resolved = assertPathInsideWorkspace(root, targetPath, {
              allowRoot: true,
            });
            const stat = fs.lstatSync(resolved);
            if (stat.isSymbolicLink()) return false;
            return true;
          } catch {
            return false;
          }
        },
        isDirectory: (targetPath: string) => {
          try {
            const resolved = assertPathInsideWorkspace(root, targetPath, {
              allowRoot: true,
            });
            const stat = fs.lstatSync(resolved);
            return !stat.isSymbolicLink() && stat.isDirectory();
          } catch {
            return false;
          }
        },
        readFile: (targetPath: string) => {
          if (isSensitiveWorkspaceFile(targetPath)) {
            throw new Error("Acesso negado a arquivo sensível.");
          }
          const resolved = assertPathInsideWorkspace(root, targetPath);
          const stat = fs.lstatSync(resolved);
          if (stat.isSymbolicLink()) {
            throw new Error("Symlinks não são permitidos em AgentsMDInjector.");
          }
          const raw = fs.readFileSync(resolved, "utf8");
          const sanitized = redactSensitiveText(raw).replace(
            CONTROL_TAG_RE,
            "[control-tag-escaped]"
          );
          return sanitized.slice(0, 6000);
        },
      };
    },
  });
}

export function createUzinaSkillsContext(skillsDir?: string): {
  entries: SkillCatalogEntry[];
  catalogMarkdown: string;
} {
  try {
    const definitions = loadNativeSkills({ skillsDir });
    const entries: SkillCatalogEntry[] = definitions
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        location: `packages/skills/${skill.name}/SKILL.md`,
        source: "uzina-native",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      entries,
      catalogMarkdown: formatSkillsCatalog(entries),
    };
  } catch {
    return {
      entries: [],
      catalogMarkdown: "",
    };
  }
}

export function createBudgetGuardProcessor(params: {
  db: UzinaDb;
  projectId: string;
  budgetCapUsd: number | null | undefined;
  modelId?: string;
  onBudgetExceeded?: (info: {
    accumulatedUsd: number;
    budgetCapUsd: number;
  }) => void;
}) {
  return {
    id: "uzina-budget-guard",
    name: "Uzina Project Budget Guard",
    async processOutputStep({
      usage,
      messageList,
      abort,
    }: ProcessOutputStepArgs) {
      const cap = params.budgetCapUsd;
      if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) {
        return messageList;
      }
      const usageRec = usage as {
        inputTokens?: number;
        outputTokens?: number;
      };
      const stepCost = estimateTokenCostUsd(params.modelId ?? "gpt-4o-mini", {
        inputTokens: usageRec.inputTokens ?? 0,
        outputTokens: usageRec.outputTokens ?? 0,
      });
      const accumulated = await getProjectAccumulatedCostUsd(
        params.db,
        params.projectId,
        stepCost
      );
      if (accumulated >= cap) {
        params.onBudgetExceeded?.({
          accumulatedUsd: accumulated,
          budgetCapUsd: cap,
        });
        abort("BUDGET_CAP_EXCEEDED");
      }
      return messageList;
    },
  };
}
