import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.js";
import { createProxyServer } from "../src/proxy.js";
import { createStorage, type Storage } from "../src/storage.js";

describe("Config (slice 05)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "how-much-cfg-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates config.json with defaults when file does not exist", () => {
    const configPath = join(tmpDir, "config.json");
    expect(existsSync(configPath)).toBe(false);

    const config = loadConfig(tmpDir);

    expect(existsSync(configPath)).toBe(true);
    expect(config.currency).toBe("EUR");
    expect(config.subscriptions).toEqual([]);
    expect(config.custom_pricing).toEqual({});
    expect(config.alerts).toEqual([]);

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.currency).toBe("EUR");
  });

  it("reads existing config.json with custom currency", () => {
    const configPath = join(tmpDir, "config.json");
    const customConfig = {
      currency: "USD",
      subscriptions: [
        {
          name: "windsurf",
          display_name: "Windsurf Pro",
          monthly_cost: 20,
          currency: "USD",
        },
      ],
      custom_pricing: {},
      alerts: [],
    };
    writeFileSync(configPath, JSON.stringify(customConfig, null, 2));

    const config = loadConfig(tmpDir);

    expect(config.currency).toBe("USD");
    expect(config.subscriptions).toHaveLength(1);
    expect(config.subscriptions[0].name).toBe("windsurf");
  });

  it("fills missing fields with defaults", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({ currency: "JPY" }));

    const config = loadConfig(tmpDir);

    expect(config.currency).toBe("JPY");
    expect(config.subscriptions).toEqual([]);
    expect(config.custom_pricing).toEqual({});
    expect(config.alerts).toEqual([]);
  });

  it("uses EUR as default currency when field is missing", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, JSON.stringify({}));

    const config = loadConfig(tmpDir);

    expect(config.currency).toBe("EUR");
  });

  it("proxy stores cost in configured currency (EUR)", async () => {
    const storage: Storage = createStorage(join(tmpDir, "test.db"));

    const mockProvider = await new Promise<{ server: Server; port: number }>(
      (resolve) => {
        const server = createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion",
              model: "gpt-4o",
              choices: [],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
            }),
          );
        });
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as AddressInfo).port;
          resolve({ server, port });
        });
      },
    );

    const mockComputeCost = vi.fn().mockResolvedValue(0.0046);

    const proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session-eur",
      currency: "EUR",
      computeCostFn: mockComputeCost,
    });

    await fetch(`http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({ model: "gpt-4o", messages: [] }),
    });

    await vi.waitFor(() => {
      expect(storage.getAllRecords()).toHaveLength(1);
    });

    const record = storage.getAllRecords()[0];
    expect(record.currency).toBe("EUR");
    expect(record.cost).toBe(0.0046);

    expect(mockComputeCost).toHaveBeenCalledWith(
      "gpt-4o",
      100,
      50,
      0,
      0,
      "EUR",
    );

    await proxy.close();
    await new Promise<void>((resolve) =>
      mockProvider.server.close(() => resolve()),
    );
    storage.close();
  });
});
