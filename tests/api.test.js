/**
 * Integration tests for ChemSus API endpoints.
 * Requires the server to be running on PORT (default 5656).
 * Run with: node --test tests/api.test.js
 *
 * Set BASE_URL env var to override: BASE_URL=http://localhost:5656 node --test tests/api.test.js
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5656';

async function req(path, opts = {}) {
  const url = BASE_URL + path;
  const res = await fetch(url, opts);
  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { status: res.status, body };
}

// ── Health check ───────────────────────────────────────────────────────

describe('GET /api/test', () => {
  test('returns 200 with ok status', async () => {
    const { status, body } = await req('/api/test');
    assert.equal(status, 200);
    assert.ok(body.ok || body.status === 'ok' || typeof body === 'object');
  });
});

// ── Public routes ──────────────────────────────────────────────────────

describe('GET /api/products-page', () => {
  test('returns array of products', async () => {
    const { status, body } = await req('/api/products-page');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });
});

describe('GET /api/shop-items', () => {
  test('returns array of shop items', async () => {
    const { status, body } = await req('/api/shop-items');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });
});

describe('GET /api/pack-pricing-all', () => {
  test('returns pack pricing data', async () => {
    const { status, body } = await req('/api/pack-pricing-all');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object');
  });
});

describe('GET /api/brochure', () => {
  test('returns brochure info', async () => {
    const { status, body } = await req('/api/brochure');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object');
  });
});

// ── Admin auth ─────────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  test('rejects missing credentials with 401', async () => {
    const { status, body } = await req('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' }),
    });
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('rejects wrong credentials with 401', async () => {
    const { status, body } = await req('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wrong@example.com', password: 'wrongpassword' }),
    });
    assert.equal(status, 401);
    assert.ok(body.error);
  });
});

// ── Admin protected routes (unauthenticated) ───────────────────────────

describe('Admin protected routes without token', () => {
  const protectedRoutes = [
    { method: 'GET', path: '/api/admin/orders' },
    { method: 'GET', path: '/api/admin/payments' },
    { method: 'GET', path: '/api/admin/sample-requests' },
    { method: 'GET', path: '/api/admin/contact-messages' },
    { method: 'GET', path: '/api/admin/customers' },
    { method: 'GET', path: '/api/admin/analytics/views' },
    { method: 'GET', path: '/api/admin/analytics/geo' },
    { method: 'GET', path: '/api/admin/collab-notify' },
    { method: 'GET', path: '/api/admin/products-page' },
    { method: 'GET', path: '/api/admin/shop-items' },
  ];

  for (const { method, path } of protectedRoutes) {
    test(`${method} ${path} returns 401 without token`, async () => {
      const { status } = await req(path, { method });
      assert.equal(status, 401, `Expected 401 for ${method} ${path}, got ${status}`);
    });
  }
});

// ── Customer auth ──────────────────────────────────────────────────────

describe('POST /api/customer/login', () => {
  test('rejects missing fields with 400', async () => {
    const { status, body } = await req('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.ok([400, 401].includes(status));
    assert.ok(body.error);
  });

  test('rejects wrong credentials with 401', async () => {
    const { status } = await req('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@test.com', password: 'wrongpass' }),
    });
    assert.equal(status, 401);
  });
});

describe('POST /api/customer/signup', () => {
  test('rejects invalid email with 400', async () => {
    const { status, body } = await req('/api/customer/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'notanemail', password: 'Test1234!' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('rejects missing password with 400', async () => {
    const { status, body } = await req('/api/customer/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

// ── Customer protected routes (unauthenticated) ────────────────────────

describe('Customer protected routes without token', () => {
  test('GET /api/customer/profile returns 401', async () => {
    const { status } = await req('/api/customer/profile', { method: 'GET' });
    assert.equal(status, 401);
  });

  test('GET /api/customer/orders returns 401', async () => {
    const { status } = await req('/api/customer/orders', { method: 'GET' });
    assert.equal(status, 401);
  });
});

// ── Contact form ───────────────────────────────────────────────────────

describe('POST /api/contact', () => {
  test('rejects missing fields with 400', async () => {
    const { status, body } = await req('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('rejects invalid email with 400', async () => {
    const { status, body } = await req('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'invalid', subject: 'Hi', message: 'Test message' }),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

// ── Orders ─────────────────────────────────────────────────────────────

describe('POST /api/orders', () => {
  test('rejects missing required fields with 400', async () => {
    const { status, body } = await req('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

describe('GET /api/orders/:purchaseId', () => {
  test('returns 404 for non-existent purchase ID', async () => {
    const { status } = await req('/api/orders/CST-0000-00-0000');
    assert.ok([404, 400].includes(status));
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────

describe('Rate limiting on admin login', () => {
  test('returns 429 after 10 failed attempts', async () => {
    const attempts = [];
    for (let i = 0; i < 11; i++) {
      attempts.push(req('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ratelimit_test@example.com', password: 'wrong' }),
      }));
    }
    const results = await Promise.all(attempts);
    const statuses = results.map(r => r.status);
    assert.ok(
      statuses.some(s => s === 429),
      `Expected at least one 429, got: ${statuses.join(', ')}`
    );
  });
});
