#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { Command } from "commander";
import { createProxyServer } from "./proxy.js";
import { createStorage } from "./storage.js";
import { loadConfig } from "./config.js";
import { formatRecordLine } from "./format.js";
import {
  getDateRange,
  formatTotalReport,
  formatModelBreakdownReport,
} from "./reports.js";
import { compareSubscription, formatComparisonReport } from "./compare.js";

const DEFAULT_PORT = 8080;

const DEFAULT_ROUTES: Record<string, string> = {
  openai: "https://api.openai.com",
};

function getDbPath(): string {
  const configDir = join(homedir(), ".how-much");
  mkdirSync(configDir, { recursive: true });
  return join(configDir, "how-much.db");
}

async function runProxy() {
  const port = DEFAULT_PORT;
  const sessionId = randomUUID();
  const configDir = join(homedir(), ".how-much");
  mkdirSync(configDir, { recursive: true });

  const config = loadConfig(configDir);
  const storage = createStorage(getDbPath());

  let sessionTotal = 0;

  const proxy = await createProxyServer({
    port,
    routes: DEFAULT_ROUTES,
    storage,
    sessionId,
    currency: config.currency,
    onRecord: (record) => {
      if (record.cost !== null) {
        sessionTotal += record.cost;
      }
      console.log(formatRecordLine(record, sessionTotal));
    },
  });

  console.log(`how-much proxy listening on http://localhost:${proxy.port}`);
  console.log(`Routes:`);
  for (const [provider, target] of Object.entries(DEFAULT_ROUTES)) {
    console.log(`  /${provider}/* → ${target}/*`);
  }

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    proxy.close().then(() => {
      storage.close();
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    proxy.close().then(() => {
      storage.close();
      process.exit(0);
    });
  });
}

function runReport(period: "today" | "week" | "month", byModel: boolean) {
  const configDir = join(homedir(), ".how-much");
  mkdirSync(configDir, { recursive: true });
  const config = loadConfig(configDir);
  const storage = createStorage(getDbPath());

  const { start, end, label } = getDateRange(period);
  const records = storage.getRecordsByDateRange(start, end);

  if (records.length === 0) {
    console.log(`No spending recorded for ${label}.`);
    storage.close();
    return;
  }

  if (byModel) {
    console.log(formatModelBreakdownReport(label, records, config.currency));
  } else {
    console.log(formatTotalReport(label, records, config.currency));
  }

  storage.close();
}

const program = new Command();

program
  .name("how-much")
  .description("Track LLM API costs in real time")
  .version("0.1.0")
  .action(() => {
    runProxy().catch((err) => {
      console.error("Failed to start:", err);
      process.exit(1);
    });
  });

program
  .command("today")
  .description("Show total spending for today")
  .option("--by-model", "Show breakdown by model")
  .action((opts: { byModel?: boolean }) => {
    runReport("today", opts.byModel ?? false);
  });

program
  .command("week")
  .description("Show total spending for the last 7 days")
  .option("--by-model", "Show breakdown by model")
  .action((opts: { byModel?: boolean }) => {
    runReport("week", opts.byModel ?? false);
  });

program
  .command("month")
  .description("Show total spending for the current month")
  .option("--by-model", "Show breakdown by model")
  .action((opts: { byModel?: boolean }) => {
    runReport("month", opts.byModel ?? false);
  });

function runCompare(plan?: string) {
  const configDir = join(homedir(), ".how-much");
  mkdirSync(configDir, { recursive: true });
  const config = loadConfig(configDir);
  const storage = createStorage(getDbPath());

  let subscriptions = config.subscriptions;
  if (plan) {
    subscriptions = subscriptions.filter((s) => s.name === plan);
    if (subscriptions.length === 0) {
      console.log(`No subscription named "${plan}" found in config.`);
      console.log(
        `Available: ${config.subscriptions.map((s) => s.name).join(", ") || "none"}`,
      );
      storage.close();
      return;
    }
  }

  const { start, end } = getDateRange("month");
  const records = storage.getRecordsByDateRange(start, end);
  const totalSpent = records.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const spentCurrency = config.currency;

  const now = new Date();
  const results = subscriptions.map((sub) =>
    compareSubscription(sub, totalSpent, spentCurrency, now),
  );

  console.log(formatComparisonReport(results));
  storage.close();
}

program
  .command("compare")
  .description("Compare actual spending vs subscription cost")
  .option("--plan <name>", "Compare against a specific subscription plan")
  .action((opts: { plan?: string }) => {
    runCompare(opts.plan);
  });

program.parse();
