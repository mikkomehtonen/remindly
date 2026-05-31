const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE = 'http://localhost:3099';

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

describe('API integration', () => {
  let server;

  before((_, done) => {
    process.env.PORT = '3099';
    process.env.API_KEYS = 'test-key-1,test-key-2';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'testpass';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.NODE_ENV = 'development';

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

  it('returns 200 for public homepage', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
  });
});
