const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { csrfProtection } = require('../middleware/csrf');
const {
  resolveDate,
  formatDate,
  formatDateWithWeekday,
  getRecurringDateRange,
} = require('../utils/dateMath');
const { VALID_CATEGORIES } = require('../config/categories');

const KNOWN_ALIASES = ['today', 'tomorrow', 'this_week', 'next_week'];

// Redirect-target allowlist for packing toggles: "/" or "/?alias=<known alias>",
// built from KNOWN_ALIASES so the set stays single-sourced. Anything else
// (protocol-relative URLs, admin paths, junk) falls back to "/".
function parseReturnTo(value) {
  if (typeof value !== 'string') return '/';
  if (value === '/') return '/';
  const aliasPrefix = '/?alias=';
  if (value.startsWith(aliasPrefix)) {
    const alias = value.slice(aliasPrefix.length);
    if (KNOWN_ALIASES.includes(alias)) return `${aliasPrefix}${alias}`;
  }
  return '/';
}

/**
 * @swagger
 * /:
 *   get:
 *     summary: View upcoming events (HTML)
 *     description: Renders the public HTML page showing events for today, tomorrow, or next week
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: alias
 *         schema:
 *           type: string
 *           enum: [today, tomorrow, this_week, next_week]
 *           default: today
 *         description: Date alias for quick lookups
 *     responses:
 *       200:
 *         description: HTML page with events
 */
router.get('/', csrfProtection, (req, res) => {
  const alias = req.query.alias || 'today';
  let result;
  if (KNOWN_ALIASES.includes(alias)) {
    result = resolveDate(alias);
  } else {
    result = resolveDate('today');
  }

  if (!result) {
    return res.render('public/index', { date: 'unknown', events: [] });
  }

  const db = getDb();

  // Redirect target for packing toggles: only the four known aliases, so the
  // value is always one the toggle route's allowlist accepts.
  const returnTo = KNOWN_ALIASES.includes(alias) && alias !== 'today' ? `/?alias=${alias}` : '/';

  if (alias === 'next_week' || alias === 'this_week') {
    const events = queryEvents(db, result.startDate, result.endDate, null, true);
    return res.render('public/index', {
      date: `${formatDate(result.startDate)} to ${formatDate(result.endDate)}`,
      alias,
      events: attachPackingItems(db, events),
      isRange: true,
      returnTo,
    });
  }

  const events = queryEvents(db, result.startDate, result.endDate);
  res.render('public/index', {
    date: formatDate(result.startDate),
    alias,
    events: attachPackingItems(db, events),
    isRange: false,
    returnTo,
  });
});

router.post('/packing/items/:id/packed', csrfProtection, (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId < 1) {
    return res.status(404).render('error', { message: 'Packing item not found' });
  }

  const target = parsePacked(req.body.packed);
  if (target === null) {
    return res.status(400).render('error', { message: 'Invalid packed value' });
  }

  // Allowlist redirect: only "/" or "/?alias=<known alias>" (see parseReturnTo).
  const returnTo = parseReturnTo(req.body.returnTo);

  const db = getDb();
  const info = db
    .prepare("UPDATE event_packing_items SET packed = ?, updated_at = datetime('now') WHERE id = ?")
    .run(target, itemId);
  if (info.changes === 0) {
    return res.status(404).render('error', { message: 'Packing item not found' });
  }

  res.redirect(returnTo);
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health/readiness check
 *     description: Verifies the SQLite database is reachable and responsive
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database is reachable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *       503:
 *         description: Database is unreachable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "error"
 */
router.get('/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Query events
 *     description: Retrieve events filtered by date, alias, or category
 *     tags: [Public API]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-12-25"
 *         description: Specific date in YYYY-MM-DD format
 *       - in: query
 *         name: alias
 *         schema:
 *           type: string
 *           enum: [today, tomorrow, this_week, next_week]
 *           default: today
 *         description: Quick date alias
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           # enum populated from VALID_CATEGORIES by src/config/swagger.js
 *         description: Filter by event category
 *     responses:
 *       200:
 *         description: List of events
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 date:
 *                   type: string
 *                   example: "2024-12-25"
 *                 startDate:
 *                   type: string
 *                   example: "2024-12-25"
 *                 endDate:
 *                   type: string
 *                   example: "2024-12-31"
 *                 events:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Event'
 *       400:
 *         description: Invalid parameters
 *
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
 *         category:
 *           type: string
 *         is_recurring:
 *           type: boolean
 *         month:
 *           type: integer
 *         day:
 *           type: integer
 *         event_date:
 *           type: string
 *           format: date
 */
router.get('/api/events', (req, res) => {
  const { date, alias, category } = req.query;

  if (date && alias) {
    return res.status(400).json({ error: 'Provide either date or alias, not both' });
  }

  if (alias && !KNOWN_ALIASES.includes(alias)) {
    return res
      .status(400)
      .json({ error: 'Invalid alias. Use today, tomorrow, this_week, or next_week' });
  }

  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
    });
  }

  const resolved = resolveDate(alias || date || 'today');
  if (!resolved) {
    return res.status(400).json({ error: 'Invalid date value' });
  }

  const db = getDb();
  const events = queryEvents(db, resolved.startDate, resolved.endDate, category);

  if (alias === 'next_week' || alias === 'this_week') {
    return res.json({
      startDate: formatDate(resolved.startDate),
      endDate: formatDate(resolved.endDate),
      events,
    });
  }

  res.json({
    date: formatDate(resolved.startDate),
    events,
  });
});

