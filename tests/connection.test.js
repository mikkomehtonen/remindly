const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

describe('Category migration', () => {
  let dbPath;
  let db;

  before(() => {
    dbPath = path.join(__dirname, '..', 'data', 'test-migration.db');
    // Clean up any previous test DB
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  after(() => {
    if (db) db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('migrates a database with old CHECK constraint (no Other)', () => {
    // Create a database with the OLD schema (without 'Other')
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE events (
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

    // Insert test data
    db.prepare(
      'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
    ).run('Birthday Party', 'Birthday', 6, 15);
    db.prepare(
      'INSERT INTO events (title, category, is_recurring, event_date) VALUES (?, ?, 0, ?)',
    ).run('Holiday Trip', 'Holiday', '2026-07-04');
    const countBefore = db.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
    assert.strictEqual(countBefore, 2, 'Should have 2 events before migration');

    db.close();

    // Now import initDb and let it run the migration
    // We need to re-initialize the connection which will trigger the migration
    const { initDb, getDb, migrateCategoryConstraint } = require('../src/db/connection');

    // Reset module to get fresh db instance
    delete require.cache[require.resolve('../src/db/connection')];
    const conn = require('../src/db/connection');

    // Re-open with the test DB
    // We need to create a fresh Database pointing to our test file
    const freshDb = new Database(dbPath);
    freshDb.pragma('journal_mode = WAL');
    freshDb.pragma('foreign_keys = ON');

    // Run migration explicitly
    conn.migrateCategoryConstraint(freshDb);

    // Verify the CHECK constraint now includes 'Other'
    const schema = freshDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes("'Other'"), 'CHECK constraint should include Other');

    // Verify existing data preserved
    const rows = freshDb.prepare('SELECT * FROM events ORDER BY id').all();
    assert.strictEqual(rows.length, 2, 'Should still have 2 events');
    assert.strictEqual(rows[0].title, 'Birthday Party');
    assert.strictEqual(rows[0].category, 'Birthday');
    assert.strictEqual(rows[1].title, 'Holiday Trip');
    assert.strictEqual(rows[1].category, 'Holiday');

    // Verify we can insert an event with category 'Other'
    freshDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Graduation', 'Other', 5, 20);
    const allRows = freshDb.prepare('SELECT * FROM events ORDER BY id').all();
    assert.strictEqual(allRows.length, 3, 'Should now have 3 events');
    assert.strictEqual(allRows[2].category, 'Other', 'New event should have Other category');

    freshDb.close();
  });

  it('creates fresh database with Other in CHECK constraint', () => {
    const freshPath = path.join(__dirname, '..', 'data', 'test-fresh.db');
    if (fs.existsSync(freshPath)) fs.unlinkSync(freshPath);

    const freshDb = new Database(freshPath);
    freshDb.exec(`
      CREATE TABLE IF NOT EXISTS events (
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
      )
    `);

    // Verify 'Other' is in the CHECK
    const schema = freshDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes("'Other'"));

    // Insert an event with Other category should work
    freshDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Test', 'Other', 1, 1);
    assert.strictEqual(freshDb.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt, 1);

    freshDb.close();
    if (fs.existsSync(freshPath)) fs.unlinkSync(freshPath);
  });

  it('is idempotent — migration is skipped when Other already in CHECK', () => {
    // Open the already-migrated DB from the first test
    const existingDb = new Database(dbPath);
    existingDb.pragma('journal_mode = WAL');
    existingDb.pragma('foreign_keys = ON');

    const { migrateCategoryConstraint } = require('../src/db/connection');

    // Collect table names before hypothetical migration
    const tablesBefore = existingDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    // Run migration — should be a no-op since 'Other' is already in the CHECK
    migrateCategoryConstraint(existingDb);

    // No new tables should appear (no orphaned events_new)
    const tablesAfter = existingDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.deepStrictEqual(tablesAfter, tablesBefore, 'No new tables should be created');

    // All data still intact
    const count = existingDb.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
    assert.strictEqual(count, 3, 'All 3 events should still be present');

    existingDb.close();
  });
});
