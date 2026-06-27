import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

export interface CostRecord {
  timestamp: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost: number | null;
  currency: string;
  session_id: string;
}

export interface Storage {
  insertRecord(record: CostRecord): void;
  getAllRecords(): CostRecord[];
  close(): void;
}

export function createStorage(dbPath: string): Storage {
  const db = new Database(dbPath) as DatabaseType;

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      cost REAL,
      currency TEXT NOT NULL,
      session_id TEXT NOT NULL
    )
  `);

  const insertStmt = db.prepare(`
    INSERT INTO cost_records (
      timestamp, provider, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, cost, currency, session_id
    ) VALUES (
      @timestamp, @provider, @model, @input_tokens, @output_tokens,
      @cache_read_tokens, @cache_write_tokens, @cost, @currency, @session_id
    )
  `);

  return {
    insertRecord(record: CostRecord) {
      insertStmt.run(record);
    },
    getAllRecords(): CostRecord[] {
      return db.prepare("SELECT * FROM cost_records").all() as CostRecord[];
    },
    close() {
      db.close();
    },
  };
}
