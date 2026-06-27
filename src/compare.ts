import chalk from "chalk";
import type { Subscription } from "./config.js";

export type CurrencyConverter = (
  amount: number,
  from: string,
  to: string,
) => number;

export const defaultConvert: CurrencyConverter = (amount, from, to) => {
  if (from === to) return amount;
  return amount;
};

export function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function getDaysElapsed(date: Date): number {
  return date.getDate();
}

export function calculateProRatedCost(
  monthlyCost: number,
  daysElapsed: number,
  daysInMonth: number,
): number {
  return (monthlyCost / daysInMonth) * daysElapsed;
}

export interface ComparisonResult {
  subscription: Subscription;
  spent: number;
  proRatedCost: number;
  difference: number;
  isSubscriptionCheaper: boolean;
  currency: string;
  daysElapsed: number;
  daysInMonth: number;
}

export function compareSubscription(
  subscription: Subscription,
  spent: number,
  spentCurrency: string,
  now: Date,
  convert: CurrencyConverter = defaultConvert,
): ComparisonResult {
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDaysElapsed(now);
  const proRatedCost = calculateProRatedCost(
    subscription.monthly_cost,
    daysElapsed,
    daysInMonth,
  );
  const convertedSpent = convert(spent, spentCurrency, subscription.currency);
  const difference = proRatedCost - convertedSpent;

  return {
    subscription,
    spent: convertedSpent,
    proRatedCost,
    difference,
    isSubscriptionCheaper: difference > 0,
    currency: subscription.currency,
    daysElapsed,
    daysInMonth,
  };
}

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
  return `${symbol}${amount.toFixed(2)}`;
}

function formatCost(amount: number, currency: string): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "";
  return `${symbol}${amount.toFixed(4)}`;
}

export function formatSingleComparison(result: ComparisonResult): string {
  const { subscription, spent, proRatedCost, difference, isSubscriptionCheaper, currency, daysElapsed, daysInMonth } = result;
  const lines: string[] = [];

  lines.push(
    chalk.bold(`Plan: ${subscription.display_name} (${formatCurrency(subscription.monthly_cost, subscription.currency)}/month)`),
  );
  lines.push(`  Spent this month: ${formatCost(spent, currency)}`);
  lines.push(
    `  Pro-rated subscription cost (${daysElapsed}/${daysInMonth} days): ${formatCost(proRatedCost, currency)}`,
  );

  if (isSubscriptionCheaper) {
    lines.push(
      `  Status: ${chalk.green("✅ Subscription is cheaper")} by ${formatCost(Math.abs(difference), currency)}`,
    );
  } else {
    lines.push(
      `  Status: ${chalk.yellow("⚠ Pay-per-use is cheaper")} by ${formatCost(Math.abs(difference), currency)}`,
    );
  }

  return lines.join("\n");
}

export function formatComparisonReport(results: ComparisonResult[]): string {
  if (results.length === 0) {
    return chalk.dim("No subscriptions configured. Add subscriptions to ~/.how-much/config.json");
  }

  return results.map(formatSingleComparison).join("\n\n");
}
