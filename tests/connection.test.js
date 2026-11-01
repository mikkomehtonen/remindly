const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { VALID_CATEGORIES } = require('../src/config/categories');
const { CATEGORY_CHECK } = require('../src/db/connection');

function removeTestDb(dbFile) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + suffix)) fs.unlinkSync(dbFile + suffix);
  }
}

// Frozen snapshot of the historical events DDL for migration fixtures. Only the
// category list varies between fixtures; everything else stayed stable across versions.
function legacyEventsTableDDL(categories) {
  return `
    CREATE TABLE events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      category    TEXT NOT NULL CHECK (
        category IN (${categories.map((c) => `'${c}'`).join(', ')})
      ),
      is_recurring INTEGER NOT NULL DEFAULT 0,
      month       INTEGER CHECK (month BETWEEN 1 AND 12),
      day         INTEGER CHECK (day BETWEEN 1 AND 31),
      event_date  TEXT CHECK (event_date LIKE '____-__-__'),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;
}

// PRAGMA-level shape guard: the generated/rebuilt schema must keep the documented
// column types (INTEGER/TEXT), which CHECK-clause string assertions alone cannot catch.
const EXPECTED_COLUMN_TYPES = [
  'id:INTEGER',
  'title:TEXT',
  'description:TEXT',
  'category:TEXT',
  'is_recurring:INTEGER',
  'month:INTEGER',
  'day:INTEGER',
  'event_date:TEXT',
  'created_at:TEXT',
  'updated_at:TEXT',
];

function columnTypes(db) {
  return db.prepare('PRAGMA table_info(events)').all().map((c) => `${c.name}:${c.type}`);
}

describe('Category migration', () => {
  let dbPath;
  let db;

  before(() => {
    dbPath = path.join(__dirname, '..', 'data', 'test-migration.db');
    // Clean up any previous test DB (including WAL/SHM sidecars)
    removeTestDb(dbPath);
  });

  after(() => {
    if (db) db.close();
    removeTestDb(dbPath);
  });

  it('migrates a database with old CHECK constraint (no Other)', () => {
    // Create a database with the OLD schema (without 'Other')
    db = new Database(dbPath);
    db.exec(legacyEventsTableDDL(['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary']));

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

    // Verify the CHECK constraint now includes every current category (single rebuild
    // brings a pre-'Other' schema fully up to date, including 'Travel')
    const schema = freshDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes("'Other'"), 'CHECK constraint should include Other');
    assert.ok(schema.sql.includes("'Travel'"), 'CHECK constraint should include Travel');
    assert.deepStrictEqual(columnTypes(freshDb), EXPECTED_COLUMN_TYPES, 'column types preserved');

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

  it('migrates a database that has Other but is missing Travel', () => {
    const partialPath = path.join(__dirname, '..', 'data', 'test-other-no-travel.db');
    removeTestDb(partialPath);

    const partialDb = new Database(partialPath);
    // Schema exactly as produced before 'Travel' was added: CHECK has Other, no Travel
    partialDb.exec(
      legacyEventsTableDDL(['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other']),
    );
    partialDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Graduation', 'Other', 5, 20);
    partialDb
      .prepare('INSERT INTO events (title, category, is_recurring, event_date) VALUES (?, ?, 0, ?)')
      .run('Family Reunion', 'Anniversary', '2026-08-01');
    const rowsBefore = partialDb.prepare('SELECT * FROM events ORDER BY id').all();

    const { migrateCategoryConstraint } = require('../src/db/connection');
    migrateCategoryConstraint(partialDb);

    // Stored schema SQL now includes 'Travel', embedded via the derived CHECK
    const schema = partialDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes("'Travel'"), 'CHECK constraint should include Travel');
    assert.ok(schema.sql.includes(CATEGORY_CHECK), 'rebuilt table must embed the derived CHECK');
    assert.deepStrictEqual(columnTypes(partialDb), EXPECTED_COLUMN_TYPES, 'column types preserved');

    // No orphaned events_new — the rebuild is one atomic transaction
    const tables = partialDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'events_new'")
      .all();
    assert.strictEqual(tables.length, 0, 'events_new must not remain');

    // All pre-existing rows preserved with identical column values
    const rowsAfter = partialDb.prepare('SELECT * FROM events ORDER BY id').all();
    assert.deepStrictEqual(rowsAfter, rowsBefore, 'rows must survive migration unchanged');

    // Inserting category 'Travel' now succeeds
    partialDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Ski Trip', 'Travel', 2, 10);
    assert.strictEqual(partialDb.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt, 3);

    partialDb.close();
    removeTestDb(partialPath);
  });

  it('skips migration when CHECK already contains all current categories (idempotent)', () => {
    const upToDatePath = path.join(__dirname, '..', 'data', 'test-up-to-date.db');
    removeTestDb(upToDatePath);

    // Build the "already up to date" fixture with production initDb, so its DDL is the
    // real generated schema — a hand-transcribed copy could drift and invalidate the
    // schema-unchanged assertion below.
    delete require.cache[require.resolve('../src/db/connection')];
    const { initDb, migrateCategoryConstraint } = require('../src/db/connection');
    const upToDateDb = initDb({ file: upToDatePath });

    upToDateDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('City Break', 'Travel', 7, 4);

    // Fixture premise: production DDL embeds the derived CHECK with every category
    const schemaBefore = upToDateDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get().sql;
    assert.ok(schemaBefore.includes(CATEGORY_CHECK), 'fixture must embed the derived CHECK');
    const rowsBefore = upToDateDb.prepare('SELECT * FROM events ORDER BY id').all();

    migrateCategoryConstraint(upToDateDb);

    // No new tables created and schema untouched
    const tablesAfter = upToDateDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(!tablesAfter.includes('events_new'), 'no events_new should be created');
    const schemaAfter = upToDateDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get().sql;
    assert.strictEqual(schemaAfter, schemaBefore, 'schema should be untouched on skip');

    // All data still intact
    assert.deepStrictEqual(
      upToDateDb.prepare('SELECT * FROM events ORDER BY id').all(),
      rowsBefore,
      'rows must be untouched on skip',
    );
    assert.strictEqual(upToDateDb.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt, 1);

    upToDateDb.close();
    removeTestDb(upToDatePath);
    delete require.cache[require.resolve('../src/db/connection')];
  });

  it('initDb creates a fresh database with CHECK derived from VALID_CATEGORIES', () => {
    const initPath = path.join(__dirname, '..', 'data', 'test-init-derived.db');
    removeTestDb(initPath);

    delete require.cache[require.resolve('../src/db/connection')];
    const { initDb } = require('../src/db/connection');
    const freshDb = initDb({ file: initPath });

    // The created schema must embed the exact CHECK clause derived from VALID_CATEGORIES
    // (proves generation from config, not a hardcoded category list).
    const schema = freshDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes(CATEGORY_CHECK), 'fresh schema must embed the derived CHECK');
    for (const c of VALID_CATEGORIES) {
      assert.ok(schema.sql.includes(`'${c}'`), `fresh CHECK constraint should include ${c}`);
    }
    assert.deepStrictEqual(
      columnTypes(freshDb),
      EXPECTED_COLUMN_TYPES,
      'generated schema must declare the expected column types',
    );

    // Travel inserts cleanly...
    freshDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Railway Pass', 'Travel', 3, 3);
    assert.strictEqual(freshDb.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt, 1);

    // ...and an unknown category is rejected by the CHECK constraint
    assert.throws(
      () =>
        freshDb
          .prepare(
            'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
          )
          .run('Fancy Break', 'Vacation', 3, 3),
      /CHECK constraint failed/,
    );

    freshDb.close();
    removeTestDb(initPath);
    // Drop the module whose singleton points at the now-deleted test file, so later
    // tests get a fresh connection instead of a closed handle.
    delete require.cache[require.resolve('../src/db/connection')];
  });

  it('initDb rejects malformed options instead of silently opening the production DB', () => {
    const probeFile = path.join(__dirname, '..', 'data', 'test-guard-probe.db');
    const { initDb } = require('../src/db/connection');
    assert.throws(() => initDb(probeFile), TypeError);
    assert.throws(() => initDb({}), TypeError);
    assert.throws(() => initDb({ dbFile: probeFile }), TypeError);
    assert.throws(() => initDb(42), TypeError);
    // If the guard ever regressed these probes may exist; clean up either way.
    removeTestDb(probeFile);
  });

  it('rebuilds when a current category is missing from the IN clause but appears elsewhere in the DDL', () => {
    const outsidePath = path.join(__dirname, '..', 'data', 'test-outside-clause.db');
    removeTestDb(outsidePath);

    const d = new Database(outsidePath);
    // 'Travel' appears OUTSIDE the category IN (...) clause (title CHECK).
    // A whole-DDL `.includes("'Travel'")` predicate would wrongly skip; the
    // clause-scoped predicate must still rebuild.
    d.exec(`
      CREATE TABLE events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL CHECK (title <> 'Travel'),
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
    d.prepare(
      'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
    ).run('Birthday Party', 'Birthday', 6, 15);

    const { migrateCategoryConstraint } = require('../src/db/connection');
    migrateCategoryConstraint(d);

    const schema = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'").get();
    assert.ok(schema.sql.includes(CATEGORY_CHECK), 'rebuild must embed the derived CHECK');
    assert.deepStrictEqual(columnTypes(d), EXPECTED_COLUMN_TYPES, 'rebuild must preserve column types');
    d.prepare(
      'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
    ).run('Ski Trip', 'Travel', 2, 10);
    assert.strictEqual(d.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt, 2);

    d.close();
    removeTestDb(outsidePath);
  });
});
