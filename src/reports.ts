import chalk from "chalk";
import type { CostRecord } from "./storage.js";

export interface ModelBreakdown {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

export function calculateTotal(records: CostRecord[]): {
  total: number;
  untracked: number;
} {
  let total = 0;
  let untracked = 0;
  for (const r of records) {
    if (r.cost !== null) {
      total += r.cost;
    } else {
      untracked++;
    }
  }
  return { total, untracked };
}

export function groupByModel(records: CostRecord[]): ModelBreakdown[] {
  const map = new Map<string, ModelBreakdown>();
  for (const r of records) {
    const existing = map.get(r.model);
    if (existing) {
      existing.calls++;
      existing.inputTokens += r.input_tokens;
      existing.outputTokens += r.output_tokens;
      if (r.cost !== null) {
        existing.totalCost += r.cost;
      }
    } else {
      map.set(r.model, {
        model: r.model,
        calls: 1,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        totalCost: r.cost ?? 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
}

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
  return `${symbol}${amount.toFixed(4)}`;
}

export function formatTotalReport(
  period: string,
  records: CostRecord[],
  currency: string,
): string {
  const { total, untracked } = calculateTotal(records);
  const lines: string[] = [];
  lines.push(chalk.bold(`Spending — ${period}`));
  lines.push("");
  lines.push(`  Total: ${chalk.green(formatCurrency(total, currency))}`);
  lines.push(`  Calls: ${records.length}`);
  if (untracked > 0) {
    lines.push(
      chalk.yellow(`  Untracked (unknown model): ${untracked} call(s)`),
    );
  }
  return lines.join("\n");
}

export function formatModelBreakdownReport(
  period: string,
  records: CostRecord[],
  currency: string,
): string {
  const breakdown = groupByModel(records);
  const { total, untracked } = calculateTotal(records);
  const lines: string[] = [];
  lines.push(chalk.bold(`Spending by model — ${period}`));
  lines.push("");

  const modelWidth = Math.max(8, ...breakdown.map((b) => b.model.length));
  const header = `  ${"Model".padEnd(modelWidth)}  Calls  Input    Output   Cost`;
  lines.push(chalk.dim(header));
  lines.push(chalk.dim("  " + "─".repeat(modelWidth + 38)));

  for (const b of breakdown) {
    lines.push(
      `  ${b.model.padEnd(modelWidth)}  ${String(b.calls).padStart(5)}  ${String(b.inputTokens).padStart(7)}  ${String(b.outputTokens).padStart(7)}   ${formatCurrency(b.totalCost, currency)}`,
    );
  }

  lines.push("");
  lines.push(`  Total: ${chalk.green(formatCurrency(total, currency))}`);
  if (untracked > 0) {
    lines.push(
      chalk.yellow(`  Untracked (unknown model): ${untracked} call(s)`),
    );
  }
  return lines.join("\n");
}

export function getDateRange(period: "today" | "week" | "month"): {
  start: string;
  end: string;
  label: string;
} {
  const now = new Date();
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: `today (${start.toISOString().slice(0, 10)})`,
    };
  }

  if (period === "week") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      label: `last 7 days (since ${start.toISOString().slice(0, 10)})`,
    };
  }

  // month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `this month (${start.toLocaleString("en", { month: "long" })} ${start.getFullYear()})`,
  };
}
