import fs from "node:fs";
import path from "node:path";
import type { MastraDBMessage, ToolsInput } from "@mastra/core/agent";
import {
  AgentsMDInjector,
  PromptInjectionDetector,
  TokenLimiterProcessor,
  ToolSearchProcessor,
  defaultStabilityErrorProcessors,
  formatSkillsCatalog,
  type ErrorProcessorOrWorkflow,
  type InputProcessor,
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
import type { MastraModelConfig } from "@mastra/core/llm";
import type { AgencyAgentRole, AgentRole } from "@uzina/contracts";
import {
  assertPathInsideWorkspace,
  estimateTokenCostUsd,
  loadNativeSkills,
  redactSensitiveText,
  redactSensitiveValue,
  selectNonConflictingSkillsForStage,
} from "@uzina/core";
import type { UzinaDb } from "@uzina/db";
import { getProjectAccumulatedCostUsd } from "./finops.js";
import { searchQmdScoped } from "./qmd.js";

const DEFAULT_STREAM_HOLDBACK_CHARS = 256;
const TOOL_SEARCH_THRESHOLD = 8;

const CONTROL_TAG_RE =
  /<\s*\/?\s*(?:system-reminder|system_instruction|assistant|tool_call|system)(?:\s[^>]*)?>/gi;

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

  const getSecrets = (requestContext?: {
    get?: (key: string) => unknown;
  }): readonly string[] => {
    const base = !options.knownSecrets
      ? []
      : typeof options.knownSecrets === "function"
        ? options.knownSecrets()
        : options.knownSecrets;
    const rcSecrets = requestContext?.get?.("knownSecrets");
    if (Array.isArray(rcSecrets)) {
      const extra = rcSecrets.filter((s): s is string => typeof s === "string");
      return extra.length > 0 ? [...base, ...extra] : base;
    }
    return base;
  };

  return {
    id: "uzina-secret-redaction",
    name: "Uzina Secret Redaction & Prompt Guard",

    async processInput({
      messages,
      messageList,
      requestContext,
    }: ProcessInputArgs) {
      const secrets = getSecrets(requestContext);
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
      messages,
      messageList,
      requestContext,
    }: ProcessToolResultArgs) {
      const secrets = getSecrets(requestContext);
      const sanitizedResult = sanitizeUntrustedToolOutput(result, secrets);
      const sanitizedArgs = redactSensitiveValue(args, secrets);
      for (const msg of messages) {
        const parts = msg.content?.parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (
            part.type === "tool-invocation" &&
            part.toolInvocation?.toolCallId === toolCallId
          ) {
            part.toolInvocation = redactSensitiveValue(
              part.toolInvocation,
              secrets
            );
          }
        }
      }
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

    async processOutputStream({
      part,
      state,
      requestContext,
    }: ProcessOutputStreamArgs) {
      const secrets = getSecrets(requestContext);
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
      requestContext,
    }: ProcessOutputResultArgs) {
      const secrets = getSecrets(requestContext);
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

export interface UzinaPromptInjectionGuardOptions {
  untrustedCheckout?: boolean;
  strategy?: "rewrite" | "block";
  knownSecrets?: readonly string[] | (() => readonly string[]);
  onDetection?: (info: { reason: string; phase: string }) => void;
}

const PROMPT_INJECTION_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "instruction_override",
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?|directives?)\b/gi,
  },
  {
    reason: "secret_exfiltration_command",
    pattern:
      /(?:reveal|print|dump|cat|exfiltrate|send)\s+(?:the\s+)?(?:\.master-key|\.env(?:\.[a-z]+)?|api[_ -]?key|secret)/gi,
  },
  {
    reason: "shell_exfiltration",
    pattern:
      /\b(?:curl|wget|Invoke-WebRequest)\b[^\n]*(?:\.env|\.master-key|\|\s*(?:sh|bash|pwsh))/gi,
  },
  {
    reason: "system_delimiter_injection",
    pattern: CONTROL_TAG_RE,
  },
];

function normalizeForInjectionScan(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

function neutralizePromptInjectionText(text: string): {
  text: string;
  matchedReasons: string[];
} {
  let out = normalizeForInjectionScan(text);
  const matchedReasons: string[] = [];
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(out)) {
      matchedReasons.push(rule.reason);
      rule.pattern.lastIndex = 0;
      out = out.replace(rule.pattern, "[prompt-injection-neutralized]");
    }
  }
  return { text: out, matchedReasons };
}

