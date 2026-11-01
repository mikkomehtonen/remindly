const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { ensureAdmin, verifyPassword } = require('../middleware/auth');
const { VALID_CATEGORIES } = require('../config/categories');

/**
 * @swagger
 * components:
 *   schemas:
 *     Event:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         title:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         category:
 *           type: string
 *           # enum populated from VALID_CATEGORIES by src/config/swagger.js
 *         is_recurring:
 *           type: integer
 *           enum: [0, 1]
 *         month:
 *           type: integer
 *           nullable: true
 *           minimum: 1
 *           maximum: 12
 *         day:
 *           type: integer
 *           nullable: true
 *           minimum: 1
 *           maximum: 31
 *         event_date:
 *           type: string
 *           format: date
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     EventInput:
 *       type: object
 *       required:
 *         - title
 *         - category
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *           # enum populated from VALID_CATEGORIES by src/config/swagger.js
 *         is_recurring:
 *           type: string
 *           enum: ["0", "1"]
 *         month:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         day:
 *           type: integer
 *           minimum: 1
 *           maximum: 31
 *         event_date:
 *           type: string
 *           format: date
 *   securitySchemes:
 *     SessionAuth:
 *       type: apiKey
 *       in: cookie
 *       name: connect.sid
 *       description: Admin session cookie (set after login)
 */

/**
 * @swagger
 * /admin/login:
 *   get:
 *     summary: Login page (HTML)
 *     description: Renders the admin login page
 *     tags: [Admin - HTML]
 *     responses:
 *       200:
 *         description: HTML login form
 *   post:
 *     summary: Admin login
 *     description: Authenticate with username and password
 *     tags: [Admin - HTML]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       302:
 *         description: Redirect to admin dashboard
 *       200:
 *         description: Invalid credentials
 */
router.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null, csrfToken: req.csrfToken() });
});

router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (verifyPassword(username, password)) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'Invalid credentials', csrfToken: req.csrfToken() });
});

/**
 * @swagger
 * /admin/logout:
 *   post:
 *     summary: Admin logout
 *     description: Destroy the admin session
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     responses:
 *       302:
 *         description: Redirect to login
 */
router.post('/admin/logout', ensureAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

/**
 * @swagger
 * /admin:
 *   get:
 *     summary: Admin dashboard
 *     description: Renders the admin dashboard listing all events
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     responses:
 *       302:
 *         description: Redirect to login if not authenticated
 *       200:
 *         description: HTML dashboard with all events
 */
router.get('/admin', ensureAdmin, (req, res) => {
  const db = getDb();

  const sortableColumns = ['title', 'category', 'type', 'date'];
  const sort = sortableColumns.includes(req.query.sort) ? req.query.sort : 'date';
  const order = req.query.order === 'desc' ? 'DESC' : 'ASC';
  const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : null;

  const orderByMap = {
    title: `title COLLATE NOCASE ${order}, category, is_recurring DESC, month, day, event_date`,
    category: `category COLLATE NOCASE ${order}, title, is_recurring DESC, month, day, event_date`,
    type: `is_recurring ${order} NULLS LAST, title, category, month, day, event_date`,
    date: `is_recurring DESC, month ${order} NULLS LAST, day ${order} NULLS LAST, event_date ${order} NULLS LAST, title COLLATE NOCASE`,
  };

  const orderBy = orderByMap[sort] || orderByMap.date;

  let sql = 'SELECT * FROM events';
  const params = [];
  if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  }
  sql += ` ORDER BY ${orderBy}`;

  const events = db.prepare(sql).all(...params);
  const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;

  res.render('admin/dashboard', {
    events,
    totalCount,
    csrfToken: req.csrfToken(),
    sort,
    order,
    category,
    categories: VALID_CATEGORIES,
  });
});

/**
 * @swagger
 * /admin/events/new:
 *   get:
 *     summary: New event form
 *     description: Renders the HTML form for creating a new event
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     responses:
 *       302:
 *         description: Redirect to login if not authenticated
 *       200:
 *         description: HTML event creation form
 *
 * /admin/events:
 *   post:
 *     summary: Create event
 *     description: Create a new event (recurring or one-time)
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             $ref: '#/components/schemas/EventInput'
 *     responses:
 *       302:
 *         description: Redirect to admin dashboard on success
 *       200:
 *         description: Form with validation errors
 *       401:
 *         description: Redirect to login if not authenticated
 */
router.get('/admin/events/new', ensureAdmin, (req, res) => {
  res.render('admin/eventForm', {
    event: null,
    errors: [],
    categories: VALID_CATEGORIES,
    csrfToken: req.csrfToken(),
    packingItems: [],
  });
});

