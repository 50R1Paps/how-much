import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Subscription {
  name: string;
  display_name: string;
  monthly_cost: number;
  currency: string;
}

export interface Config {
  currency: string;
  subscriptions: Subscription[];
  custom_pricing: Record<string, unknown>;
  alerts: unknown[];
}

export const DEFAULT_CONFIG: Config = {
  currency: "EUR",
  subscriptions: [],
  custom_pricing: {},
  alerts: [],
};

export function getConfigDir(): string {
  return join(homedir(), ".how-much");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function loadConfig(configDir?: string): Config {
  const dir = configDir ?? getConfigDir();
  const configPath = join(dir, "config.json");

  if (!existsSync(configPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Config>;

  return {
    currency: parsed.currency ?? DEFAULT_CONFIG.currency,
    subscriptions: parsed.subscriptions ?? DEFAULT_CONFIG.subscriptions,
    custom_pricing: parsed.custom_pricing ?? DEFAULT_CONFIG.custom_pricing,
    alerts: parsed.alerts ?? DEFAULT_CONFIG.alerts,
  };
}
