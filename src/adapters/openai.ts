export interface UsageData {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function getModelFromPayload(json: any): string | null {
  if (typeof json?.model === "string") return json.model;
  if (typeof json?.response?.model === "string") return json.response.model;
  return null;
}

function getUsageFromPayload(json: any): any | null {
  if (json?.usage) return json.usage;
  if (json?.response?.usage) return json.response.usage;
  return null;
}

function extractUsageFromJson(json: any): UsageData | null {
  const usage = getUsageFromPayload(json);
  const model = getModelFromPayload(json);
  if (!usage || !model) return null;

  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  cacheReadTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    0;

  return {
    model,
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