function neutralizePromptInjectionValue(value: unknown): {
  value: unknown;
  matchedReasons: string[];
} {
  if (typeof value === "string") {
    const res = neutralizePromptInjectionText(value);
    return { value: res.text, matchedReasons: res.matchedReasons };
  }
  if (Array.isArray(value)) {
    const reasons = new Set<string>();
    const items = value.map((item) => {
      const sub = neutralizePromptInjectionValue(item);
      for (const r of sub.matchedReasons) reasons.add(r);
      return sub.value;
    });
    return { value: items, matchedReasons: Array.from(reasons) };
  }
  if (value && typeof value === "object") {
    const reasons = new Set<string>();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const sub = neutralizePromptInjectionValue(v);
      for (const r of sub.matchedReasons) reasons.add(r);
      out[k] = sub.value;
    }
    return { value: out, matchedReasons: Array.from(reasons) };
  }
  return { value, matchedReasons: [] };
}

export function createUzinaPromptInjectionGuardProcessor(
  options: UzinaPromptInjectionGuardOptions = {}
): InputProcessor {
  const strategy = options.strategy ?? "rewrite";
  const resolveSecrets = (requestContext?: {
    get?: (key: string) => unknown;
  }): readonly string[] => {
    const base = !options.knownSecrets
      ? []
      : typeof options.knownSecrets === "function"
        ? options.knownSecrets()
        : options.knownSecrets;
    const rcSecrets = requestContext?.get?.("knownSecrets");
    if (Array.isArray(rcSecrets)) {
      const extra = rcSecrets.filter((s): s is string => typeof s === "string");
      return extra.length > 0 ? [...base, ...extra] : base;
    }
    return base;
  };

  return {
    id: "uzina-prompt-injection-guard",
    name: "Uzina Prompt Injection Guard",

    async processInput({
      messages,
      messageList,
      requestContext,
      abort,
    }: ProcessInputArgs) {
      const untrusted =
        options.untrustedCheckout === true ||
        requestContext?.get("untrustedCheckout") === true;
      if (!untrusted) {
        return messageList;
      }

      for (const msg of messages) {
        const content = msg.content;
        if (!content) continue;
        const reasons: string[] = [];

        if (typeof content.content === "string") {
          const res = neutralizePromptInjectionText(content.content);
          if (res.matchedReasons.length > 0) {
            reasons.push(...res.matchedReasons);
            content.content = res.text;
          }
        }
        if (Array.isArray(content.parts)) {
          content.parts = content.parts.map((part) => {
            if (part.type === "text" && typeof part.text === "string") {
              const res = neutralizePromptInjectionText(part.text);
              if (res.matchedReasons.length > 0) {
                reasons.push(...res.matchedReasons);
                return { ...part, text: res.text };
              }
            }
            return part;
          });
        }

        if (reasons.length > 0) {
          options.onDetection?.({
            reason: reasons.join(","),
            phase: "processInput",
          });
          if (strategy === "block") {
            abort(`PROMPT_INJECTION_BLOCKED:${reasons[0]}`);
          }
        }
      }

      return messageList;
    },

    async processInputStep({
      systemMessages,
      requestContext,
      abort,
    }: ProcessInputStepArgs) {
      const untrusted =
        options.untrustedCheckout === true ||
        requestContext?.get("untrustedCheckout") === true;
      if (!untrusted) {
        return { systemMessages };
      }
      const nextSystem = systemMessages.map((msg) => {
        if (msg.role !== "system" || typeof msg.content !== "string") return msg;
        const res = neutralizePromptInjectionText(msg.content);
        if (res.matchedReasons.length > 0) {
          options.onDetection?.({
            reason: res.matchedReasons.join(","),
            phase: "processInputStep",
          });
          if (strategy === "block") {
            abort(`PROMPT_INJECTION_SYSTEM_BLOCKED:${res.matchedReasons[0]}`);
          }
          return { ...msg, content: res.text };
        }
        return msg;
      });
      return { systemMessages: nextSystem };
    },

    async processToolResult({
      toolName,
      toolCallId,
      args,
      result,
      messages,
      messageList,
      requestContext,
      abort,
    }: ProcessToolResultArgs) {
      const secrets = resolveSecrets(requestContext);
      const neutralized = neutralizePromptInjectionValue(result);
      if (neutralized.matchedReasons.length > 0) {
        options.onDetection?.({
          reason: neutralized.matchedReasons.join(","),
          phase: "processToolResult",
        });
        if (strategy === "block") {
          abort(`PROMPT_INJECTION_TOOL_BLOCKED:${neutralized.matchedReasons[0]}`);
        }
        const safeResult = sanitizeUntrustedToolOutput(
          neutralized.value,
          secrets
        );
        const safeArgs = redactSensitiveValue(args, secrets);
        for (const msg of messages) {
          const parts = msg.content?.parts;
          if (!Array.isArray(parts)) continue;
          for (const part of parts) {
            if (
              part.type === "tool-invocation" &&
              part.toolInvocation?.toolCallId === toolCallId
            ) {
              part.toolInvocation = {
                ...part.toolInvocation,
                args: safeArgs,
              };
            }
          }
        }
        messageList.updateToolInvocation({
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId,
            toolName,
            args: safeArgs,
            result: safeResult,
          },
        });
      }
      return messageList;
    },
  };
}

