const { describe, it } = require('node:test');
const assert = require('node:assert');
const { resolveDate, formatDate, formatDateWithWeekday, WEEKDAY_ABBREVS, getRecurringDateRange } = require('../src/utils/dateMath');

describe('resolveDate', () => {
  it('resolves today', () => {
    const result = resolveDate('today');
    assert.ok(result);
    assert.ok(result.startDate instanceof Date);
    assert.ok(result.endDate instanceof Date);
    assert.strictEqual(formatDate(result.startDate), formatDate(result.endDate));
  });

  it('resolves tomorrow', () => {
    const result = resolveDate('tomorrow');
    assert.ok(result);
    const now = resolveDate('today');
    const diff = (result.startDate.getTime() - now.startDate.getTime()) / (1000 * 60 * 60 * 24);
    assert.strictEqual(diff, 1);
  });

  it('resolves next_week', () => {
    const result = resolveDate('next_week');
    assert.ok(result);
    const diff =
      (result.endDate.getTime() - result.startDate.getTime()) / (1000 * 60 * 60 * 24);
    assert.strictEqual(diff, 6);
    assert.strictEqual(result.startDate.getDay(), 1);
  });

  it('resolves this_week', () => {
    const result = resolveDate('this_week');
    assert.ok(result);
    const diff =
      (result.endDate.getTime() - result.startDate.getTime()) / (1000 * 60 * 60 * 24);
    assert.strictEqual(diff, 6);
    assert.strictEqual(result.startDate.getDay(), 1);
  });

  it('resolves explicit date', () => {
    const result = resolveDate('2026-12-25');
    assert.ok(result);
    assert.strictEqual(formatDate(result.startDate), '2026-12-25');
  });

  it('rejects invalid date format', () => {
    assert.strictEqual(resolveDate('not-a-date'), null);
    assert.strictEqual(resolveDate('2026-13-01'), null);
  });

  it('rejects date out of range', () => {
    assert.strictEqual(resolveDate('1999-01-01'), null);
    assert.strictEqual(resolveDate('2100-01-01'), null);
  });
});

describe('WEEKDAY_ABBREVS', () => {
  it('is a frozen array of 7 strings', () => {
    assert.deepStrictEqual(WEEKDAY_ABBREVS, ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    assert.strictEqual(Object.isFrozen(WEEKDAY_ABBREVS), true);
    assert.strictEqual(WEEKDAY_ABBREVS.length, 7);
  });
});

describe('formatDate', () => {
  it('formats date correctly', () => {
    const d = new Date(2026, 4, 30);
    assert.strictEqual(formatDate(d), '2026-05-30');
  });

  it('pads single-digit months and days', () => {
    const d = new Date(2026, 0, 5);
    assert.strictEqual(formatDate(d), '2026-01-05');
  });
});

describe('formatDateWithWeekday', () => {
  it('returns YYYY-MM-DD Dd for Saturday', () => {
    const d = new Date(2026, 5, 20);
    assert.strictEqual(formatDateWithWeekday(d), '2026-06-20 Sa');
  });

  it('returns YYYY-MM-DD Dd for Monday', () => {
    const d = new Date(2026, 0, 5);
    assert.strictEqual(formatDateWithWeekday(d), '2026-01-05 Mo');
  });

  it('returns YYYY-MM-DD Dd for Sunday', () => {
    const d = new Date(2026, 11, 27);
    assert.strictEqual(formatDateWithWeekday(d), '2026-12-27 Su');
  });

  it('includes weekday abbreviation after a space', () => {
    const d = new Date(2026, 4, 30);
    const result = formatDateWithWeekday(d);
    assert.ok(result.includes(' '));
    const [datePart, abbr] = result.split(' ');
    assert.strictEqual(datePart, '2026-05-30');
    assert.strictEqual(abbr.length, 2);
  });

  it('does not change formatDate behaviour', () => {
    const d = new Date(2026, 4, 30);
    assert.strictEqual(formatDate(d), '2026-05-30');
  });
});

describe('getRecurringDateRange', () => {
  it('handles single-day range', () => {
    const start = new Date(2026, 4, 30);
    const end = new Date(2026, 4, 30);
    const range = getRecurringDateRange(start, end);
    assert.ok(range.single);
    assert.strictEqual(range.single.mStart, 5);
    assert.strictEqual(range.single.dStart, 30);
  });

  it('handles multi-day range same month', () => {
    const start = new Date(2026, 5, 8);
    const end = new Date(2026, 5, 14);
    const range = getRecurringDateRange(start, end);
    assert.ok(range.single);
    assert.strictEqual(range.single.mStart, 6);
    assert.strictEqual(range.single.mEnd, 6);
  });

  it('handles year-boundary wrap', () => {
    const start = new Date(2026, 11, 29);
    const end = new Date(2027, 0, 4);
    const range = getRecurringDateRange(start, end);
    assert.ok(range.part1);
    assert.ok(range.part2);
    assert.strictEqual(range.part1.mEnd, 12);
    assert.strictEqual(range.part2.mStart, 1);
  });
});
