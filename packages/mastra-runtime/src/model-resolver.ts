import type { MastraModelConfig } from "@mastra/core/llm";
import {
  isPrivateOrLoopbackUrl,
  type AgencyAgentRole,
  type AgentRole,
  type ProviderType,
  type RoleBindings,
} from "@uzina/contracts";
import { decryptSecret, parseMasterKeyBuffer } from "@uzina/core";
import { providerProfiles, type UzinaDb } from "@uzina/db";
import { desc, eq } from "drizzle-orm";
import { DEFAULT_PROVIDER_MODELS } from "./llm-client.js";

export interface ResolvedOrganizationModel {
  providerProfileId: string;
  providerType: ProviderType;
  modelId: string;
  rawModelName: string;
  rawApiKey: string;
  knownSecrets: string[];
  mastraModel: {
    id: string;
    model: MastraModelConfig;
  };
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

function isProviderType(raw: string): raw is ProviderType {
  return (
    raw === "omniroute" ||
    raw === "openai_compatible" ||
    raw === "google" ||
    raw === "anthropic" ||
    raw === "ollama"
  );
}

function isOfficialProviderDefaultUrl(
  providerType: ProviderType,
  rawBaseUrl?: string | null
): boolean {
  const trimmed = rawBaseUrl?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal8080 =
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      parsed.port === "8080";
    if (providerType === "google") {
      return hostname === "generativelanguage.googleapis.com" || isLocal8080;
    }
    if (providerType === "anthropic") {
      return hostname === "api.anthropic.com" || isLocal8080;
    }
  } catch {
    return false;
  }
  return false;
}

