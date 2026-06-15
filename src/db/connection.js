const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Single source of truth for events table column definitions.
// Both initDb() and migrateCategoryConstraint() use this to avoid DDL drift.
const EVENTS_TABLE_COLUMNS = `
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  category    TEXT NOT NULL CHECK (
    category IN ('Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other')
  ),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  month       INTEGER CHECK (month BETWEEN 1 AND 12),
  day         INTEGER CHECK (day BETWEEN 1 AND 31),
  event_date  TEXT CHECK (event_date LIKE '____-__-__'),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
`;

function initDb() {
  db = new Database(path.join(dataDir, 'remindly.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS events (${EVENTS_TABLE_COLUMNS})`);

  // Migration: add 'Other' to CHECK constraint if missing
  migrateCategoryConstraint(db);

  return db;
}

function migrateCategoryConstraint(db) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
    .get();
  if (!row || !row.sql) return;

  // If 'Other' already appears in the CHECK clause, no migration needed
  if (row.sql.includes("'Other'")) return;

  // Rebuild the table with updated CHECK constraint.
  // Must be in a transaction for crash safety — losing events table mid-migration
  // would orphan data in events_new on next startup (initDb() creates a fresh empty table).
  const migration = db.transaction(() => {
    db.exec(`CREATE TABLE events_new (${EVENTS_TABLE_COLUMNS})`);
    db.exec('INSERT INTO events_new SELECT * FROM events');
    db.exec('DROP TABLE events');
    db.exec('ALTER TABLE events_new RENAME TO events');
  });
  migration();
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

module.exports = { initDb, getDb, migrateCategoryConstraint };
