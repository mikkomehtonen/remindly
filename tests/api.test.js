const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDb, initDb } = require('../src/db/connection');
const { VALID_CATEGORIES } = require('../src/config/categories');
const { resolveDate } = require('../src/utils/dateMath');

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
