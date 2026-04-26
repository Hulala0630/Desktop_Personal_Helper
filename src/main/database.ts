import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';

let database: Database.Database | null = null;

const createSchema = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_input TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sequence INTEGER
    );

    CREATE TABLE IF NOT EXISTS ai_digest_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const columns = db.prepare(`PRAGMA table_info(chat_logs)`).all() as Array<{ name: string }>;
  const hasSequence = columns.some((column) => column.name === 'sequence');

  if (!hasSequence) {
    db.exec(`ALTER TABLE chat_logs ADD COLUMN sequence INTEGER`);
    db.exec(`UPDATE chat_logs SET sequence = rowid WHERE sequence IS NULL`);
  }
};

export const getDatabase = () => {
  if (database) {
    return database;
  }

  const dbPath = path.join(app.getPath('userData'), 'desktop-pet-agent.db');
  database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  createSchema(database);
  return database;
};
