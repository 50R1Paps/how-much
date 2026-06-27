#!/usr/bin/env node
import { createProxyServer } from "./proxy.js";

const DEFAULT_PORT = 8080;

const DEFAULT_ROUTES: Record<string, string> = {
  openai: "https://api.openai.com",
};

async function main() {
  const port = DEFAULT_PORT;

  const proxy = await createProxyServer({
    port,
    routes: DEFAULT_ROUTES,
  });

  console.log(`how-much proxy listening on http://localhost:${proxy.port}`);
  console.log(`Routes:`);
  for (const [provider, target] of Object.entries(DEFAULT_ROUTES)) {
    console.log(`  /${provider}/* → ${target}/*`);
  }

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    proxy.close().then(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    proxy.close().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
