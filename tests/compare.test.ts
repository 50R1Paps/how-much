import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, type Storage, type CostRecord } from "../src/storage.js";
import { loadConfig, type Subscription } from "../src/config.js";
import {
  getDaysInMonth,
  getDaysElapsed,
  calculateProRatedCost,
  compareSubscription,
  formatComparisonReport,
  formatSingleComparison,
  type ComparisonResult,
  type CurrencyConverter,
} from "../src/compare.js";

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    timestamp: new Date().toISOString(),
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost: 0.01,
    currency: "USD",
    session_id: "test-session",
    ...overrides,
  };
}

const WINDSURF: Subscription = {
  name: "windsurf",
  display_name: "Windsurf Pro",
  monthly_cost: 20,
  currency: "USD",
};

const CURSOR: Subscription = {
  name: "cursor",
  display_name: "Cursor Pro",
  monthly_cost: 20,
  currency: "USD",
};

describe("Compare vs subscription (slice 07)", () => {
  let tmpDir: string;
  let storage: Storage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "how-much-compare-"));
    storage = createStorage(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getDaysInMonth", () => {
    it("returns correct days for a 30-day month", () => {
      expect(getDaysInMonth(new Date("2026-06-15T12:00:00Z"))).toBe(30);
    });

    it("returns correct days for a 31-day month", () => {
      expect(getDaysInMonth(new Date("2026-07-15T12:00:00Z"))).toBe(31);
    });

    it("returns 28 for February in a non-leap year", () => {
      expect(getDaysInMonth(new Date("2025-02-15T12:00:00Z"))).toBe(28);
    });

    it("returns 29 for February in a leap year", () => {
      expect(getDaysInMonth(new Date("2024-02-15T12:00:00Z"))).toBe(29);
    });
  });

  describe("getDaysElapsed", () => {
    it("returns the day-of-month as elapsed days", () => {
      expect(getDaysElapsed(new Date("2026-06-15T12:00:00Z"))).toBe(15);
    });

    it("returns 1 on the first day of the month", () => {
      expect(getDaysElapsed(new Date("2026-06-01T12:00:00Z"))).toBe(1);
    });

    it("returns 30 on the last day of a 30-day month", () => {
      expect(getDaysElapsed(new Date("2026-06-30T12:00:00Z"))).toBe(30);
    });
  });

  describe("calculateProRatedCost", () => {
    it("pro-rates monthly cost by elapsed days", () => {
      const cost = calculateProRatedCost(20, 15, 30);
      expect(cost).toBeCloseTo(10, 6);
    });

    it("returns full monthly cost on the last day of the month", () => {
      const cost = calculateProRatedCost(20, 30, 30);
      expect(cost).toBeCloseTo(20, 6);
    });

    it("returns minimal cost on day 1", () => {
      const cost = calculateProRatedCost(20, 1, 30);
      expect(cost).toBeCloseTo(0.6667, 3);
    });
  });

  describe("compareSubscription", () => {
    it("returns subscription cheaper when spent < pro-rated cost", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const result = compareSubscription(WINDSURF, 5, "USD", now);

      expect(result.subscription).toEqual(WINDSURF);
      expect(result.proRatedCost).toBeCloseTo(10, 6);
      expect(result.spent).toBeCloseTo(5, 6);
      expect(result.difference).toBeCloseTo(5, 6);
      expect(result.isSubscriptionCheaper).toBe(true);
      expect(result.currency).toBe("USD");
    });

    it("returns pay-per-use cheaper when spent > pro-rated cost", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const result = compareSubscription(WINDSURF, 15, "USD", now);

      expect(result.proRatedCost).toBeCloseTo(10, 6);
      expect(result.spent).toBeCloseTo(15, 6);
      expect(result.difference).toBeCloseTo(-5, 6);
      expect(result.isSubscriptionCheaper).toBe(false);
    });

    it("converts spending currency to subscription currency", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const mockConvert: CurrencyConverter = (amount, from, to) => {
        if (from === "EUR" && to === "USD") return amount * 1.1;
        return amount;
      };
      const result = compareSubscription(WINDSURF, 5, "EUR", now, mockConvert);

      expect(result.spent).toBeCloseTo(5.5, 6);
      expect(result.difference).toBeCloseTo(4.5, 6);
      expect(result.isSubscriptionCheaper).toBe(true);
    });

    it("uses identity conversion when currencies match", () => {
      const now = new Date("2026-06-15T12:00:00Z");
      const result = compareSubscription(WINDSURF, 5, "USD", now);

      expect(result.spent).toBeCloseTo(5, 6);
    });
  });

  describe("formatSingleComparison", () => {
    it("formats output with plan name, spent, pro-rated cost, and status", () => {
      const result: ComparisonResult = {
        subscription: WINDSURF,
        spent: 5,
        proRatedCost: 10,
        difference: 5,
        isSubscriptionCheaper: true,
        currency: "USD",
        daysElapsed: 15,
        daysInMonth: 30,
      };

      const output = formatSingleComparison(result);
      expect(output).toContain("Windsurf Pro");
      expect(output).toContain("$20.00");
      expect(output).toContain("$5.0000");
      expect(output).toContain("$10.0000");
      expect(output).toContain("15/30");
      expect(output).toContain("Subscription is cheaper");
    });

    it("shows pay-per-use cheaper status when spending exceeds pro-rated cost", () => {
      const result: ComparisonResult = {
        subscription: WINDSURF,
        spent: 15,
        proRatedCost: 10,
        difference: -5,
        isSubscriptionCheaper: false,
        currency: "USD",
        daysElapsed: 15,
        daysInMonth: 30,
      };

      const output = formatSingleComparison(result);
      expect(output).toContain("Pay-per-use is cheaper");
    });

    it("uses EUR symbol for EUR currency", () => {
      const eurSub: Subscription = {
        name: "euro-plan",
        display_name: "Euro Plan",
        monthly_cost: 20,
        currency: "EUR",
      };
      const result: ComparisonResult = {
        subscription: eurSub,
        spent: 5,
        proRatedCost: 10,
        difference: 5,
        isSubscriptionCheaper: true,
        currency: "EUR",
        daysElapsed: 15,
        daysInMonth: 30,
      };

      const output = formatSingleComparison(result);
      expect(output).toContain("€20.00");
      expect(output).toContain("€5.0000");
      expect(output).toContain("€10.0000");
    });
  });

  describe("formatComparisonReport (multiple subscriptions)", () => {
    it("shows comparison for all subscriptions when no plan filter", () => {
      const results: ComparisonResult[] = [
        {
          subscription: WINDSURF,
          spent: 5,
          proRatedCost: 10,
          difference: 5,
          isSubscriptionCheaper: true,
          currency: "USD",
          daysElapsed: 15,
          daysInMonth: 30,
        },
        {
          subscription: CURSOR,
          spent: 5,
          proRatedCost: 10,
          difference: 5,
          isSubscriptionCheaper: true,
          currency: "USD",
          daysElapsed: 15,
          daysInMonth: 30,
        },
      ];

      const output = formatComparisonReport(results);
      expect(output).toContain("Windsurf Pro");
      expect(output).toContain("Cursor Pro");
    });

    it("shows only filtered subscription when plan is specified", () => {
      const results: ComparisonResult[] = [
        {
          subscription: WINDSURF,
          spent: 5,
          proRatedCost: 10,
          difference: 5,
          isSubscriptionCheaper: true,
          currency: "USD",
          daysElapsed: 15,
          daysInMonth: 30,
        },
      ];

      const output = formatComparisonReport(results);
      expect(output).toContain("Windsurf Pro");
      expect(output).not.toContain("Cursor Pro");
    });
  });

  describe("integration: storage + compare", () => {
    it("compares actual SQLite spending against subscription with pro-rated cost", () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      storage.insertRecord(
        makeRecord({ timestamp: startOfMonth.toISOString(), cost: 1.0, currency: "USD" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 1.5, currency: "USD" }),
      );

      const { start, end } = {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      };
      const records = storage.getRecordsByDateRange(start, end);
      const totalSpent = records.reduce((sum, r) => sum + (r.cost ?? 0), 0);

      const result = compareSubscription(WINDSURF, totalSpent, "USD", now);

      const daysInMonth = getDaysInMonth(now);
      const daysElapsed = getDaysElapsed(now);
      const expectedProRated = (20 / daysInMonth) * daysElapsed;

      expect(totalSpent).toBeCloseTo(2.5, 6);
      expect(result.proRatedCost).toBeCloseTo(expectedProRated, 6);
      expect(result.spent).toBeCloseTo(2.5, 6);
    });

    it("handles config with multiple subscriptions and filters by plan name", () => {
      const configPath = join(tmpDir, "config.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          currency: "USD",
          subscriptions: [WINDSURF, CURSOR],
          custom_pricing: {},
          alerts: [],
        }),
      );

      const config = loadConfig(tmpDir);
      expect(config.subscriptions).toHaveLength(2);

      const filtered = config.subscriptions.filter((s) => s.name === "windsurf");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("windsurf");
    });

    it("handles empty subscriptions gracefully", () => {
      const configPath = join(tmpDir, "config.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          currency: "USD",
          subscriptions: [],
          custom_pricing: {},
          alerts: [],
        }),
      );

      const config = loadConfig(tmpDir);
      expect(config.subscriptions).toHaveLength(0);
    });
  });
});
