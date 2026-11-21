import { describe, expect, test } from "vitest";
import type { DesignAsset } from "@uzina/contracts";
import { generateDesignMdContract } from "../src/design-md.js";

const NOW = "2026-11-21T18:00:00.000Z";

function makeAsset(overrides: Partial<DesignAsset> = {}): DesignAsset {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    deliverableId: null,
    assetType: "reference_url",
    title: "Linear Cockpit Reference",
    sourceUrl: "https://linear.app",
    assetUrl: null,
    mimeType: null,
    sizeBytes: null,
    intentionTags: ["copiar:densidade-compacta", "ignorar:roxo-neon"],
    notes: "Manter foco em bordas 1px",
    approved: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("generateDesignMdContract — .uzina/DESIGN.md", () => {
  test("consolida moodboard, intentionTags (copiar vs ignorar), tokens WCAG >= 4.5:1 e anti-padrões", () => {
    const md = generateDesignMdContract({
      projectName: "Faturamento Pro",
      themePreference: "dual_theme",
      assets: [
        makeAsset(),
        makeAsset({
          id: "33333333-3333-4333-8333-333333333333",
          assetType: "moodboard_image",
          title: "Tabela Financeira Dark",
          sourceUrl: null,
          assetUrl: "/api/assets/33333333-3333-4333-8333-333333333333",
          mimeType: "image/png",
          intentionTags: ["tabular-nums", "copiar:sem-sombras"],
        }),
      ],
      notes: "Priorizar contraste alto em números monetários",
    });

    expect(md).toContain("# Contrato Visual — Faturamento Pro");
    expect(md).toContain("WCAG >= 4.5:1");
    expect(md).toContain("tabular-nums");
    expect(md).toContain("Linear Cockpit Reference");
    expect(md).toContain("ignorar:roxo-neon");
    expect(md).toContain("5 Estados Obrigatórios");
    expect(md).toContain("Priorizar contraste alto em números monetários");
  });

  test("gera contrato completo mesmo sem referências prévias cadastradas", () => {
    const md = generateDesignMdContract({
      projectName: "Painel Minimal",
      themePreference: "industrial_dark",
      assets: [],
    });

    expect(md).toContain("industrial_dark");
    expect(md).toContain("--accent");
    expect(md).toContain("Zero \"AI Slop\"");
  });
});
