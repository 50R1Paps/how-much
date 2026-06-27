# how-much

> Local proxy that tracks LLM API costs in real time.

`how-much` sits between your application and LLM provider APIs (OpenAI-compatible), transparently intercepting every request to extract token usage, calculate cost, and persist it to a local SQLite database — all while streaming responses back to your app with zero latency overhead.

## Features

- **Transparent proxying** — Forwards requests to any OpenAI-compatible API, preserving headers, method, and body
- **Real-time cost tracking** — Extracts `usage` from both standard JSON and SSE streaming responses
- **Live CLI output** — Prints per-request cost, token counts, and running session total as requests flow through
- **SQLite storage** — All cost records persisted locally in `~/.how-much/how-much.db`
- **Spending reports** — `today`, `week`, `month` commands with optional `--by-model` breakdown
- **Subscription comparison** — Compare actual pay-per-use spending against subscription plans (pro-rated daily)
- **Multi-currency** — Configurable display currency (EUR, USD, etc.)
- **Cache token support** — Tracks cached/prompt cache read tokens for accurate cost calculation

## Quick start

```bash
# Install dependencies
npm install

# Start the proxy (defaults to port 8080)
npm run dev
```

Now point your app to the proxy instead of the real API:

```bash
# Before
OPENAI_BASE_URL=https://api.openai.com/v1

# After
OPENAI_BASE_URL=http://localhost:8080/openai/v1
```

Every API call will be logged in real time:

```
how-much proxy listening on http://localhost:8080
Routes:
  /openai/* → https://api.openai.com/*
[14:32:01] openai/gpt-4o | in: 1200 out: 350 | $0.0089 | session: $0.01
[14:32:15] openai/gpt-4o-mini | in: 500 out: 100 | $0.0005 | session: $0.01
[14:33:02] openai/gpt-4o | in: 2000 out: 800 | $0.0150 | session: $0.03
```

## CLI usage

```
how-much                    Start the proxy server (default command)
how-much today              Show total spending for today
how-much week               Show total spending for the last 7 days
how-much month              Show total spending for the current month
how-much compare            Compare actual spending vs subscription cost
```

### Options

| Command | Option | Description |
|---|---|---|
| `today` | `--by-model` | Show breakdown by model |
| `week` | `--by-model` | Show breakdown by model |
| `month` | `--by-model` | Show breakdown by model |
| `compare` | `--plan <name>` | Compare against a specific subscription plan |

### Report examples

```bash
# Today's total spend
how-much today

# Output:
# Spending — today (2026-06-27)
#
#   Total: €0.0350
#   Calls: 12

# Breakdown by model
how-much month --by-model

# Output:
# Spending by model — this month (June 2026)
#
#   Model         Calls  Input    Output   Cost
#   ────────────────────────────────────────────────
#   gpt-4o            8   12400     3200   €0.0890
#   gpt-4o-mini      15    3200      800   €0.0050
#
#   Total: €0.0940
```

### Subscription comparison

```bash
how-much compare

# Output:
# Plan: Windsurf Pro ($20.00/month)
#   Spent this month: $2.5000
#   Pro-rated subscription cost (15/30 days): $10.0000
#   Status: ✅ Subscription is cheaper by $7.5000

# Plan: Cursor Pro ($20.00/month)
#   Spent this month: $2.5000
#   Pro-rated subscription cost (15/30 days): $10.0000
#   Status: ✅ Subscription is cheaper by $7.5000
```

## Configuration

On first run, `how-much` creates a config file at `~/.how-much/config.json`:

```json
{
  "currency": "EUR",
  "subscriptions": [],
  "custom_pricing": {},
  "alerts": []
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `currency` | `string` | Display currency for cost calculation (`"EUR"`, `"USD"`, etc.) |
| `subscriptions` | `Subscription[]` | Subscription plans to compare against |
| `custom_pricing` | `object` | Custom pricing overrides (reserved for future use) |
| `alerts` | `array` | Spending alerts (reserved for future use) |

### Subscription format

```json
{
  "name": "windsurf",
  "display_name": "Windsurf Pro",
  "monthly_cost": 20,
  "currency": "USD"
}
```

### Example config with subscriptions

```json
{
  "currency": "USD",
  "subscriptions": [
    {
      "name": "windsurf",
      "display_name": "Windsurf Pro",
      "monthly_cost": 20,
      "currency": "USD"
    },
    {
      "name": "cursor",
      "display_name": "Cursor Pro",
      "monthly_cost": 20,
      "currency": "USD"
    }
  ],
  "custom_pricing": {},
  "alerts": []
}
```

## How it works

```
Your App ──→ how-much proxy (localhost:8080) ──→ OpenAI API
                        │
                        ├── Streams response back to your app in real time
                        ├── Extracts usage data from response body
                        ├── Calculates cost via @atenareply/tokenpricing
                        ├── Persists record to SQLite
                        └── Prints formatted line to terminal
```

The proxy transparently forwards all requests, preserving headers (including `Authorization`), HTTP method, query parameters, and request body. For streaming responses (`text/event-stream`), chunks are forwarded to the client immediately while being buffered to extract usage data from the final SSE chunk.

## Project structure

```
src/
├── index.ts           # CLI entry point (commander) — proxy, reports, compare
├── proxy.ts           # HTTP proxy server with streaming support
├── storage.ts         # SQLite storage layer (better-sqlite3)
├── cost.ts            # Cost calculation via @atenareply/tokenpricing
├── config.ts          # Config file loading/creation (~/.how-much/config.json)
├── reports.ts         # Spending reports (total + by-model breakdown)
├── compare.ts         # Subscription comparison with pro-rated cost
├── format.ts          # Terminal output formatting for live proxy lines
└── adapters/
    └── openai.ts      # OpenAI usage extraction (JSON + SSE)

tests/
├── proxy.test.ts          # Proxy routing, header forwarding, concurrency
├── cost-tracking.test.ts  # Usage extraction, cost persistence, SSE streaming
├── streaming-live.test.ts # Live CLI formatting, onRecord callback, session totals
├── config.test.ts         # Config loading, defaults, currency
├── reports.test.ts        # Date ranges, totals, model breakdowns
└── compare.test.ts        # Pro-rating, subscription comparison, formatting
```

## Development

```bash
# Run in dev mode (tsx, no build needed)
npm run dev

# Type-check
npm run typecheck

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Tech stack

- **TypeScript** — strict mode, ES2022 modules
- **Node.js** — native `fetch`, `http` server, no external HTTP framework
- **commander** — CLI argument parsing
- **better-sqlite3** — embedded SQLite storage
- **chalk** — terminal output coloring
- **@atenareply/tokenpricing** — LLM token cost calculation
- **vitest** — test runner

## Data storage

All cost records are stored in SQLite at `~/.how-much/how-much.db`:

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Auto-increment primary key |
| `timestamp` | TEXT | ISO 8601 timestamp |
| `provider` | TEXT | Provider key (e.g. `openai`) |
| `model` | TEXT | Model name (e.g. `gpt-4o`) |
| `input_tokens` | INTEGER | Prompt tokens |
| `output_tokens` | INTEGER | Completion tokens |
| `cache_read_tokens` | INTEGER | Cached prompt tokens |
| `cache_write_tokens` | INTEGER | Cache creation tokens |
| `cost` | REAL | Calculated cost (null if model unknown) |
| `currency` | TEXT | Currency code |
| `session_id` | TEXT | Proxy session UUID |

## License

MIT
