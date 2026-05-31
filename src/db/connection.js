const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function initDb() {
  db = new Database(path.join(dataDir, 'remindly.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      category    TEXT NOT NULL CHECK (
        category IN ('Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary')
      ),
      is_recurring INTEGER NOT NULL DEFAULT 0,
      month       INTEGER CHECK (month BETWEEN 1 AND 12),
      day         INTEGER CHECK (day BETWEEN 1 AND 31),
      event_date  TEXT CHECK (event_date LIKE '____-__-__'),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = { initDb, getDb };
