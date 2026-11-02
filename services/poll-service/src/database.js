import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);

  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY,
        question TEXT NOT NULL,
        room_code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        host_token_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY,
        poll_id INTEGER NOT NULL REFERENCES polls(id),
        text TEXT NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE (poll_id, position)
      );
    `);

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
