import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let database;
let activePath;

export function getDatabase() {
  const databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'mikrotik-ai.db');
  if (database && activePath === databasePath) return database;
  database?.close();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  database = new Database(databasePath);
  activePath = databasePath;
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS routers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, encrypted_password TEXT NOT NULL, secure INTEGER NOT NULL, allow_self_signed INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS routers_user_id ON routers(user_id);
  `);
  return database;
}
