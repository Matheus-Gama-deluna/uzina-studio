import { z } from "zod";
import { AgentRoleSchema, ProviderTypeSchema } from "./enums.js";
import { HttpUrlSchema, isPrivateOrLoopbackUrl } from "./errors.js";

export const RoleBindingEntrySchema = z.object({
  modelId: z.string().trim().min(1).max(160),
});
export type RoleBindingEntry = z.infer<typeof RoleBindingEntrySchema>;

export const RoleBindingsSchema = z.partialRecord(
  AgentRoleSchema,
  RoleBindingEntrySchema
);
export type RoleBindings = z.infer<typeof RoleBindingsSchema>;

export const ModelPricingRateSchema = z
  .object({
    inputPer1MUsd: z.number().min(0).max(1000),
    outputPer1MUsd: z.number().min(0).max(1000),
    cacheReadPer1MUsd: z.number().min(0).max(1000).optional(),
  })
  .strict();
export type ModelPricingRate = z.infer<typeof ModelPricingRateSchema>;

export const CustomModelPricingMapSchema = z.record(
  z.string().trim().min(1).max(160),
  ModelPricingRateSchema
);
export type CustomModelPricingMap = z.infer<typeof CustomModelPricingMapSchema>;

export const ProviderProfilePublicSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string().min(1).max(120),
    providerType: ProviderTypeSchema,
    baseUrl: HttpUrlSchema.nullable(),
    hasApiKey: z.boolean(),
    keyPreview: z.string().min(3).max(32).nullable(),
    roleBindings: RoleBindingsSchema,
    customPricing: CustomModelPricingMapSchema.default({}),
    isDefault: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProviderProfilePublic = z.infer<typeof ProviderProfilePublicSchema>;

export function isAllowedGitHubApiBaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "api.github.com" &&
      (parsed.port === "" || parsed.port === "443") &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export const CreateProviderProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    providerType: ProviderTypeSchema,
    baseUrl: HttpUrlSchema.nullable().optional(),
    apiKey: z.string().trim().min(4).max(512).optional(),
    roleBindings: RoleBindingsSchema.default({}),
    customPricing: CustomModelPricingMapSchema.optional(),
    isDefault: z.boolean().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.providerType !== "ollama" && !val.apiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "apiKey é obrigatória para provedores que não sejam Ollama",
      });
    }
    if (
      (val.providerType === "omniroute" ||
        val.providerType === "openai_compatible" ||
        val.providerType === "ollama") &&
      !val.baseUrl
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "baseUrl é obrigatória para OmniRoute, OpenAI-compatible e Ollama",
      });
    }
    if (
      (val.providerType === "google" || val.providerType === "anthropic") &&
      val.baseUrl &&
      isPrivateOrLoopbackUrl(val.baseUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "Provedores cloud (Google/Anthropic) não podem apontar para endereços privados ou loopback.",
      });
    }
    if (
      val.providerType === "github_pat" &&
      val.baseUrl &&
      !isAllowedGitHubApiBaseUrl(val.baseUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "GitHub PAT aceita exclusivamente https://api.github.com como Base URL.",
      });
    }
  });
export type CreateProviderProfileInput = z.infer<
  typeof CreateProviderProfileSchema
>;

export const UpdateProviderProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    baseUrl: HttpUrlSchema.nullable().optional(),
    apiKey: z.string().trim().min(4).max(512).optional(),
    roleBindings: RoleBindingsSchema.optional(),
    customPricing: CustomModelPricingMapSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type UpdateProviderProfileInput = z.infer<
  typeof UpdateProviderProfileSchema
>;

export const ProviderProfileListResponseSchema = z.object({
  items: z.array(ProviderProfilePublicSchema),
});
export type ProviderProfileListResponse = z.infer<
  typeof ProviderProfileListResponseSchema
>;

export const TestProviderConnectionRequestSchema = z
  .object({
    providerId: z.uuid().optional(),
    providerType: ProviderTypeSchema.optional(),
    baseUrl: HttpUrlSchema.nullable().optional(),
    apiKey: z.string().trim().min(4).max(512).optional(),
    modelId: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.providerId && !val.providerType) {
      ctx.addIssue({
        code: "custom",
        path: ["providerType"],
        message:
          "Informe providerId de um perfil salvo ou providerType para teste direto.",
      });
    }
    if (
      (val.providerType === "google" || val.providerType === "anthropic") &&
      val.baseUrl &&
      isPrivateOrLoopbackUrl(val.baseUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "Provedores cloud (Google/Anthropic) não podem apontar para endereços privados ou loopback.",
      });
    }
    if (
      val.providerType === "github_pat" &&
      val.baseUrl &&
      !isAllowedGitHubApiBaseUrl(val.baseUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "GitHub PAT aceita exclusivamente https://api.github.com como Base URL.",
      });
    }
  });
export type TestProviderConnectionRequest = z.infer<
  typeof TestProviderConnectionRequestSchema
>;

export const TestProviderConnectionResponseSchema = z
  .object({
    ok: z.boolean(),
    providerType: ProviderTypeSchema,
    modelId: z.string().min(1).max(160),
    latencyMs: z.number().int().min(0),
    replyPreview: z.string().max(400).nullable(),
    error: z.string().max(400).nullable(),
  })
  .strict();
export type TestProviderConnectionResponse = z.infer<
  typeof TestProviderConnectionResponseSchema
>;
