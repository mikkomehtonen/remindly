const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { documentFromHtml, windowFromHtml } = require('./helpers/dom');
const { getDb, initDb } = require('../src/db/connection');
const { VALID_CATEGORIES } = require('../src/config/categories');
const { resolveDate, formatDate } = require('../src/utils/dateMath');

const BASE = 'http://localhost:9999';

function request(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Parse Set-Cookie header(s) into a flat cookie string for subsequent requests.
 */
function parseCookies(res) {
  const cookies = res.headers['set-cookie'];
  if (!cookies) return '';
  if (Array.isArray(cookies)) {
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }
  return cookies.split(';')[0];
}

/**
 * Extract CSRF token value from an HTML response body.
 */
function extractCsrf(body) {
  const match = body.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Prove a served page ships a working auto-grow script: running it must define
 * initPackingAutogrow AND leave window.onload calling it. A substring check on the
 * raw HTML would also pass for a function that is defined but never invoked.
 */
async function assertAutoGrowWired(html) {
  const window = await windowFromHtml(html);
  assert.strictEqual(
    typeof window.initPackingAutogrow,
    'function',
    'initPackingAutogrow must be defined by the inline script',
  );
  assert.match(
    String(window.onload),
    /initPackingAutogrow\(\)/,
    'window.onload must invoke initPackingAutogrow',
  );
}

/**
 * Perform admin login and return a cookie jar with session + csrf token.
 */
async function loginAsAdmin() {
  // Step 1: GET /admin/login to get initial session cookie + CSRF token
  const loginPage = await request('/admin/login');
  const cookies = parseCookies(loginPage);
  const csrfToken = extractCsrf(loginPage.body);

  // Step 2: POST /admin/login with credentials
  const loginRes = await request('/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
    },
    body: `username=admin&password=testpass&_csrf=${csrfToken}`,
  });
  const sessionCookies = parseCookies(loginRes);

  return sessionCookies;
}

/**
 * Month/day of "today" for recurring fixtures — resolveDate('today') uses the same
 * Europe/Helsinki timezone the server resolves aliases in (AGENTS.md gotcha).
 */
function todayMonthDay() {
  const { startDate } = resolveDate('today');
  return { month: startDate.getMonth() + 1, day: startDate.getDate() };
}

/**
 * Create a recurring event due today through the admin UI (session cookie + CSRF token).
 */
async function createRecurringEvent(cookies, { title, category }) {
  const formPage = await request('/admin/events/new', { headers: { Cookie: cookies } });
  const csrfToken = extractCsrf(formPage.body);
  assert.ok(csrfToken, 'CSRF token must be present on the event form');
  const { month, day } = todayMonthDay();
  return request('/admin/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
    },
    body: `title=${encodeURIComponent(title)}&category=${encodeURIComponent(category)}&is_recurring=1&month=${month}&day=${day}&_csrf=${csrfToken}`,
  });
}

/**
 * Slice one event card out of the public page HTML by title anchor, so packing
 * assertions target a single card even with other fixtures on the page.
 */
function cardSlice(body, title) {
  const at = body.indexOf(`<h3>${title}</h3>`);
  assert.ok(at >= 0, `event card for "${title}" must be present`);
  const start = body.lastIndexOf('<div class="event-card">', at);
  const next = body.indexOf('<div class="event-card">', at);
  return body.slice(start, next === -1 ? body.length : next);
}

describe('Swagger spec', () => {
  // Use server from API integration describe below
  let swaggerSpec;

  before(async () => {
    // Delete require cache for swagger module to reload on fresh state
    delete require.cache[require.resolve('../src/config/swagger')];
    swaggerSpec = require('../src/config/swagger');
  });

  // Exact-equality assertions against VALID_CATEGORIES: any category added to (or
  // removed from) the shared list must appear in every spec location, in order —
  // catches drift that per-category `includes` checks would miss.
  it('GET /api/events category query param enum equals VALID_CATEGORIES', () => {
    const pathItem = swaggerSpec.paths['/api/events']?.get;
    assert.ok(pathItem, 'GET /api/events should be defined');
    const categoryParam = pathItem.parameters?.find((p) => p.name === 'category');
    assert.ok(categoryParam, 'category parameter should exist');
    assert.deepStrictEqual(categoryParam.schema?.enum, VALID_CATEGORIES);
  });

  it('Event schema category enum equals VALID_CATEGORIES', () => {
    const eventSchema = swaggerSpec.components?.schemas?.Event;
    assert.ok(eventSchema, 'Event schema should exist');
    const categoryProp = eventSchema.properties?.category;
    assert.ok(categoryProp, 'category property should exist');
    assert.deepStrictEqual(categoryProp.enum, VALID_CATEGORIES);
  });

  it('EventInput schema category enum equals VALID_CATEGORIES', () => {
    const eventInputSchema = swaggerSpec.components?.schemas?.EventInput;
    assert.ok(eventInputSchema, 'EventInput schema should exist');
    const categoryProp = eventInputSchema.properties?.category;
    assert.ok(categoryProp, 'category property should exist');
    assert.deepStrictEqual(categoryProp.enum, VALID_CATEGORIES);
  });

  it('GET /health is documented as an unauthenticated Health endpoint', () => {
    const pathItem = swaggerSpec.paths['/health']?.get;
    assert.ok(pathItem, 'GET /health should be documented');
    assert.deepStrictEqual(pathItem.tags, ['Health'], 'should be tagged Health');
    assert.strictEqual(pathItem.security, undefined, 'should not require authentication');
    assert.ok(pathItem.responses?.[200]?.content?.['application/json'], 'should document 200 JSON response');
    assert.ok(pathItem.responses?.[503]?.content?.['application/json'], 'should document 503 JSON response');
  });

  it('GET /api/events is documented as a public endpoint without security requirement', () => {
    const pathItem = swaggerSpec.paths['/api/events']?.get;
    assert.ok(pathItem, 'GET /api/events should be documented');
    assert.strictEqual(pathItem.security, undefined, 'should not require authentication');
  });
});