router.post('/admin/events', ensureAdmin, (req, res) => {
  const db = getDb();
  const errors = validateEvent(req.body);
  const packingRows = parsePackingItems(req.body);
  const isTravel = req.body.category === 'Travel';
  if (isTravel) {
    // Create: no items exist yet, so any submitted id is invalid.
    errors.push(...validatePackingItems(db, packingRows, null));
  }
  if (errors.length > 0) {
    return res.render('admin/eventForm', {
      event: req.body,
      errors,
      categories: VALID_CATEGORIES,
      csrfToken: req.csrfToken(),
      packingItems: packingItemsFromBody(req.body),
    });
  }

  const { title, description, category } = req.body;
  const isRecurring = req.body.is_recurring === '1' || req.body.is_recurring === 1;

  const create = db.transaction(() => {
    let eventId;
    if (isRecurring) {
      eventId = db
        .prepare(
          `
          INSERT INTO events (title, description, category, is_recurring, month, day, event_date, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?, NULL, datetime('now'), datetime('now'))
        `,
        )
        .run(
          title,
          description || null,
          category,
          parseInt(req.body.month, 10),
          parseInt(req.body.day, 10),
        ).lastInsertRowid;
    } else {
      eventId = db
        .prepare(
          `
          INSERT INTO events (title, description, category, is_recurring, month, day, event_date, created_at, updated_at)
          VALUES (?, ?, ?, 0, NULL, NULL, ?, datetime('now'), datetime('now'))
        `,
        )
        .run(title, description || null, category, req.body.event_date).lastInsertRowid;
    }

    // Category gate is the real enforcement: item fields are synced only for Travel.
    if (isTravel) {
      syncPackingItems(db, eventId, packingRows);
    }
  });
  create();

  res.redirect('/admin');
});

/**
 * @swagger
 * /admin/events/{id}/edit:
 *   get:
 *     summary: Edit event form
 *     description: Renders the HTML form for editing an existing event
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Event ID
 *     responses:
 *       302:
 *         description: Redirect to login if not authenticated
 *       404:
 *         description: Event not found
 *       200:
 *         description: HTML event edit form
 *
 * /admin/events/{id}:
 *   put:
 *     summary: Update event
 *     description: Update an existing event (recurring or one-time)
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Event ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             $ref: '#/components/schemas/EventInput'
 *     responses:
 *       302:
 *         description: Redirect to admin dashboard on success
 *       200:
 *         description: Form with validation errors
 *       404:
 *         description: Event not found
 *       401:
 *         description: Redirect to login if not authenticated
 *   delete:
 *     summary: Delete event
 *     description: Permanently delete an event
 *     tags: [Admin]
 *     security:
 *       - SessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Event ID
 *     responses:
 *       302:
 *         description: Redirect to admin dashboard on success
 *       401:
 *         description: Redirect to login if not authenticated
 */
router.get('/admin/events/:id/edit', ensureAdmin, (req, res) => {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    return res.status(404).render('error', { message: 'Event not found' });
  }
  const packingItems = db
    .prepare('SELECT id, label FROM event_packing_items WHERE event_id = ? ORDER BY id ASC')
    .all(event.id);
  res.render('admin/eventForm', {
    event,
    errors: [],
    categories: VALID_CATEGORIES,
    csrfToken: req.csrfToken(),
    packingItems,
  });
});

router.put('/admin/events/:id', ensureAdmin, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).render('error', { message: 'Event not found' });
  }

  const eventId = Number(req.params.id);
  const errors = validateEvent(req.body);
  const packingRows = parsePackingItems(req.body);
  const isTravel = req.body.category === 'Travel';
  if (isTravel) {
    errors.push(...validatePackingItems(db, packingRows, eventId));
  }
  if (errors.length > 0) {
    return res.render('admin/eventForm', {
      event: { ...req.body, id: req.params.id },
      errors,
      categories: VALID_CATEGORIES,
      csrfToken: req.csrfToken(),
      packingItems: packingItemsFromBody(req.body),
    });
  }

  const { title, description, category } = req.body;
  const isRecurring = req.body.is_recurring === '1' || req.body.is_recurring === 1;

  const update = db.transaction(() => {
    if (isRecurring) {
      db.prepare(
        `
        UPDATE events
        SET title = ?, description = ?, category = ?, is_recurring = 1,
            month = ?, day = ?, event_date = NULL, updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(
        title,
        description || null,
        category,
        parseInt(req.body.month, 10),
        parseInt(req.body.day, 10),
        req.params.id,
      );
    } else {
      db.prepare(
        `
        UPDATE events
        SET title = ?, description = ?, category = ?, is_recurring = 0,
            month = NULL, day = NULL, event_date = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(title, description || null, category, req.body.event_date, req.params.id);
    }

    // Category gate: switching Travel to another category hides the items but
    // leaves the rows untouched, so switching back restores them.
    if (isTravel) {
      syncPackingItems(db, eventId, packingRows);
    }
  });
  update();

  res.redirect('/admin');
});