export function createOptionalLlmPromptInjectionDetector(
  model?: MastraModelConfig
): PromptInjectionDetector | null {
  if (!model) return null;
  return new PromptInjectionDetector({
    model,
    strategy: "rewrite",
    threshold: 0.75,
  });
}

function mapAgencyRoleToSkillRole(role?: AgencyAgentRole): AgentRole | undefined {
  switch (role) {
    case "product_discovery":
      return "discovery";
    case "software_architect":
      return "architect";
    case "ux_designer":
      return "visual";
    case "tech_lead":
      return "builder";
    case "qa_appsec":
      return "security";
    case "orchestrator":
      return "copilot";
    default:
      return undefined;
  }
}

export function createUzinaSkillsCatalogProcessor(params: {
  role?: AgencyAgentRole;
  skillsDir?: string;
  preferredLeadName?: string;
  includeCritique?: boolean;
}) {
  return {
    id: "uzina-skills-catalog",
    name: "Uzina Progressive Skills Catalog",
    async processInputStep({
      systemMessages,
      requestContext,
    }: ProcessInputStepArgs) {
      const dynamicRole =
        (requestContext?.get("agencyRole") as AgencyAgentRole | undefined) ??
        params.role;
      const skillRole = mapAgencyRoleToSkillRole(dynamicRole);
      const rolesFilter: AgentRole[] | undefined = skillRole
        ? skillRole === "security"
          ? ["security", "verifier"]
          : [skillRole]
        : undefined;

      const preferredLeadFromCtx = requestContext?.get("preferredLeadSkill");
      const preferredLeadName =
        typeof preferredLeadFromCtx === "string" && preferredLeadFromCtx.trim()
          ? preferredLeadFromCtx.trim()
          : params.preferredLeadName;

      const includeCritiqueFromCtx = requestContext?.get("includeCritique");
      const includeCritique =
        typeof includeCritiqueFromCtx === "boolean"
          ? includeCritiqueFromCtx
          : (params.includeCritique ??
            (dynamicRole === "qa_appsec" ||
              dynamicRole === "ux_designer" ||
              requestContext?.get("controllerMode") === "review"));

      const ctx = createUzinaSkillsContext(params.skillsDir, rolesFilter, {
        preferredLeadName,
        includeCritique,
      });
      if (!ctx.catalogMarkdown) {
        return { systemMessages };
      }

      const catalogMessageContent = [
        ctx.catalogMarkdown,
        "Quando uma tarefa corresponder a uma skill acima, chame a tool `load_uzina_skill` com `skillName` (e opcionalmente `resourcePath` para `references/` ou `templates/`) antes de executar.",
      ].join("\n\n");

      const alreadyInjected = systemMessages.some(
        (m) =>
          typeof m.content === "string" &&
          m.content.includes("<available_skills>")
      );
      if (alreadyInjected) {
        return { systemMessages };
      }

      return {
        systemMessages: [
          ...systemMessages,
          { role: "system" as const, content: catalogMessageContent },
        ],
      };
    },
  };
}

