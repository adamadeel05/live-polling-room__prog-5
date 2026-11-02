import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);

  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY,
        poll_id INTEGER NOT NULL CHECK (poll_id > 0),
        option_id INTEGER NOT NULL CHECK (option_id > 0),
        participant_id TEXT NOT NULL CHECK (length(participant_id) BETWEEN 1 AND 100),
        UNIQUE (poll_id, participant_id)
      );
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
