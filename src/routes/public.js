const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const {
  resolveDate,
  formatDate,
  formatDateWithWeekday,
  getRecurringDateRange,
} = require('../utils/dateMath');

const VALID_CATEGORIES = ['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'];

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
router.get('/', (req, res) => {
  const alias = req.query.alias || 'today';
  let result;
  if (['today', 'tomorrow', 'this_week', 'next_week'].includes(alias)) {
    result = resolveDate(alias);
  } else {
    result = resolveDate('today');
  }

  if (!result) {
    return res.render('public/index', { date: 'unknown', events: [] });
  }

  const db = getDb();

  if (alias === 'next_week' || alias === 'this_week') {
    const events = queryEvents(db, result.startDate, result.endDate, null, true);
    return res.render('public/index', {
      date: `${formatDate(result.startDate)} to ${formatDate(result.endDate)}`,
      alias,
      events,
      isRange: true,
    });
  }

  const events = queryEvents(db, result.startDate, result.endDate);
  res.render('public/index', { date: formatDate(result.startDate), alias, events, isRange: false });
});

/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Query events
 *     description: Retrieve events filtered by date, alias, or category
 *     tags: [Public API]
 *     security:
 *       - ApiKeyAuth: []
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
 *           enum: [Birthday, Name Day, Flag Day, Holiday, Anniversary]
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
 *       401:
 *         description: Missing or invalid API key
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

  if (alias && !['today', 'tomorrow', 'this_week', 'next_week'].includes(alias)) {
    return res
      .status(400)
      .json({ error: 'Invalid alias. Use today, tomorrow, this_week, or next_week' });
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
    });
  }

  const resolved = resolveDate(alias || date);
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
