import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStorage, type Storage, type CostRecord } from "../src/storage.js";
import {
  calculateTotal,
  groupByModel,
  getDateRange,
  formatTotalReport,
  formatModelBreakdownReport,
} from "../src/reports.js";

function makeRecord(
  overrides: Partial<CostRecord> = {},
): CostRecord {
  return {
    timestamp: new Date().toISOString(),
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost: 0.01,
    currency: "EUR",
    session_id: "test-session",
    ...overrides,
  };
}

describe("Report commands (slice 06)", () => {
  let tmpDir: string;
  let storage: Storage;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "how-much-report-"));
    storage = createStorage(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("storage.getRecordsByDateRange", () => {
    it("returns only records within the date range", () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      storage.insertRecord(
        makeRecord({ timestamp: twoDaysAgo.toISOString(), model: "gpt-4" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: yesterday.toISOString(), model: "gpt-4o" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), model: "gpt-4o-mini" }),
      );

      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const records = storage.getRecordsByDateRange(
        start.toISOString(),
        end.toISOString(),
      );

      expect(records).toHaveLength(2);
      expect(records.map((r) => r.model)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("returns empty array when no records match", () => {
      const records = storage.getRecordsByDateRange(
        "2020-01-01T00:00:00.000Z",
        "2020-01-02T00:00:00.000Z",
      );
      expect(records).toEqual([]);
    });
  });

  describe("calculateTotal", () => {
    it("sums costs of all records with non-null cost", () => {
      const records = [
        makeRecord({ cost: 0.01 }),
        makeRecord({ cost: 0.02 }),
        makeRecord({ cost: 0.005 }),
      ];
      const { total, untracked } = calculateTotal(records);
      expect(total).toBeCloseTo(0.035, 6);
      expect(untracked).toBe(0);
    });

    it("counts null-cost records as untracked and excludes from total", () => {
      const records = [
        makeRecord({ cost: 0.01 }),
        makeRecord({ cost: null, model: "unknown-model" }),
        makeRecord({ cost: 0.02 }),
      ];
      const { total, untracked } = calculateTotal(records);
      expect(total).toBeCloseTo(0.03, 6);
      expect(untracked).toBe(1);
    });

    it("returns zero total for empty records", () => {
      const { total, untracked } = calculateTotal([]);
      expect(total).toBe(0);
      expect(untracked).toBe(0);
    });
  });

  describe("groupByModel", () => {
    it("groups records by model and sums tokens and cost", () => {
      const records = [
        makeRecord({ model: "gpt-4o", input_tokens: 100, output_tokens: 50, cost: 0.01 }),
        makeRecord({ model: "gpt-4o", input_tokens: 200, output_tokens: 100, cost: 0.02 }),
        makeRecord({ model: "gpt-4o-mini", input_tokens: 50, output_tokens: 25, cost: 0.005 }),
      ];
      const breakdown = groupByModel(records);

      expect(breakdown).toHaveLength(2);

      const gpt4o = breakdown.find((b) => b.model === "gpt-4o")!;
      expect(gpt4o.calls).toBe(2);
      expect(gpt4o.inputTokens).toBe(300);
      expect(gpt4o.outputTokens).toBe(150);
      expect(gpt4o.totalCost).toBeCloseTo(0.03, 6);

      const mini = breakdown.find((b) => b.model === "gpt-4o-mini")!;
      expect(mini.calls).toBe(1);
      expect(mini.inputTokens).toBe(50);
      expect(mini.outputTokens).toBe(25);
      expect(mini.totalCost).toBeCloseTo(0.005, 6);
    });

    it("sorts by totalCost descending", () => {
      const records = [
        makeRecord({ model: "cheap-model", cost: 0.001 }),
        makeRecord({ model: "expensive-model", cost: 0.1 }),
        makeRecord({ model: "mid-model", cost: 0.01 }),
      ];
      const breakdown = groupByModel(records);
      expect(breakdown[0].model).toBe("expensive-model");
      expect(breakdown[1].model).toBe("mid-model");
      expect(breakdown[2].model).toBe("cheap-model");
    });

    it("treats null cost as 0 in breakdown", () => {
      const records = [
        makeRecord({ model: "unknown-model", cost: null }),
      ];
      const breakdown = groupByModel(records);
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0].totalCost).toBe(0);
    });
  });

  describe("getDateRange", () => {
    it("today: starts at midnight, ends tomorrow", () => {
      const { start, end, label } = getDateRange("today");
      const startDate = new Date(start);
      const endDate = new Date(end);

      expect(startDate.getHours()).toBe(0);
      expect(startDate.getMinutes()).toBe(0);
      expect(startDate.getSeconds()).toBe(0);
      expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
      expect(label).toContain("today");
    });

    it("week: starts 7 days ago", () => {
      const { start, end, label } = getDateRange("week");
      const startDate = new Date(start);
      const now = new Date();
      const diffDays = (now.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);

      expect(diffDays).toBeCloseTo(7, 1);
      expect(label).toContain("last 7 days");
    });

    it("month: starts on 1st of current month", () => {
      const { start, label } = getDateRange("month");
      const startDate = new Date(start);
      const now = new Date();

      expect(startDate.getDate()).toBe(1);
      expect(startDate.getMonth()).toBe(now.getMonth());
      expect(startDate.getFullYear()).toBe(now.getFullYear());
      expect(label).toContain("this month");
    });
  });

  describe("formatTotalReport", () => {
    it("includes period label, total cost, and call count", () => {
      const records = [
        makeRecord({ cost: 0.01 }),
        makeRecord({ cost: 0.02 }),
      ];
      const output = formatTotalReport("today (2026-06-27)", records, "EUR");
      expect(output).toContain("today (2026-06-27)");
      expect(output).toContain("0.0300");
      expect(output).toContain("Calls: 2");
    });

    it("shows untracked count when there are null-cost records", () => {
      const records = [
        makeRecord({ cost: 0.01 }),
        makeRecord({ cost: null, model: "unknown" }),
      ];
      const output = formatTotalReport("today", records, "EUR");
      expect(output).toContain("Untracked");
      expect(output).toContain("1 call(s)");
    });

    it("does not show untracked line when all costs are non-null", () => {
      const records = [makeRecord({ cost: 0.01 })];
      const output = formatTotalReport("today", records, "EUR");
      expect(output).not.toContain("Untracked");
    });
  });

  describe("formatModelBreakdownReport", () => {
    it("shows per-model table with calls, tokens, and cost", () => {
      const records = [
        makeRecord({ model: "gpt-4o", input_tokens: 100, output_tokens: 50, cost: 0.02 }),
        makeRecord({ model: "gpt-4o", input_tokens: 200, output_tokens: 100, cost: 0.01 }),
        makeRecord({ model: "gpt-4o-mini", input_tokens: 50, output_tokens: 25, cost: 0.005 }),
      ];
      const output = formatModelBreakdownReport("this month", records, "EUR");

      expect(output).toContain("this month");
      expect(output).toContain("gpt-4o");
      expect(output).toContain("gpt-4o-mini");
      expect(output).toContain("Model");
      expect(output).toContain("Calls");
      expect(output).toContain("Input");
      expect(output).toContain("Output");
      expect(output).toContain("0.0300"); // gpt-4o total
    });

    it("includes total and untracked count at the bottom", () => {
      const records = [
        makeRecord({ model: "gpt-4o", cost: 0.01 }),
        makeRecord({ model: "unknown", cost: null }),
      ];
      const output = formatModelBreakdownReport("this month", records, "EUR");
      expect(output).toContain("Total:");
      expect(output).toContain("Untracked");
    });
  });

  describe("integration: storage + reports", () => {
    it("today report shows only today's records", () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      storage.insertRecord(
        makeRecord({ timestamp: twoDaysAgo.toISOString(), cost: 0.5, model: "old-model" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 0.01, model: "gpt-4o" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 0.02, model: "gpt-4o-mini" }),
      );

      const { start, end, label } = getDateRange("today");
      const records = storage.getRecordsByDateRange(start, end);
      const { total } = calculateTotal(records);

      expect(records).toHaveLength(2);
      expect(total).toBeCloseTo(0.03, 6);
      expect(records.every((r) => r.model !== "old-model")).toBe(true);

      const output = formatTotalReport(label, records, "EUR");
      expect(output).toContain("0.0300");
    });

    it("week report includes records from last 7 days", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      storage.insertRecord(
        makeRecord({ timestamp: tenDaysAgo.toISOString(), cost: 1.0, model: "ancient" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: threeDaysAgo.toISOString(), cost: 0.1, model: "gpt-4o" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 0.05, model: "gpt-4o" }),
      );

      const { start, end } = getDateRange("week");
      const records = storage.getRecordsByDateRange(start, end);

      expect(records).toHaveLength(2);
      expect(records.every((r) => r.model !== "ancient")).toBe(true);
    });

    it("month report includes only current month records", () => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

      storage.insertRecord(
        makeRecord({ timestamp: lastMonth.toISOString(), cost: 2.0, model: "last-month" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: startOfMonth.toISOString(), cost: 0.1, model: "gpt-4o" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 0.2, model: "gpt-4o-mini" }),
      );

      const { start, end } = getDateRange("month");
      const records = storage.getRecordsByDateRange(start, end);

      expect(records).toHaveLength(2);
      expect(records.every((r) => r.model !== "last-month")).toBe(true);
    });

    it("--by-model breakdown groups correctly across mixed dates", () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      storage.insertRecord(
        makeRecord({ timestamp: yesterday.toISOString(), model: "gpt-4o", cost: 0.01, input_tokens: 100, output_tokens: 50 }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), model: "gpt-4o", cost: 0.02, input_tokens: 200, output_tokens: 100 }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), model: "claude-3", cost: 0.03, input_tokens: 300, output_tokens: 150 }),
      );

      const { start, end, label } = getDateRange("week");
      const records = storage.getRecordsByDateRange(start, end);
      const breakdown = groupByModel(records);

      expect(breakdown).toHaveLength(2);

      const gpt4o = breakdown.find((b) => b.model === "gpt-4o")!;
      expect(gpt4o.calls).toBe(2);
      expect(gpt4o.inputTokens).toBe(300);
      expect(gpt4o.outputTokens).toBe(150);
      expect(gpt4o.totalCost).toBeCloseTo(0.03, 6);

      const claude = breakdown.find((b) => b.model === "claude-3")!;
      expect(claude.calls).toBe(1);
      expect(claude.totalCost).toBeCloseTo(0.03, 6);

      const output = formatModelBreakdownReport(label, records, "EUR");
      expect(output).toContain("gpt-4o");
      expect(output).toContain("claude-3");
    });

    it("null-cost records are shown in untracked count but excluded from total", () => {
      const now = new Date();

      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: 0.05, model: "gpt-4o" }),
      );
      storage.insertRecord(
        makeRecord({ timestamp: now.toISOString(), cost: null, model: "unknown-xyz" }),
      );

      const { start, end, label } = getDateRange("today");
      const records = storage.getRecordsByDateRange(start, end);
      const { total, untracked } = calculateTotal(records);

      expect(total).toBeCloseTo(0.05, 6);
      expect(untracked).toBe(1);

      const output = formatTotalReport(label, records, "EUR");
      expect(output).toContain("0.0500");
      expect(output).toContain("Untracked");
      expect(output).toContain("1 call(s)");
    });
  });
});