describe('API integration', () => {
  let server;
  const testDbFile = path.join(__dirname, '..', 'data', 'test-api.db');

  function removeTestDbFile() {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(testDbFile + suffix, { force: true });
    }
  }

  before((_, done) => {
    // Isolate the suite from the app's real data/remindly.db: src/index.js calls
    // initDb() with no args, which falls back to DB_FILE. Must be set before require.
    removeTestDbFile();
    process.env.DB_FILE = testDbFile;
    process.env.PORT = '9999';
    process.env.API_KEYS = 'test-key-1,test-key-2';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';
    process.env.LOGO_LINK_URL = 'https://example.com';

    server = require('../src/index');
    server.on('listening', done);
  });

  after(() => {
    server.close();
    // Drop the whole throwaway DB instead of deleting fixture rows by title —
    // title-based DELETEs could never distinguish test rows from a dev's real data.
    const db = getDb();
    if (db.open) db.close();
    removeTestDbFile();
  });

  it('returns 200 without API key', async () => {
    const res = await request('/api/events?alias=today');
    assert.strictEqual(res.status, 200);
  });

  it('returns 200 with invalid API key', async () => {
    const res = await request('/api/events?alias=today', {
      headers: { 'x-api-key': 'wrong-key' },
    });
    assert.strictEqual(res.status, 200);
  });

  it('returns 401 for other /api/ routes without API key', async () => {
    const res = await request('/api/unknown');
    assert.strictEqual(res.status, 401);
  });

  it('returns 400 when date and alias both provided', async () => {
    const res = await request('/api/events?date=2026-05-30&alias=today', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request('/api/events?date=not-a-date', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for invalid category listing all valid categories (Travel included)', async () => {
    const res = await request('/api/events?category=Foo', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 400);
    const json = JSON.parse(res.body);
    // Message must be built from the shared VALID_CATEGORIES list — no hardcoded copy here.
    assert.ok(json.error.includes(VALID_CATEGORIES.join(', ')));
    assert.ok(json.error.includes('Travel'));
  });

  it('returns 200 with valid key and today alias', async () => {
    const res = await request('/api/events?alias=today', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(json.date);
    assert.ok(Array.isArray(json.events));
  });

  it('returns next_week envelope', async () => {
    const res = await request('/api/events?alias=next_week', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(json.startDate);
    assert.ok(json.endDate);
    assert.ok(Array.isArray(json.events));
  });

  it('returns this_week envelope', async () => {
    const res = await request('/api/events?alias=this_week', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(json.startDate);
    assert.ok(json.endDate);
    assert.ok(Array.isArray(json.events));
  });

  it('returns 200 for public homepage', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
  });

  it('serves favicon.svg without API key', async () => {
    const res = await request('/favicon.svg');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('image/svg+xml'));
  });

  it('favicon.svg returns valid SVG', async () => {
    const res = await request('/favicon.svg');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<svg'));
    assert.ok(res.body.includes('viewBox'));
    assert.ok(res.body.includes('#6a9e7e'));
  });

  it('homepage includes favicon link tag', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'));
  });

  it('JSON API next_week envelope dates are YYYY-MM-DD without weekday', async () => {
    const res = await request('/api/events?alias=next_week', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.startDate));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.endDate));
    json.events.forEach((e) => {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.displayDate), `Expected YYYY-MM-DD, got ${e.displayDate}`);
    });
  });

  it('JSON API this_week envelope dates are YYYY-MM-DD without weekday', async () => {
    const res = await request('/api/events?alias=this_week', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.startDate));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.endDate));
    json.events.forEach((e) => {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.displayDate), `Expected YYYY-MM-DD, got ${e.displayDate}`);
    });
  });

  it('JSON API today returns YYYY-MM-DD date without weekday', async () => {
    const res = await request('/api/events?alias=today', {
      headers: { 'x-api-key': 'test-key-1' },
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(json.date));
    json.events.forEach((e) => {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.displayDate), `Expected YYYY-MM-DD, got ${e.displayDate}`);
    });
  });

  it('HTML today page does not include weekday abbreviations', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('Events for'));
    const headingMatch = res.body.match(/Events for ([^<]+)/);
    assert.ok(headingMatch);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(headingMatch[1].trim()));
  });

  describe('Other category', () => {
    let adminCookies;

    before(async () => {
      adminCookies = await loginAsAdmin();
    });

    it('event form includes "Other" as a selectable category option', async () => {
      const formPage = await request('/admin/events/new', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(formPage.status, 200);
      // Verify "Other" is listed as a selectable option in the dropdown
      assert.ok(formPage.body.includes('value="Other"'), 'Event form should have Other option');
      // Verify it's rendered from the categories array (not hardcoded)
      assert.ok(
        !formPage.body.includes("['Birthday', 'Name Day', 'Flag Day', 'Holiday', 'Anniversary'].forEach"),
        'Should not use hardcoded category list',
      );
    });

    it('admin can create a recurring event with category "Other"', async () => {
      const createRes = await createRecurringEvent(adminCookies, {
        title: 'Graduation',
        category: 'Other',
      });
      // Should redirect to dashboard
      assert.strictEqual(createRes.status, 302);
      assert.strictEqual(createRes.headers.location, '/admin');

      // Verify event appears on dashboard
      const dashboard = await request('/admin', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(dashboard.status, 200);
      assert.ok(dashboard.body.includes('Graduation'));
      assert.ok(dashboard.body.includes('Other'));
    });

    it('API query with category=Other returns only Other events', async () => {
      const res = await request('/api/events?category=Other', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 200);
      const json = JSON.parse(res.body);
      assert.ok(Array.isArray(json.events));
      assert.ok(json.events.length > 0, 'Expected at least the Graduation event created above');
      json.events.forEach((e) => {
        assert.strictEqual(e.category, 'Other');
      });
    });

    it('API query with alias=today returns Other events', async () => {
      const res = await request('/api/events?alias=today', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 200);
      const json = JSON.parse(res.body);
      assert.ok(Array.isArray(json.events));
      // At least one event should be "Other" (the one we created)
      const otherEvents = json.events.filter((e) => e.category === 'Other');
      assert.ok(otherEvents.length > 0, 'Expected at least one Other event');
      otherEvents.forEach((e) => {
        assert.strictEqual(e.category, 'Other');
      });
    });
  });

  describe('Travel category', () => {
    let adminCookies;

    before(async () => {
      adminCookies = await loginAsAdmin();
      // Block-local fixtures: a non-Travel and a Travel recurring event due today, so
      // every assertion below is self-sufficient and does not depend on other blocks
      // or on events created by earlier tests.
      const dayTripRes = await createRecurringEvent(adminCookies, {
        title: 'Day Trip',
        category: 'Anniversary',
      });
      assert.strictEqual(dayTripRes.status, 302, 'Day Trip fixture must be created');
      const shuttleRes = await createRecurringEvent(adminCookies, {
        title: 'Airport Shuttle',
        category: 'Travel',
      });
      assert.strictEqual(shuttleRes.status, 302, 'Airport Shuttle fixture must be created');
    });

    it('event form includes "Travel" as the last selectable category option', async () => {
      const formPage = await request('/admin/events/new', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(formPage.status, 200);
      // Options must render in VALID_CATEGORIES order with Travel last — expectation
      // derived from the shared list, not from HTML string positions hardcoded here.
      const positions = VALID_CATEGORIES.map(
        (cat) => formPage.body.indexOf(`value="${cat}"`),
      );
      assert.ok(
        positions.every((p) => p >= 0),
        'every VALID_CATEGORIES option should render in the form',
      );
      positions.forEach((p, i) => {
        if (i > 0) {
          assert.ok(
            p > positions[i - 1],
            `${VALID_CATEGORIES[i]} must render after ${VALID_CATEGORIES[i - 1]}`,
          );
        }
      });
    });

    it('admin dashboard category filter dropdown includes Travel', async () => {
      const dashboard = await request('/admin', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(dashboard.status, 200);
      assert.ok(
        dashboard.body.includes('value="Travel"'),
        'Filter dropdown should have Travel option',
      );
    });

    it('admin can create a recurring event with category "Travel"', async () => {
      const createRes = await createRecurringEvent(adminCookies, {
        title: 'Business Trip',
        category: 'Travel',
      });
      assert.strictEqual(createRes.status, 302);
      assert.strictEqual(createRes.headers.location, '/admin');

      // Verify event appears on dashboard, and that the Travel category filter
      // (behavioral check — lists only Travel-category rows) includes it.
      const dashboard = await request('/admin', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(dashboard.status, 200);
      assert.ok(dashboard.body.includes('Business Trip'), 'Business Trip should be on dashboard');

      const filtered = await request('/admin?category=Travel', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(filtered.status, 200);
      assert.ok(filtered.body.includes('Business Trip'), 'Travel filter should list Business Trip');
      assert.ok(!filtered.body.includes('Day Trip'), 'Travel filter must exclude non-Travel rows');
    });

    it('API query with category=Travel returns only Travel events', async () => {
      const res = await request('/api/events?category=Travel', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 200);
      const json = JSON.parse(res.body);
      assert.ok(Array.isArray(json.events));
      assert.ok(json.events.length > 0, 'Expected at least the Airport Shuttle fixture');
      json.events.forEach((e) => {
        assert.strictEqual(e.category, 'Travel');
      });
    });

    it('API query with alias=today returns Travel events alongside other categories', async () => {
      const res = await request('/api/events?alias=today', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 200);
      const json = JSON.parse(res.body);
      assert.ok(Array.isArray(json.events));
      const travelEvents = json.events.filter((e) => e.category === 'Travel');
      assert.ok(travelEvents.length > 0, 'Expected at least one Travel event');
      travelEvents.forEach((e) => {
        assert.strictEqual(e.category, 'Travel');
      });
      const otherCategoryEvents = json.events.filter((e) => e.category !== 'Travel');
      assert.ok(
        otherCategoryEvents.length > 0,
        'Expected non-Travel events rendered alongside Travel events',
      );
    });
  });

  describe('Travel packing list — admin editor', () => {
    let adminCookies;

    before(async () => {
      adminCookies = await loginAsAdmin();
    });

    function formBody(fields) {
      const parts = [];
      const append = (k, v) => parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      for (const [key, value] of Object.entries(fields)) {
        if (Array.isArray(value)) value.forEach((v) => append(key, v));
        else append(key, value);
      }
      return parts.join('&');
    }

    function eventIdByTitle(title) {
      const row = getDb().prepare('SELECT id FROM events WHERE title = ?').get(title);
      assert.ok(row, `fixture event "${title}" must exist`);
      return row.id;
    }

    function itemsOf(eventId) {
      return getDb()
        .prepare(
          'SELECT id, label, packed FROM event_packing_items WHERE event_id = ? ORDER BY id ASC',
        )
        .all(eventId);
    }

    // Parse the served HTML rather than substring-counting: the inline auto-grow
    // script mentions name="packing_items[]" inside selector strings, so an
    // attribute substring would over-count rows.
    function countPackingInputs(html) {
      return documentFromHtml(html).querySelectorAll('input[name="packing_items[]"]').length;
    }

    async function csrfFor(pathUrl, cookies) {
      const page = await request(pathUrl, { headers: { Cookie: cookies } });
      const token = extractCsrf(page.body);
      assert.ok(token, `CSRF token must be present on ${pathUrl}`);
      return token;
    }

    async function createTravelEvent(title, { items = [], ids = [] } = {}) {
      const token = await csrfFor('/admin/events/new', adminCookies);
      const { month, day } = todayMonthDay();
      return request('/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
        body: formBody({
          title,
          category: 'Travel',
          is_recurring: 1,
          month,
          day,
          'packing_items[]': items,
          'packing_item_ids[]': ids,
          _csrf: token,
        }),
      });
    }

    async function putTravelEvent(eventId, { title, items = [], ids = [], category = 'Travel' }) {
      const token = await csrfFor(`/admin/events/${eventId}/edit`, adminCookies);
      const { month, day } = todayMonthDay();
      return request(`/admin/events/${eventId}?_method=PUT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
        body: formBody({
          title,
          category,
          is_recurring: 1,
          month,
          day,
          'packing_items[]': items,
          'packing_item_ids[]': ids,
          _csrf: token,
        }),
      });
    }

    it('creates a Travel event with two items in submission order, all unpacked', async () => {
      const res = await createTravelEvent('Packing Create Trip', {
        items: ['Passport', 'Toothbrush'],
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');
      const items = itemsOf(eventIdByTitle('Packing Create Trip'));
      assert.strictEqual(items.length, 2);
      assert.deepStrictEqual(items.map((i) => i.label), ['Passport', 'Toothbrush']);
      items.forEach((i) => assert.strictEqual(i.packed, 0, 'new items start unpacked'));
      assert.ok(items[0].id < items[1].id, 'ids must follow submission order');
    });

    it('blank and whitespace-only rows produce no items and no error', async () => {
      const res = await createTravelEvent('Packing Blank Rows', {
        items: ['Charger', '', '   '],
      });
      assert.strictEqual(res.status, 302);
      const items = itemsOf(eventIdByTitle('Packing Blank Rows'));
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].label, 'Charger');
    });

    it('PUT renames a row, deletes an omitted row, and inserts a new label', async () => {
      const create = await createTravelEvent('Packing Edit Trip', {
        items: ['Camera', 'Sunglasses'],
      });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Packing Edit Trip');
      const before = itemsOf(eventId);

      const res = await putTravelEvent(eventId, {
        title: 'Packing Edit Trip',
        ids: [before[0].id],
        items: ['Action camera', 'Rain shell'],
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');

      const after = itemsOf(eventId);
      assert.strictEqual(after.length, 2, 'item count must match submission');
      assert.strictEqual(after[0].id, before[0].id, 'renamed row keeps its id');
      assert.strictEqual(after[0].label, 'Action camera', 'renamed label persisted');
      assert.ok(after.some((i) => i.label === 'Rain shell'), 'new label inserted');
      assert.ok(!after.some((i) => i.label === 'Sunglasses'), 'omitted id deleted from DB');
    });

    it('PUT clearing an existing item text deletes it, keeping the rest of ids and order', async () => {
      const create = await createTravelEvent('Packing Delete Trip', {
        items: ['First', 'Second', 'Third'],
      });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Packing Delete Trip');
      const before = itemsOf(eventId);

      const res = await putTravelEvent(eventId, {
        title: 'Packing Delete Trip',
        ids: [before[0].id, '', before[2].id],
        items: ['First', '', 'Third'],
      });
      assert.strictEqual(res.status, 302);

      const after = itemsOf(eventId);
      assert.deepStrictEqual(after.map((i) => i.label), ['First', 'Third']);
      assert.deepStrictEqual(after.map((i) => i.id), [before[0].id, before[2].id]);
    });

    it('rejects a packing_item_ids value belonging to another event and changes nothing', async () => {
      const a = await createTravelEvent('Packing Tamper A', { items: ['Alpha'] });
      const b = await createTravelEvent('Packing Tamper B', { items: ['Beta'] });
      assert.strictEqual(a.status, 302);
      assert.strictEqual(b.status, 302);
      const idA = eventIdByTitle('Packing Tamper A');
      const idB = eventIdByTitle('Packing Tamper B');
      const itemsA = itemsOf(idA);
      const itemsB = itemsOf(idB);

      const res = await putTravelEvent(idA, {
        title: 'Packing Tamper A',
        ids: [itemsB[0].id],
        items: ['Hijacked'],
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('Unknown packing item'));
      assert.deepStrictEqual(itemsOf(idA), itemsA, 'submitted event items unchanged');
      assert.deepStrictEqual(itemsOf(idB), itemsB, 'victim event items unchanged');
    });

    it('rejects a submitted item id on create and creates no event and no items', async () => {
      const eventsBefore = getDb().prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
      const itemsBefore = getDb()
        .prepare('SELECT COUNT(*) as cnt FROM event_packing_items')
        .get().cnt;

      const res = await createTravelEvent('Packing Create Junk Id', {
        items: ['Passport'],
        ids: [1],
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('Unknown packing item'));
      assert.strictEqual(
        getDb().prepare('SELECT COUNT(*) as cnt FROM events').get().cnt,
        eventsBefore,
        'no event created',
      );
      assert.strictEqual(
        getDb().prepare('SELECT COUNT(*) as cnt FROM event_packing_items').get().cnt,
        itemsBefore,
        'no items created',
      );
    });

    it('rejects a 201-character label and leaves event fields and items unchanged', async () => {
      const create = await createTravelEvent('Packing Long Label', { items: ['Socks'] });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Packing Long Label');
      const eventBefore = getDb().prepare('SELECT * FROM events WHERE id = ?').get(eventId);
      const itemsBefore = itemsOf(eventId);

      const res = await putTravelEvent(eventId, {
        title: 'Packing Long Label Renamed',
        ids: [itemsBefore[0].id],
        items: ['x'.repeat(201)],
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('Packing item labels must be 200 characters or fewer'));
      assert.deepStrictEqual(
        getDb().prepare('SELECT * FROM events WHERE id = ?').get(eventId),
        eventBefore,
        'event fields unchanged',
      );
      assert.deepStrictEqual(itemsOf(eventId), itemsBefore, 'items unchanged');
    });

    it('rejects 51 non-blank labels and creates no items', async () => {
      const eventsBefore = getDb().prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
      const itemsBefore = getDb()
        .prepare('SELECT COUNT(*) as cnt FROM event_packing_items')
        .get().cnt;

      const res = await createTravelEvent('Packing Too Many', {
        items: Array.from({ length: 51 }, (_, i) => `Item ${i + 1}`),
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('A travel event can have at most 50 packing items'));
      assert.strictEqual(
        getDb().prepare('SELECT COUNT(*) as cnt FROM events').get().cnt,
        eventsBefore,
      );
      assert.strictEqual(
        getDb().prepare('SELECT COUNT(*) as cnt FROM event_packing_items').get().cnt,
        itemsBefore,
        'no items created',
      );
    });

    it('switching category from Travel to Other keeps all item rows (hidden, not deleted)', async () => {
      const create = await createTravelEvent('Packing Category Switch', {
        items: ['Gear One', 'Gear Two', 'Gear Three'],
      });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Packing Category Switch');
      const itemsBefore = itemsOf(eventId);

      const res = await putTravelEvent(eventId, {
        title: 'Packing Category Switch',
        category: 'Other',
        ids: itemsBefore.map((i) => i.id),
        items: ['Gear One', 'Gear Two', 'Gear Three'],
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(
        getDb().prepare('SELECT category FROM events WHERE id = ?').get(eventId).category,
        'Other',
      );
      const after = itemsOf(eventId);
      assert.strictEqual(after.length, 3, 'all 3 item rows must still be present');
      assert.deepStrictEqual(after.map((i) => i.label), ['Gear One', 'Gear Two', 'Gear Three']);
    });

    it('edit page for the Other event keeps the packing block present but unrevealed', async () => {
      const eventId = eventIdByTitle('Packing Category Switch');
      const page = await request(`/admin/events/${eventId}/edit`, {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(page.status, 200);
      assert.ok(page.body.includes('class="packing-fields"'), 'packing block markup present');
      assert.ok(!page.body.includes('packing-fields active'), 'block must not be revealed');
      assert.match(page.body, /value="Other"[^>]*selected/, 'Other option marked selected');
    });

    it('re-submitting category=Travel with the same ids preserves rows without delete/reinsert churn', async () => {
      const eventId = eventIdByTitle('Packing Category Switch');
      const itemsBefore = itemsOf(eventId);

      const res = await putTravelEvent(eventId, {
        title: 'Packing Category Switch',
        category: 'Travel',
        ids: itemsBefore.map((i) => i.id),
        items: ['Gear One', 'Gear Two', 'Gear Three'],
      });
      assert.strictEqual(res.status, 302);
      const after = itemsOf(eventId);
      assert.deepStrictEqual(
        after.map((i) => i.id),
        itemsBefore.map((i) => i.id),
        'original ids preserved',
      );
      assert.strictEqual(
        getDb().prepare('SELECT category FROM events WHERE id = ?').get(eventId).category,
        'Travel',
      );
    });

    it('creates an event from 6 submitted rows in one pass, in submission order and unpacked', async () => {
      const res = await createTravelEvent('Autogrow Six Rows', {
        items: ['Passport', 'Toothbrush', 'Charger', 'Rain shell', 'Snacks', 'Tent'],
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');

      const items = itemsOf(eventIdByTitle('Autogrow Six Rows'));
      assert.strictEqual(items.length, 6, 'every submitted row persisted');
      assert.deepStrictEqual(
        items.map((i) => i.label),
        ['Passport', 'Toothbrush', 'Charger', 'Rain shell', 'Snacks', 'Tent'],
      );
      items.forEach((i) => assert.strictEqual(i.packed, 0, 'new items start unpacked'));
    });

    it('drops blank and whitespace-only rows from a larger submission', async () => {
      const res = await createTravelEvent('Autogrow Blank Mix', { items: ['A', '', 'B', '   '] });
      assert.strictEqual(res.status, 302);

      const items = itemsOf(eventIdByTitle('Autogrow Blank Mix'));
      assert.strictEqual(items.length, 2, 'blank rows produce no items');
      assert.deepStrictEqual(items.map((i) => i.label), ['A', 'B']);
    });

    it('PUT keeps existing ids while growing to 5 rows with 3 trailing blanks', async () => {
      const create = await createTravelEvent('Autogrow Grow Trip', { items: ['One', 'Two'] });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Autogrow Grow Trip');
      const before = itemsOf(eventId);
      assert.strictEqual(before.length, 2);

      const res = await putTravelEvent(eventId, {
        title: 'Autogrow Grow Trip',
        ids: [before[0].id, before[1].id],
        items: ['One', 'Two', 'Three', 'Four', 'Five', '', '', ''],
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');

      const after = itemsOf(eventId);
      assert.strictEqual(after.length, 5, 'trailing blank rows produce no items');
      assert.deepStrictEqual(
        after.map((i) => i.label),
        ['One', 'Two', 'Three', 'Four', 'Five'],
      );
      assert.strictEqual(after[0].id, before[0].id, 'first updated row keeps its id');
      assert.strictEqual(after[1].id, before[1].id, 'second updated row keeps its id');
    });

    it('new-event page ships the auto-grow script and still renders 3 blank rows', async () => {
      const page = await request('/admin/events/new', { headers: { Cookie: adminCookies } });
      assert.strictEqual(page.status, 200);
      await assertAutoGrowWired(page.body);
      assert.strictEqual(
        countPackingInputs(page.body),
        3,
        'initial render unchanged: exactly 3 blank packing rows',
      );
    });

    it('edit page ships the auto-grow script with saved rows and their hidden ids', async () => {
      const create = await createTravelEvent('Autogrow Edit Marker Trip', {
        items: ['Passport', 'Visa', 'Camera', 'Charger'],
      });
      assert.strictEqual(create.status, 302);
      const eventId = eventIdByTitle('Autogrow Edit Marker Trip');
      const saved = itemsOf(eventId);
      const page = await request(`/admin/events/${eventId}/edit`, {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(page.status, 200);
      await assertAutoGrowWired(page.body);
      for (const item of saved) {
        assert.ok(
          page.body.includes(`value="${item.label}"`),
          `saved label "${item.label}" rendered as an input value`,
        );
        assert.ok(
          page.body.includes(`name="packing_item_ids[]" value="${item.id}"`),
          `hidden id ${item.id} rendered for its row`,
        );
      }
      assert.strictEqual(
        countPackingInputs(page.body),
        saved.length + 3,
        'saved rows plus the 3 blank rows',
      );
    });

    it('rows grown in the served page submit and persist through the real form body', async () => {
      const page = await request('/admin/events/new', { headers: { Cookie: adminCookies } });
      const window = await windowFromHtml(page.body);
      const form = window.document.querySelector('form');
      form.querySelector('input[name="title"]').value = 'Autogrow Dom Roundtrip';
      const category = form.querySelector('select[name="category"]');
      category.value = 'Travel';
      // The user path: choosing Travel fires onchange, which reveals the packing block.
      category.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.ok(
        window.document.querySelector('.packing-fields').classList.contains('active'),
        'packing block revealed before any typing starts',
      );
      const { month, day } = todayMonthDay();
      form.querySelector('input[name="month"]').value = String(month);
      form.querySelector('input[name="day"]').value = String(day);

      const labels = ['Passport', 'Toothbrush', 'Charger', 'Rain shell', 'Snacks', 'Tent'];
      for (const label of labels) {
        const rows = window.document.querySelectorAll('.packing-fields .packing-row');
        const input = rows[rows.length - 1].querySelector('input[name="packing_items[]"]');
        input.value = label;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      assert.strictEqual(
        window.document.querySelectorAll('.packing-fields .packing-row').length,
        labels.length + 3,
        'auto-grow added one row per label typed in the served page',
      );

      const body = Array.from(new window.FormData(form).entries())
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      const res = await request('/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: adminCookies },
        body,
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/admin');

      const items = itemsOf(eventIdByTitle('Autogrow Dom Roundtrip'));
      assert.strictEqual(items.length, 6, 'every grown row reached the server');
      assert.deepStrictEqual(
        items.map((i) => i.label),
        labels,
        'grown rows arrive in DOM order, trailing blanks dropped',
      );
    });
  });

  describe('Travel packing list — public page', () => {
    let travelEventId;

    before(() => {
      const db = getDb();
      const { month, day } = todayMonthDay();
      const insertEvent = (title, category, isRecurring, monthVal, dayVal, eventDate) =>
        db
          .prepare(
            `INSERT INTO events (title, description, category, is_recurring, month, day, event_date)
             VALUES (?, NULL, ?, ?, ?, ?, ?)`,
          )
          .run(title, category, isRecurring, monthVal, dayVal, eventDate).lastInsertRowid;
      const addItem = (eventId, label, packed) =>
        db
          .prepare('INSERT INTO event_packing_items (event_id, label, packed) VALUES (?, ?, ?)')
          .run(eventId, label, packed).lastInsertRowid;

      travelEventId = insertEvent('Lapland Render Trip', 'Travel', 1, month, day, null);
      const emptyTravelId = insertEvent('Zero Items Trip', 'Travel', 1, month, day, null);
      const holidayId = insertEvent('Holiday With Items Trip', 'Holiday', 1, month, day, null);
      const nextWeekId = insertEvent(
        'Next Week Render Trip',
        'Travel',
        0,
        null,
        null,
        formatDate(resolveDate('next_week').startDate),
      );

      addItem(travelEventId, 'Render Item A', 0);
      addItem(travelEventId, 'Render Item B', 1);
      addItem(travelEventId, 'Render Item C', 0);
      addItem(travelEventId, 'Passport <script>x</script>', 0);
      addItem(holidayId, 'Holiday Only Item', 0);
      addItem(nextWeekId, 'Sunglasses Render', 0);
      assert.ok(emptyTravelId, 'zero-item fixture created');
    });

    it('renders the list with unpacked items first (id order) and packed last', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      const card = cardSlice(res.body, 'Lapland Render Trip');
      assert.ok(card.includes('class="packing-list"'), 'packing list markup present');
      assert.ok(card.includes('Packing list'), 'packing list heading present');
      const posA = card.indexOf('Render Item A');
      const posC = card.indexOf('Render Item C');
      const posB = card.indexOf('Render Item B');
      assert.ok(posA >= 0 && posC >= 0 && posB >= 0, 'all labels rendered');
      assert.ok(posA < posC, 'unpacked items in id ascending order');
      assert.ok(posC < posB, 'packed item rendered last');
    });

    it('marks the packed item with packed class + checked, styled faded and struck-through', async () => {
      const res = await request('/');
      const card = cardSlice(res.body, 'Lapland Render Trip');
      assert.strictEqual(
        card.split('<li class="packing-item packed">').length - 1,
        1,
        'exactly one packed li',
      );
      const packedStart = card.indexOf('<li class="packing-item packed">');
      const packedLi = card.slice(packedStart, card.indexOf('Render Item B') + 'Render Item B'.length);
      assert.ok(packedLi.includes('checked'), 'packed checkbox is checked');

      const rule = res.body.match(/\.packing-item\.packed label\s*\{([^}]*)\}/);
      assert.ok(rule, '.packing-item.packed label CSS rule must exist');
      assert.ok(rule[1].includes('text-decoration: line-through'), 'struck through');
      assert.ok(/color:\s*#[0-9a-fA-F]{6}/.test(rule[1]), 'muted color');
    });

    it('every item form carries an extractable _csrf hidden input and a packed checkbox', async () => {
      const res = await request('/');
      const card = cardSlice(res.body, 'Lapland Render Trip');
      assert.ok(/name="_csrf"\s+value="[^"]+"/.test(card), 'extractCsrf attribute order');
      assert.strictEqual(card.split('name="_csrf" value="').length - 1, 4);
      assert.strictEqual(card.split('type="checkbox" name="packed"').length - 1, 4);
    });

    it('renders no packing markup for a Travel event with zero items or a non-Travel event with items', async () => {
      const res = await request('/');
      const emptyCard = cardSlice(res.body, 'Zero Items Trip');
      assert.ok(!emptyCard.includes('packing-list'));
      assert.ok(!emptyCard.includes('Packing list'));
      const holidayCard = cardSlice(res.body, 'Holiday With Items Trip');
      assert.ok(!holidayCard.includes('packing-list'));
      assert.ok(!holidayCard.includes('Packing list'));
    });

    it('escapes item labels', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('Passport &lt;script&gt;x&lt;/script&gt;'));
      assert.ok(!res.body.includes('<script>x</script>'));
    });

    it('leaves the JSON API payload shape byte-for-byte unchanged', async () => {
      const res = await request('/api/events?alias=today');
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.includes('packingItems'), 'no packingItems key anywhere');
      assert.ok(!res.body.includes('"packed"'), 'no packed key anywhere');
      const travel = JSON.parse(res.body).events.find((e) => e.title === 'Lapland Render Trip');
      assert.ok(travel, 'fixture event must appear in the API payload');
      assert.deepStrictEqual(Object.keys(travel), [
        'id',
        'title',
        'description',
        'category',
        'displayDate',
      ]);
    });

    it('renders items in the next_week view with returnTo pointing at that view', async () => {
      const res = await request('/?alias=next_week');
      assert.strictEqual(res.status, 200);
      const card = cardSlice(res.body, 'Next Week Render Trip');
      assert.ok(card.includes('Sunglasses Render'), 'next-week items render');
      assert.ok(card.includes('name="returnTo" value="/?alias=next_week"'));
    });

    it('uses returnTo="/" in the today view', async () => {
      const res = await request('/');
      const card = cardSlice(res.body, 'Lapland Render Trip');
      assert.ok(card.includes('name="returnTo" value="/"'));
    });
  });

  describe('Travel packing list — toggle route', () => {
    let firstItemId;
    let secondItemId;

    before(async () => {
      const adminCookies = await loginAsAdmin();
      const createRes = await createRecurringEventWithItems(adminCookies, 'Toggle Trip', [
        'Passport Toggle',
        'Visa Toggle',
      ]);
      assert.strictEqual(createRes.status, 302);
      const eventId = getDb().prepare('SELECT id FROM events WHERE title = ?').get('Toggle Trip').id;
      const items = getDb()
        .prepare('SELECT id FROM event_packing_items WHERE event_id = ? ORDER BY id ASC')
        .all(eventId);
      assert.strictEqual(items.length, 2);
      firstItemId = items[0].id;
      secondItemId = items[1].id;
    });

    async function createRecurringEventWithItems(cookies, title, items) {
      const formPage = await request('/admin/events/new', { headers: { Cookie: cookies } });
      const csrfToken = extractCsrf(formPage.body);
      const { month, day } = todayMonthDay();
      const itemFields = items
        .map((i) => `packing_items%5B%5D=${encodeURIComponent(i)}`)
        .join('&');
      return request('/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
        body: `title=${encodeURIComponent(title)}&category=Travel&is_recurring=1&month=${month}&day=${day}&${itemFields}&_csrf=${csrfToken}`,
      });
    }

    function packedValue(itemId) {
      return getDb().prepare('SELECT packed FROM event_packing_items WHERE id = ?').get(itemId)
        .packed;
    }

    // A fresh cookie jar = a fresh visitor session with its own CSRF token.
    async function newVisitor() {
      const home = await request('/');
      assert.strictEqual(home.status, 200);
      return { cookies: parseCookies(home), csrf: extractCsrf(home.body) };
    }

    async function postToggle(itemId, visitor, { packed, returnTo } = {}) {
      const parts = [`_csrf=${encodeURIComponent(visitor.csrf)}`];
      if (packed !== undefined) parts.push(packed);
      if (returnTo !== undefined) parts.push(`returnTo=${encodeURIComponent(returnTo)}`);
      return request(`/packing/items/${itemId}/packed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: visitor.cookies },
        body: parts.join('&'),
      });
    }

    it('sets connect.sid for anonymous visitors and exposes an extractable _csrf token', async () => {
      const home = await request('/');
      assert.strictEqual(home.status, 200);
      const setCookie = home.headers['set-cookie'];
      assert.ok(setCookie, 'Set-Cookie header expected');
      const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      assert.ok(joined.includes('connect.sid'), 'anonymous visitors get a session cookie');
      assert.ok(extractCsrf(home.body), 'packing form carries an extractable _csrf token');
    });

    it('ticks an item: 302 to /, packed=1 in DB, rendered last as packed and checked', async () => {
      const visitor = await newVisitor();
      const res = await postToggle(firstItemId, visitor, { packed: 'packed=0&packed=1' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, '/');
      assert.strictEqual(packedValue(firstItemId), 1);

      const home = await request('/');
      const card = cardSlice(home.body, 'Toggle Trip');
      assert.ok(
        card.indexOf('Visa Toggle') < card.indexOf('Passport Toggle'),
        'packed item renders after the unpacked one',
      );
      const packedStart = card.indexOf('<li class="packing-item packed">');
      assert.ok(packedStart >= 0, 'packed class present');
      const packedLi = card.slice(packedStart, card.indexOf('Passport Toggle') + 'Passport Toggle'.length);
      assert.ok(packedLi.includes('checked'));
    });

    it('unticks a packed item: 302, packed=0, back in id order with no packed styling', async () => {
      const visitor = await newVisitor();
      const res = await postToggle(firstItemId, visitor, { packed: 'packed=0' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(packedValue(firstItemId), 0);

      const home = await request('/');
      const card = cardSlice(home.body, 'Toggle Trip');
      assert.ok(
        card.indexOf('Passport Toggle') < card.indexOf('Visa Toggle'),
        'back in id order among unpacked items',
      );
      assert.ok(!card.includes('packing-item packed'), 'no packed class');
      assert.ok(!card.includes('checked'), 'no checked attribute');
    });

    it('rejects no-cookie and wrong-token requests with 403, leaving the row unchanged', async () => {
      const visitor = await newVisitor();
      const noCookie = await request(`/packing/items/${secondItemId}/packed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `_csrf=${encodeURIComponent(visitor.csrf)}&packed=0&packed=1`,
      });
      assert.strictEqual(noCookie.status, 403);
      assert.ok(noCookie.body.includes('Invalid CSRF token'));

      const wrongToken = await postToggle(secondItemId, { cookies: visitor.cookies, csrf: 'bogus' }, {
        packed: 'packed=0&packed=1',
      });
      assert.strictEqual(wrongToken.status, 403);
      assert.ok(wrongToken.body.includes('Invalid CSRF token'));

      assert.strictEqual(packedValue(secondItemId), 0, 'row unchanged by rejected requests');
    });

    it('returns 404 for a missing id and for a non-numeric id', async () => {
      const visitor = await newVisitor();
      const missing = await postToggle(999999, visitor, { packed: 'packed=0&packed=1' });
      assert.strictEqual(missing.status, 404);
      assert.ok(missing.body.includes('Packing item not found'));

      const junk = await request('/packing/items/not-a-number/packed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: visitor.cookies },
        body: `_csrf=${encodeURIComponent(visitor.csrf)}&packed=0&packed=1`,
      });
      assert.strictEqual(junk.status, 404);
    });

    it('returns 400 for absent, empty, or junk packed values, leaving the row unchanged', async () => {
      const visitor = await newVisitor();
      for (const packed of [undefined, 'packed=', 'packed=maybe']) {
        const res = await postToggle(secondItemId, visitor, { packed });
        assert.strictEqual(res.status, 400, `packed=${JSON.stringify(packed)} must be 400`);
        assert.ok(res.body.includes('Invalid packed value'));
        assert.strictEqual(packedValue(secondItemId), 0);
      }
    });

    it('redirects only to allowlisted returnTo values', async () => {
      const visitor = await newVisitor();
      const allowed = await postToggle(secondItemId, visitor, {
        packed: 'packed=0&packed=1',
        returnTo: '/?alias=next_week',
      });
      assert.strictEqual(allowed.status, 302);
      assert.strictEqual(allowed.headers.location, '/?alias=next_week');

      const evilVisitor = await newVisitor();
      const evil = await postToggle(secondItemId, evilVisitor, {
        packed: 'packed=0',
        returnTo: '//evil.example',
      });
      assert.strictEqual(evil.status, 302);
      assert.strictEqual(evil.headers.location, '/', 'non-allowlisted returnTo falls back to /');
    });

    it('shares state across visitors: two cookie jars, second write wins, both views agree', async () => {
      const alice = await newVisitor();
      const bob = await newVisitor();
      assert.ok(alice.cookies && bob.cookies && alice.cookies !== bob.cookies, 'distinct jars');

      const tick = await postToggle(secondItemId, alice, { packed: 'packed=0&packed=1' });
      assert.strictEqual(tick.status, 302);
      const untick = await postToggle(secondItemId, bob, { packed: 'packed=0' });
      assert.strictEqual(untick.status, 302);
      assert.strictEqual(packedValue(secondItemId), 0, 'second write wins');

      const aliceView = await request('/', { headers: { Cookie: alice.cookies } });
      const bobView = await request('/', { headers: { Cookie: bob.cookies } });
      const aliceCard = cardSlice(aliceView.body, 'Toggle Trip');
      const bobCard = cardSlice(bobView.body, 'Toggle Trip');
      for (const card of [aliceCard, bobCard]) {
        assert.ok(!card.includes('packing-item packed'), 'both visitors see the shared unpacked state');
        assert.ok(card.indexOf('Passport Toggle') < card.indexOf('Visa Toggle'));
      }
    });
  });

  describe('Logo in page title', () => {
    let adminCookies;

    before(async () => {
      adminCookies = await loginAsAdmin();
    });

    it('renders linked logo on public homepage when LOGO_LINK_URL is set', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('<img src="/favicon.svg"'), 'logo image should be present');
      assert.ok(res.body.includes('href="https://example.com"'), 'logo should link to LOGO_LINK_URL');
      assert.ok(res.body.includes('Remindly</h1>'), 'title text should be unchanged');
    });

    it('renders plain logo on public homepage when LOGO_LINK_URL is unset', async () => {
      const original = process.env.LOGO_LINK_URL;
      delete process.env.LOGO_LINK_URL;
      try {
        const res = await request('/');
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.includes('<img src="/favicon.svg"'), 'logo image should still be present');
        assert.ok(!res.body.includes('href="https://example.com"'), 'logo should not be a link');
        assert.ok(res.body.includes('Remindly</h1>'), 'title text should be unchanged');
      } finally {
        process.env.LOGO_LINK_URL = original;
      }
    });

    it('renders linked logo on admin dashboard', async () => {
      const res = await request('/admin', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('<img src="/favicon.svg"'), 'logo image should be present');
      assert.ok(res.body.includes('href="https://example.com"'), 'logo should link to LOGO_LINK_URL');
      assert.ok(res.body.includes('Dashboard</h1>'), 'title text should be unchanged');
    });

    it('renders linked logo on new event form', async () => {
      const res = await request('/admin/events/new', {
        headers: { Cookie: adminCookies },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('<img src="/favicon.svg"'), 'logo image should be present');
      assert.ok(res.body.includes('href="https://example.com"'), 'logo should link to LOGO_LINK_URL');
    });

    it('does not affect favicon link tag or page content on homepage', async () => {
      const res = await request('/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'));
      assert.ok(res.body.includes('Events for'));
    });
  });

  describe('Health check', () => {
    it('returns 200 with status ok when DB is reachable', async () => {
      const res = await request('/health');
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/json'));
      const json = JSON.parse(res.body);
      assert.deepStrictEqual(json, { status: 'ok' });
      assert.strictEqual('timestamp' in json, false, 'should not contain timestamp');
      assert.strictEqual('version' in json, false, 'should not contain version');
      assert.strictEqual('db' in json, false, 'should not contain db');
      assert.strictEqual('error' in json, false, 'should not contain error');
    });

    it('returns 503 with status error when DB is unreachable', async () => {
      const db = getDb();
      db.close();
      try {
        const res = await request('/health');
        assert.strictEqual(res.status, 503);
        assert.ok(res.headers['content-type'].includes('application/json'));
        const json = JSON.parse(res.body);
        assert.deepStrictEqual(json, { status: 'error' });
        assert.strictEqual('timestamp' in json, false, 'should not contain timestamp');
        assert.strictEqual('version' in json, false, 'should not contain version');
        assert.strictEqual('db' in json, false, 'should not contain db');
        assert.strictEqual('error' in json, false, 'should not contain error');
      } finally {
        initDb();
      }
    });

    it('does not affect existing public endpoints', async () => {
      const home = await request('/');
      assert.strictEqual(home.status, 200);
      assert.ok(home.headers['content-type'].includes('text/html'));
      const api = await request('/api/events?alias=today');
      assert.strictEqual(api.status, 200);
    });
  });
});
