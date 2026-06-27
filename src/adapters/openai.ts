export interface UsageData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function extractUsageFromJson(json: any): UsageData | null {
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
}

export function extractUsage(responseBody: string): UsageData | null {
  try {
    const json = JSON.parse(responseBody);
    return extractUsageFromJson(json);
  } catch {
    return null;
  }
}

export function extractUsageFromSSE(sseBuffer: string): UsageData | null {
  const lines = sseBuffer.split("\n");
  let lastUsageData: UsageData | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;

    try {
      const json = JSON.parse(data);
      const usage = extractUsageFromJson(json);
      if (usage) {
        lastUsageData = usage;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return lastUsageData;
}
