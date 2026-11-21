import { describe, expect, test } from "vitest";
import {
  DatabaseModeSchema,
  DecisionTypeSchema,
  DeliverableStatusSchema,
  DevelopmentStrategySchema,
  HealthDetailsSchema,
  HealthPublicSchema,
  MemoryScopeSchema,
  OrgRoleSchema,
  ProviderTypeSchema,
  RiskLevelSchema,
  SecuritySeveritySchema,
  ServiceCheckSchema,
  TacticalPatternSchema,
  TriageVerdictSchema,
} from "../src/index.js";

describe("@uzina/contracts — enums base", () => {
  test.each([
    { name: "DatabaseModeSchema", schema: DatabaseModeSchema, valid: "pglite", invalid: "sqlite" },
    {
      name: "DevelopmentStrategySchema",
      schema: DevelopmentStrategySchema,
      valid: "frontend_first_msw",
      invalid: "waterfall",
    },
    {
      name: "DeliverableStatusSchema",
      schema: DeliverableStatusSchema,
      valid: "decision_pending",
      invalid: "archived",
    },
    {
      name: "TacticalPatternSchema",
      schema: TacticalPatternSchema,
      valid: "split_lanes",
      invalid: "swarm_yolo",
    },
    { name: "RiskLevelSchema", schema: RiskLevelSchema, valid: "high", invalid: "extreme" },
    { name: "ProviderTypeSchema", schema: ProviderTypeSchema, valid: "omniroute", invalid: "bedrock" },
    { name: "MemoryScopeSchema", schema: MemoryScopeSchema, valid: "client", invalid: "global" },
    {
      name: "DecisionTypeSchema",
      schema: DecisionTypeSchema,
      valid: "stuck_intervention",
      invalid: "auto_merge",
    },
    {
      name: "SecuritySeveritySchema",
      schema: SecuritySeveritySchema,
      valid: "critical",
      invalid: "blocker",
    },
    {
      name: "TriageVerdictSchema",
      schema: TriageVerdictSchema,
      valid: "false_positive",
      invalid: "ignored",
    },
    { name: "OrgRoleSchema", schema: OrgRoleSchema, valid: "owner", invalid: "superadmin" },
  ])("$name aceita '$valid' e rejeita '$invalid'", ({ schema, valid, invalid }) => {
    expect(schema.parse(valid)).toBe(valid);
    expect(schema.safeParse(invalid).success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });
});

describe("@uzina/contracts — HealthCheck schemas", () => {
  const validTimestamp = "2026-11-21T16:00:00.000Z";

  test.each([
    {
      label: "public ok",
      payload: { status: "ok", service: "uzina-studio", timestamp: validTimestamp },
      expected: true,
    },
    {
      label: "public error",
      payload: { status: "error", service: "uzina-studio", timestamp: validTimestamp },
      expected: true,
    },
    {
      label: "status degraded não permitido no público",
      payload: { status: "degraded", service: "uzina-studio", timestamp: validTimestamp },
      expected: false,
    },
    {
      label: "service incorreto",
      payload: { status: "ok", service: "other", timestamp: validTimestamp },
      expected: false,
    },
    {
      label: "timestamp inválido",
      payload: { status: "ok", service: "uzina-studio", timestamp: "not-a-date" },
      expected: false,
    },
  ])("HealthPublicSchema — $label", ({ payload, expected }) => {
    expect(HealthPublicSchema.safeParse(payload).success).toBe(expected);
  });

  test.each([
    {
      label: "details válido pglite + ephemeral_dev",
      payload: {
        status: "ok",
        service: "uzina-studio",
        version: "0.1.0",
        timestamp: validTimestamp,
        checks: {
          database: { status: "up", mode: "pglite", latencyMs: 1.4 },
          auth: { status: "ephemeral_dev" },
        },
      },
      expected: true,
    },
    {
      label: "details válido postgres + checks opcionais Slices 1-3",
      payload: {
        status: "degraded",
        service: "uzina-studio",
        version: "0.1.0",
        timestamp: validTimestamp,
        checks: {
          database: { status: "up", mode: "postgres", latencyMs: 12.5 },
          auth: { status: "configured" },
          mastraStore: { status: "up", latencyMs: 3.2 },
          llmGateway: { status: "down" },
        },
      },
      expected: true,
    },
    {
      label: "latencyMs negativo rejeitado",
      payload: {
        status: "error",
        service: "uzina-studio",
        version: "0.1.0",
        timestamp: validTimestamp,
        checks: {
          database: { status: "down", mode: "postgres", latencyMs: -1, errorCode: "DB_TIMEOUT" },
          auth: { status: "configured" },
        },
      },
      expected: false,
    },
    {
      label: "version vazia rejeitada",
      payload: {
        status: "ok",
        service: "uzina-studio",
        version: "",
        timestamp: validTimestamp,
        checks: {
          database: { status: "up", mode: "pglite", latencyMs: 0 },
          auth: { status: "ephemeral_dev" },
        },
      },
      expected: false,
    },
  ])("HealthDetailsSchema — $label", ({ payload, expected }) => {
    expect(HealthDetailsSchema.safeParse(payload).success).toBe(expected);
  });

  test("ServiceCheckSchema rejeita latencyMs negativo", () => {
    expect(ServiceCheckSchema.safeParse({ status: "up", latencyMs: 0 }).success).toBe(true);
    expect(ServiceCheckSchema.safeParse({ status: "up", latencyMs: -0.1 }).success).toBe(false);
  });
});