router.delete('/admin/events/:id', ensureAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

function validateEvent(body) {
  const errors = [];
  if (!body.title || !body.title.trim()) {
    errors.push('Title is required');
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    errors.push(`Category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  const isRecurring = body.is_recurring === '1' || body.is_recurring === 1;
  if (isRecurring) {
    const month = parseInt(body.month, 10);
    const day = parseInt(body.day, 10);
    if (!month || month < 1 || month > 12) {
      errors.push('Month must be between 1 and 12');
    }
    if (!day || day < 1 || day > 31) {
      errors.push('Day must be between 1 and 31');
    }
  } else {
    if (!body.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
      errors.push('Event date is required in YYYY-MM-DD format');
    }
  }

  return errors;
}

// Packing items ride along in the one event form as two index-aligned parallel
// arrays: packing_item_ids[] (existing rows only) and packing_items[] (every row).
// express.urlencoded({ extended: true }) turns repeated name[] into an array;
// a single submission arrives as a string, hence [].concat.
// Shared zipper for both consumers below — they must walk the arrays identically,
// or ids silently misalign with labels on the error re-render.
function zipPackingRows(body) {
  const labels = [].concat(body.packing_items || []);
  const ids = [].concat(body.packing_item_ids || []);
  const zipped = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i] == null ? '' : String(labels[i]);
    const rawId = ids[i] == null ? '' : String(ids[i]);
    zipped.push({ label, rawId });
  }
  return zipped;
}

// Row id states: null = no id submitted (new row), number = valid id,
// NaN = junk id submitted (0, leading zeros, non-numeric) — rejected at validation,
// never silently treated as a new row.
function parsePackingItems(body) {
  const rows = [];
  for (const { label, rawId } of zipPackingRows(body)) {
    const trimmed = label.trim();
    if (trimmed === '') continue; // blank row: new row ignored; existing row leaves the kept set = deleted
    const idText = rawId.trim();
    let id = null;
    if (idText !== '') {
      // AUTOINCREMENT ids always start at 1; reject 0 and leading zeros.
      id = /^[1-9]\d*$/.test(idText) ? Number(idText) : NaN;
    }
    rows.push({ id, label: trimmed });
  }
  return rows;
}

// Error re-render keeps every submitted row (raw ids included) so ids stay aligned
// with labels and a validation failure never silently deletes items.
function packingItemsFromBody(body) {
  const items = [];
  for (const { label, rawId } of zipPackingRows(body)) {
    if (label.trim() === '' && rawId.trim() === '') continue;
    items.push({ id: rawId, label });
  }
  return items;
}

// eventId === null means create: no items exist yet, so any submitted id is unknown.
function validatePackingItems(db, rows, eventId) {
  const errors = [];
  if (rows.length > 50) {
    errors.push('A travel event can have at most 50 packing items');
  }
  if (rows.some((r) => r.label.length > 200)) {
    errors.push('Packing item labels must be 200 characters or fewer');
  }
  let unknown = false;
  for (const r of rows) {
    if (Number.isNaN(r.id)) {
      unknown = true;
      break;
    }
    if (r.id !== null) {
      if (eventId === null) {
        unknown = true;
        break;
      }
      const exists = db
        .prepare('SELECT 1 FROM event_packing_items WHERE id = ? AND event_id = ?')
        .get(r.id, eventId);
      if (!exists) {
        unknown = true;
        break;
      }
    }
  }
  if (unknown) {
    errors.push('Unknown packing item');
  }
  return errors;
}

// Add = fill a blank row, edit = change the text, delete = clear the text.
// The AND event_id = ? clause in the UPDATE is the cross-event tamper guard.
// `kept` collects every row that survived this sync — submitted ids AND freshly
// inserted ids — so the delete pass (which deliberately runs AFTER the inserts)
// removes only existing rows that fell out of the submission (cleared text /
// omitted row), never the rows just inserted.
function syncPackingItems(db, eventId, rows) {
  const kept = new Set();
  for (const r of rows) {
    // r.id is null (new row) or an integer >= 1 here: validatePackingItems already
    // rejected NaN junk ids, so plain truthiness is safe.
    if (r.id) {
      db.prepare(
        "UPDATE event_packing_items SET label = ?, updated_at = datetime('now') WHERE id = ? AND event_id = ?",
      ).run(r.label, r.id, eventId);
      kept.add(r.id);
    } else {
      const info = db
        .prepare('INSERT INTO event_packing_items (event_id, label) VALUES (?, ?)')
        .run(eventId, r.label);
      kept.add(info.lastInsertRowid);
    }
  }
  for (const row of db
    .prepare('SELECT id FROM event_packing_items WHERE event_id = ?')
    .all(eventId)) {
    if (!kept.has(row.id)) {
      db.prepare('DELETE FROM event_packing_items WHERE id = ?').run(row.id);
    }
  }
}

module.exports = router;
