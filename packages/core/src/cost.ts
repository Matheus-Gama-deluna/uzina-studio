export interface TokenUsageAmounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

interface ModelRatePerMillion {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
}

const MODEL_RATES: ReadonlyArray<readonly [RegExp, ModelRatePerMillion]> = [
  [/claude-opus/i, { inputUsd: 15, outputUsd: 75, cacheReadUsd: 1.5 }],
  [/claude-sonnet/i, { inputUsd: 3, outputUsd: 15, cacheReadUsd: 0.3 }],
  [/claude-haiku/i, { inputUsd: 0.8, outputUsd: 4, cacheReadUsd: 0.08 }],
  [/gpt-4o-mini/i, { inputUsd: 0.15, outputUsd: 0.6, cacheReadUsd: 0.075 }],
  [/gpt-4o|gpt-4\.1|gpt-5/i, { inputUsd: 2.5, outputUsd: 10, cacheReadUsd: 1.25 }],
  [/gemini-2\.5-pro|gemini-1\.5-pro/i, { inputUsd: 1.25, outputUsd: 5, cacheReadUsd: 0.31 }],
  [/gemini-2\.5-flash|gemini-2\.0-flash|gemini-flash/i, { inputUsd: 0.1, outputUsd: 0.4, cacheReadUsd: 0.025 }],
];

export function estimateTokenCostUsd(
  modelId: string | null | undefined,
  usage: TokenUsageAmounts
): number {
  if (!modelId) {
    return 0;
  }
  const normalized = modelId.trim();
  const matched = MODEL_RATES.find(([pattern]) => pattern.test(normalized));
  if (!matched) {
    return 0;
  }
  const rate = matched[1];
  const inputCost = (Math.max(0, usage.inputTokens) / 1_000_000) * rate.inputUsd;
  const outputCost = (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputUsd;
  const cacheCost =
    (Math.max(0, usage.cacheReadTokens ?? 0) / 1_000_000) * rate.cacheReadUsd;

  return Number((inputCost + outputCost + cacheCost).toFixed(6));
}
