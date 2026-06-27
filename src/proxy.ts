import { createServer, type Server } from "node:http";
import { extractUsage, extractUsageFromSSE } from "./adapters/openai.js";
import { calculateCost, type CostCalculator } from "./cost.js";
import type { Storage } from "./storage.js";

export interface ProxyOptions {
  port: number;
  routes: Record<string, string>;
  storage?: Storage;
  sessionId?: string;
  currency?: string;
  computeCostFn?: CostCalculator;
}

export interface ProxyServer {
  port: number;
  close: () => Promise<void>;
}

export function createProxyServer(options: ProxyOptions): Promise<ProxyServer> {
  return new Promise((resolve, reject) => {
    const {
      port,
      routes,
      storage,
      sessionId,
      currency = "USD",
      computeCostFn = calculateCost,
    } = options;

    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "", `http://localhost`);
        const pathSegments = url.pathname.split("/").filter(Boolean);

        if (pathSegments.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No provider specified in path" }));
          return;
        }

        const providerKey = pathSegments[0];
        const targetBase = routes[providerKey];

        if (!targetBase) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Unknown provider "${providerKey}". Known providers: ${Object.keys(routes).join(", ")}`,
            }),
          );
          return;
        }

        const remainingPath = "/" + pathSegments.slice(1).join("/");
        const targetUrl = new URL(remainingPath, targetBase);
        if (url.search) {
          targetUrl.search = url.search;
        }

        const forwardHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (key === "host") continue;
          if (Array.isArray(value)) {
            forwardHeaders[key] = value.join(", ");
          } else if (value !== undefined) {
            forwardHeaders[key] = value;
          }
        }

        const response = await fetch(targetUrl.toString(), {
          method: req.method || "GET",
          headers: forwardHeaders,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
          duplex: "half",
        } as RequestInit);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        res.writeHead(response.status, responseHeaders);

        if (response.body) {
          const contentType = response.headers.get("content-type") || "";
          const isStreaming = contentType.includes("text/event-stream");
          const shouldTrack = !!storage;

          const reader = response.body.getReader();
          const chunks: Buffer[] = [];
          const pump = async (): Promise<void> => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
              if (shouldTrack) {
                chunks.push(Buffer.from(value));
              }
            }
            res.end();

            if (shouldTrack && chunks.length > 0) {
              const body = Buffer.concat(chunks).toString("utf-8");
              const usage = isStreaming
                ? extractUsageFromSSE(body)
                : extractUsage(body);
              if (usage) {
                let cost: number | null = null;
                try {
                  cost = await computeCostFn(
                    usage.model,
                    usage.inputTokens,
                    usage.outputTokens,
                    usage.cacheReadTokens,
                    usage.cacheWriteTokens,
                    currency,
                  );
                } catch {
                  console.warn(`⚠ Unknown model: ${usage.model}`);
                }
                storage!.insertRecord({
                  timestamp: new Date().toISOString(),
                  provider: providerKey,
                  model: usage.model,
                  input_tokens: usage.inputTokens,
                  output_tokens: usage.outputTokens,
                  cache_read_tokens: usage.cacheReadTokens,
                  cache_write_tokens: usage.cacheWriteTokens,
                  cost,
                  currency,
                  session_id: sessionId ?? "",
                });
              }
            }
          };
          pump().catch((err) => {
            console.error("Stream error:", err);
            res.end();
          });
        } else {
          res.end();
        }
      } catch (err) {
        console.error("Proxy error:", err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Proxy error" }));
        } else {
          res.end();
        }
      }
    });

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const actualPort =
        port === 0 ? (server.address() as { port: number }).port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}
