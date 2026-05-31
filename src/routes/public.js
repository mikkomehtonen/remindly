const express = require('express');
const router = express.Router();
const { getDb } = require('../db/connection');
const { resolveDate, formatDate, getRecurringDateRange } = require('../utils/dateMath');

const VALID_CATEGORIES = ['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'];

router.get('/', (req, res) => {
  const alias = req.query.alias || 'today';
  let result;
  if (['today', 'tomorrow', 'next_week'].includes(alias)) {
    result = resolveDate(alias);
  } else {
    result = resolveDate('today');
  }

  if (!result) {
    return res.render('public/index', { date: 'unknown', events: [] });
  }

  const db = getDb();
  const events = queryEvents(db, result.startDate, result.endDate);

  if (alias === 'next_week') {
    return res.render('public/index', {
      date: `${formatDate(result.startDate)} to ${formatDate(result.endDate)}`,
      events,
    });
  }

  res.render('public/index', { date: formatDate(result.startDate), events });
});

router.get('/api/events', (req, res) => {
  const { date, alias, category } = req.query;

  if (date && alias) {
    return res.status(400).json({ error: 'Provide either date or alias, not both' });
  }

  if (alias && !['today', 'tomorrow', 'next_week'].includes(alias)) {
    return res.status(400).json({ error: 'Invalid alias. Use today, tomorrow, or next_week' });
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

  if (alias === 'next_week') {
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

function queryEvents(db, startDate, endDate, category) {
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

  return combined.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    category: e.category,
  }));
}

module.exports = router;
