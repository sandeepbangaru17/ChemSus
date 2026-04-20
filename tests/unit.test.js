/**
 * Unit tests for ChemSus backend pure functions.
 * Run with: node --test tests/unit.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// ── Replicate helpers from server.js for isolated testing ─────────────

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function isValidPhone(s) {
  return /^[0-9]{10,15}$/.test(String(s || '').trim());
}

function normalizeEmail(s) {
  return String(s || '').trim().toLowerCase();
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hashLocalPassword(password, saltHex) {
  return crypto
    .createHmac('sha256', saltHex)
    .update(String(password))
    .digest('hex');
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch { return false; }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  test('accepts standard emails', () => {
    assert.ok(isValidEmail('user@example.com'));
    assert.ok(isValidEmail('user+tag@domain.co.in'));
    assert.ok(isValidEmail('director@chemsus.in'));
  });

  test('rejects invalid emails', () => {
    assert.ok(!isValidEmail(''));
    assert.ok(!isValidEmail('notanemail'));
    assert.ok(!isValidEmail('@nodomain.com'));
    assert.ok(!isValidEmail('user@'));
    assert.ok(!isValidEmail('user @example.com'));
    assert.ok(!isValidEmail(null));
    assert.ok(!isValidEmail(undefined));
  });
});

describe('isValidPhone', () => {
  test('accepts 10-15 digit phone numbers', () => {
    assert.ok(isValidPhone('9876543210'));
    assert.ok(isValidPhone('918486877575'));
    assert.ok(isValidPhone('123456789012345'));
  });

  test('rejects invalid phones', () => {
    assert.ok(!isValidPhone(''));
    assert.ok(!isValidPhone('123456789'));       // 9 digits
    assert.ok(!isValidPhone('1234567890123456')); // 16 digits
    assert.ok(!isValidPhone('+919876543210'));    // has +
    assert.ok(!isValidPhone('98765-43210'));      // has dash
    assert.ok(!isValidPhone(null));
  });
});

describe('normalizeEmail', () => {
  test('lowercases and trims', () => {
    assert.equal(normalizeEmail('  USER@Example.COM  '), 'user@example.com');
    assert.equal(normalizeEmail('Director@ChemSus.in'), 'director@chemsus.in');
  });

  test('handles edge cases', () => {
    assert.equal(normalizeEmail(null), '');
    assert.equal(normalizeEmail(undefined), '');
    assert.equal(normalizeEmail(''), '');
  });
});

describe('generateOtpCode', () => {
  test('generates a 6-digit string', () => {
    for (let i = 0; i < 10; i++) {
      const otp = generateOtpCode();
      assert.equal(typeof otp, 'string');
      assert.equal(otp.length, 6);
      assert.ok(/^\d{6}$/.test(otp), `OTP ${otp} should be 6 digits`);
    }
  });

  test('generates OTPs in valid range (100000-999999)', () => {
    for (let i = 0; i < 20; i++) {
      const otp = Number(generateOtpCode());
      assert.ok(otp >= 100000 && otp <= 999999);
    }
  });
});

describe('clampInt', () => {
  test('clamps values to range', () => {
    assert.equal(clampInt(5, 1, 10), 5);
    assert.equal(clampInt(0, 1, 10), 1);
    assert.equal(clampInt(15, 1, 10), 10);
    assert.equal(clampInt(-5, 0, 100), 0);
  });

  test('truncates floats', () => {
    assert.equal(clampInt(3.9, 0, 10), 3);
    assert.equal(clampInt(3.1, 0, 10), 3);
  });

  test('returns min for non-finite values', () => {
    assert.equal(clampInt('abc', 1, 10), 1);
    assert.equal(clampInt(NaN, 0, 5), 0);
    assert.equal(clampInt(null, 2, 8), 2);
    assert.equal(clampInt(Infinity, 0, 100), 0);  // non-finite → returns min
  });
});

describe('safeNumber', () => {
  test('returns number for valid inputs', () => {
    assert.equal(safeNumber(42), 42);
    assert.equal(safeNumber('3.14'), 3.14);
    assert.equal(safeNumber('0'), 0);
  });

  test('returns fallback for non-numeric inputs', () => {
    assert.equal(safeNumber('abc'), 0);
    assert.equal(safeNumber(null), 0);
    assert.equal(safeNumber(undefined), 0);
    assert.equal(safeNumber(NaN), 0);
    assert.equal(safeNumber('abc', 99), 99);
  });
});

describe('hashLocalPassword', () => {
  test('produces consistent hash for same inputs', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const h1 = hashLocalPassword('mypassword', salt);
    const h2 = hashLocalPassword('mypassword', salt);
    assert.equal(h1, h2);
  });

  test('produces different hash for different password', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const h1 = hashLocalPassword('password1', salt);
    const h2 = hashLocalPassword('password2', salt);
    assert.notEqual(h1, h2);
  });

  test('produces different hash for different salt', () => {
    const salt1 = crypto.randomBytes(16).toString('hex');
    const salt2 = crypto.randomBytes(16).toString('hex');
    const h1 = hashLocalPassword('samepassword', salt1);
    const h2 = hashLocalPassword('samepassword', salt2);
    assert.notEqual(h1, h2);
  });

  test('output is a hex string', () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashLocalPassword('test', salt);
    assert.match(hash, /^[0-9a-f]+$/);
  });
});

describe('safeEqualHex', () => {
  test('returns true for identical hex strings', () => {
    const h = crypto.randomBytes(32).toString('hex');
    assert.ok(safeEqualHex(h, h));
  });

  test('returns false for different hex strings', () => {
    const h1 = crypto.randomBytes(32).toString('hex');
    const h2 = crypto.randomBytes(32).toString('hex');
    assert.ok(!safeEqualHex(h1, h2));
  });

  test('returns false for empty or null inputs', () => {
    assert.ok(!safeEqualHex('', ''));
    assert.ok(!safeEqualHex(null, null));
    assert.ok(!safeEqualHex(undefined, undefined));
  });

  test('returns false for different lengths', () => {
    assert.ok(!safeEqualHex('aabb', 'aabbcc'));
  });
});

describe('purchase ID format', () => {
  test('CST format matches expected pattern', () => {
    // Simulate the format: CST-YYYY-YY-NNNN
    const pattern = /^CST-\d{4}-\d{2}-\d{4}$/;
    const examples = ['CST-2025-26-0001', 'CST-2026-27-0042', 'CST-2024-25-9999'];
    examples.forEach(id => assert.ok(pattern.test(id), `${id} should match pattern`));
  });
});
