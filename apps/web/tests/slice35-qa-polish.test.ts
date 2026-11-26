import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentEffectivenessPanel } from "../src/components/agent-effectiveness-panel";
import { DecisionRiskBriefingCard } from "../src/components/decision-risk-briefing-card";
import { FinopsDashboard } from "../src/components/finops-dashboard";
import {
  MemoriesManager,
  stripMarkdownToPlainPreview,
} from "../src/components/memories-manager";
import { ProvidersManager } from "../src/components/providers-manager";
import { SecurityAuditConsole } from "../src/components/security-audit-console";
import {
  SkillsCatalogPanel,
  filterSkillsCatalogItems,
} from "../src/components/skills-catalog-panel";
import {
  mockAgentEffectivenessMetrics,
  mockDecisions,
  mockEntropyAuditReport,
  mockSkillsCatalog,
} from "../src/mocks/fixtures";

function renderWithQuery(node: React.ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client }, node)
  );
}

const SAMPLE_SKILLS = [
  ...mockSkillsCatalog.skills,
  {
    name: "threat-modeling-stride-fmea",
    description: "Use quando modelar ameaças STRIDE e FMEA em arquitetura.",
    version: "2.0.0",
    license: "Apache-2.0",
    phase: "architecture",
    roleCategory: "reference",
    appliesToRoles: ["architect", "security"],
    resourcesCount: 1,
    sha256: "c".repeat(64),
    verified: true,
    enabled: true,
  },
];

describe("Slice 35 — Polimento Pós-QA em Navegador Real", () => {
  test.each([
    {
      caseName: "busca textual por nome stride",
      filters: { searchQuery: "stride", phaseFilter: "all", roleCategoryFilter: "all" },
      expectedNames: ["threat-modeling-stride-fmea"],
    },
    {
      caseName: "filtro por fase verify",
      filters: { searchQuery: "", phaseFilter: "verify", roleCategoryFilter: "all" },
      expectedNames: ["secure-code-audit"],
    },
    {
      caseName: "filtro por categoria lead",
      filters: { searchQuery: "", phaseFilter: "all", roleCategoryFilter: "lead" },
      expectedNames: ["discovery-interview"],
    },
    {
      caseName: "busca sem correspondência",
      filters: { searchQuery: "inexistente-xyz", phaseFilter: "all", roleCategoryFilter: "all" },
      expectedNames: [],
    },
  ])("filterSkillsCatalogItems: $caseName", ({ filters, expectedNames }) => {
    const filtered = filterSkillsCatalogItems(SAMPLE_SKILLS, filters);
    expect(filtered.map((item) => item.name)).toEqual(expectedNames);
  });

  test.each([
    {
      input: "# Título QMD\nRegra **obrigatória** em `.uzina/DESIGN.md`.",
      expected: "Título QMD\nRegra obrigatória em .uzina/DESIGN.md.",
    },
    {
      input: "## Checklist\n- Validar *contraste* WCAG\n- Evitar `any`",
      expected: "Checklist\n• Validar contraste WCAG\n• Evitar any",
    },
  ])("stripMarkdownToPlainPreview limpa sintaxe Markdown crua", ({ input, expected }) => {
    expect(stripMarkdownToPlainPreview(input)).toBe(expected);
  });

  test("SkillsCatalogPanel renderiza filtros, contador e seletor alinhado", () => {
    const html = renderWithQuery(
      React.createElement(SkillsCatalogPanel, {
        initialCatalog: mockSkillsCatalog,
        initialEntropy: mockEntropyAuditReport,
        defaultProjectId: "proj-1",
      })
    );

    expect(html).toContain('data-testid="skills-search-input"');
    expect(html).toContain('data-testid="skills-phase-filter"');
    expect(html).toContain('data-testid="skills-role-category-filter"');
    expect(html).toContain('data-testid="skills-filtered-count"');
    expect(html).toContain(`Exibindo ${mockSkillsCatalog.skills.length} de ${mockSkillsCatalog.skills.length}`);
  });

  test("FinOpsDashboard exibe finops-by-technique-empty também quando byTechnique tem linhas zeradas", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["finops-summary"], {
      totalTokensSaved: 0,
      totalTokensBaseline: 0,
      totalTokensActual: 0,
      overallSavingsPercent: 0,
      cacheHitRate: 0,
      reworkRate: 0,
      estimatedCostSavedUsd: 0,
      totalLlmTokens: 0,
      totalLlmCostUsd: 0,
      byTechnique: [
        {
          technique: "prompt_cache",
          eventsCount: 0,
          tokensBaseline: 0,
          tokensActual: 0,
          tokensSaved: 0,
          savingsPercent: 0,
        },
      ],
      recentEvents: [],
      recentLlmCalls: [],
    });
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(FinopsDashboard)
      )
    );
    expect(html).toContain('data-testid="finops-by-technique-empty"');
    expect(html).not.toContain('data-testid="finops-technique-row"');
  });

  test("FinOpsDashboard, Decisions, Security, Providers e Memories renderizam correções visuais e copy", () => {
    const finopsHtml = renderWithQuery(React.createElement(FinopsDashboard));
    expect(finopsHtml).toContain("Economia por Técnica");
    expect(finopsHtml).toContain("whitespace-nowrap");

    const providersHtml = renderWithQuery(React.createElement(ProvidersManager));
    expect(providersHtml).not.toContain("Escolha um dos 5 cartões");
    expect(providersHtml).toContain("omni-fast");

    const memoriesHtml = renderWithQuery(React.createElement(MemoriesManager));
    expect(memoriesHtml).toContain("<code");
    expect(memoriesHtml).not.toContain("`.uzina/`");

    const securityHtml = renderWithQuery(React.createElement(SecurityAuditConsole));
    expect(securityHtml).toContain("whitespace-nowrap");

    const firstDecision = mockDecisions.items[0]!;
    const briefingHtml = renderWithQuery(
      React.createElement(DecisionRiskBriefingCard, {
        payloadJson: firstDecision.payloadJson,
      })
    );
    expect(briefingHtml).toContain('data-testid="decision-risk-briefing-card"');

    const effectivenessHtml = renderWithQuery(
      React.createElement(AgentEffectivenessPanel, {
        initialData: mockAgentEffectivenessMetrics,
      })
    );
    expect(effectivenessHtml).toContain('data-testid="effectiveness-by-role-table"');
  });

  test("agency.ts não referencia mais a aba antiga 'Estúdio & Protótipo'", () => {
    const agencyPath = path.resolve(
      process.cwd(),
      "../../packages/mastra-runtime/src/agency.ts"
    );
    const source = fs.readFileSync(agencyPath, "utf8");
    expect(source).not.toContain("Estúdio & Protótipo");
    expect(source).toContain("Estúdio Visual");
  });
});
