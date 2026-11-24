export interface TokenUsageAmounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface CustomModelPricingEntry {
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  cacheReadPer1MUsd?: number;
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

function matchCustomPricingRate(
  normalizedModelId: string,
  customPricing?: Record<string, CustomModelPricingEntry>
): ModelRatePerMillion | null {
  if (!customPricing) return null;
  const slashIdx = normalizedModelId.indexOf("/");
  const stripped =
    slashIdx > 0 ? normalizedModelId.slice(slashIdx + 1) : normalizedModelId;
  const candidates = [normalizedModelId, stripped, "*"];
  for (const cand of candidates) {
    const direct = customPricing[cand];
    if (direct) {
      return {
        inputUsd: direct.inputPer1MUsd,
        outputUsd: direct.outputPer1MUsd,
        cacheReadUsd: direct.cacheReadPer1MUsd ?? direct.inputPer1MUsd * 0.1,
      };
    }
    const lowerCand = cand.toLowerCase();
    for (const [k, v] of Object.entries(customPricing)) {
      if (k.trim().toLowerCase() === lowerCand) {
        return {
          inputUsd: v.inputPer1MUsd,
          outputUsd: v.outputPer1MUsd,
          cacheReadUsd: v.cacheReadPer1MUsd ?? v.inputPer1MUsd * 0.1,
        };
      }
    }
  }
  return null;
}

export function estimateTokenCostUsd(
  modelId: string | null | undefined,
  usage: TokenUsageAmounts,
  customPricing?: Record<string, CustomModelPricingEntry>
): number {
  if (!modelId) {
    return 0;
  }
  const normalized = modelId.trim();
  const customRate = matchCustomPricingRate(normalized, customPricing);
  const rate =
    customRate ?? MODEL_RATES.find(([pattern]) => pattern.test(normalized))?.[1];
  if (!rate) {
    return 0;
  }
  const inputCost = (Math.max(0, usage.inputTokens) / 1_000_000) * rate.inputUsd;
  const outputCost = (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputUsd;
  const cacheCost =
    (Math.max(0, usage.cacheReadTokens ?? 0) / 1_000_000) * rate.cacheReadUsd;

  return Number((inputCost + outputCost + cacheCost).toFixed(6));
}
