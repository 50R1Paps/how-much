import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProxyServer, type ProxyServer } from "../src/proxy.js";
import { createStorage, type Storage } from "../src/storage.js";

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
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    prompt_tokens_details: { cached_tokens: 20 },
  },
});

describe("Cost tracking (slice 02)", () => {
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

  it("extracts usage from OpenAI-compatible response and persists cost record", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(SAMPLE_USAGE_RESPONSE);
    });

    const mockComputeCost = vi.fn().mockResolvedValue(0.005);

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session-123",
      currency: "USD",
      computeCostFn: mockComputeCost,
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("gpt-4o");

    await vi.waitFor(() => {
      expect(storage.getAllRecords()).toHaveLength(1);
    });

    const records = storage.getAllRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.provider).toBe("openai");
    expect(record.model).toBe("gpt-4o");
    expect(record.input_tokens).toBe(100);
    expect(record.output_tokens).toBe(50);
    expect(record.cache_read_tokens).toBe(20);
    expect(record.cache_write_tokens).toBe(0);
    expect(record.cost).toBe(0.005);
    expect(record.currency).toBe("USD");
    expect(record.session_id).toBe("test-session-123");
    expect(record.timestamp).toBeTruthy();

    expect(mockComputeCost).toHaveBeenCalledWith(
      "gpt-4o",
      100,
      50,
      20,
      0,
      "USD",
    );
  });

  it("prints warning and stores null cost for unknown model", async () => {
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
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ model: "unknown-model-xyz", messages: [] }),
      },
    );

    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(storage.getAllRecords()).toHaveLength(1);
    });

    const records = storage.getAllRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.model).toBe("unknown-model-xyz");
    expect(record.cost).toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("⚠ Unknown model: unknown-model-xyz"),
    );

    warnSpy.mockRestore();
  });

  it("does not persist record when response has no usage field", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const mockComputeCost = vi.fn();

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session",
      computeCostFn: mockComputeCost,
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ messages: [] }),
      },
    );

    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(storage.getAllRecords()).toHaveLength(0);
    expect(mockComputeCost).not.toHaveBeenCalled();
  });

  it("tracks SSE streaming responses: forwards chunks in real-time and extracts usage from last chunk", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":20}}}\n\n',
      "data: [DONE]\n\n",
    ];

    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of sseChunks) {
        res.write(chunk);
      }
      res.end();
    });

    const mockComputeCost = vi.fn().mockResolvedValue(0.005);

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session-sse",
      currency: "USD",
      computeCostFn: mockComputeCost,
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [], stream: true }),
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();

    // Verify all chunks including [DONE] were forwarded
    expect(body).toContain('"content":""');
    expect(body).toContain('"content":"Hello"');
    expect(body).toContain('"content":"!"');
    expect(body).toContain('"prompt_tokens":100');
    expect(body).toContain("[DONE]");

    await vi.waitFor(() => {
      expect(storage.getAllRecords()).toHaveLength(1);
    });

    const records = storage.getAllRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.provider).toBe("openai");
    expect(record.model).toBe("gpt-4o");
    expect(record.input_tokens).toBe(100);
    expect(record.output_tokens).toBe(50);
    expect(record.cache_read_tokens).toBe(20);
    expect(record.cache_write_tokens).toBe(0);
    expect(record.cost).toBe(0.005);
    expect(record.currency).toBe("USD");
    expect(record.session_id).toBe("test-session-sse");

    expect(mockComputeCost).toHaveBeenCalledWith(
      "gpt-4o",
      100,
      50,
      20,
      0,
      "USD",
    );
  });

  it("does not persist record when SSE stream has no usage in any chunk", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      "data: [DONE]\n\n",
    ];

    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of sseChunks) {
        res.write(chunk);
      }
      res.end();
    });

    const mockComputeCost = vi.fn();

    proxy = await createProxyServer({
      port: 0,
      routes: { openai: `http://127.0.0.1:${mockProvider.port}` },
      storage,
      sessionId: "test-session",
      computeCostFn: mockComputeCost,
    });

    const res = await fetch(
      `http://127.0.0.1:${proxy.port}/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [], stream: true }),
      },
    );

    expect(res.status).toBe(200);
    await res.text();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(storage.getAllRecords()).toHaveLength(0);
    expect(mockComputeCost).not.toHaveBeenCalled();
  });
});
