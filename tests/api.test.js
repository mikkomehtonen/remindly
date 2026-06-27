const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { getDb, initDb } = require('../src/db/connection');

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

describe('Swagger spec', () => {
  // Use server from API integration describe below
  let swaggerSpec;

  before(async () => {
    // Delete require cache for swagger module to reload on fresh state
    delete require.cache[require.resolve('../src/config/swagger')];
    swaggerSpec = require('../src/config/swagger');
  });

  it('category enum in GET /api/events query param includes Other', () => {
    const pathItem = swaggerSpec.paths['/api/events']?.get;
    assert.ok(pathItem, 'GET /api/events should be defined');
    const categoryParam = pathItem.parameters?.find((p) => p.name === 'category');
    assert.ok(categoryParam, 'category parameter should exist');
    assert.ok(categoryParam.schema?.enum?.includes('Other'), 'category enum should include Other');
  });

  it('Event schema category enum includes Other', () => {
    const eventSchema = swaggerSpec.components?.schemas?.Event;
    assert.ok(eventSchema, 'Event schema should exist');
    const categoryProp = eventSchema.properties?.category;
    assert.ok(categoryProp, 'category property should exist');
    assert.ok(categoryProp.enum?.includes('Other'), 'Event category enum should include Other');
  });

  it('EventInput schema category enum includes Other', () => {
    const eventInputSchema = swaggerSpec.components?.schemas?.EventInput;
    assert.ok(eventInputSchema, 'EventInput schema should exist');
    const categoryProp = eventInputSchema.properties?.category;
    assert.ok(categoryProp, 'category property should exist');
    assert.ok(categoryProp.enum?.includes('Other'), 'EventInput category enum should include Other');
  });

  it('GET /health is documented as an unauthenticated Health endpoint', () => {
    const pathItem = swaggerSpec.paths['/health']?.get;
    assert.ok(pathItem, 'GET /health should be documented');
    assert.deepStrictEqual(pathItem.tags, ['Health'], 'should be tagged Health');
    assert.strictEqual(pathItem.security, undefined, 'should not require authentication');
    assert.ok(pathItem.responses?.[200]?.content?.['application/json'], 'should document 200 JSON response');
    assert.ok(pathItem.responses?.[503]?.content?.['application/json'], 'should document 503 JSON response');
  });
});

describe('API integration', () => {
  let server;

  before((_, done) => {
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
  });

  it('returns 401 without API key', async () => {
    const res = await request('/api/events?alias=today');
    assert.strictEqual(res.status, 401);
  });

  it('returns 401 with invalid API key', async () => {
    const res = await request('/api/events?alias=today', {
      headers: { 'x-api-key': 'wrong-key' },
    });
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

    it('error message for invalid category lists all valid categories including Other', async () => {
      const res = await request('/api/events?category=Foo', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 400);
      const json = JSON.parse(res.body);
      // Check that all categories (including Other) are listed in the error
      assert.ok(json.error.includes('Birthday'));
      assert.ok(json.error.includes('Name Day'));
      assert.ok(json.error.includes('Flag Day'));
      assert.ok(json.error.includes('Holiday'));
      assert.ok(json.error.includes('Anniversary'));
      assert.ok(json.error.includes('Other'));
    });

    it('admin can create a recurring event with category "Other"', async () => {
      // Get CSRF token for the new event form
      const formPage = await request('/admin/events/new', {
        headers: { Cookie: adminCookies },
      });
      const csrfToken = extractCsrf(formPage.body);

      // Use Helsinki-today's month/day so the recurring event always matches alias=today queries
      // (the server resolves date aliases in Europe/Helsinki timezone)
      const helsinkiStr = new Date().toLocaleString('en-US', { timeZone: 'Europe/Helsinki' });
      const helsinkiToday = new Date(helsinkiStr);
      const month = helsinkiToday.getMonth() + 1;
      const day = helsinkiToday.getDate();

      // Create a recurring "Other" event
      const createRes = await request('/admin/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: adminCookies,
        },
        body: `title=Graduation&category=Other&is_recurring=1&month=${month}&day=${day}&_csrf=${csrfToken}`,
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
      json.events.forEach((e) => {
        assert.strictEqual(e.category, 'Other');
      });
    });

    it('API query with invalid category returns 400 with valid categories including Other', async () => {
      const res = await request('/api/events?category=Foo', {
        headers: { 'x-api-key': 'test-key-1' },
      });
      assert.strictEqual(res.status, 400);
      const json = JSON.parse(res.body);
      assert.ok(json.error.includes('Other'));
    });

    it('API query with alias=today returns Other events alongside other categories', async () => {
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
      assert.strictEqual(api.status, 401);
    });
  });
});
