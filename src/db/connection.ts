import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.SQLITE_DB_PATH?.trim()) {
  throw new Error('Production requires an explicit SQLITE_DB_PATH');
}

const dbPath = process.env.SQLITE_DB_PATH || "./data/shiftweave.db";
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(dbPath, { fileMustExist: process.env.NODE_ENV === 'production' });

// Configure SQLite for high-concurrency microsecond access
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = FULL");
db.pragma("busy_timeout = 5000");

export default db;
