import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProxyServer, type ProxyServer } from "../src/proxy.js";

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

async function startProxy(
  routes: Record<string, string>,
): Promise<ProxyServer> {
  return createProxyServer({ port: 0, routes });
}

async function fetchProxy(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, options);
}

describe("Proxy server", () => {
  let mockProvider: { server: Server; port: number };
  let proxy: ProxyServer;

  afterEach(async () => {
    if (proxy) await proxy.close();
    if (mockProvider) await stopServer(mockProvider.server);
  });

  it("returns 400 with explicit message for unknown provider path", async () => {
    mockProvider = await startMockProvider((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startProxy({
      openai: `http://127.0.0.1:${mockProvider.port}`,
    });

    const res = await fetchProxy(proxy.port, "/unknown/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown provider");
    expect(body.error).toContain("unknown");
  });

  it("handles concurrent requests without blocking", async () => {
    let requestCount = 0;
    const delays = [200, 100, 300];

    mockProvider = await startMockProvider((req, res) => {
      const index = requestCount++;
      const delay = delays[index] ?? 50;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestIndex: index }));
      }, delay);
    });

    proxy = await startProxy({
      openai: `http://127.0.0.1:${mockProvider.port}`,
    });

    const start = Date.now();

    const requests = [0, 1, 2].map((i) =>
      fetchProxy(proxy.port, "/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer sk-test-${i}`,
        },
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      }),
    );

    const responses = await Promise.all(requests);
    const elapsed = Date.now() - start;

    expect(responses).toHaveLength(3);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const bodies = await Promise.all(responses.map((r) => r.json()));
    const indices = bodies.map((b: any) => b.requestIndex).sort();
    expect(indices).toEqual([0, 1, 2]);

    expect(elapsed).toBeLessThan(500);
  });

  it("forwards requests to /openai/ path with Authorization header preserved", async () => {
    let receivedAuth: string | undefined;
    let receivedPath: string | undefined;
    let receivedMethod: string | undefined;

    mockProvider = await startMockProvider((req, res) => {
      receivedAuth = req.headers["authorization"];
      receivedPath = req.url;
      receivedMethod = req.method;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    proxy = await startProxy({
      openai: `http://127.0.0.1:${mockProvider.port}`,
    });

    const res = await fetchProxy(proxy.port, "/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test-key",
      },
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(receivedAuth).toBe("Bearer sk-test-key");
    expect(receivedPath).toBe("/v1/chat/completions");
    expect(receivedMethod).toBe("POST");
  });
});
