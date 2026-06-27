import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProxyServer, type ProxyServer } from "../src/proxy.js";
import {
  createStorage,
  type Storage,
  type CostRecord,
} from "../src/storage.js";
import {
  formatRecordLine,
  formatCost,
  formatSessionTotal,
} from "../src/format.js";

async function startMockProvider(
  handler: (req: any, res: any) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

const SAMPLE_USAGE_RESPONSE = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 350,
    total_tokens: 1550,
  },
});

describe("Streaming live CLI (slice 03) — line formatting", () => {
  it("formats a record line with timestamp, model, tokens, cost, and session total", () => {
    const record: CostRecord = {
      timestamp: "2025-06-27T14:32:01.000Z",
      provider: "openai",
      model: "gpt-4o",
      input_tokens: 1200,
      output_tokens: 350,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost: 0.0089,
      currency: "USD",
      session_id: "test-session",
    };

    const line = formatRecordLine(record, 0.14);
    expect(line).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\] openai\/gpt-4o \| in: 1200 out: 350 \| \$0.0089 \| session: \$0.14$/,
    );
  });

  it("shows N/A for null cost (unknown model)", () => {
    const record: CostRecord = {
      timestamp: "2025-06-27T14:32:01.000Z",
      provider: "openai",
      model: "unknown-model-xyz",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost: null,
      currency: "USD",
      session_id: "test-session",
    };

    const line = formatRecordLine(record, 0.14);
    expect(line).toContain("N/A");
    expect(line).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\] openai\/unknown-model-xyz \| in: 100 out: 50 \| N\/A \| session: \$0.14$/,
    );
  });

  it("formatCost returns N/A for null, dollar-formatted for numbers", () => {
    expect(formatCost(null)).toBe("N/A");
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.0089)).toBe("$0.0089");
    expect(formatCost(1.5)).toBe("$1.5000");
  });

  it("formatSessionTotal formats with 2 decimal places", () => {
    expect(formatSessionTotal(0)).toBe("$0.00");
    expect(formatSessionTotal(0.14)).toBe("$0.14");
    expect(formatSessionTotal(12.5)).toBe("$12.50");
  });

  it("session total does not increase when cost is null", () => {
    const record: CostRecord = {
      timestamp: "2025-06-27T14:32:01.000Z",
      provider: "openai",
      model: "unknown-model",
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost: null,
      currency: "USD",
      session_id: "test-session",
    };

    const line = formatRecordLine(record, 0.14);
    expect(line).toContain("session: $0.14");
  });
});

describe("Streaming live CLI (slice 03) — onRecord callback", () => {
  let mockProvider: { server: Server; port: number };
  let proxy: ProxyServer;
  let storage: Storage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "how-much-test-"));
    storage = createStorage(join(tmpDir, "test.db"));
  });

  afterEach(async () => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
    if (proxy) await proxy.close();
    if (mockProvider) await stopServer(mockProvider.server);
  });

  it("calls onRecord with the persisted record after a successful request", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(SAMPLE_USAGE_RESPONSE);
    });

    const onRecord = vi.fn();
    const mockComputeCost = vi.fn().mockResolvedValue(0.0089);

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session-123",
      currency: "USD",
      computeCostFn: mockComputeCost,
      onRecord,
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
      expect(onRecord).toHaveBeenCalledTimes(1);
    });

    const record = onRecord.mock.calls[0][0] as CostRecord;
    expect(record.provider).toBe("openai");
    expect(record.model).toBe("gpt-4o");
    expect(record.input_tokens).toBe(1200);
    expect(record.output_tokens).toBe(350);
    expect(record.cost).toBe(0.0089);
    expect(record.session_id).toBe("test-session-123");
  });

  it("calls onRecord with null cost for unknown models", async () => {
    const unknownModelResponse = JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      model: "unknown-model-xyz",
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(unknownModelResponse);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onRecord = vi.fn();
    const mockComputeCost = vi
      .fn()
      .mockRejectedValue(new Error("Model not found"));

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session",
      currency: "USD",
      computeCostFn: mockComputeCost,
      onRecord,
    });

    await fetch(`http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({ model: "unknown-model-xyz", messages: [] }),
    });

    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });

    const record = onRecord.mock.calls[0][0] as CostRecord;
    expect(record.cost).toBeNull();
    expect(record.model).toBe("unknown-model-xyz");

    warnSpy.mockRestore();
  });

  it("does not call onRecord when response has no usage field", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const onRecord = vi.fn();
    const mockComputeCost = vi.fn();

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session",
      computeCostFn: mockComputeCost,
      onRecord,
    });

    await fetch(`http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({ messages: [] }),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onRecord).not.toHaveBeenCalled();
  });

  it("onRecord can be used to track cumulative session total", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(SAMPLE_USAGE_RESPONSE);
    });

    let sessionTotal = 0;
    const lines: string[] = [];
    const onRecord = vi.fn((record: CostRecord) => {
      if (record.cost !== null) {
        sessionTotal += record.cost;
      }
      lines.push(formatRecordLine(record, sessionTotal));
    });

    const mockComputeCost = vi.fn().mockResolvedValue(0.0089);

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session",
      currency: "USD",
      computeCostFn: mockComputeCost,
      onRecord,
    });

    // Send 3 requests
    for (let i = 0; i < 3; i++) {
      await fetch(`http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      });
    }

    await vi.waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(3);
    });

    expect(sessionTotal).toBeCloseTo(0.0267, 6);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("session: $0.01");
    expect(lines[1]).toContain("session: $0.02");
    expect(lines[2]).toContain("session: $0.03");
  });
});
