import type { CostRecord } from "./storage.js";

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "N/A";
  return `$${cost.toFixed(4)}`;
}

export function formatSessionTotal(total: number): string {
  return `$${total.toFixed(2)}`;
}

export function formatRecordLine(record: CostRecord, sessionTotal: number): string {
  const time = formatTime(record.timestamp);
  const costStr = formatCost(record.cost);
  const sessionStr = formatSessionTotal(sessionTotal);
  return `[${time}] ${record.provider}/${record.model} | in: ${record.input_tokens} out: ${record.output_tokens} | ${costStr} | session: ${sessionStr}`;
}