function normalizeOllamaOpenAiUrl(rawBaseUrl?: string | null): string {
  const base = (rawBaseUrl?.trim() || "http://127.0.0.1:11434").replace(
    /\/+$/,
    ""
  );
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function stripProviderPrefix(rawModel: string): string {
  const trimmed = rawModel.trim();
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    const prefix = trimmed.slice(0, slashIdx).toLowerCase();
    if (
      prefix === "google" ||
      prefix === "anthropic" ||
      prefix === "openai" ||
      prefix === "ollama"
    ) {
      return trimmed.slice(slashIdx + 1);
    }
  }
  return trimmed.replace(/^models\//i, "");
}

export function buildMastraModelForProvider(params: {
  providerType: ProviderType;
  modelName: string;
  baseUrl?: string | null;
  apiKey: string;
}): { id: string; model: MastraModelConfig } {
  const cleanName = stripProviderPrefix(params.modelName);

  if (params.providerType === "google") {
    if (isOfficialProviderDefaultUrl("google", params.baseUrl)) {
      const fullId = `google/${cleanName}` as `${string}/${string}`;
      return {
        id: fullId,
        model: {
          id: fullId,
          model: {
            id: fullId,
            apiKey: params.apiKey,
          },
        },
      };
    }
    const customUrl = params.baseUrl!.trim().replace(/\/+$/, "");
    if (isPrivateOrLoopbackUrl(customUrl)) {
      throw new Error("SSRF_BLOCKED: baseUrl privada bloqueada para Google.");
    }
    const fullId = `openai/${cleanName}` as `${string}/${string}`;
    return {
      id: fullId,
      model: {
        id: fullId,
        url: customUrl,
        apiKey: params.apiKey,
      },
    };
  }

  if (params.providerType === "anthropic") {
    if (isOfficialProviderDefaultUrl("anthropic", params.baseUrl)) {
      const fullId = `anthropic/${cleanName}` as `${string}/${string}`;
      return {
        id: fullId,
        model: {
          id: fullId,
          model: {
            id: fullId,
            apiKey: params.apiKey,
          },
        },
      };
    }
    const customUrl = params.baseUrl!.trim().replace(/\/+$/, "");
    if (isPrivateOrLoopbackUrl(customUrl)) {
      throw new Error("SSRF_BLOCKED: baseUrl privada bloqueada para Anthropic.");
    }
    const fullId = `openai/${cleanName}` as `${string}/${string}`;
    return {
      id: fullId,
      model: {
        id: fullId,
        url: customUrl,
        apiKey: params.apiKey,
      },
    };
  }

  if (params.providerType === "ollama") {
    const ollamaUrl = normalizeOllamaOpenAiUrl(params.baseUrl);
    const fullId = `openai/${cleanName}` as `${string}/${string}`;
    return {
      id: fullId,
      model: {
        id: fullId,
        url: ollamaUrl,
        apiKey: params.apiKey || "ollama",
      },
    };
  }

  // omniroute ou openai_compatible
  const targetUrl = (
    params.baseUrl?.trim() ||
    (params.providerType === "omniroute"
      ? "http://localhost:8080/v1"
      : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");
  const fullId = `openai/${cleanName}` as `${string}/${string}`;
  return {
    id: fullId,
    model: {
      id: fullId,
      url: targetUrl,
      apiKey: params.apiKey,
    },
  };
}

export async function collectOrganizationKnownSecrets(
  db: UzinaDb,
  params: {
    organizationId: string;
    masterKey?: Buffer | string | null;
  }
): Promise<string[]> {
  if (!params.masterKey) return [];
  let keyBuf: Buffer;
  try {
    keyBuf =
      typeof params.masterKey === "string"
        ? parseMasterKeyBuffer(params.masterKey)
        : params.masterKey;
  } catch {
    return [];
  }

  const profiles = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, params.organizationId));

  const secrets: string[] = [];
  for (const profile of profiles) {
    if (!profile.encryptedApiKey || !isProviderType(profile.providerType)) {
      continue;
    }
    try {
      const raw = decryptSecret({
        encrypted: profile.encryptedApiKey,
        masterKey: keyBuf,
        organizationId: profile.organizationId,
        providerType: profile.providerType,
      });
      if (raw && raw !== "ollama" && raw.length >= 6) {
        secrets.push(raw);
      }
    } catch {
      // Ignora perfil inválido na coleta de redação
    }
  }
  return secrets;
}

export async function resolveOrganizationModelConfig(
  db: UzinaDb,
  params: {
    organizationId: string;
    agentRole: AgencyAgentRole | AgentRole;
    masterKey?: Buffer | string | null;
    preferredProviderId?: string;
  }
): Promise<ResolvedOrganizationModel | null> {
  const profiles = await db
    .select()
    .from(providerProfiles)
    .where(eq(providerProfiles.organizationId, params.organizationId))
    .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.updatedAt));

  if (profiles.length === 0) {
    return null;
  }

  const chosen = params.preferredProviderId
    ? profiles.find((p) => p.id === params.preferredProviderId) ?? profiles[0]!
    : profiles.find((p) => p.isDefault) ?? profiles[0]!;

  if (!isProviderType(chosen.providerType)) {
    return null;
  }

  let keyBuf: Buffer | null = null;
  if (params.masterKey) {
    try {
      keyBuf =
        typeof params.masterKey === "string"
          ? parseMasterKeyBuffer(params.masterKey)
          : params.masterKey;
    } catch {
      keyBuf = null;
    }
  }

  let apiKey = "";
  if (chosen.providerType === "ollama") {
    apiKey = "ollama";
  }

  if (chosen.encryptedApiKey && keyBuf) {
    try {
      apiKey = decryptSecret({
        encrypted: chosen.encryptedApiKey,
        masterKey: keyBuf,
        organizationId: chosen.organizationId,
        providerType: chosen.providerType,
      });
    } catch {
      if (chosen.providerType !== "ollama") {
        return null;
      }
    }
  } else if (chosen.providerType !== "ollama") {
    return null;
  }

  const bindingKey: AgentRole =
    params.agentRole === "orchestrator" ||
    params.agentRole === "product_discovery" ||
    params.agentRole === "software_architect" ||
    params.agentRole === "ux_designer" ||
    params.agentRole === "tech_lead" ||
    params.agentRole === "qa_appsec"
      ? mapAgencyRoleToBindingKey(params.agentRole)
      : params.agentRole;

  const bindings = (chosen.roleBindingsJson ?? {}) as RoleBindings;
  const boundModel =
    (params.agentRole === "qa_appsec"
      ? bindings.verifier?.modelId ?? bindings.security?.modelId
      : bindings[bindingKey]?.modelId) ??
    (bindingKey === "architect" || bindingKey === "security"
      ? DEFAULT_PROVIDER_MODELS[chosen.providerType].tier3
      : DEFAULT_PROVIDER_MODELS[chosen.providerType].tier2);

  const mastraModel = buildMastraModelForProvider({
    providerType: chosen.providerType,
    modelName: boundModel,
    baseUrl: chosen.baseUrl,
    apiKey,
  });

  const knownSecrets =
    apiKey && apiKey !== "ollama" && apiKey.length >= 6 ? [apiKey] : [];

  return {
    providerProfileId: chosen.id,
    providerType: chosen.providerType,
    modelId: mastraModel.id,
    rawModelName: stripProviderPrefix(boundModel),
    rawApiKey: apiKey,
    knownSecrets,
    mastraModel,
  };
}

