import {
  TestProviderConnectionRequestSchema,
  TestProviderConnectionResponseSchema,
  isPrivateOrLoopbackUrl,
  type AgencyAgentRole,
  type AgentRole,
  type ProviderType,
  type RoleBindings,
  type TestProviderConnectionRequest,
  type TestProviderConnectionResponse,
} from "@uzina/contracts";
import {
  decryptSecret,
  parseMasterKeyBuffer,
  redactSensitiveText,
} from "@uzina/core";
import { providerProfiles, type UzinaDb } from "@uzina/db";
import { and, desc, eq } from "drizzle-orm";

export const DEFAULT_PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  google: "https://generativelanguage.googleapis.com/v1beta",
  openai_compatible: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  omniroute: "http://localhost:8080/v1",
  ollama: "http://127.0.0.1:11434",
};

export const DEFAULT_PROVIDER_MODELS: Record<
  ProviderType,
  { tier3: string; tier2: string }
> = {
  google: {
    tier3: "gemini-2.5-pro",
    tier2: "gemini-2.5-flash",
  },
  openai_compatible: {
    tier3: "gpt-4o",
    tier2: "gpt-4o-mini",
  },
  anthropic: {
    tier3: "claude-sonnet-4-5",
    tier2: "claude-haiku-4-5",
  },
  omniroute: {
    tier3: "gpt-4o",
    tier2: "gpt-4o-mini",
  },
  ollama: {
    tier3: "qwen2.5-coder:7b",
    tier2: "qwen2.5-coder:7b",
  },
};

