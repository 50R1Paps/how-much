export interface UsageData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function extractUsage(responseBody: string): UsageData | null {
  try {
    const json = JSON.parse(responseBody);
    if (!json.usage || !json.model) return null;

    const usage = json.usage;
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;

    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    if (usage.prompt_tokens_details) {
      cacheReadTokens = usage.prompt_tokens_details.cached_tokens ?? 0;
    }

    return {
      model: json.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    };
  } catch {
    return null;
  }
}
