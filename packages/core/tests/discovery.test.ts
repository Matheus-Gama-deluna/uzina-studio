import { describe, expect, test } from "vitest";
import {
  buildDiscoveryQuestions,
  consolidateDiscoverySummary,
} from "../src/discovery.js";

describe("Discovery Interview (5 Pilares, máx. 3 rodadas / 4 perguntas)", () => {
  test("pré-leitura omite pergunta de UI quando hasUi já foi definido explicitamente e emite 1-4 perguntas com default", () => {
    const round1 = buildDiscoveryQuestions({
      roundNumber: 1,
      title: "Portal de Faturas",
      description: "Emitir faturas mensais para clientes B2B",
      hasUiKnown: true,
      hasUiValue: true,
      previousAnswers: [],
    });

    expect(round1.roundNumber).toBe(1);
    expect(round1.questions.length).toBeGreaterThanOrEqual(1);
    expect(round1.questions.length).toBeLessThanOrEqual(4);
    expect(round1.coveredPillars).toContain("ui_ux_requirement");
    expect(
      round1.questions.some((q) => q.pillar === "ui_ux_requirement")
    ).toBe(false);

    for (const q of round1.questions) {
      expect(q.options).toContain(q.recommendedOption);
    }
  });

  test("emite pelo menos 1 pergunta de confirmação final quando todos os pilares já tiverem respostas", () => {
    const answers = [
      {
        questionId: "q-obj",
        pillar: "objective_and_user" as const,
        answer: "Gestor financeiro",
      },
      {
        questionId: "q-flow",
        pillar: "critical_flows_and_exceptions" as const,
        answer: "Emissão e cancelamento",
      },
      {
        questionId: "q-tech",
        pillar: "technical_constraints_and_data" as const,
        answer: "PGlite/Postgres + Zod",
      },
      {
        questionId: "q-ui",
        pillar: "ui_ux_requirement" as const,
        answer: "Sim, possui interface web",
      },
      {
        questionId: "q-acc",
        pillar: "acceptance_and_out_of_scope" as const,
        answer: "Testes unitários e contrato verde",
      },
    ];

    const round2 = buildDiscoveryQuestions({
      roundNumber: 2,
      title: "Portal de Faturas",
      previousAnswers: answers,
    });
    expect(round2.questions.length).toBeGreaterThanOrEqual(1);
    expect(round2.coveredPillars).toHaveLength(5);
  });

  test("consolidateDiscoverySummary gera specMarkdown estruturado e premissas rastreáveis", () => {
    const summary = consolidateDiscoverySummary({
      title: "Motor de Notificações",
      description: "Disparar alertas de pipeline",
      hasUi: false,
      answers: [
        {
          questionId: "q-obj",
          pillar: "objective_and_user",
          answer: "Desenvolvedor acompanhando build",
        },
        {
          questionId: "q-acc",
          pillar: "acceptance_and_out_of_scope",
          answer: "Latência < 2s; fora de escopo: SMS",
        },
      ],
    });

    expect(summary.hasUi).toBe(false);
    expect(summary.objective).toContain("Motor de Notificações");
    expect(summary.specMarkdown).toContain("# Especificação: Motor de Notificações");
    expect(summary.specMarkdown).toContain("## Premissas Assumidas");
    expect(summary.assumptions.some((a) => a.source === "user_answer")).toBe(true);
    expect(
      summary.assumptions.some((a) => a.source === "recommended_default")
    ).toBe(true);
  });
});
