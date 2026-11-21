import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { routeDevelopmentStrategy } from "../src/strategy-router.js";

describe("StrategyRouter — 6 estratégias & padrão tático (Tests as Data)", () => {
  test.each([
    {
      label: "override explícito tem prioridade máxima",
      input: {
        title: "UI + Schema",
        hasUi: true,
        isBrownfield: true,
        maturityScore: 15,
        overrideStrategy: "spike_first" as const,
      },
      expectedStrategy: "spike_first",
    },
    {
      label: "brownfield com maturityScore < 40 seleciona characterization_strangler",
      input: {
        title: "Refatorar legado fiscal",
        hasUi: true,
        isBrownfield: true,
        maturityScore: 28,
      },
      expectedStrategy: "characterization_strangler",
    },
    {
      label: "integração externa desconhecida seleciona spike_first",
      input: {
        title: "Conector ERP desconhecido",
        hasUi: false,
        isBrownfield: false,
        hasExternalUnknownIntegration: true,
      },
      expectedStrategy: "spike_first",
    },
    {
      label: "entrega com UI seleciona frontend_first_msw",
      input: {
        title: "Dashboard de Métricas",
        hasUi: true,
        isBrownfield: false,
      },
      expectedStrategy: "frontend_first_msw",
    },
    {
      label: "mudança estrutural de schema sem UI seleciona data_schema_first",
      input: {
        title: "Nova tabela de auditoria",
        hasUi: false,
        isBrownfield: false,
        hasDatabaseSchemaChanges: true,
      },
      expectedStrategy: "data_schema_first",
    },
    {
      label: "domínio puro sem API seleciona domain_first",
      input: {
        title: "Motor de regras tributárias",
        hasUi: false,
        isBrownfield: false,
        isPureDomainLogic: true,
        isApiIntegration: false,
      },
      expectedStrategy: "domain_first",
    },
    {
      label: "fallback API / integração usa api_contract_first",
      input: {
        title: "Webhook REST parceiro",
        hasUi: false,
        isBrownfield: false,
        isApiIntegration: true,
      },
      expectedStrategy: "api_contract_first",
    },
  ])("$label -> $expectedStrategy", ({ input, expectedStrategy }) => {
    const out = routeDevelopmentStrategy(input);
    expect(out.developmentStrategy).toBe(expectedStrategy);
    expect(out.verticalSlices.length).toBeGreaterThanOrEqual(1);
    expect(out.rationale.length).toBeGreaterThan(10);
  });

  test("seleciona split_lanes apenas quando candidateSlices têm allowedPaths disjuntos e cai para single_agent se houver sobreposição", () => {
    const disjoint = routeDevelopmentStrategy({
      title: "Módulo dual",
      hasUi: true,
      candidateSlices: [
        {
          name: "API Billing",
          objective: "Endpoints",
          allowedPaths: ["apps/web/src/app/api/billing"],
          sequential: false,
        },
        {
          name: "UI Billing",
          objective: "Tela",
          allowedPaths: ["apps/web/src/components/billing"],
          sequential: false,
        },
      ],
    });
    expect(disjoint.tacticalPattern).toBe("split_lanes");
    expect(disjoint.sharedPathsDetected).toEqual([]);

    const overlapping = routeDevelopmentStrategy({
      title: "Módulo acoplado",
      hasUi: true,
      candidateSlices: [
        {
          name: "Slice A",
          objective: "Schema + rota",
          allowedPaths: ["packages/db/src/schema", "apps/web/src/app/api"],
          sequential: false,
        },
        {
          name: "Slice B",
          objective: "Outro schema",
          allowedPaths: ["packages/db/src/schema/billing.ts"],
          sequential: false,
        },
      ],
    });
    expect(overlapping.tacticalPattern).toBe("single_agent");
    expect(overlapping.sharedPathsDetected).toContain(
      "packages/db/src/schema/billing.ts"
    );
    expect(overlapping.verticalSlices.every((s) => s.sequential)).toBe(true);
  });

  test("subpaths browser-safe não possuem imports node:*", () => {
    for (const file of ["strategy-router.ts", "discovery.ts", "design-md.ts"]) {
      const fullPath = path.resolve(import.meta.dirname, "..", "src", file);
      const src = fs.readFileSync(fullPath, "utf8");
      expect(src).not.toMatch(/from\s+["']node:/);
    }
  });
});
