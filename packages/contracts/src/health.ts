import { z } from "zod";
import { DatabaseModeSchema } from "./enums.js";

export const ServiceCheckSchema = z.object({
  status: z.enum(["up", "down", "not_configured"]),
  latencyMs: z.number().nonnegative().optional(),
});
export type ServiceCheck = z.infer<typeof ServiceCheckSchema>;

export const DatabaseHealthCheckSchema = z.object({
  status: z.enum(["up", "down"]),
  mode: DatabaseModeSchema,
  latencyMs: z.number().nonnegative(),
  errorCode: z.string().min(1).optional(),
});
export type DatabaseHealthCheck = z.infer<typeof DatabaseHealthCheckSchema>;

export const AuthHealthCheckSchema = z.object({
  status: z.enum(["configured", "ephemeral_dev"]),
});
export type AuthHealthCheck = z.infer<typeof AuthHealthCheckSchema>;

export const DockerHealthCheckSchema = z.object({
  ready: z.boolean(),
  version: z.string().nullable(),
  errorCode: z.string().optional(),
});
export type DockerHealthCheck = z.infer<typeof DockerHealthCheckSchema>;

export const HealthPublicSchema = z.object({
  status: z.enum(["ok", "error"]),
  service: z.literal("uzina-studio"),
  timestamp: z.iso.datetime(),
});
export type HealthPublic = z.infer<typeof HealthPublicSchema>;

export const HealthDetailsSchema = z.object({
  status: z.enum(["ok", "degraded", "error"]),
  service: z.literal("uzina-studio"),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: DatabaseHealthCheckSchema,
    auth: AuthHealthCheckSchema,
    mastraStore: ServiceCheckSchema.optional(),
    llmGateway: ServiceCheckSchema.optional(),
    docker: DockerHealthCheckSchema.optional(),
  }),
});
export type HealthDetails = z.infer<typeof HealthDetailsSchema>;
