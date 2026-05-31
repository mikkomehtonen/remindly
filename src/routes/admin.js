const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { ensureAdmin, verifyPassword } = require('../middleware/auth');

const VALID_CATEGORIES = ['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'];

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

router.post('/admin/logout', ensureAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/admin', ensureAdmin, (req, res) => {
  const db = getDb();
  const events = db
    .prepare(
      `
    SELECT * FROM events
    ORDER BY
      is_recurring DESC,
      month ASC NULLS LAST,
      day ASC NULLS LAST,
      event_date ASC NULLS LAST
  `,
    )
    .all();
  res.render('admin/dashboard', { events, csrfToken: req.csrfToken() });
});

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