export interface TenantModelResolver {
  preloadOrganizationProviders: (
    organizationId: string
  ) => Promise<ReadonlySet<ProviderType>>;
  resolveForRole: (
    organizationId: string,
    agentRole: AgencyAgentRole | AgentRole
  ) => Promise<ResolvedOrganizationModel | null>;
  resolveOmModel: (
    organizationId: string,
    requestedModelId: string
  ) => Promise<MastraModelConfig>;
}

export function createTenantModelResolver(deps: {
  db: UzinaDb;
  masterKey?: Buffer | string | null;
  modelOverride?: MastraModelConfig;
}): TenantModelResolver {
  return {
    async preloadOrganizationProviders(
      organizationId: string
    ): Promise<ReadonlySet<ProviderType>> {
      const profiles = await deps.db
        .select({
          providerType: providerProfiles.providerType,
          encryptedApiKey: providerProfiles.encryptedApiKey,
        })
        .from(providerProfiles)
        .where(eq(providerProfiles.organizationId, organizationId));

      const set = new Set<ProviderType>();
      for (const p of profiles) {
        if (!isProviderType(p.providerType)) continue;
        if (p.providerType === "ollama") {
          set.add("ollama");
          continue;
        }
        if (p.encryptedApiKey && deps.masterKey) {
          set.add(p.providerType);
        }
      }
      return set;
    },

    async resolveForRole(
      organizationId: string,
      agentRole: AgencyAgentRole | AgentRole
    ) {
      return resolveOrganizationModelConfig(deps.db, {
        organizationId,
        agentRole,
        masterKey: deps.masterKey,
      });
    },

    async resolveOmModel(
      organizationId: string,
      requestedModelId: string
    ): Promise<MastraModelConfig> {
      if (deps.modelOverride) {
        return deps.modelOverride;
      }

      const profiles = await deps.db
        .select()
        .from(providerProfiles)
        .where(eq(providerProfiles.organizationId, organizationId))
        .orderBy(desc(providerProfiles.isDefault), desc(providerProfiles.updatedAt));

      const slashIdx = requestedModelId.indexOf("/");
      const requestedProvider =
        slashIdx > 0 ? requestedModelId.slice(0, slashIdx).toLowerCase() : "";

      const matchingProfile =
        profiles.find((p) => p.providerType === requestedProvider) ??
        profiles.find((p) => p.isDefault) ??
        profiles[0];

      if (!matchingProfile || !isProviderType(matchingProfile.providerType)) {
        throw new Error(
          `OM_PROVIDER_UNAVAILABLE: Organização '${organizationId}' sem provedor ativo.`
        );
      }

      const resolved = await resolveOrganizationModelConfig(deps.db, {
        organizationId,
        agentRole: "orchestrator",
        masterKey: deps.masterKey,
        preferredProviderId: matchingProfile.id,
      });

      if (!resolved) {
        throw new Error(
          `OM_CREDENTIAL_UNAVAILABLE: Não foi possível resolver credencial do cofre para '${matchingProfile.providerType}'.`
        );
      }

      // Se o OM pediu um modelo flash/leve específico compatível com o provedor, preserva o nome; caso contrário usa o tier2 configurado
      const useRequestedName =
        requestedProvider === resolved.providerType &&
        requestedModelId.includes("/");
      const chosenName = useRequestedName
        ? requestedModelId
        : DEFAULT_PROVIDER_MODELS[resolved.providerType].tier2;

      return buildMastraModelForProvider({
        providerType: resolved.providerType,
        modelName: chosenName,
        baseUrl: matchingProfile.baseUrl,
        apiKey: resolved.rawApiKey,
      }).model;
    },
  };
}
