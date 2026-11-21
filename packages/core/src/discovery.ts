import {
  DiscoveryRoundSchema,
  DiscoverySummarySchema,
  type DiscoveryAnswer,
  type DiscoveryAssumption,
  type DiscoveryPillarKey,
  type DiscoveryQuestion,
  type DiscoveryRound,
  type DiscoverySummary,
} from "@uzina/contracts";

export interface BuildDiscoveryQuestionsInput {
  roundNumber: number;
  title: string;
  description?: string | null;
  hasUiKnown?: boolean;
  hasUiValue?: boolean;
  previousAnswers: readonly DiscoveryAnswer[];
  brownfieldSummary?: string;
}

const PILLAR_QUESTION_BANK: Record<
  DiscoveryPillarKey,
  (title: string) => DiscoveryQuestion
> = {
  objective_and_user: (title) => ({
    id: "q-objective-user",
    pillar: "objective_and_user",
    prompt: `Qual persona principal vai operar '${title}' e qual resultado mensurável é esperado?`,
    recommendedOption: "Operador técnico / time interno com fluxo auditável end-to-end",
    options: [
      "Operador técnico / time interno com fluxo auditável end-to-end",
      "Cliente final externo em portal self-service",
      "Gestor executivo acompanhando entregas e aprovações",
    ],
  }),
  critical_flows_and_exceptions: () => ({
    id: "q-flows-exceptions",
    pillar: "critical_flows_and_exceptions",
    prompt: "Quais fluxos críticos e cenários de falha devem ter recuperação explícita?",
    recommendedOption: "Validação estrita Zod + rollback/pausa segura + erro acionável",
    options: [
      "Validação estrita Zod + rollback/pausa segura + erro acionável",
      "Apenas caminho feliz com log de erro",
      "Processamento assíncrono em fila com retry automático",
    ],
  }),
  technical_constraints_and_data: () => ({
    id: "q-tech-data",
    pillar: "technical_constraints_and_data",
    prompt: "Quais restrições técnicas de persistência, segurança e integrações se aplicam?",
    recommendedOption: "Drizzle PGlite/Postgres + RBAC multi-tenant + zero segredos expostos",
    options: [
      "Drizzle PGlite/Postgres + RBAC multi-tenant + zero segredos expostos",
      "Somente módulo de domínio puro sem banco de dados",
      "Integração com API REST externa usando cofre AES-256-GCM",
    ],
  }),
  ui_ux_requirement: () => ({
    id: "q-ui-ux",
    pillar: "ui_ux_requirement",
    prompt: "Esta entrega requer telas web / componentes visuais no Cockpit (`has_ui`)?",
    recommendedOption: "Sim, requer interface web seguindo .uzina/DESIGN.md",
    options: [
      "Sim, requer interface web seguindo .uzina/DESIGN.md",
      "Não, entrega exclusivamente backend / CLI / domínio",
    ],
  }),
  acceptance_and_out_of_scope: () => ({
    id: "q-acceptance-scope",
    pillar: "acceptance_and_out_of_scope",
    prompt: "Quais critérios objetivos definem pronto (DoD) e o que fica fora de escopo?",
    recommendedOption: "Contratos Zod + testes automatizados antes do build + verificação limpa",
    options: [
      "Contratos Zod + testes automatizados antes do build + verificação limpa",
      "Protótipo rápido validado manualmente em navegador",
      "Pacote completo com Docker e migração de dados",
    ],
  }),
};

export function buildDiscoveryQuestions(
  input: BuildDiscoveryQuestionsInput
): DiscoveryRound {
  const roundNumber = Math.max(1, Math.min(3, Math.trunc(input.roundNumber)));
  const answeredPillars = new Set<DiscoveryPillarKey>(
    input.previousAnswers.map((a) => a.pillar)
  );

  if (input.hasUiKnown) {
    answeredPillars.add("ui_ux_requirement");
  }

  const allPillars: DiscoveryPillarKey[] = [
    "objective_and_user",
    "critical_flows_and_exceptions",
    "technical_constraints_and_data",
    "ui_ux_requirement",
    "acceptance_and_out_of_scope",
  ];

  const missingPillars = allPillars.filter((p) => !answeredPillars.has(p));
  const questions: DiscoveryQuestion[] = missingPillars
    .slice(0, 4)
    .map((pillar) => PILLAR_QUESTION_BANK[pillar](input.title));

  // Garante min(1) no DiscoveryRoundSchema quando os 5 pilares ja estiverem cobertos
  if (questions.length === 0) {
    questions.push({
      id: `q-confirm-round-${roundNumber}`,
      pillar: "acceptance_and_out_of_scope",
      prompt: `Todos os 5 pilares para '${input.title}' foram cobertos (${input.hasUiValue ? "com UI" : "sem UI"}). Confirma seguir com este resumo e tabela de premissas para o Blueprint?`,
      recommendedOption: "Confirmar resumo e gerar Blueprint técnico",
      options: [
        "Confirmar resumo e gerar Blueprint técnico",
        "Ajustar critérios de aceite e restrições antes do Blueprint",
      ],
    });
  }

  return DiscoveryRoundSchema.parse({
    roundNumber,
    questions,
    answers: [...input.previousAnswers],
    coveredPillars: Array.from(answeredPillars),
  });
}

