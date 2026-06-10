function resolveDate(input) {
  const helsinkiNow = getHelsinkiDate();

  let startDate;

  if (input === 'today') {
    startDate = helsinkiNow;
  } else if (input === 'tomorrow') {
    startDate = new Date(helsinkiNow);
    startDate.setDate(startDate.getDate() + 1);
  } else if (input === 'this_week') {
    const dayOfWeek = helsinkiNow.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate = new Date(helsinkiNow);
    startDate.setDate(startDate.getDate() + daysUntilMonday);
  } else if (input === 'next_week') {
    const dayOfWeek = helsinkiNow.getDay();
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    startDate = new Date(helsinkiNow);
    startDate.setDate(startDate.getDate() + daysUntilNextMonday);
  } else {
    const parts = input.split('-');
    if (parts.length !== 3) return null;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (
      isNaN(year) ||
      isNaN(month) ||
      isNaN(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      year < 2000 ||
      year > 2099
    ) {
      return null;
    }

    startDate = new Date(year, month - 1, day);
    if (
      startDate.getFullYear() !== year ||
      startDate.getMonth() !== month - 1 ||
      startDate.getDate() !== day
    ) {
      return null;
    }
  }

  const endDate =
    input === 'next_week' || input === 'this_week'
      ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6)
      : new Date(startDate);

  return { startDate, endDate };
}

function getHelsinkiDate() {
  const now = new Date();
  const helsinkiStr = now.toLocaleString('en-US', { timeZone: 'Europe/Helsinki' });
  const helsinkiDate = new Date(helsinkiStr);
  return new Date(helsinkiDate.getFullYear(), helsinkiDate.getMonth(), helsinkiDate.getDate());
}

const WEEKDAY_ABBREVS = Object.freeze(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);

function formatDateWithWeekday(date) {
  return `${formatDate(date)} ${WEEKDAY_ABBREVS[date.getDay()]}`;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getRecurringDateRange(startDate, endDate) {
  const mStart = startDate.getMonth() + 1;
  const dStart = startDate.getDate();
  const mEnd = endDate.getMonth() + 1;
  const dEnd = endDate.getDate();

  if (mStart > mEnd || (mStart === mEnd && dStart > dEnd)) {
    return {
      part1: { mStart, dStart, mEnd: 12, dEnd: 31 },
      part2: { mStart: 1, dStart: 1, mEnd, dEnd },
    };
  }

  return { single: { mStart, dStart, mEnd, dEnd } };
}

module.exports = {
  resolveDate,
  formatDate,
  formatDateWithWeekday,
  WEEKDAY_ABBREVS,
  getRecurringDateRange,
};
