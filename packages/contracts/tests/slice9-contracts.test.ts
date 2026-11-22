import { describe, expect, test } from "vitest";
import {
  CreatePrototypeRequestSchema,
  DesignTokensW3CSchema,
  StitchMcpSyncRequestSchema,
  UpdatePrototypeApprovalSchema,
  WorkflowGateTypeSchema,
} from "../src/index.js";

describe("Slice 9 contracts — Visual Studio 3 Níveis & Google Stitch", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  test.each([
    {
      name: "CreatePrototypeRequest nível 3 stitch_import",
      schema: CreatePrototypeRequestSchema,
      input: {
        title: "Checkout Dashboard",
        level: 3,
        source: "stitch_import",
        html: "<main class='bg-slate-950 p-6 rounded-xl'>OK</main>",
      },
      ok: true,
    },
    {
      name: "CreatePrototypeRequest nível 1 wireframe nativo",
      schema: CreatePrototypeRequestSchema,
      input: {
        title: "Fluxo Onboarding",
        level: 1,
        source: "native",
        specSummary: "Login -> Dashboard -> Aprovação",
      },
      ok: true,
    },
    {
      name: "CreatePrototypeRequest rejeita nível 4 inválido",
      schema: CreatePrototypeRequestSchema,
      input: { title: "Inválido", level: 4 },
      ok: false,
    },
    {
      name: "CreatePrototypeRequest rejeita chave extra (.strict)",
      schema: CreatePrototypeRequestSchema,
      input: { title: "Strict", organizationId: validUuid },
      ok: false,
    },
    {
      name: "UpdatePrototypeApproval válido",
      schema: UpdatePrototypeApprovalSchema,
      input: { approved: true, syncDesignMd: true },
      ok: true,
    },
    {
      name: "StitchMcpSyncRequest list_screens padrão",
      schema: StitchMcpSyncRequestSchema,
      input: {},
      ok: true,
    },
    {
      name: "StitchMcpSyncRequest import_screen válido",
      schema: StitchMcpSyncRequestSchema,
      input: { action: "import_screen", screenId: "scr-01", title: "Home" },
      ok: true,
    },
  ])("$name", ({ schema, input, ok }) => {
    expect(schema.safeParse(input).success).toBe(ok);
  });

  test("valida prototype_approve em WorkflowGateTypeSchema e DesignTokensW3CSchema", () => {
    expect(WorkflowGateTypeSchema.safeParse("prototype_approve").success).toBe(
      true
    );
    expect(
      DesignTokensW3CSchema.safeParse({
        color: { primary: { $value: "#38bdf8", $type: "color" } },
        typography: { sans: { $value: "Inter, sans-serif", $type: "fontFamily" } },
        spacing: { md: { $value: "1rem", $type: "dimension" } },
        radius: { lg: { $value: "0.5rem", $type: "dimension" } },
      }).success
    ).toBe(true);
  });
});
