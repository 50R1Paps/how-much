#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createProxyServer } from "./proxy.js";
import { createStorage } from "./storage.js";
import { loadConfig } from "./config.js";
import { formatRecordLine } from "./format.js";

const DEFAULT_PORT = 8080;

const DEFAULT_ROUTES: Record<string, string> = {
  openai: "https://api.openai.com",
};

function getDbPath(): string {
  const configDir = join(homedir(), ".how-much");
  mkdirSync(configDir, { recursive: true });
  return join(configDir, "how-much.db");
}

async function main() {
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

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