export interface ConsolidateDiscoveryInput {
  title: string;
  description?: string | null;
  hasUi: boolean;
  answers: readonly DiscoveryAnswer[];
  brownfieldSummary?: string;
}

export function consolidateDiscoverySummary(
  input: ConsolidateDiscoveryInput
): DiscoverySummary {
  const byPillar = new Map<DiscoveryPillarKey, string>();
  for (const answer of input.answers) {
    byPillar.set(answer.pillar, answer.answer);
  }

  const assumptions: DiscoveryAssumption[] = [];
  const resolvePillar = (
    pillar: DiscoveryPillarKey,
    keyLabel: string,
    defaultVal: string
  ): string => {
    const userAns = byPillar.get(pillar);
    if (userAns) {
      assumptions.push({
        key: keyLabel,
        value: userAns,
        source: "user_answer",
      });
      return userAns;
    }
    assumptions.push({
      key: keyLabel,
      value: defaultVal,
      source: "recommended_default",
    });
    return defaultVal;
  };

  const targetUser = resolvePillar(
    "objective_and_user",
    "Persona e Objetivo",
    "Operador do Uzina Studio com rastreabilidade completa"
  );
  const criticalFlow = resolvePillar(
    "critical_flows_and_exceptions",
    "Fluxos Críticos e Exceções",
    "Validação Zod na borda e tratamento explícito de falhas sem perda de estado"
  );
  const techConstraint = resolvePillar(
    "technical_constraints_and_data",
    "Restrições Técnicas",
    "Drizzle ORM (PGlite/Postgres), RBAC multi-tenant e zero segredos em texto claro"
  );
  const acceptanceText = resolvePillar(
    "acceptance_and_out_of_scope",
    "Critérios de Aceite",
    "Contratos Zod, testes unitários/integração e build sem warnings"
  );

  assumptions.push({
    key: "Necessidade de Interface (has_ui)",
    value: input.hasUi ? "true (ativar Estúdio Visual Lite)" : "false",
    source: byPillar.has("ui_ux_requirement") ? "user_answer" : "pre_read",
  });

  if (input.brownfieldSummary) {
    assumptions.push({
      key: "Contexto Brownfield",
      value: input.brownfieldSummary,
      source: "pre_read",
    });
  }

  const objective = input.description?.trim()
    ? `${input.title}: ${input.description.trim()}`
    : input.title;

  const assumptionsRows = assumptions
    .map((a) => `| ${a.key} | ${a.value.replace(/\|/g, "/")} | ${a.source} |`)
    .join("\n");

  const specMarkdown = [
    `# Especificação: ${input.title}`,
    "",
    `## Resumo de Alinhamento`,
    `- **Objetivo:** ${objective}`,
    `- **Usuário / Operador:** ${targetUser}`,
    `- **Interface UI (\`has_ui\`):** ${input.hasUi ? "Sim" : "Não"}`,
    `- **Fluxos Críticos:** ${criticalFlow}`,
    `- **Restrições Técnicas:** ${techConstraint}`,
    `- **Critérios de Aceite:** ${acceptanceText}`,
    "",
    `## Premissas Assumidas`,
    `| Pilar / Premissa | Definição | Origem |`,
    `| :--- | :--- | :--- |`,
    assumptionsRows,
  ].join("\n");

  return DiscoverySummarySchema.parse({
    objective,
    targetUser,
    criticalFlows: [criticalFlow],
    technicalConstraints: [techConstraint],
    hasUi: input.hasUi,
    acceptanceCriteria: [acceptanceText],
    outOfScope: ["Funcionalidades explicitamente alocadas a Slices posteriores"],
    assumptions,
    specMarkdown,
  });
}
