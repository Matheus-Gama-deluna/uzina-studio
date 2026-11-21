import { describe, expect, test } from "vitest";
import type { AgentTurnObservationInput, StuckPattern } from "@uzina/contracts";
import { detectStuck, StuckDetector } from "../src/stuck-detector.js";

function makeToolTurn(
  turnIndex: number,
  toolName: string,
  actionSignature: string,
  observationSignature: string
): AgentTurnObservationInput {
  return {
    turnIndex,
    actionType: "tool_call",
    toolName,
    actionSignature,
    observationSignature,
  };
}

function makeErrorTurn(
  turnIndex: number,
  opts: {
    toolName?: string;
    actionSignature?: string;
    errorMessage?: string;
    isContextOverflow?: boolean;
  }
): AgentTurnObservationInput {
  return {
    turnIndex,
    actionType: "error",
    toolName: opts.toolName,
    actionSignature: opts.actionSignature,
    errorMessage: opts.errorMessage,
    isContextOverflow: opts.isContextOverflow,
  };
}

function makeMonologueTurn(turnIndex: number): AgentTurnObservationInput {
  return {
    turnIndex,
    actionType: "assistant_text",
  };
}

describe("StuckDetector — 5 padrões OpenHands (Tests as Data)", () => {
  const cases: Array<{
    name: string;
    turns: AgentTurnObservationInput[];
    expectedPattern: StuckPattern | null;
    expectedEvidence?: number[];
  }> = [
    {
      name: "Padrão 1: 4 repetições idênticas de ação + observação dispara alerta",
      turns: [
        makeToolTurn(0, "read", "read:a.ts", "hash:111"),
        makeToolTurn(1, "read", "read:a.ts", "hash:111"),
        makeToolTurn(2, "read", "read:a.ts", "hash:111"),
        makeToolTurn(3, "read", "read:a.ts", "hash:111"),
      ],
      expectedPattern: "repeated_action_observation",
      expectedEvidence: [0, 1, 2, 3],
    },
    {
      name: "Padrão 1 (boundary N-1): 3 repetições idênticas não dispara",
      turns: [
        makeToolTurn(0, "read", "read:a.ts", "hash:111"),
        makeToolTurn(1, "read", "read:a.ts", "hash:111"),
        makeToolTurn(2, "read", "read:a.ts", "hash:111"),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 1 e 4 (A === B): 6 chamadas iguais com observações distintas não dispara ping-pong nem repetição",
      turns: [
        makeToolTurn(0, "read", "read:a.ts", "obs:0"),
        makeToolTurn(1, "read", "read:a.ts", "obs:1"),
        makeToolTurn(2, "read", "read:a.ts", "obs:2"),
        makeToolTurn(3, "read", "read:a.ts", "obs:3"),
        makeToolTurn(4, "read", "read:a.ts", "obs:4"),
        makeToolTurn(5, "read", "read:a.ts", "obs:5"),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 2: 3 repetições consecutivas da mesma ação com erro dispara alerta",
      turns: [
        makeErrorTurn(0, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Command failed exit 1",
        }),
        makeErrorTurn(1, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Command failed exit 1",
        }),
        makeErrorTurn(2, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Command failed exit 1",
        }),
      ],
      expectedPattern: "repeated_action_error",
      expectedEvidence: [0, 1, 2],
    },
    {
      name: "Padrão 2 (via tool_call com errorMessage): 3 tool_calls com errorMessage idênticos dispara alerta",
      turns: [
        {
          turnIndex: 0,
          actionType: "tool_call",
          toolName: "bash",
          actionSignature: "pnpm build",
          errorMessage: "tsc error",
        },
        {
          turnIndex: 1,
          actionType: "tool_call",
          toolName: "bash",
          actionSignature: "pnpm build",
          errorMessage: "tsc error",
        },
        {
          turnIndex: 2,
          actionType: "tool_call",
          toolName: "bash",
          actionSignature: "pnpm build",
          errorMessage: "tsc error",
        },
      ],
      expectedPattern: "repeated_action_error",
      expectedEvidence: [0, 1, 2],
    },
    {
      name: "Padrão 2 (quebra de sequência): 2 erros + 1 sucesso + 2 erros não dispara",
      turns: [
        makeErrorTurn(0, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Exit 1",
        }),
        makeErrorTurn(1, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Exit 1",
        }),
        makeToolTurn(2, "read", "read:fix.ts", "ok"),
        makeErrorTurn(3, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Exit 1",
        }),
        makeErrorTurn(4, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Exit 1",
        }),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 2 (boundary N-1): 2 erros idênticos não dispara",
      turns: [
        makeErrorTurn(0, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Command failed exit 1",
        }),
        makeErrorTurn(1, {
          toolName: "bash",
          actionSignature: "pnpm test",
          errorMessage: "Command failed exit 1",
        }),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 2 (sem assinatura): 3 erros genéricos distintos sem assinatura não geram falso positivo",
      turns: [
        makeErrorTurn(0, { errorMessage: "Timeout 1" }),
        makeErrorTurn(1, { errorMessage: "Timeout 2" }),
        makeErrorTurn(2, { errorMessage: "Timeout 3" }),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 3: 3 turnos consecutivos de monólogo sem tool call dispara alerta",
      turns: [
        makeToolTurn(0, "grep", "grep:foo", "ok:2"),
        makeMonologueTurn(1),
        makeMonologueTurn(2),
        makeMonologueTurn(3),
      ],
      expectedPattern: "monologue_no_tool",
      expectedEvidence: [1, 2, 3],
    },
    {
      name: "Padrão 3 (boundary N-1): 2 monólogos não dispara",
      turns: [makeMonologueTurn(0), makeMonologueTurn(1)],
      expectedPattern: null,
    },
    {
      name: "Padrão 4: 6 oscilações alternadas A->B->A->B->A->B dispara alerta",
      turns: [
        makeToolTurn(0, "edit", "edit:a.ts", "ok"),
        makeToolTurn(1, "edit", "edit:b.ts", "ok"),
        makeToolTurn(2, "edit", "edit:a.ts", "ok"),
        makeToolTurn(3, "edit", "edit:b.ts", "ok"),
        makeToolTurn(4, "edit", "edit:a.ts", "ok"),
        makeToolTurn(5, "edit", "edit:b.ts", "ok"),
      ],
      expectedPattern: "alternating_ping_pong",
      expectedEvidence: [0, 1, 2, 3, 4, 5],
    },
    {
      name: "Padrão 4 (boundary N-1): 5 oscilações não dispara",
      turns: [
        makeToolTurn(0, "edit", "edit:a.ts", "ok"),
        makeToolTurn(1, "edit", "edit:b.ts", "ok"),
        makeToolTurn(2, "edit", "edit:a.ts", "ok"),
        makeToolTurn(3, "edit", "edit:b.ts", "ok"),
        makeToolTurn(4, "edit", "edit:a.ts", "ok"),
      ],
      expectedPattern: null,
    },
    {
      name: "Padrão 5 (flag): 2 erros consecutivos de estouro de contexto dispara alerta",
      turns: [
        makeErrorTurn(0, {
          errorMessage: "token limit reached",
          isContextOverflow: true,
        }),
        makeErrorTurn(1, {
          errorMessage: "token limit reached",
          isContextOverflow: true,
        }),
      ],
      expectedPattern: "context_window_overflow",
      expectedEvidence: [0, 1],
    },
    {
      name: "Padrão 5 (regex): 2 erros consecutivos com mensagem de maximum context length dispara",
      turns: [
        makeErrorTurn(0, {
          errorMessage: "This model's maximum context length is 128000 tokens",
        }),
        makeErrorTurn(1, {
          errorMessage: "Prompt is too long for context window",
        }),
      ],
      expectedPattern: "context_window_overflow",
      expectedEvidence: [0, 1],
    },
    {
      name: "Precedência: context_window_overflow vence repeated_action_error quando ambos casam no mesmo turno",
      turns: [
        makeErrorTurn(0, {
          toolName: "llm",
          actionSignature: "prompt",
          errorMessage: "maximum context length exceeded",
        }),
        makeErrorTurn(1, {
          toolName: "llm",
          actionSignature: "prompt",
          errorMessage: "maximum context length exceeded",
        }),
        makeErrorTurn(2, {
          toolName: "llm",
          actionSignature: "prompt",
          errorMessage: "maximum context length exceeded",
        }),
      ],
      expectedPattern: "context_window_overflow",
      expectedEvidence: [1, 2],
    },
    {
      name: "Padrão 5 (boundary N-1): 1 erro de estouro de contexto não dispara",
      turns: [
        makeErrorTurn(0, {
          errorMessage: "Context window exceeded",
          isContextOverflow: true,
        }),
      ],
      expectedPattern: null,
    },
  ];

  test.each(cases)("$name", ({ turns, expectedPattern, expectedEvidence }) => {
    const alert = detectStuck(turns);
    if (expectedPattern === null) {
      expect(alert).toBeNull();
    } else {
      expect(alert).not.toBeNull();
      expect(alert?.detected).toBe(true);
      expect(alert?.decisionType).toBe("stuck_intervention");
      expect(alert?.pattern).toBe(expectedPattern);
      expect(alert?.evidenceTurns).toEqual(expectedEvidence);
    }
  });

  test("StuckDetector incremental acumula turnos, dispara no limiar e limpa com reset()", () => {
    const detector = new StuckDetector();
    expect(detector.recordTurn(makeMonologueTurn(0))).toBeNull();
    expect(detector.recordTurn(makeMonologueTurn(1))).toBeNull();
    const alert = detector.recordTurn(makeMonologueTurn(2));
    expect(alert?.pattern).toBe("monologue_no_tool");
    expect(detector.getHistory()).toHaveLength(3);

    detector.reset();
    expect(detector.getHistory()).toHaveLength(0);
    expect(detector.recordTurn(makeMonologueTurn(0))).toBeNull();
  });
});
