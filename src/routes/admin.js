const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { ensureAdmin, verifyPassword } = require('../middleware/auth');

const VALID_CATEGORIES = ['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'];

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
 *           enum: [Birthday, Name Day, Flag Day, Holiday, Anniversary]
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
 *           enum: [Birthday, Name Day, Flag Day, Holiday, Anniversary]
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
    csrfToken: req.csrfToken(),
  });
});

router.post('/admin/events', ensureAdmin, (req, res) => {
  const db = getDb();
  const errors = validateEvent(req.body);
  if (errors.length > 0) {
    return res.render('admin/eventForm', {
      event: req.body,
      errors,
      csrfToken: req.csrfToken(),
    });
  }

  const { title, description, category } = req.body;
  const isRecurring = req.body.is_recurring === '1' || req.body.is_recurring === 1;

  if (isRecurring) {
    db.prepare(
      `
      INSERT INTO events (title, description, category, is_recurring, month, day, event_date, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, NULL, datetime('now'), datetime('now'))
    `,
    ).run(
      title,
      description || null,
      category,
      parseInt(req.body.month, 10),
      parseInt(req.body.day, 10),
    );
  } else {
    db.prepare(
      `
      INSERT INTO events (title, description, category, is_recurring, month, day, event_date, created_at, updated_at)
      VALUES (?, ?, ?, 0, NULL, NULL, ?, datetime('now'), datetime('now'))
    `,
    ).run(title, description || null, category, req.body.event_date);
  }

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
  res.render('admin/eventForm', {
    event,
    errors: [],
    csrfToken: req.csrfToken(),
  });
});

router.put('/admin/events/:id', ensureAdmin, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).render('error', { message: 'Event not found' });
  }

  const errors = validateEvent(req.body);
  if (errors.length > 0) {
    return res.render('admin/eventForm', {
      event: { ...req.body, id: req.params.id },
      errors,
      csrfToken: req.csrfToken(),
    });
  }

  const { title, description, category } = req.body;
  const isRecurring = req.body.is_recurring === '1' || req.body.is_recurring === 1;

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

module.exports = router;