export function createUzinaSemanticRecallProcessor(params: {
  db: UzinaDb;
  topK?: number;
}) {
  const topK = Math.max(1, Math.min(10, params.topK ?? 4));
  return {
    id: "uzina-semantic-recall",
    name: "Uzina Multi-Tenant Semantic Recall (QMD)",
    async processInput({
      messages,
      messageList,
      requestContext,
    }: ProcessInputArgs) {
      const actor = requestContext?.get("actor") as
        | { organizationId?: string }
        | undefined;
      const organizationId = actor?.organizationId;
      if (!organizationId) {
        return messageList;
      }

      const projectIdRaw = requestContext?.get("projectId");
      const projectId =
        typeof projectIdRaw === "string" && projectIdRaw.length > 0
          ? projectIdRaw
          : undefined;

      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      if (!lastUserMsg) {
        return messageList;
      }

      let queryText = "";
      if (typeof lastUserMsg.content?.content === "string") {
        queryText = lastUserMsg.content.content;
      } else if (Array.isArray(lastUserMsg.content?.parts)) {
        queryText = lastUserMsg.content.parts
          .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
          .join(" ");
      }
      const trimmedQuery = queryText.trim().slice(0, 320);
      if (trimmedQuery.length < 3) {
        return messageList;
      }

      const res = await searchQmdScoped(params.db, {
        organizationId,
        request: {
          query: trimmedQuery,
          projectId,
          limit: topK,
        },
      }).catch(() => null);

      if (!res || res.hits.length === 0) {
        return messageList;
      }

      const rcSecrets = requestContext?.get("knownSecrets");
      const secrets = Array.isArray(rcSecrets)
        ? rcSecrets.filter((s): s is string => typeof s === "string")
        : [];
      const sanitizeMemoryText = (raw: string): string => {
        const redacted = redactSensitiveText(raw, secrets).replace(
          CONTROL_TAG_RE,
          "[control-tag-escaped]"
        );
        return neutralizePromptInjectionText(redacted).text;
      };

      const lines = res.hits.map(
        (h) =>
          `- [${h.scopeType}] ${sanitizeMemoryText(h.headingPath)}: ${sanitizeMemoryText(h.snippet).slice(0, 260)}`
      );
      const recallBlock = `<uzina_semantic_recall>\n${lines.join("\n")}\n</uzina_semantic_recall>`;

      const existingRecall = messageList.getSystemMessages("uzina-semantic-recall");
      if (existingRecall.length === 0) {
        messageList.addSystem(recallBlock, "uzina-semantic-recall");
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
  untrustedCheckout?: boolean;
  promptInjectionModel?: MastraModelConfig;
}): InputProcessorOrWorkflow[] {
  const processors: InputProcessorOrWorkflow[] = [
    createUzinaPromptInjectionGuardProcessor({
      untrustedCheckout: params.untrustedCheckout,
      knownSecrets: params.knownSecrets,
    }),
    createSecretRedactionProcessor({ knownSecrets: params.knownSecrets }),
  ];

  const llmDetector = createOptionalLlmPromptInjectionDetector(
    params.promptInjectionModel
  );
  if (llmDetector) {
    processors.push(llmDetector);
  }

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
  /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.master-key|\.git[\\/](?:config|hooks)(?:$|[\\/])|[^\\/]+\.(?:pem|key)$)/i;

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
      const resolved = path.resolve(/*turbopackIgnore: true*/ candidate);
      if (!fs.existsSync(/*turbopackIgnore: true*/ resolved)) return undefined;
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
            const stat = fs.lstatSync(/*turbopackIgnore: true*/ resolved);
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
            const stat = fs.lstatSync(/*turbopackIgnore: true*/ resolved);
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
          const stat = fs.lstatSync(/*turbopackIgnore: true*/ resolved);
          if (stat.isSymbolicLink()) {
            throw new Error("Symlinks não são permitidos em AgentsMDInjector.");
          }
          const raw = fs.readFileSync(/*turbopackIgnore: true*/ resolved, "utf8");
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

export function createUzinaSkillsContext(
  skillsDir?: string,
  roles?: AgentRole[],
  stageSelection?: {
    preferredLeadName?: string;
    includeCritique?: boolean;
  }
): {
  entries: SkillCatalogEntry[];
  catalogMarkdown: string;
} {
  try {
    const rawDefinitions = loadNativeSkills({ skillsDir, roles });
    const definitions = stageSelection
      ? selectNonConflictingSkillsForStage(rawDefinitions, stageSelection)
      : rawDefinitions;
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
