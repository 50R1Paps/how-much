import { computeCost } from "@atenareply/tokenpricing";

export type CostCalculator = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  currency: string,
) => Promise<number | null>;

export const calculateCost: CostCalculator = async (
  model,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  currency,
) => {
  try {
    const cost = await computeCost(model, inputTokens, outputTokens, currency, {
      cacheReadTokens,
      cacheCreationTokens: cacheWriteTokens,
    });
    return cost;
  } catch {
    console.warn(`⚠ Unknown model: ${model}`);
    return null;
  }
};
