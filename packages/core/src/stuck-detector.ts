import {
  AgentTurnObservationSchema,
  type AgentTurnObservation,
  type AgentTurnObservationInput,
  type StuckAlert,
  type StuckAlertV2Extension,
} from "@uzina/contracts";

export interface StuckDetectorConfig {
  contextOverflowThreshold: number;
  actionErrorThreshold: number;
  actionObservationThreshold: number;
  pingPongThreshold: number;
  monologueThreshold: number;
}

export interface StuckThreeStrikeDirective {
  strikeCount: number;
  actionKey: string | null;
  requiresRootCauseHypothesis: boolean;
  directiveMessage: string | null;
  escalateToArchitect: boolean;
}

export const DEFAULT_STUCK_DETECTOR_CONFIG: StuckDetectorConfig = {
  contextOverflowThreshold: 2,
  actionErrorThreshold: 3,
  actionObservationThreshold: 4,
  pingPongThreshold: 6,
  monologueThreshold: 3,
};

export const CONTEXT_OVERFLOW_REGEX =
  /context.?length|maximum context|max.?tokens|token.?limit|context.?window|prompt is too long|exceeds.*context|too many tokens/i;

function isContextOverflowTurn(obs: AgentTurnObservation): boolean {
  if (obs.isContextOverflow) {
    return true;
  }
  return obs.errorMessage ? CONTEXT_OVERFLOW_REGEX.test(obs.errorMessage) : false;
}

function getActionErrorKey(obs: AgentTurnObservation): string | null {
  const isError = obs.actionType === "error" || Boolean(obs.errorMessage);
  if (!isError) {
    return null;
  }
  const key = obs.actionSignature?.trim() || obs.toolName?.trim();
  return key || null;
}

function getToolObservationKey(obs: AgentTurnObservation): string | null {
  if (obs.actionType !== "tool_call") {
    return null;
  }
  const actionSig = obs.actionSignature?.trim();
  if (!obs.toolName || !actionSig) {
    return null;
  }
  return `${obs.toolName}::${actionSig}::${obs.observationSignature ?? ""}`;
}

function getPingPongSignature(obs: AgentTurnObservation): string | null {
  if (obs.actionType !== "tool_call") {
    return null;
  }
  const actionSig = obs.actionSignature?.trim();
  if (!obs.toolName || !actionSig) {
    return null;
  }
  return `${obs.toolName}::${actionSig}`;
}

function buildAlert(
  pattern: StuckAlert["pattern"],
  reason: string,
  turns: readonly AgentTurnObservation[],
  options?: {
    strikeCount?: number;
    escalatedToArchitect?: boolean;
    rootCauseHypothesis?: string;
  }
): StuckAlertV2Extension {
  const strikeCount = Math.min(
    10,
    Math.max(1, options?.strikeCount ?? turns.length)
  );
  const rootCauseHypothesis = options?.rootCauseHypothesis?.trim().slice(0, 2000);
  return {
    detected: true,
    pattern,
    decisionType: "stuck_intervention",
    reason,
    evidenceTurns: turns.map((t) => t.turnIndex),
    strikeCount,
    escalatedToArchitect: Boolean(options?.escalatedToArchitect),
    ...(rootCauseHypothesis ? { rootCauseHypothesis } : {}),
  };
}

export function evaluateConsecutiveErrorStrike(
  history: readonly AgentTurnObservationInput[],
  partialConfig: Partial<StuckDetectorConfig> = {}
): StuckThreeStrikeDirective {
  const cfg: StuckDetectorConfig = {
    ...DEFAULT_STUCK_DETECTOR_CONFIG,
    ...partialConfig,
  };
  const parsed = history.map((item) => AgentTurnObservationSchema.parse(item));
  const lastTurn = parsed[parsed.length - 1];
  const lastKey = lastTurn && !isContextOverflowTurn(lastTurn)
    ? getActionErrorKey(lastTurn)
    : null;

  if (!lastKey) {
    return {
      strikeCount: 0,
      actionKey: null,
      requiresRootCauseHypothesis: false,
      directiveMessage: null,
      escalateToArchitect: false,
    };
  }

  let streak = 0;
  for (let i = parsed.length - 1; i >= 0; i--) {
    const item = parsed[i]!;
    if (isContextOverflowTurn(item)) {
      break;
    }
    if (getActionErrorKey(item) === lastKey) {
      streak += 1;
    } else {
      break;
    }
  }

  if (streak >= cfg.actionErrorThreshold && cfg.actionErrorThreshold > 0) {
    return {
      strikeCount: streak,
      actionKey: lastKey,
      requiresRootCauseHypothesis: true,
      directiveMessage: `${streak}ª falha consecutiva para '${lastKey}'. Escalação obrigatória ao Arquiteto/HITL com hipótese de causa-raiz.`,
      escalateToArchitect: true,
    };
  }

  if (streak >= 2) {
    return {
      strikeCount: streak,
      actionKey: lastKey,
      requiresRootCauseHypothesis: true,
      directiveMessage: `2ª falha consecutiva para '${lastKey}'. Pare de editar; formule e registre a hipótese da causa-raiz antes da próxima alteração.`,
      escalateToArchitect: false,
    };
  }

  return {
    strikeCount: streak,
    actionKey: lastKey,
    requiresRootCauseHypothesis: false,
    directiveMessage: null,
    escalateToArchitect: false,
  };
}