// HTML-only step in the GET / handler: batch-attach packing items to the already
// sorted event list. One query regardless of event count (no N+1); SQL ordering
// (packed ASC puts packed last, id ASC tie-break) is the single ordering rule —
// never re-sort in JS. GET /api/events never calls this, so the JSON objects
// keep their current keys.
function attachPackingItems(db, events) {
  for (const e of events) e.packingItems = [];
  if (events.length === 0) return events;
  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, event_id, label, packed FROM event_packing_items
       WHERE event_id IN (${placeholders}) ORDER BY packed ASC, id ASC`,
    )
    .all(...ids);
  const byEvent = new Map(events.map((e) => [e.id, e.packingItems]));
  for (const row of rows) {
    const bucket = byEvent.get(row.event_id);
    if (bucket) bucket.push(row);
  }
  return events;
}

// Hidden-default-plus-checkbox pair: unchecked submits "packed=0", checked submits
// "packed=0&packed=1" — any "1" element means checked, "0"-only means unchecked.
// Absent or all-junk values → null (400 at the call site); the DB CHECK re-guards {0,1}.
function parsePacked(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (values.some((v) => String(v) === '1')) return 1;
  if (values.length > 0 && values.every((v) => String(v) === '0')) return 0;
  return null;
}

function queryEvents(db, startDate, endDate, category, includeWeekday = false) {
  const range = getRecurringDateRange(startDate, endDate);

  function queryRecurring(mStart, dStart, mEnd, dEnd) {
    return db
      .prepare(
        `
      SELECT id, title, description, category, is_recurring, month, day, event_date
      FROM events
      WHERE is_recurring = 1
        AND (month > ? OR (month = ? AND day >= ?))
        AND (month < ? OR (month = ? AND day <= ?))
    `,
      )
      .all(mStart, mStart, dStart, mEnd, mEnd, dEnd);
  }

  let recurringEvents;

  if (range.part1 && range.part2) {
    const r1 = queryRecurring(
      range.part1.mStart,
      range.part1.dStart,
      range.part1.mEnd,
      range.part1.dEnd,
    );
    const r2 = queryRecurring(
      range.part2.mStart,
      range.part2.dStart,
      range.part2.mEnd,
      range.part2.dEnd,
    );
    recurringEvents = [...r1, ...r2];
  } else {
    const { mStart, dStart, mEnd, dEnd } = range.single;
    recurringEvents = queryRecurring(mStart, dStart, mEnd, dEnd);
  }

  if (category) {
    recurringEvents = recurringEvents.filter((e) => e.category === category);
  }

  let fixedSql = `
    SELECT id, title, description, category, is_recurring, month, day, event_date
    FROM events
    WHERE is_recurring = 0
      AND event_date >= ?
      AND event_date <= ?
  `;
  const fixedParams = [formatDate(startDate), formatDate(endDate)];

  if (category) {
    fixedSql += ' AND category = ?';
    fixedParams.push(category);
  }

  const fixedEvents = db.prepare(fixedSql).all(...fixedParams);

  const combined = [...recurringEvents, ...fixedEvents];

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  const eventsWithDates = combined.map((e) => {
    let displayDate;
    if (e.is_recurring === 1) {
      const candidate = new Date(startDate.getFullYear(), e.month - 1, e.day);
      if (candidate.getTime() >= startMs && candidate.getTime() <= endMs) {
        displayDate = candidate;
      } else {
        displayDate = new Date(startDate.getFullYear() + 1, e.month - 1, e.day);
      }
    } else {
      displayDate = new Date(e.event_date + 'T00:00:00');
    }
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      category: e.category,
      _sortDate: displayDate,
      displayDate: includeWeekday ? formatDateWithWeekday(displayDate) : formatDate(displayDate),
    };
  });

  eventsWithDates.sort((a, b) => a._sortDate - b._sortDate);

  return eventsWithDates.map(({ _sortDate, ...rest }) => rest);
}

module.exports = router;