function isLocalhost8080Url(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return (
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.port === "8080"
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(
  providerType: ProviderType,
  rawBaseUrl?: string | null
): string {
  const trimmed = rawBaseUrl?.trim() ?? "";
  // Se o usuário trocou para Google/Anthropic/OpenAI mas o campo ficou com o default antigo de localhost:8080/v1, corrige para a URL oficial
  if (
    !trimmed ||
    ((providerType === "google" || providerType === "anthropic") &&
      isLocalhost8080Url(trimmed))
  ) {
    return DEFAULT_PROVIDER_BASE_URLS[providerType];
  }
  return trimmed.replace(/\/+$/, "");
}

function normalizeModelIdForProvider(
  providerType: ProviderType,
  rawModelId: string,
  baseUrl: string
): string {
  const trimmed = rawModelId.trim();
  if (!trimmed) {
    return DEFAULT_PROVIDER_MODELS[providerType].tier2;
  }
  if (providerType === "google") {
    return trimmed.replace(/^google\//i, "").replace(/^models\//i, "");
  }
  if (providerType === "anthropic") {
    return trimmed.replace(/^anthropic\//i, "");
  }
  if (providerType === "ollama") {
    return trimmed.replace(/^ollama\//i, "");
  }
  if (providerType === "openai_compatible" || providerType === "omniroute") {
    try {
      if (new URL(baseUrl).hostname === "api.openai.com") {
        return trimmed.replace(/^openai\//i, "");
      }
    } catch {
      // ignora URL inválida
    }
  }
  return trimmed;
}

function mapAgencyRoleToBindingKey(role: AgencyAgentRole): AgentRole {
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
  }
}

export async function callProviderLlmApi(params: {
  providerType: ProviderType;
  baseUrl?: string | null;
  apiKey?: string | null;
  modelId?: string | null;
  systemInstruction: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  providerType: ProviderType;
  modelId: string;
  latencyMs: number;
  text: string | null;
  error: string | null;
}> {
  const startedAt = Date.now();
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(params.providerType, params.baseUrl);
  if (
    (params.providerType === "google" || params.providerType === "anthropic") &&
    isPrivateOrLoopbackUrl(baseUrl)
  ) {
    return {
      ok: false,
      providerType: params.providerType,
      modelId: params.modelId?.trim() || DEFAULT_PROVIDER_MODELS[params.providerType].tier2,
      latencyMs: 0,
      text: null,
      error:
        "Provedores cloud (Google/Anthropic) não podem apontar para endereços privados ou loopback.",
    };
  }
  const rawModel =
    params.modelId?.trim() ||
    DEFAULT_PROVIDER_MODELS[params.providerType].tier2;
  const cleanModel = normalizeModelIdForProvider(
    params.providerType,
    rawModel,
    baseUrl
  );
  const maxTokens = params.maxTokens ?? 750;
  const timeoutMs = params.timeoutMs ?? 12_000;

  if (params.providerType !== "ollama" && !params.apiKey?.trim()) {
    return {
      ok: false,
      providerType: params.providerType,
      modelId: cleanModel,
      latencyMs: Date.now() - startedAt,
      text: null,
      error: "Chave de API ausente para este provedor.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    if (params.providerType === "google") {
      const endpoint = `${baseUrl}/models/${encodeURIComponent(
        cleanModel
      )}:generateContent`;
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": params.apiKey!.trim(),
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: params.systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: params.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: maxTokens,
          },
        }),
        signal: controller.signal,
      });

      const bodyJson = (await response.json().catch(() => null)) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        const msg =
          bodyJson?.error?.message ??
          `Google Gemini retornou HTTP ${response.status}.`;
        return {
          ok: false,
          providerType: params.providerType,
          modelId: cleanModel,
          latencyMs: Date.now() - startedAt,
          text: null,
          error: redactSensitiveText(msg).slice(0, 380),
        };
      }

      const text =
        bodyJson?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim() ?? "";

      return {
        ok: Boolean(text),
        providerType: params.providerType,
        modelId: cleanModel,
        latencyMs: Date.now() - startedAt,
        text: text ? redactSensitiveText(text) : null,
        error: text ? null : "Resposta vazia recebida do Google Gemini.",
      };
    }

    if (params.providerType === "anthropic") {
      const endpoint = `${baseUrl}/messages`;
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": params.apiKey!.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cleanModel,
          max_tokens: maxTokens,
          system: params.systemInstruction,
          messages: [{ role: "user", content: params.userPrompt }],
        }),
        signal: controller.signal,
      });

      const bodyJson = (await response.json().catch(() => null)) as {
        content?: Array<{ type?: string; text?: string }>;
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        const msg =
          bodyJson?.error?.message ??
          `Anthropic retornou HTTP ${response.status}.`;
        return {
          ok: false,
          providerType: params.providerType,
          modelId: cleanModel,
          latencyMs: Date.now() - startedAt,
          text: null,
          error: redactSensitiveText(msg).slice(0, 380),
        };
      }

      const text =
        bodyJson?.content
          ?.map((c) => c.text ?? "")
          .join("")
          .trim() ?? "";

      return {
        ok: Boolean(text),
        providerType: params.providerType,
        modelId: cleanModel,
        latencyMs: Date.now() - startedAt,
        text: text ? redactSensitiveText(text) : null,
        error: text ? null : "Resposta vazia recebida da Anthropic.",
      };
    }

    if (params.providerType === "ollama") {
      const cleanOllamaRoot = baseUrl.replace(/\/v1\/?$/i, "");
      const endpoint = `${cleanOllamaRoot}/api/chat`;
      response = await fetchFn(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: cleanModel,
          stream: false,
          messages: [
            { role: "system", content: params.systemInstruction },
            { role: "user", content: params.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      const bodyJson = (await response.json().catch(() => null)) as {
        message?: { content?: string };
        error?: string;
      } | null;

      if (!response.ok) {
        const msg =
          bodyJson?.error ?? `Ollama retornou HTTP ${response.status}.`;
        return {
          ok: false,
          providerType: params.providerType,
          modelId: cleanModel,
          latencyMs: Date.now() - startedAt,
          text: null,
          error: redactSensitiveText(msg).slice(0, 380),
        };
      }

      const text = bodyJson?.message?.content?.trim() ?? "";
      return {
        ok: Boolean(text),
        providerType: params.providerType,
        modelId: cleanModel,
        latencyMs: Date.now() - startedAt,
        text: text ? redactSensitiveText(text) : null,
        error: text ? null : "Resposta vazia recebida do Ollama.",
      };
    }

    // openai_compatible & omniroute
    const endpoint = `${baseUrl}/chat/completions`;
    response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(params.apiKey?.trim()
          ? { Authorization: `Bearer ${params.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: cleanModel,
        temperature: 0.3,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: params.systemInstruction },
          { role: "user", content: params.userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    const bodyJson = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    } | null;

    if (!response.ok) {
      const errField = bodyJson?.error;
      const msg =
        typeof errField === "string"
          ? errField
          : errField?.message ??
            `Endpoint OpenAI-compatible retornou HTTP ${response.status}.`;
      return {
        ok: false,
        providerType: params.providerType,
        modelId: cleanModel,
        latencyMs: Date.now() - startedAt,
        text: null,
        error: redactSensitiveText(msg).slice(0, 380),
      };
    }

    const text = bodyJson?.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      ok: Boolean(text),
      providerType: params.providerType,
      modelId: cleanModel,
      latencyMs: Date.now() - startedAt,
      text: text ? redactSensitiveText(text) : null,
      error: text ? null : "Resposta vazia recebida do provedor LLM.",
    };
  } catch (err) {
    const rawMsg =
      err instanceof Error ? err.message : "Falha de rede ao contatar o LLM.";
    return {
      ok: false,
      providerType: params.providerType,
      modelId: cleanModel,
      latencyMs: Date.now() - startedAt,
      text: null,
      error: redactSensitiveText(rawMsg).slice(0, 380),
    };
  } finally {
    clearTimeout(timer);
  }
}

function toMasterKeyBuffer(raw?: Buffer | string | null): Buffer | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  return parseMasterKeyBuffer(raw);
}

export async function testProviderLlmConnectionScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    masterKey?: Buffer | string | null;
    request: TestProviderConnectionRequest;
    fetchImpl?: typeof fetch;
  }
): Promise<TestProviderConnectionResponse> {
  const parsed = TestProviderConnectionRequestSchema.parse(params.request);

  let resolvedType: ProviderType = parsed.providerType ?? "google";
  let resolvedBaseUrl: string | null = parsed.baseUrl ?? null;
  let resolvedApiKey: string | null = parsed.apiKey ?? null;
  let resolvedModelId: string | null = parsed.modelId ?? null;

  if (parsed.providerId) {
    const [row] = await db
      .select()
      .from(providerProfiles)
      .where(
        and(
          eq(providerProfiles.id, parsed.providerId),
          eq(providerProfiles.organizationId, params.organizationId)
        )
      )
      .limit(1);

    if (!row) {
      return TestProviderConnectionResponseSchema.parse({
        ok: false,
        providerType: resolvedType,
        modelId: resolvedModelId ?? "unknown",
        latencyMs: 0,
        replyPreview: null,
        error: "Perfil de provedor não encontrado nesta organização.",
      });
    }

    resolvedType = parsed.providerType ?? (row.providerType as ProviderType);
    resolvedBaseUrl = parsed.baseUrl ?? row.baseUrl;
    const bindings = (row.roleBindingsJson ?? {}) as RoleBindings;
    resolvedModelId =
      parsed.modelId ??
      bindings.discovery?.modelId ??
      bindings.architect?.modelId ??
      bindings.builder?.modelId ??
      DEFAULT_PROVIDER_MODELS[resolvedType].tier2;

    if (
      (resolvedType === "google" || resolvedType === "anthropic") &&
      resolvedBaseUrl &&
      isPrivateOrLoopbackUrl(resolvedBaseUrl)
    ) {
      return TestProviderConnectionResponseSchema.parse({
        ok: false,
        providerType: resolvedType,
        modelId: resolvedModelId,
        latencyMs: 0,
        replyPreview: null,
        error: "URL privada ou loopback não permitida para provedor cloud (anti-SSRF).",
      });
    }

    if (!resolvedApiKey && row.encryptedApiKey) {
      const mkBuf = toMasterKeyBuffer(params.masterKey);
      if (!mkBuf) {
        return TestProviderConnectionResponseSchema.parse({
          ok: false,
          providerType: resolvedType,
          modelId: resolvedModelId,
          latencyMs: 0,
          replyPreview: null,
          error: "Chave mestra do servidor indisponível para descriptografar o cofre.",
        });
      }
      try {
        resolvedApiKey = decryptSecret({
          encrypted: row.encryptedApiKey,
          masterKey: mkBuf,
          organizationId: params.organizationId,
          providerType: row.providerType as ProviderType,
        });
      } catch {
        return TestProviderConnectionResponseSchema.parse({
          ok: false,
          providerType: resolvedType,
          modelId: resolvedModelId,
          latencyMs: 0,
          replyPreview: null,
          error: "Falha ao descriptografar chave AES-256-GCM deste perfil.",
        });
      }
    }
  }

  if (
    (resolvedType === "google" || resolvedType === "anthropic") &&
    resolvedBaseUrl &&
    isPrivateOrLoopbackUrl(resolvedBaseUrl)
  ) {
    return TestProviderConnectionResponseSchema.parse({
      ok: false,
      providerType: resolvedType,
      modelId: resolvedModelId ?? DEFAULT_PROVIDER_MODELS[resolvedType].tier2,
      latencyMs: 0,
      replyPreview: null,
      error: "URL privada ou loopback não permitida para provedor cloud (anti-SSRF).",
    });
  }

  const pingResult = await callProviderLlmApi({
    providerType: resolvedType,
    baseUrl: resolvedBaseUrl,
    apiKey: resolvedApiKey,
    modelId: resolvedModelId,
    systemInstruction:
      "Você é o verificador de conectividade do Uzina Studio. Responda em 1 linha curta em português confirmando que está online.",
    userPrompt: "Ping de conexão do Cofre AES-256-GCM do Uzina Studio. Confirme status.",
    maxTokens: 60,
    timeoutMs: 10_000,
    fetchImpl: params.fetchImpl,
  });

  return TestProviderConnectionResponseSchema.parse({
    ok: pingResult.ok,
    providerType: pingResult.providerType,
    modelId: pingResult.modelId,
    latencyMs: pingResult.latencyMs,
    replyPreview: pingResult.text ? pingResult.text.slice(0, 380) : null,
    error: pingResult.error ? pingResult.error.slice(0, 380) : null,
  });
}

export async function invokeOrganizationLlmForAgentScoped(
  db: UzinaDb,
  params: {
    organizationId: string;
    masterKey?: Buffer | string | null;
    agentRole: AgencyAgentRole;
    agentName: string;
    agentTitle: string;
    projectName?: string | null;
    strategyLabel?: string | null;
    phaseLabel?: string | null;
    userMessage: string;
    contextSummary?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<{
  ok: boolean;
  text: string | null;
  modelId: string;
  providerType: ProviderType | null;
  latencyMs: number;
  error: string | null;
}> {
  const profiles = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, params.organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.updatedAt));

  const primary = profiles.find(
    (p) => Boolean(p.encryptedApiKey) || p.providerType === "ollama"
  );

  if (!primary) {
    return {
      ok: false,
      text: null,
      modelId: "local-assisted",
      providerType: null,
      latencyMs: 0,
      error: null,
    };
  }

  const providerType = primary.providerType as ProviderType;
  let apiKey: string | null = null;
  if (primary.encryptedApiKey) {
    const mkBuf = toMasterKeyBuffer(params.masterKey);
    if (!mkBuf) {
      return {
        ok: false,
        text: null,
        modelId: "local-assisted",
        providerType,
        latencyMs: 0,
        error: "MASTER_ENCRYPTION_KEY ausente.",
      };
    }
    try {
      apiKey = decryptSecret({
        encrypted: primary.encryptedApiKey,
        masterKey: mkBuf,
        organizationId: params.organizationId,
        providerType,
      });
    } catch {
      return {
        ok: false,
        text: null,
        modelId: "local-assisted",
        providerType,
        latencyMs: 0,
        error: "Falha ao descriptografar chave do cofre.",
      };
    }
  }

  const bindings = (primary.roleBindingsJson ?? {}) as RoleBindings;
  const bindingKey = mapAgencyRoleToBindingKey(params.agentRole);
  const isTier3 =
    params.agentRole === "orchestrator" ||
    params.agentRole === "product_discovery" ||
    params.agentRole === "software_architect";
  const defaultModel = isTier3
    ? DEFAULT_PROVIDER_MODELS[providerType].tier3
    : DEFAULT_PROVIDER_MODELS[providerType].tier2;
  const chosenModel =
    bindings[bindingKey]?.modelId ??
    bindings.architect?.modelId ??
    bindings.discovery?.modelId ??
    defaultModel;

  const systemInstruction = [
    `Você é ${params.agentName} (${params.agentTitle}) da Fábrica de Software Autônoma Uzina Studio.`,
    `Responda sempre em português do Brasil, de forma técnica, direta, estruturada em tópicos Markdown curtos (**negrito** e \`código\`).`,
    params.projectName ? `Projeto Ativo: ${params.projectName}.` : "",
    params.strategyLabel
      ? `Estratégia Arquitetural para IA: ${params.strategyLabel}.`
      : "",
    params.phaseLabel ? `Fase Atual do Ciclo: ${params.phaseLabel}.` : "",
    params.contextSummary ? `Contexto Executado no Sistema:\n${params.contextSummary}` : "",
    `Forneça orientações práticas de arquitetura, contratos Zod, fluxo visual e próximos passos acionáveis para o usuário.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callProviderLlmApi({
    providerType,
    baseUrl: primary.baseUrl,
    apiKey,
    modelId: chosenModel,
    systemInstruction,
    userPrompt: params.userMessage,
    maxTokens: 650,
    timeoutMs: 14_000,
    fetchImpl: params.fetchImpl,
  });

  return {
    ok: res.ok,
    text: res.text,
    modelId: res.modelId,
    providerType,
    latencyMs: res.latencyMs,
    error: res.error,
  };
}