export function detectStuck(
  history: readonly AgentTurnObservationInput[],
  partialConfig: Partial<StuckDetectorConfig> = {},
  options?: { rootCauseHypothesis?: string }
): StuckAlertV2Extension | null {
  const cfg: StuckDetectorConfig = {
    ...DEFAULT_STUCK_DETECTOR_CONFIG,
    ...partialConfig,
  };
  const parsed = history.map((item) => AgentTurnObservationSchema.parse(item));

  if (
    cfg.contextOverflowThreshold > 0 &&
    parsed.length >= cfg.contextOverflowThreshold
  ) {
    const tail = parsed.slice(-cfg.contextOverflowThreshold);
    if (tail.every(isContextOverflowTurn)) {
      return buildAlert(
        "context_window_overflow",
        `${cfg.contextOverflowThreshold}+ erros consecutivos de estouro de janela de contexto detectados.`,
        tail,
        {
          strikeCount: tail.length,
          escalatedToArchitect: false,
          rootCauseHypothesis: options?.rootCauseHypothesis,
        }
      );
    }
  }

  if (
    cfg.actionErrorThreshold > 0 &&
    parsed.length >= cfg.actionErrorThreshold
  ) {
    const tail = parsed.slice(-cfg.actionErrorThreshold);
    const keys = tail.map(getActionErrorKey);
    const firstKey = keys[0];
    if (firstKey && keys.every((k) => k === firstKey)) {
      const lastErrorMessage =
        tail[tail.length - 1]?.errorMessage?.trim() ?? "erro recorrente";
      const synthesizedHypothesis =
        options?.rootCauseHypothesis?.trim() ||
        `Falha persistente após ${tail.length} tentativas em '${firstKey}': ${lastErrorMessage}`;
      return buildAlert(
        "repeated_action_error",
        `${cfg.actionErrorThreshold}+ repetições consecutivas da mesma ação com erro (${firstKey}).`,
        tail,
        {
          strikeCount: tail.length,
          escalatedToArchitect: tail.length >= 3,
          rootCauseHypothesis: synthesizedHypothesis,
        }
      );
    }
  }

  if (
    cfg.actionObservationThreshold > 0 &&
    parsed.length >= cfg.actionObservationThreshold
  ) {
    const tail = parsed.slice(-cfg.actionObservationThreshold);
    const keys = tail.map(getToolObservationKey);
    const firstKey = keys[0];
    if (firstKey && keys.every((k) => k === firstKey)) {
      return buildAlert(
        "repeated_action_observation",
        `${cfg.actionObservationThreshold}+ repetições idênticas de ação e observação (${firstKey}).`,
        tail,
        {
          strikeCount: tail.length,
          escalatedToArchitect: false,
          rootCauseHypothesis: options?.rootCauseHypothesis,
        }
      );
    }
  }

  if (cfg.pingPongThreshold >= 4 && parsed.length >= cfg.pingPongThreshold) {
    const tail = parsed.slice(-cfg.pingPongThreshold);
    const sigs = tail.map(getPingPongSignature);
    const sigA = sigs[0];
    const sigB = sigs[1];
    if (
      sigA &&
      sigB &&
      sigA !== sigB &&
      sigs.every((sig, idx) => sig === (idx % 2 === 0 ? sigA : sigB))
    ) {
      return buildAlert(
        "alternating_ping_pong",
        `${cfg.pingPongThreshold}+ oscilações alternadas consecutivas entre ${sigA} e ${sigB}.`,
        tail,
        {
          strikeCount: tail.length,
          escalatedToArchitect: false,
          rootCauseHypothesis: options?.rootCauseHypothesis,
        }
      );
    }
  }

  if (cfg.monologueThreshold > 0 && parsed.length >= cfg.monologueThreshold) {
    const tail = parsed.slice(-cfg.monologueThreshold);
    if (tail.every((turn) => turn.actionType === "assistant_text")) {
      return buildAlert(
        "monologue_no_tool",
        `${cfg.monologueThreshold}+ turnos consecutivos de monólogo sem chamada de ferramenta.`,
        tail,
        {
          strikeCount: tail.length,
          escalatedToArchitect: false,
          rootCauseHypothesis: options?.rootCauseHypothesis,
        }
      );
    }
  }

  return null;
}

export class StuckDetector {
  private readonly config: StuckDetectorConfig;
  private readonly history: AgentTurnObservation[] = [];
  private rootCauseHypothesis: string | undefined;

  constructor(config: Partial<StuckDetectorConfig> = {}) {
    this.config = {
      ...DEFAULT_STUCK_DETECTOR_CONFIG,
      ...config,
    };
  }

  recordRootCauseHypothesis(hypothesis: string): void {
    const trimmed = hypothesis.trim();
    if (trimmed.length > 0) {
      this.rootCauseHypothesis = trimmed.slice(0, 2000);
    }
  }

  getLatestRootCauseHypothesis(): string | undefined {
    return this.rootCauseHypothesis;
  }

  getStrikeStatus(): StuckThreeStrikeDirective {
    return evaluateConsecutiveErrorStrike(this.history, this.config);
  }

  recordTurn(observation: AgentTurnObservationInput): StuckAlertV2Extension | null {
    const validated = AgentTurnObservationSchema.parse(observation);
    this.history.push(validated);
    return detectStuck(this.history, this.config, {
      rootCauseHypothesis: this.rootCauseHypothesis,
    });
  }

  getHistory(): readonly AgentTurnObservation[] {
    return [...this.history];
  }

  reset(): void {
    this.history.length = 0;
    this.rootCauseHypothesis = undefined;
  }
}
