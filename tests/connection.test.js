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

describe('Packing items table', () => {
  // PRAGMA-level shape guard, same pattern as EXPECTED_COLUMN_TYPES for events.
  const EXPECTED_PACKING_COLUMN_TYPES = [
    'id:INTEGER',
    'event_id:INTEGER',
    'label:TEXT',
    'packed:INTEGER',
    'created_at:TEXT',
    'updated_at:TEXT',
  ];

  function packingColumnTypes(db) {
    return db
      .prepare('PRAGMA table_info(event_packing_items)')
      .all()
      .map((c) => `${c.name}:${c.type}`);
  }

  function insertEvent(db, title, category) {
    return db
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, 6, 15)',
      )
      .run(title, category).lastInsertRowid;
  }

  it('fresh initDb creates event_packing_items with pinned schema, index, and working constraints', () => {
    const freshPath = path.join(__dirname, '..', 'data', 'test-packing-fresh.db');
    removeTestDb(freshPath);

    delete require.cache[require.resolve('../src/db/connection')];
    const { initDb } = require('../src/db/connection');
    const freshDb = initDb({ file: freshPath });

    assert.deepStrictEqual(
      packingColumnTypes(freshDb),
      EXPECTED_PACKING_COLUMN_TYPES,
      'generated schema must declare the expected column types',
    );

    const indexes = freshDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_packing_items_event'")
      .all();
    assert.strictEqual(indexes.length, 1, 'lookup index idx_packing_items_event must exist');

    // Valid child row: packed defaults to 0
    const eventId = insertEvent(freshDb, 'City Break', 'Travel');
    const insert = freshDb
      .prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)')
      .run(eventId, 'Passport');
    assert.strictEqual(insert.changes, 1);
    const item = freshDb
      .prepare('SELECT event_id, label, packed FROM event_packing_items WHERE id = ?')
      .get(insert.lastInsertRowid);
    assert.strictEqual(item.packed, 0, 'packed must default to 0');
    assert.strictEqual(item.event_id, eventId);

    // CHECK constraint rejects packed values outside {0, 1}
    assert.throws(
      () =>
        freshDb
          .prepare('INSERT INTO event_packing_items (event_id, label, packed) VALUES (?, ?, ?)')
          .run(eventId, 'Toothbrush', 2),
      /CHECK constraint failed/,
    );

    // FK enforcement: no softening (initDb opens with PRAGMA foreign_keys = ON)
    assert.throws(
      () =>
        freshDb
          .prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)')
          .run(4242, 'Ghost item'),
      /FOREIGN KEY constraint failed/,
    );

    freshDb.close();
    removeTestDb(freshPath);
    delete require.cache[require.resolve('../src/db/connection')];
  });

  it('ensurePackingItemsTable upgrades a legacy events-only database without touching events', () => {
    const legacyPath = path.join(__dirname, '..', 'data', 'test-packing-legacy.db');
    removeTestDb(legacyPath);

    const legacyDb = new Database(legacyPath);
    legacyDb.pragma('foreign_keys = ON');
    legacyDb.exec(
      legacyEventsTableDDL(['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other', 'Travel']),
    );
    legacyDb
      .prepare(
        'INSERT INTO events (title, category, is_recurring, month, day) VALUES (?, ?, 1, ?, ?)',
      )
      .run('Ski Trip', 'Travel', 2, 10);
    legacyDb
      .prepare('INSERT INTO events (title, category, is_recurring, event_date) VALUES (?, ?, 0, ?)')
      .run('Family Reunion', 'Anniversary', '2026-08-01');
    const eventsBefore = legacyDb.prepare('SELECT * FROM events ORDER BY id').all();

    const { ensurePackingItemsTable } = require('../src/db/connection');
    ensurePackingItemsTable(legacyDb);

    const table = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_packing_items'")
      .get();
    assert.ok(table, 'event_packing_items must be created');
    assert.deepStrictEqual(
      packingColumnTypes(legacyDb),
      EXPECTED_PACKING_COLUMN_TYPES,
      'upgraded schema must match the fresh schema',
    );
    assert.strictEqual(
      legacyDb.prepare('SELECT COUNT(*) as cnt FROM event_packing_items').get().cnt,
      0,
      'new table must start empty',
    );

    // Both events preserved byte-identically, and no rebuild leftovers
    assert.deepStrictEqual(
      legacyDb.prepare('SELECT * FROM events ORDER BY id').all(),
      eventsBefore,
      'events must survive unchanged',
    );
    const strays = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_new'")
      .all();
    assert.strictEqual(strays.length, 0, 'no *_new tables may be left behind');

    legacyDb.close();
    removeTestDb(legacyPath);
  });

  it('ensurePackingItemsTable is idempotent when run twice in a row', () => {
    const twicePath = path.join(__dirname, '..', 'data', 'test-packing-twice.db');
    removeTestDb(twicePath);

    const d = new Database(twicePath);
    d.pragma('foreign_keys = ON');
    d.exec(
      legacyEventsTableDDL(['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary', 'Other', 'Travel']),
    );
    const { ensurePackingItemsTable } = require('../src/db/connection');
    ensurePackingItemsTable(d);

    const eventId = insertEvent(d, 'Cabin Weekend', 'Travel');
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      eventId,
      'Hiking boots',
    );
    const schemaBefore = d
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_packing_items'")
      .get().sql;
    const indexesBefore = d
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_packing_items_event'")
      .all().length;

    ensurePackingItemsTable(d);

    const schemaAfter = d
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_packing_items'")
      .get().sql;
    assert.strictEqual(schemaAfter, schemaBefore, 'schema must be untouched on second run');
    assert.deepStrictEqual(
      packingColumnTypes(d),
      EXPECTED_PACKING_COLUMN_TYPES,
      'column types must be unchanged on second run',
    );
    assert.strictEqual(
      d.prepare('SELECT COUNT(*) as cnt FROM event_packing_items').get().cnt,
      1,
      'row count must be unchanged on second run',
    );
    const indexesAfter = d
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_packing_items_event'")
      .all().length;
    assert.strictEqual(indexesAfter, indexesBefore, 'index count must be unchanged');

    d.close();
    removeTestDb(twicePath);
  });

  it('category rebuild does not cascade-delete packing items via the DROP TABLE', () => {
    const migPath = path.join(__dirname, '..', 'data', 'test-packing-migration.db');
    removeTestDb(migPath);

    const d = new Database(migPath);
    d.pragma('foreign_keys = ON');
    // Events table predates Travel, so migrateCategoryConstraint WILL fire the rebuild.
    d.exec(
      legacyEventsTableDDL(['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary']),
    );
    const { migrateCategoryConstraint, ensurePackingItemsTable } = require('../src/db/connection');
    ensurePackingItemsTable(d);

    const eventId = insertEvent(d, 'Cabin Weekend', 'Birthday');
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      eventId,
      'Hiking boots',
    );
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      eventId,
      'Stove',
    );

    migrateCategoryConstraint(d);

    // The DROP TABLE events must not trigger ON DELETE CASCADE on the children.
    assert.deepStrictEqual(
      d
        .prepare('SELECT label FROM event_packing_items WHERE event_id = ? ORDER BY id')
        .all(eventId)
        .map((r) => r.label),
      ['Hiking boots', 'Stove'],
      'packing items must survive the category rebuild',
    );
    const schema = d
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'")
      .get();
    assert.ok(schema.sql.includes(CATEGORY_CHECK), 'rebuild must still have fired');
    // foreign_keys must be back ON after the rebuild: FK enforcement is alive again.
    assert.strictEqual(
      d.pragma('foreign_keys', { simple: true }),
      1,
      'foreign_keys pragma must be restored to ON',
    );
    assert.throws(
      () =>
        d
          .prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)')
          .run(4242, 'Ghost item'),
      /FOREIGN KEY constraint failed/,
    );

    d.close();
    removeTestDb(migPath);
  });

  it('deleting an event cascades to its packing items but not other events', () => {
    const cascadePath = path.join(__dirname, '..', 'data', 'test-packing-cascade.db');
    removeTestDb(cascadePath);

    delete require.cache[require.resolve('../src/db/connection')];
    const { initDb } = require('../src/db/connection');
    const d = initDb({ file: cascadePath });

    const targetId = insertEvent(d, 'Ski Trip', 'Travel');
    const otherId = insertEvent(d, 'City Break', 'Travel');
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      targetId,
      'Skis',
    );
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      targetId,
      'Gloves',
    );
    d.prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)').run(
      otherId,
      'Passport',
    );

    d.prepare('DELETE FROM events WHERE id = ?').run(targetId);

    assert.strictEqual(
      d.prepare('SELECT COUNT(*) as cnt FROM event_packing_items WHERE event_id = ?').get(targetId)
        .cnt,
      0,
      'ON DELETE CASCADE must remove exactly the deleted event children',
    );
    const survivors = d
      .prepare('SELECT label FROM event_packing_items WHERE event_id = ?')
      .all(otherId);
    assert.deepStrictEqual(
      survivors.map((r) => r.label),
      ['Passport'],
      "other events' children must stay intact",
    );

    d.close();
    removeTestDb(cascadePath);
    delete require.cache[require.resolve('../src/db/connection')];
  });
});
