import {
  StrategyRouterInputSchema,
  StrategyRouterOutputSchema,
  type DevelopmentStrategy,
  type StrategyRouterInput,
  type StrategyRouterOutput,
  type VerticalSlicePlan,
} from "@uzina/contracts";

function normalizePosixPath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function pathsOverlap(a: string, b: string): boolean {
  const normA = normalizePosixPath(a);
  const normB = normalizePosixPath(b);
  if (!normA || !normB) {
    return false;
  }
  return (
    normA === normB ||
    normA.startsWith(`${normB}/`) ||
    normB.startsWith(`${normA}/`)
  );
}

function buildDefaultSlices(
  strategy: DevelopmentStrategy,
  hasUi: boolean
): VerticalSlicePlan[] {
  const slices: VerticalSlicePlan[] = [
    {
      name: "Contratos & Domínio",
      objective: `Definir contratos Zod e regras centrais (${strategy}).`,
      allowedPaths: ["packages/contracts/src", "packages/core/src"],
      sequential: true,
    },
    {
      name: "Persistência & API",
      objective: "Modelar schema Drizzle/PGlite e rotas validadas por Zod.",
      allowedPaths: ["packages/db/src", "apps/web/src/app/api"],
      sequential: true,
    },
  ];

  if (hasUi) {
    slices.push({
      name: "Cockpit UI & MSW",
      objective: "Implementar interface OKLCH + handlers MSW alinhados aos contratos.",
      allowedPaths: ["apps/web/src/components", "apps/web/src/mocks"],
      sequential: false,
    });
  }

  return slices;
}

export function routeDevelopmentStrategy(
  rawInput: StrategyRouterInput
): StrategyRouterOutput {
  const input = StrategyRouterInputSchema.parse(rawInput);

  let developmentStrategy: DevelopmentStrategy;
  let rationale: string;

  if (input.overrideStrategy) {
    developmentStrategy = input.overrideStrategy;
    rationale = `Estratégia definida explicitamente por override humano/projeto: ${developmentStrategy}.`;
  } else if (input.isBrownfield && (input.maturityScore ?? 0) < 40) {
    developmentStrategy = "characterization_strangler";
    rationale = `Repositório brownfield com maturityScore ${input.maturityScore ?? 0}/100 (< 40): exige testes de caracterização antes de refatorar.`;
  } else if (input.hasExternalUnknownIntegration) {
    developmentStrategy = "spike_first";
    rationale =
      "Integração externa desconhecida ou de alto risco técnico: validar viabilidade via spike isolado primeiro.";
  } else if (input.hasUi) {
    developmentStrategy = "frontend_first_msw";
    rationale =
      "Entrega possui interface de usuário: construir UI e contratos MSW antes da integração final.";
  } else if (input.hasDatabaseSchemaChanges) {
    developmentStrategy = "data_schema_first";
    rationale =
      "Alteração estrutural de persistência sem interface primária: modelar Drizzle schema e migrações primeiro.";
  } else if (input.isPureDomainLogic && !input.isApiIntegration) {
    developmentStrategy = "domain_first";
    rationale =
      "Lógica pura de domínio/motor sem acoplamento HTTP: validar com Tests as Data antes da casca.";
  } else {
    developmentStrategy = "api_contract_first";
    rationale =
      "Entrega orientada a serviço/API: travar contratos OpenAPI/Zod antes dos adaptadores.";
  }

  const slices =
    input.candidateSlices && input.candidateSlices.length > 0
      ? input.candidateSlices
      : buildDefaultSlices(developmentStrategy, input.hasUi);

  const sharedPaths = new Set<string>();
  for (let i = 0; i < slices.length; i++) {
    for (let j = i + 1; j < slices.length; j++) {
      const sliceA = slices[i]!;
      const sliceB = slices[j]!;
      for (const pA of sliceA.allowedPaths) {
        for (const pB of sliceB.allowedPaths) {
          if (pathsOverlap(pA, pB)) {
            const deeper =
              normalizePosixPath(pA).length >= normalizePosixPath(pB).length
                ? normalizePosixPath(pA)
                : normalizePosixPath(pB);
            sharedPaths.add(deeper);
          }
        }
      }
    }
  }

  const hasOverlap = sharedPaths.size > 0;
  const canSplitLanes = slices.length >= 2 && !hasOverlap;

  const finalSlices: VerticalSlicePlan[] = slices.map((slice) => ({
    ...slice,
    sequential: hasOverlap ? true : slice.sequential,
  }));

  return StrategyRouterOutputSchema.parse({
    developmentStrategy,
    tacticalPattern: canSplitLanes ? "split_lanes" : "single_agent",
    rationale,
    verticalSlices: finalSlices,
    sharedPathsDetected: Array.from(sharedPaths),
  });
}
