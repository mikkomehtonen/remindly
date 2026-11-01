const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { VALID_CATEGORIES } = require('../config/categories');

let db;

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// CHECK clause derived from VALID_CATEGORIES so category changes never need DDL edits.
// Labels containing a single quote (') are escaped as '' before interpolation.
// Labels must not contain ')' — the migration skip predicate below slices the stored
// DDL at the first closing paren of the category IN (...) clause.
const CATEGORY_CHECK = `category IN (${VALID_CATEGORIES.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')})`;

// Single source of truth for the events table: one name/definition pair per column
// drives CREATE TABLE (initDb + migration rebuild) and the migration's explicit
// INSERT/SELECT column list, so none of the three can drift.
const EVENTS_COLUMNS = [
  { name: 'id', def: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
  { name: 'title', def: 'TEXT NOT NULL' },
  { name: 'description', def: 'TEXT DEFAULT NULL' },
  { name: 'category', def: `TEXT NOT NULL CHECK (${CATEGORY_CHECK})` },
  { name: 'is_recurring', def: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'month', def: 'INTEGER CHECK (month BETWEEN 1 AND 12)' },
  { name: 'day', def: 'INTEGER CHECK (day BETWEEN 1 AND 31)' },
  { name: 'event_date', def: "TEXT CHECK (event_date LIKE '____-__-__')" },
  { name: 'created_at', def: "TEXT NOT NULL DEFAULT (datetime('now'))" },
  { name: 'updated_at', def: "TEXT NOT NULL DEFAULT (datetime('now'))" },
];

const EVENTS_TABLE_COLUMNS = EVENTS_COLUMNS.map((c) => `${c.name.padEnd(12)} ${c.def}`).join(
  ',\n  ',
);
const EVENTS_COLUMN_NAMES = EVENTS_COLUMNS.map((c) => c.name);

function initDb(options) {
  if (options != null && (typeof options !== 'object' || !options.file)) {
    throw new TypeError('initDb expects { file } or no arguments');
  }
  // DB_FILE env override keeps test/dev runs off the production data/remindly.db.
  const dbFile =
    (options && options.file) || process.env.DB_FILE || path.join(dataDir, 'remindly.db');
  db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS events (${EVENTS_TABLE_COLUMNS})`);

  // Migration: rebuild CHECK constraint if any current category is missing
  migrateCategoryConstraint(db);

  return db;
}

function migrateCategoryConstraint(db) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
    .get();
  if (!row || !row.sql) return;

  // Extract the stored `category IN (...)` clause so detection matches label literals in
  // the CHECK itself, not elsewhere in the DDL (e.g. datetime('now')).
  const clauseStart = row.sql.indexOf('category IN (');
  const clauseEnd = clauseStart === -1 ? -1 : row.sql.indexOf(')', clauseStart);
  const categoryClause = clauseEnd === -1 ? null : row.sql.slice(clauseStart, clauseEnd);

  // Skip only if the stored CHECK already contains every current category (quote-anchored,
  // case-sensitive); otherwise rebuild to the derived schema.
  // Note: detection is one-way — REMOVING a category from VALID_CATEGORIES needs a
  // manual migration, since a stored CHECK that merely accepts extra labels still passes.
  if (
    categoryClause &&
    VALID_CATEGORIES.every((c) => categoryClause.includes(`'${c.replace(/'/g, "''")}'`))
  ) {
    return;
  }

  // Rebuild the table with updated CHECK constraint.
  // Must be in a transaction for crash safety — losing events table mid-migration
  // would orphan data in events_new on next startup (initDb() creates a fresh empty table).
  const migration = db.transaction(() => {
    db.exec(`CREATE TABLE events_new (${EVENTS_TABLE_COLUMNS})`);
    // Named columns (from EVENTS_COLUMN_NAMES) instead of `SELECT *`, so a legacy
    // schema with the same column count but different order cannot shuffle values.
    const cols = EVENTS_COLUMN_NAMES.join(', ');
    db.exec(`INSERT INTO events_new (${cols}) SELECT ${cols} FROM events`);
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

module.exports = { initDb, getDb, migrateCategoryConstraint, CATEGORY_CHECK };
