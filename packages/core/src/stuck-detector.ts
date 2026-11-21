import {
  AgentTurnObservationSchema,
  type AgentTurnObservation,
  type AgentTurnObservationInput,
  type StuckAlert,
} from "@uzina/contracts";

export interface StuckDetectorConfig {
  contextOverflowThreshold: number;
  actionErrorThreshold: number;
  actionObservationThreshold: number;
  pingPongThreshold: number;
  monologueThreshold: number;
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
  turns: readonly AgentTurnObservation[]
): StuckAlert {
  return {
    detected: true,
    pattern,
    decisionType: "stuck_intervention",
    reason,
    evidenceTurns: turns.map((t) => t.turnIndex),
  };
}

export function detectStuck(
  history: readonly AgentTurnObservationInput[],
  partialConfig: Partial<StuckDetectorConfig> = {}
): StuckAlert | null {
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
        tail
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
      return buildAlert(
        "repeated_action_error",
        `${cfg.actionErrorThreshold}+ repetições consecutivas da mesma ação com erro (${firstKey}).`,
        tail
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
        tail
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
        tail
      );
    }
  }

  if (cfg.monologueThreshold > 0 && parsed.length >= cfg.monologueThreshold) {
    const tail = parsed.slice(-cfg.monologueThreshold);
    if (tail.every((turn) => turn.actionType === "assistant_text")) {
      return buildAlert(
        "monologue_no_tool",
        `${cfg.monologueThreshold}+ turnos consecutivos de monólogo sem chamada de ferramenta.`,
        tail
      );
    }
  }

  return null;
}

export class StuckDetector {
  private readonly config: StuckDetectorConfig;
  private readonly history: AgentTurnObservation[] = [];

  constructor(config: Partial<StuckDetectorConfig> = {}) {
    this.config = {
      ...DEFAULT_STUCK_DETECTOR_CONFIG,
      ...config,
    };
  }

  recordTurn(observation: AgentTurnObservationInput): StuckAlert | null {
    const validated = AgentTurnObservationSchema.parse(observation);
    this.history.push(validated);
    return detectStuck(this.history, this.config);
  }

  getHistory(): readonly AgentTurnObservation[] {
    return [...this.history];
  }

  reset(): void {
    this.history.length = 0;
  }
}
