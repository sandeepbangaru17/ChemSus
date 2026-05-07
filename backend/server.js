try { require("dotenv").config(); } catch { /* dotenv optional */ }
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const multer = require("multer");
const fs = require("fs");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}
const { db, initDb, getActivePath } = require("./db");

const app = express();
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_TTL_SEC = Math.floor(SESSION_TTL_MS / 1000);
const OTP_TTL_MIN = Math.max(1, Number(process.env.OTP_TTL_MIN || 10));
const OTP_RESEND_SEC = Math.max(15, Number(process.env.OTP_RESEND_SEC || 60));
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const OTP_TOKEN_TTL_MIN = Math.max(
  5,
  Number(process.env.OTP_TOKEN_TTL_MIN || 30)
);
const OTP_HASH_SECRET =
  process.env.OTP_HASH_SECRET || "change_me_for_production";

app.use(express.json({ limit: "2mb" }));
app.set('trust proxy', true);

// ---------------- Analytics: Geo lookup + page view tracking ----------------
const _geoCache = new Map();
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function lookupGeo(ip) {
  return new Promise((resolve) => {
    const fallback = { country: '', country_code: '', city: '' };
    if (!ip || ip === '127.0.0.1' || ip === '::1') {
      return resolve({ country: 'Local', country_code: 'LOCAL', city: '' });
    }
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) {
      return resolve({ country: 'Local', country_code: 'LOCAL', city: '' });
    }
    const cached = _geoCache.get(ip);
    if (cached && Date.now() < cached.expires) return resolve(cached.data);

    const cleanIp = ip.replace(/^::ffff:/, '');
    const req = http.get(
      `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,country,countryCode,city`,
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const data = j.status === 'success'
              ? { country: j.country || '', country_code: j.countryCode || '', city: j.city || '' }
              : fallback;
            _geoCache.set(ip, { data, expires: Date.now() + GEO_CACHE_TTL_MS });
            resolve(data);
          } catch { resolve(fallback); }
        });
      }
    );
    req.on('error', () => resolve(fallback));
    req.setTimeout(3000, () => { req.destroy(); resolve(fallback); });
  });
}

async function trackPageView(ip, pagePath) {
  try {
    const geo = await lookupGeo(ip);
    await run(
      `INSERT INTO page_views(page_path, ip, country, country_code, city) VALUES (?, ?, ?, ?, ?)`,
      [pagePath, ip, geo.country, geo.country_code, geo.city]
    );
  } catch (_) { /* silently ignore */ }
}

// ---------------- Security Headers ----------------
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' api.qrserver.com cdn.jsdelivr.net https://*.supabase.co wss://*.supabase.co; frame-src 'self' https://www.openstreetmap.org https://www.google.com https://maps.google.com;"
  );
  next();
});

// ---------------- In-Memory Rate Limiter ----------------
const _rateLimitStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateLimitStore.entries()) {
    if (now > v.reset) _rateLimitStore.delete(k);
  }
}, 5 * 60 * 1000); // Cleanup every 5 minutes

function rateLimiter(windowMs, max) {
  return (req, res, next) => {
    const key = (req.ip || 'unknown') + ':' + req.path;
    const now = Date.now();
    const entry = _rateLimitStore.get(key);
    if (!entry || now > entry.reset) {
      _rateLimitStore.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.reset - now) / 1000);
      return res.status(429).json({ error: 'Too many requests', retryAfterSec: retryAfter });
    }
    entry.count++;
    next();
  };
}

// ---------------- Helpers: Promise wrappers ----------------
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
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

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function isValidPhone(s) {
  return /^[0-9]{10,15}$/.test(String(s || "").trim());
}

function normalizeEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(email, otp, challengeId) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeEmail(email)}|${otp}|${challengeId}|${OTP_HASH_SECRET}`)
    .digest("hex");
}

let otpTransporter = null;
function getOtpTransporter() {
  if (otpTransporter) return otpTransporter;
  if (!nodemailer) {
    console.error("[OTP-CONFIG] Error: nodemailer is NOT loaded. Run 'npm install' on the server.");
    return null;
  }

  const host = (process.env.OTP_SMTP_HOST || process.env.SMTP_HOST || "").trim();
  const user = (process.env.OTP_SMTP_USER || process.env.SMTP_USER || "").trim();
  const pass = (process.env.OTP_SMTP_PASS || process.env.SMTP_PASS || "").trim();
  const portVal = process.env.OTP_SMTP_PORT || process.env.SMTP_PORT;
  const port = Number(portVal || 587);
  const secure =
    String(process.env.OTP_SMTP_SECURE || process.env.SMTP_SECURE || "false") ===
    "true";

  console.log(`[OTP-CONFIG] Checking settings: host='${host}', user='${user}', port=${port}, secure=${secure}, hasPass=${!!pass}`);

  if (!host || !user || !pass || !Number.isFinite(port)) {
    console.warn("[OTP-CONFIG] FAILED: Missing one or more required SMTP settings (Host, User, Pass, or Port).");
    return null;
  }

  otpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  console.log("[OTP-CONFIG] SUCCESS: Transporter created.");
  return otpTransporter;
}

async function sendOtpEmail(email, otp) {
  const transporter = getOtpTransporter();
  const from =
    (
      process.env.OTP_EMAIL_FROM ||
      process.env.FROM_EMAIL ||
      process.env.OTP_SMTP_USER ||
      process.env.SMTP_USER ||
      ""
    ).trim();
  if (!transporter || !from) {
    const reason = "Email OTP service is not configured";
    console.warn(`[OTP] ${reason}. Falling back to debug OTP.`);
    console.log(`[OTP-DEV] email=${email} otp=${otp}`);
    return { mode: "dev", reason };
  }

  try {
    await transporter.sendMail({
      from,
      to: email,
      subject: "ChemSus Order Verification OTP",
      text: `Your ChemSus OTP is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`,
      html: `<p>Your ChemSus OTP is <b>${otp}</b>.</p><p>This OTP expires in ${OTP_TTL_MIN} minutes.</p>`,
    });
    return { mode: "smtp" };
  } catch (err) {
    const reason = `SMTP send failed (${err?.message || err})`;
    console.warn(`[OTP] ${reason}. Falling back to debug OTP.`);
    console.log(`[OTP-DEV] email=${email} otp=${otp}`);
    return { mode: "dev", reason };
  }
}

async function sendTransactionalEmail(to, subject, html, text, attachments) {
  const transporter = getOtpTransporter();
  const from = (
    process.env.OTP_EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    process.env.OTP_SMTP_USER ||
    process.env.SMTP_USER ||
    ""
  ).trim();
  if (!transporter || !from) {
    console.warn(`[EMAIL] Transporter not configured. Would have sent to ${to}: ${subject}`);
    return { mode: "dev" };
  }
  try {
    const mailOpts = { from, to, subject, html, text: text || "" };
    if (attachments && attachments.length) mailOpts.attachments = attachments;
    await transporter.sendMail(mailOpts);
    return { mode: "smtp" };
  } catch (err) {
    console.warn(`[EMAIL] Send failed to ${to}: ${err?.message || err}`);
    return { mode: "error", reason: err?.message };
  }
}

async function purgeOtpSessions() {
  try {
    await run(
      `DELETE FROM email_otp_sessions
       WHERE
         (used_at IS NOT NULL AND datetime(used_at) < datetime('now','-7 days'))
         OR (verified_at IS NULL AND datetime(expires_at) < datetime('now','-1 day'))
         OR (verified_at IS NOT NULL AND datetime(token_expires_at) < datetime('now','-1 day'))`
    );
  } catch (e) {
    console.warn("OTP purge failed:", e.message || e);
  }
}

const RECEIPT_ROOT = path.join(PUBLIC, "assets", "receipts");
function resolveReceiptPath(receiptPath) {
  const raw = String(receiptPath || "").replace(/^[\\/]+/, "");
  if (!raw) return "";
  if (raw.startsWith("assets/")) return path.join(PUBLIC, raw);
  if (raw.startsWith("receipts/")) return path.join(PUBLIC, "assets", raw);
  return path.join(PUBLIC, "assets", "receipts", raw);
}

function deleteReceiptFile(receiptPath) {
  try {
    const full = resolveReceiptPath(receiptPath);
    if (!full) return;
    const normalized = path.normalize(full);
    if (!normalized.startsWith(RECEIPT_ROOT)) return;
    if (fs.existsSync(normalized)) fs.unlinkSync(normalized);
  } catch (e) {
    console.warn("Receipt delete failed:", e.message || e);
  }
}

// ---------------- Runtime config for the frontend ----------------
// Exposes only the Supabase public anon key + admin email so they don't live in git.
app.get("/config.json", (_req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    adminEmail: process.env.ADMIN_EMAIL || "",
  });
});

const SUPABASE_AUTH_IP_FALLBACK = ["104.18.38.10", "172.64.149.246"];
let supabaseIpCache = {
  host: "",
  ips: [],
  expiresAt: 0,
};

async function resolveSupabaseIps(host) {
  const now = Date.now();
  if (
    supabaseIpCache.host === host &&
    now < supabaseIpCache.expiresAt &&
    supabaseIpCache.ips.length
  ) {
    return supabaseIpCache.ips;
  }

  const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
    host
  )}&type=A`;
  const r = await fetch(dohUrl, {
    headers: { accept: "application/dns-json" },
  });
  if (!r.ok) {
    throw new Error(`DoH lookup failed (${r.status})`);
  }
  const payload = await r.json();
  const ips = (payload?.Answer || [])
    .filter((ans) => Number(ans?.type) === 1 && typeof ans?.data === "string")
    .map((ans) => ans.data.trim())
    .filter((ip) => /^[0-9.]+$/.test(ip));

  if (!ips.length) {
    throw new Error("DoH returned no A records");
  }

  supabaseIpCache = {
    host,
    ips: [...new Set(ips)],
    expiresAt: now + 5 * 60 * 1000,
  };
  return supabaseIpCache.ips;
}

function requestSupabaseViaIp({
  ip,
  host,
  requestPath,
  method = "POST",
  headers = {},
  body = "",
  timeoutMs = 15000,
}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: ip,
        port: 443,
        path: requestPath,
        method,
        servername: host,
        headers: {
          Host: host,
          ...headers,
        },
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", (chunk) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            status: upstreamRes.statusCode || 500,
            text,
            json,
          });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Supabase request timed out")));
    if (body) req.write(body);
    req.end();
  });
}

async function requestSupabaseDirect({
  baseUrl,
  requestPath,
  method = "POST",
  headers = {},
  body = "",
  timeoutMs = 15000,
}) {
  const base = new URL(baseUrl);
  const pathPart = String(requestPath || "").startsWith("/")
    ? String(requestPath || "")
    : `/${String(requestPath || "")}`;
  const url = `${base.origin}${pathPart}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      status: r.status || 500,
      text,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function proxySupabasePasswordAuth(routePath, payload) {
  const supabaseUrlRaw = String(process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrlRaw || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY is missing");
  }

  const supabaseHost = new URL(supabaseUrlRaw).host;
  const body = JSON.stringify(payload || {});
  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    "Content-Length": Buffer.byteLength(body),
  };

  // First try normal HTTPS to the Supabase host.
  // This is the most reliable path when DNS/network is healthy.
  try {
    return await requestSupabaseDirect({
      baseUrl: supabaseUrlRaw,
      requestPath: routePath,
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    console.warn("[SUPABASE-AUTH] Direct request failed:", err?.message || err);
  }

  // Fallback: resolve A records and try pinned IPs (helps in some DNS edge cases).
  let ips = [];
  try {
    ips = await resolveSupabaseIps(supabaseHost);
  } catch (err) {
    console.warn("[SUPABASE-DNS] DoH lookup failed, using fallback IPs:", err?.message || err);
  }
  if (!ips.length) ips = SUPABASE_AUTH_IP_FALLBACK;

  let lastErr = null;
  for (const ip of ips) {
    try {
      return await requestSupabaseViaIp({
        ip,
        host: supabaseHost,
        requestPath: routePath,
        method: "POST",
        headers,
        body,
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[SUPABASE-AUTH] Request failed via ${ip}:`, err?.message || err);
    }
  }

  throw lastErr || new Error("Unable to reach Supabase auth");
}

const LOCAL_AUTH_JWT_SECRET = String(
  process.env.LOCAL_AUTH_JWT_SECRET || process.env.OTP_HASH_SECRET || "change_me_for_production"
).trim();

function hashLocalPassword(password, saltHex) {
  const salt = Buffer.from(String(saltHex || ""), "hex");
  return crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a || ""), "hex");
    const right = Buffer.from(String(b || ""), "hex");
    if (!left.length || !right.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function buildLocalAccessToken(email, userId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + SESSION_TTL_SEC;
  const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadObj = {
    iss: "chemsus-local-auth",
    aud: "authenticated",
    role: "authenticated",
    email: normalizeEmail(email),
    sub: `local-${Number(userId || 0)}`,
    iat: nowSec,
    exp: expSec,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sigB64 = crypto
    .createHmac("sha256", LOCAL_AUTH_JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return {
    accessToken: `${headerB64}.${payloadB64}.${sigB64}`,
    expSec,
  };
}

async function findLocalAuthUserByEmail(email) {
  return get(
    `SELECT id, email, password_salt, password_hash
       FROM auth_users
      WHERE email=?`,
    [normalizeEmail(email)]
  );
}

async function upsertLocalAuthUser(email, password) {
  const emailNorm = normalizeEmail(email);
  const existing = await findLocalAuthUserByEmail(emailNorm);
  const saltHex = crypto.randomBytes(16).toString("hex");
  const hashHex = hashLocalPassword(password, saltHex);
  if (existing?.id) {
    await run(
      `UPDATE auth_users
          SET password_salt=?,
              password_hash=?,
              updated_at=datetime('now')
        WHERE id=?`,
      [saltHex, hashHex, existing.id]
    );
    return { id: existing.id, email: emailNorm };
  }
  const r = await run(
    `INSERT INTO auth_users(email, password_salt, password_hash)
     VALUES (?, ?, ?)`,
    [emailNorm, saltHex, hashHex]
  );
  return { id: r.lastID, email: emailNorm };
}

async function createLocalAuthUser(email, password) {
  const emailNorm = normalizeEmail(email);
  const existing = await findLocalAuthUserByEmail(emailNorm);
  if (existing?.id) return null;
  return upsertLocalAuthUser(emailNorm, password);
}

async function verifyLocalAuthUser(email, password) {
  const user = await findLocalAuthUserByEmail(email);
  if (!user) return null;
  const incomingHash = hashLocalPassword(password, user.password_salt);
  if (!safeEqualHex(incomingHash, user.password_hash)) return null;
  await run(
    `UPDATE auth_users
        SET last_login_at=datetime('now'),
            updated_at=datetime('now')
      WHERE id=?`,
    [user.id]
  );
  return { id: user.id, email: normalizeEmail(user.email) };
}

function buildLocalAuthPayload(user) {
  const emailNorm = normalizeEmail(user?.email || "");
  const token = buildLocalAccessToken(emailNorm, user?.id);
  return {
    access_token: token.accessToken,
    token_type: "bearer",
    expires_in: SESSION_TTL_SEC,
    expires_at: token.expSec,
    refresh_token: crypto.randomBytes(24).toString("hex"),
    user: {
      id: `local-${Number(user?.id || 0)}`,
      email: emailNorm,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
    },
  };
}

// ---------------- Page-view tracking middleware ----------------
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const p = req.path;
    const isHtml = p.endsWith('.html') || p === '/' || p === '';
    const isAdmin = p.startsWith('/admin');
    const isApi = p.startsWith('/api');
    const isAsset = p.startsWith('/assets') || p.startsWith('/products');
    if (isHtml && !isAdmin && !isApi && !isAsset) {
      const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress
        || 'unknown';
      trackPageView(rawIp, p);
    }
  }
  next();
});

// Redirect www to non-www
app.use((req, res, next) => {
  if (req.hostname === "www.chemsus.in") {
    return res.redirect(301, "https://chemsus.in" + req.originalUrl);
  }
  next();
});

// ---------------- Blog SSR ----------------
function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BLOG_CSS = `<style>
:root{--primary:#0074c7;--primary-dark:#00508a;--accent:#00b8b0;--bg:#F3F7FB;--ink:#1f2933}
*{box-sizing:border-box;margin:0;padding:0}
html{margin:0;padding:0;width:100%;min-height:100%;background:var(--bg)}
body{font-family:"Open Sans",Arial,sans-serif;line-height:1.6;color:var(--ink);background:var(--bg);min-height:100dvh;overflow-x:hidden}
a{text-decoration:none;color:inherit}
.sidebar{width:240px;background:var(--primary);color:#fff;border-right:3px solid var(--accent);display:flex;flex-direction:column;height:100vh;overflow:hidden;position:fixed;left:0;top:0;z-index:1002;transition:transform .3s ease}
.sidebar-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1001;backdrop-filter:blur(2px);opacity:0;transition:opacity .3s ease}
.sidebar-overlay.active{display:block;opacity:1}
.nav-logo{display:inline-flex;align-items:center;gap:8px;font-family:"Montserrat",sans-serif;font-weight:700;font-size:16px;letter-spacing:.02em;white-space:nowrap;color:#fff;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
.nav-logo-img{height:24px;width:auto}
.nav-menu{list-style:none;padding:8px 0;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.nav-menu li a{display:block;color:#fff;padding:10px 20px;font-size:13.5px;border-left:3px solid transparent;transition:all .2s ease}
.nav-menu li a.active,.nav-menu li a:hover{background:rgba(255,255,255,.1);border-left-color:var(--accent)}
.nav-section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.45);padding:10px 20px 4px;pointer-events:none;user-select:none}
.nav-icon{margin-right:6px;font-size:14px;display:inline-block;width:18px;text-align:center}
#cart-count{background:var(--accent);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin-left:8px}
.search-section{padding:12px 20px 16px;border-top:1px solid rgba(255,255,255,.1)}
.search-form{position:relative}
.search-input{width:100%;padding:8px 32px 8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font-size:12.5px;outline:none;backdrop-filter:blur(10px)}
.search-input::placeholder{color:#fff;font-size:11.5px}
.search-icon{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:#fff;pointer-events:none}
.mobile-toggle{display:none;position:fixed;top:20px;left:20px;z-index:1003;background:var(--primary);color:#fff;border:none;padding:12px;border-radius:8px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.mobile-toggle svg{width:20px;height:20px}
.main-wrapper{margin-left:240px;width:calc(100% - 240px);flex:1;min-height:100vh;display:flex;flex-direction:column;transition:margin-left .3s ease}
.hero{position:relative;overflow:hidden;background:radial-gradient(circle at top left,rgba(0,184,176,.18),transparent 55%),radial-gradient(circle at bottom right,rgba(0,116,199,.2),transparent 55%),#041424;color:#fff;min-height:220px;padding:32px 0;display:flex;align-items:center;justify-content:center;text-align:center;border-top:3px solid var(--accent)}
.hero::before{content:"";position:absolute;inset:0;background-image:radial-gradient(circle at 10% 20%,rgba(255,255,255,.08) 0,rgba(255,255,255,.08) 2px,transparent 3px),radial-gradient(circle at 80% 70%,rgba(255,255,255,.08) 0,rgba(255,255,255,.08) 2px,transparent 3px);background-size:140px 140px;opacity:.6;pointer-events:none}
.hero-content{position:relative;z-index:1;max-width:720px;padding:0 18px}
.hero-kicker{font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px;color:#b9e6ff}
.hero-title{font-family:"Montserrat",sans-serif;font-size:32px;line-height:1.1;font-weight:700;margin-bottom:6px}
.hero-subtitle{font-size:14px;color:#e2f3ff}
main{max-width:900px;margin:0 auto;padding:32px 18px 48px;width:100%;flex:1}
.blog-article{background:#fff;border-radius:14px;box-shadow:0 12px 28px rgba(15,23,42,.1);padding:40px 44px;margin-bottom:28px}
.blog-article h2{font-family:"Montserrat",sans-serif;font-size:20px;font-weight:700;color:var(--primary-dark);margin:28px 0 10px;padding-bottom:8px;border-bottom:2px solid #e2e8f0}
.blog-article h3{font-family:"Montserrat",sans-serif;font-size:16px;font-weight:700;color:var(--primary-dark);margin:20px 0 8px}
.blog-article p{font-size:15px;color:#374151;line-height:1.8;margin-bottom:14px}
.blog-article ul,.blog-article ol{margin:0 0 14px 24px;font-size:15px;color:#374151;line-height:1.8}
.blog-article li{margin-bottom:6px}
.blog-article strong{color:var(--ink)}
.blog-table-wrap{overflow-x:auto;margin:16px 0 20px}
.blog-table{width:100%;border-collapse:collapse;font-size:14px}
.blog-table th{background:#f0f7ff;color:var(--primary-dark);font-family:"Montserrat",sans-serif;font-size:12px;font-weight:700;padding:10px 14px;border:1px solid #dce8f5;text-align:left}
.blog-table td{padding:10px 14px;border:1px solid #e5eef7;color:#374151}
.blog-table tr:nth-child(even) td{background:#f8fbff}
.blog-actions{display:flex;flex-direction:column;align-items:center;gap:16px;margin-top:36px}
.blog-cta{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,var(--accent),#00d4cc);color:#fff;padding:15px 36px;border-radius:12px;font-family:"Montserrat",sans-serif;font-weight:700;font-size:15px;box-shadow:0 6px 16px rgba(0,184,176,.3);transition:all .2s ease;width:100%;max-width:400px}
.blog-cta:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,184,176,.4);color:#fff}
.blog-back-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;color:var(--primary);border:2px solid var(--primary);padding:13px 32px;border-radius:12px;font-family:"Montserrat",sans-serif;font-weight:600;font-size:14px;transition:all .2s ease;width:100%;max-width:400px}
.blog-back-btn:hover{background:var(--primary);color:#fff;transform:translateY(-2px)}
.blog-back{display:inline-flex;align-items:center;gap:6px;color:var(--primary);font-size:14px;font-weight:600;margin-bottom:24px;padding:8px 0}
.blog-back:hover{color:var(--primary-dark)}
.blog-card{background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.09);padding:28px 32px;margin-bottom:22px;border-left:4px solid var(--accent);transition:transform .2s ease,box-shadow .2s ease}
.blog-card:hover{transform:translateY(-3px);box-shadow:0 14px 32px rgba(15,23,42,.14)}
.blog-card h2{font-family:"Montserrat",sans-serif;font-size:18px;font-weight:700;color:var(--primary-dark);margin-bottom:10px;line-height:1.3}
.blog-card h2 a{color:inherit}
.blog-card h2 a:hover{color:var(--primary)}
.blog-card p{font-size:14px;color:#4b5563;line-height:1.7;margin-bottom:14px}
.blog-card-meta{font-size:12px;color:#6b7280;margin-bottom:8px}
.blog-read-more{display:inline-flex;align-items:center;gap:4px;color:var(--primary);font-size:13px;font-weight:700;border-bottom:1px solid transparent;transition:border-color .2s ease}
.blog-read-more:hover{border-bottom-color:var(--primary)}
.blog-empty{text-align:center;padding:60px 20px;color:#6b7280;font-size:15px}
.blog-listing-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.blog-count{font-size:13px;color:#6b7280;font-weight:500}
:root{--fab-size:60px;--fab-right:25px;--fab-bottom:calc(25px + env(safe-area-inset-bottom));--fab-gap:10px}
#ib-wa{position:fixed;bottom:var(--fab-bottom);right:var(--fab-right);z-index:99999;font-family:Arial,sans-serif}
#ib-wa-btn{background:#25d366;color:#fff;border:none;border-radius:50%;width:var(--fab-size);height:var(--fab-size);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);transition:transform .3s ease}
#ib-wa-btn:hover{transform:scale(1.1)}
#ib-wa-btn svg{width:calc(var(--fab-size)*.58);height:calc(var(--fab-size)*.58);fill:white}
#ib-wa-popup{display:none;position:absolute;bottom:calc(var(--fab-size) + 20px);right:0;width:300px;max-width:85vw;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.2);overflow:hidden}
#ib-wa-popup header{background:#075e54;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:600}
#ib-wa-popup header span:last-child{cursor:pointer;font-size:18px;opacity:.8}
#ib-wa-popup .body{padding:16px;text-align:center}
#ib-wa-popup .body img{width:180px;height:auto;margin:10px 0;border:4px solid #f0f0f0;border-radius:8px}
#ib-wa-popup .body a{display:block;background:#25d366;color:#fff;padding:12px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;margin-top:10px;box-shadow:0 4px 10px rgba(37,211,102,.3)}
.download-section{width:auto;position:fixed;bottom:calc(var(--fab-bottom) + var(--fab-size) + var(--fab-gap));right:var(--fab-right);z-index:99998}
.download-btn{display:flex;align-items:center;justify-content:center;width:var(--fab-size);height:var(--fab-size);border-radius:50%;background:#fff;color:var(--primary);box-shadow:0 4px 15px rgba(0,0,0,.15);transition:all .3s ease;text-decoration:none;border:2px solid var(--primary);position:relative}
.download-btn svg{width:24px;height:24px;fill:currentColor}
.download-btn:hover{background:var(--primary);color:#fff;transform:translateY(-5px);box-shadow:0 8px 25px rgba(0,0,0,.2)}
.download-btn::before{content:"Brochure";position:absolute;bottom:75px;right:50%;transform:translateX(50%);background:var(--ink);color:#fff;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap;opacity:0;visibility:hidden;transition:all .2s ease}
.download-btn:hover::before{opacity:1;visibility:visible;bottom:70px}
footer{background:#06121f;color:#cbd5f5;font-size:13px;margin-top:auto}
@media(max-width:1050px){.sidebar{transform:translateX(-100%)}.sidebar.open{transform:translateX(0)}.main-wrapper{margin-left:0;width:100%;padding-top:0}.mobile-toggle{display:block}.hero{padding-top:72px}body.no-scroll{overflow:hidden}body.no-scroll .mobile-toggle{opacity:0;pointer-events:none}}
@media(max-width:900px){main{padding:24px 14px 36px}.hero{height:auto;padding:72px 14px 26px}.hero-title{font-size:24px}.blog-article{padding:24px 20px}}
@media(max-width:580px){.hero-title{font-size:20px}.hero{padding:36px 0 28px}main{padding:18px 12px 30px}.blog-article{padding:18px 14px}.blog-card{padding:20px 18px}:root{--fab-size:50px;--fab-right:20px;--fab-bottom:calc(40px + env(safe-area-inset-bottom))}}
@media(max-width:480px){.blog-article h2{font-size:17px}.blog-article h3{font-size:14px}.blog-article p,.blog-article li{font-size:14px}.blog-table{font-size:13px}}
</style>`;

function blogPageNav(isBlogActive) {
  const activeClass = isBlogActive ? ' class="active"' : '';
  return `
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="closeSidebar()"></div>
  <button class="mobile-toggle" onclick="toggleSidebar()" aria-label="Toggle Menu">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
  </button>
  <nav class="sidebar" id="sidebar">
    <a href="/index.html" class="nav-logo">
      <img src="/assets/logo.webp" alt="ChemSus Logo" class="nav-logo-img" width="40" height="53">
      <span>ChemSus</span>
    </a>
    <ul class="nav-menu">
      <li class="nav-section-label">Main</li>
      <li><a href="/index.html"><span class="nav-icon">🏠</span> Home</a></li>
      <li><a href="/about.html"><span class="nav-icon">ℹ️</span> About Us</a></li>
      <li><a href="/products.html"><span class="nav-icon">🧪</span> Products</a></li>
      <li><a href="/blogs"${activeClass}><span class="nav-icon">📝</span> Blogs and Updates</a></li>
      <li class="nav-section-label">Shop</li>
      <li><a href="/shop.html"><span class="nav-icon">🛍️</span> Shop</a></li>
      <li><a href="/cart.html"><span class="nav-icon">🛒</span> Cart <span id="cart-count">0</span></a></li>
      <li class="nav-section-label">Company</li>
      <li><a href="/collaboration.html"><span class="nav-icon">🤝</span> Collaboration</a></li>
      <li><a href="/recognitions.html"><span class="nav-icon">🏆</span> Recognitions</a></li>
      <li><a href="/investors.html"><span class="nav-icon">💼</span> Investors</a></li>
      <li><a href="/distributorship.html"><span class="nav-icon">🚚</span> Distributorship</a></li>
      <li class="nav-section-label">Support</li>
      <li><a href="/contact.html"><span class="nav-icon">✉️</span> Contact us</a></li>
      <li><a href="/request-sample.html"><span class="nav-icon">🧫</span> Request Sample</a></li>
      <li><a href="/bulk-order.html"><span class="nav-icon">📦</span> Bulk Order</a></li>
      <li class="nav-section-label">Account</li>
      <li><a href="/login.html" id="authNavLink"><span class="nav-icon">👤</span> Login / Sign Up</a></li>
      <li id="profileNavItem" style="display:none"><a href="/profile.html"><span class="nav-icon">⚙️</span> My Profile</a></li>
    </ul>
    <div class="search-section">
      <form class="search-form" id="siteSearchForm">
        <input type="search" id="siteSearchInput" class="search-input" placeholder="Search pages..." aria-label="Search pages">
        <span class="search-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/>
          </svg>
        </span>
      </form>
    </div>
  </nav>`;
}

const BLOG_FOOTER_HTML = `
  <footer style="background:#06121f;color:#cbd5f5;padding:40px 0 20px;margin-top:auto;">
    <div style="max-width:1100px;margin:0 auto;padding:0 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:36px;margin-bottom:28px;">
      <div>
        <h4 style="color:#fff;font-family:'Montserrat',sans-serif;margin-bottom:14px;font-size:15px;">Registered Office</h4>
        <p style="font-size:14px;line-height:1.6;">House No. 555, GNB Road,<br>Guwahati, Assam – 781030</p>
      </div>
      <div>
        <h4 style="color:#fff;font-family:'Montserrat',sans-serif;margin-bottom:14px;font-size:15px;">Branch Office</h4>
        <p style="font-size:14px;line-height:1.6;">Gavara jaggayyapalem,<br>BHPV, Visakhapatnam 530012</p>
      </div>
      <div>
        <h4 style="color:#fff;font-family:'Montserrat',sans-serif;margin-bottom:14px;font-size:15px;">Contact</h4>
        <p style="font-size:14px;margin-bottom:8px;">📞 <a href="tel:+918486877575" style="color:#cbd5f5;">+91 84868 77575</a></p>
        <p style="font-size:14px;">✉️ <a href="mailto:info@chemsus.in" style="color:#cbd5f5;">info@chemsus.in</a></p>
      </div>
      <div>
        <h4 style="color:#fff;font-family:'Montserrat',sans-serif;margin-bottom:14px;font-size:15px;">Follow Us</h4>
        <a href="https://www.linkedin.com/company/chemsus-tech/?viewAsMember=true" target="_blank" rel="noopener noreferrer"
           style="display:inline-flex;align-items:center;gap:8px;color:#cbd5f5;text-decoration:none;font-size:14px;padding:8px 14px;border:1px solid rgba(255,255,255,.2);border-radius:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#0a66c2" style="flex-shrink:0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          LinkedIn
        </a>
      </div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:18px;text-align:center;font-size:13px;">
      &copy; ${new Date().getFullYear()} ChemSus Technologies Pvt Ltd. All rights reserved.
    </div>
  </footer>`;

const BLOG_WA_HTML = `
  <div id="ib-wa">
    <div id="ib-wa-popup">
      <header><span>Chat with ChemSus</span><span onclick="ibToggleWA()">✕</span></header>
      <div class="body">
        <p style="font-size:13px;margin-bottom:10px;">Scan to chat on mobile</p>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://wa.me/918486877575?text=Hello%20ChemSus%20Team" alt="WhatsApp QR">
        <div style="display:flex;align-items:center;margin:12px 0;color:#999;font-size:13px;">
          <span style="flex:1;height:1px;background:#ddd;"></span><span style="padding:0 10px;font-weight:600;">OR</span><span style="flex:1;height:1px;background:#ddd;"></span>
        </div>
        <a href="https://wa.me/918486877575?text=Hello%20ChemSus%20Team%2C%0A%0AI%20am%20interested%20in%20your%20sustainable%20specialty%20chemicals." target="_blank">Open WhatsApp</a>
      </div>
    </div>
    <button id="ib-wa-btn" onclick="ibToggleWA()" aria-label="Open WhatsApp Chat">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3 18.6-68.1-4.4-6.9c-18.6-29.5-28.4-63.5-28.4-98.6 0-101.9 82.9-184.8 185-184.8 49.3 0 95.7 19.2 130.5 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-4-10.5-6.8z"/></svg>
    </button>
  </div>
  <div class="download-section">
    <a href="/assets/brochure.pdf" download="ChemSus_Brochure.pdf" class="download-btn" title="Download Brochure">
      <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
    </a>
  </div>`;

const BLOG_SCRIPT = `
  <script src="/assets/callback-widget.js"><\/script>
  <script>
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    function toggleSidebar() {
      const isOpen = sidebar.classList.toggle('open');
      overlay.classList.toggle('active', isOpen);
      document.body.classList.toggle('no-scroll', isOpen);
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      document.body.classList.remove('no-scroll');
    }
    document.querySelectorAll('.nav-menu a').forEach(l => l.addEventListener('click', () => { if (window.innerWidth <= 1050) closeSidebar(); }));
    (function() {
      const cart = JSON.parse(localStorage.getItem('chemsusCart')) || [];
      const count = cart.reduce((s, i) => s + (i.quantity || 0), 0);
      const badge = document.getElementById('cart-count');
      if (badge) badge.textContent = count;
    })();
    function ibToggleWA() {
      const p = document.getElementById('ib-wa-popup');
      p.style.display = p.style.display === 'block' ? 'none' : 'block';
    }
    document.getElementById('siteSearchForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const q = document.getElementById('siteSearchInput').value.trim().toLowerCase();
      if (!q) return;
      if (q.includes('product') || q.includes('shop')) window.location.href = '/products.html';
      else if (q.includes('recognition') || q.includes('award')) window.location.href = '/recognitions.html';
      else if (q.includes('investor') || q.includes('funding')) window.location.href = '/investors.html';
      else if (q.includes('contact') || q.includes('address') || q.includes('phone')) window.location.href = '/contact.html';
      else if (q.includes('home') || q.includes('chemsus')) window.location.href = '/index.html';
      else if (q.includes('about') || q.includes('company')) window.location.href = '/about.html';
      else if (q.includes('collab') || q.includes('partner')) window.location.href = '/collaboration.html';
      else if (q.includes('sample')) window.location.href = '/request-sample.html';
      else if (q.includes('blog')) window.location.href = '/blogs';
      else window.location.href = '/shop.html?q=' + encodeURIComponent(q);
    });
    (function() {
      const tok = sessionStorage.getItem('chemsus_customer_token');
      const exp = Number(sessionStorage.getItem('chemsus_customer_token_exp') || 0);
      const link = document.getElementById('authNavLink');
      const profileItem = document.getElementById('profileNavItem');
      if (!link) return;
      if (tok && (!exp || Date.now() / 1000 < exp)) {
        const name = sessionStorage.getItem('chemsus_customer_name');
        link.innerHTML = '<span class="nav-icon">📦</span> ' + (name ? 'My Orders (' + name + ')' : 'My Orders');
        link.href = '/my-orders.html';
        if (profileItem) profileItem.style.display = 'list-item';
      } else {
        link.innerHTML = '<span class="nav-icon">👤</span> Login / Sign Up';
        link.href = '/login.html';
        if (profileItem) profileItem.style.display = 'none';
      }
    })();
  <\/script>`;

function blogHead(title, description, canonical, extra) {
  return `<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${description}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="text/plain" href="/llms.txt">
<link rel="icon" type="image/png" href="/assets/logo.webp">
${extra || ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Open+Sans:wght@400;600&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Open+Sans:wght@400;600&display=swap"></noscript>
${BLOG_CSS}
</head>`;
}

app.get('/blogs', async (req, res) => {
  try {
    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    trackPageView(rawIp, '/blogs');
    const blogs = await all(`SELECT id, slug, title, excerpt, published_at FROM blogs WHERE is_published=1 ORDER BY id DESC`);

    const cards = blogs.length
      ? blogs.map(b => {
          const date = b.published_at ? new Date(b.published_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          return `<div class="blog-card">
            ${date ? `<div class="blog-card-meta">📅 ${date}</div>` : ''}
            <h2><a href="/blogs/${escapeAttr(b.slug)}">${escapeAttr(b.title)}</a></h2>
            <p>${escapeAttr(b.excerpt)}</p>
            <a href="/blogs/${escapeAttr(b.slug)}" class="blog-read-more">Read Article →</a>
          </div>`;
        }).join('')
      : '<div class="blog-empty">No blog posts yet. Check back soon.</div>';

    const ogExtra = `<meta property="og:type" content="website">
<meta property="og:title" content="Blogs and Updates | ChemSus Technologies">
<meta property="og:description" content="In-depth articles on bio-based specialty chemicals, calcium levulinate, sodium levulinate, and sustainable chemistry.">
<meta property="og:url" content="https://chemsus.in/blogs">`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
${blogHead('Blogs and Updates | ChemSus Technologies', 'Explore ChemSus Technologies blogs and updates — in-depth articles on bio-based specialty chemicals, levulinic acid derivatives, and sustainable formulation science.', 'https://chemsus.in/blogs', ogExtra)}
<body>
${blogPageNav(true)}
<div class="main-wrapper" id="mainWrapper">
  <section class="hero">
    <div class="hero-content">
      <div class="hero-kicker">ChemSus Technologies</div>
      <h1 class="hero-title">Blogs and Updates</h1>
      <p class="hero-subtitle">Insights on bio-based specialty chemicals &amp; sustainable formulation science</p>
    </div>
  </section>
  <main>
    <div class="blog-listing-header">
      <span class="blog-count">${blogs.length} article${blogs.length !== 1 ? 's' : ''}</span>
    </div>
    ${cards}
  </main>
  ${BLOG_FOOTER_HTML}
</div>
${BLOG_WA_HTML}
${BLOG_SCRIPT}
</body>
</html>`);
  } catch (e) {
    console.error('[BLOG-LIST]', e);
    res.status(500).send('Server error');
  }
});

app.get('/blogs/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!slug) return res.status(404).send('Not found');
    const blog = await get(`SELECT * FROM blogs WHERE slug=? AND is_published=1`, [slug]);
    if (!blog) return res.status(404).send('Blog post not found');

    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    trackPageView(rawIp, `/blogs/${slug}`);

    const date = blog.published_at ? new Date(blog.published_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const schemaDate = blog.published_at ? new Date(blog.published_at).toISOString() : new Date().toISOString();
    const modDate = blog.updated_at ? new Date(blog.updated_at).toISOString() : schemaDate;

    const productName = escapeAttr(blog.title.split(':')[0].trim());
    const ctaBlock = blog.product_link
      ? `<a href="${escapeAttr(blog.product_link)}" class="blog-cta">🧪 View ${productName} Product →</a>`
      : '';

    const ogExtra = `<meta property="og:type" content="article">
<meta property="og:title" content="${escapeAttr(blog.title)}">
<meta property="og:description" content="${escapeAttr(blog.meta_description || blog.excerpt)}">
<meta property="og:url" content="https://chemsus.in/blogs/${escapeAttr(blog.slug)}">
<meta property="og:site_name" content="ChemSus Technologies Pvt Ltd">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(blog.title)}">
<meta name="twitter:description" content="${escapeAttr(blog.meta_description || blog.excerpt)}">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"${escapeAttr(blog.title)}","description":"${escapeAttr(blog.meta_description || blog.excerpt)}","url":"https://chemsus.in/blogs/${escapeAttr(blog.slug)}","datePublished":"${schemaDate}","dateModified":"${modDate}","publisher":{"@type":"Organization","name":"ChemSus Technologies Pvt Ltd","url":"https://chemsus.in"},"author":{"@type":"Organization","name":"ChemSus Technologies Pvt Ltd"}}<\/script>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
${blogHead(escapeAttr(blog.title) + ' | ChemSus Technologies', escapeAttr(blog.meta_description || blog.excerpt), 'https://chemsus.in/blogs/' + escapeAttr(blog.slug), ogExtra)}
<body>
${blogPageNav(false)}
<div class="main-wrapper" id="mainWrapper">
  <section class="hero">
    <div class="hero-content">
      <div class="hero-kicker">ChemSus Blog</div>
      <h1 class="hero-title">${escapeAttr(blog.title)}</h1>
      ${date ? `<p class="hero-subtitle">📅 ${date}</p>` : ''}
    </div>
  </section>
  <main>
    <a href="/blogs" class="blog-back">← Back to Blogs and Updates</a>
    <article class="blog-article">${blog.content}</article>
    <div class="blog-actions">
      ${ctaBlock}
      <a href="/blogs" class="blog-back-btn">← Back to Blogs and Updates</a>
    </div>
  </main>
  ${BLOG_FOOTER_HTML}
</div>
${BLOG_WA_HTML}
${BLOG_SCRIPT}
</body>
</html>`);
  } catch (e) {
    console.error('[BLOG-DETAIL]', e);
    res.status(500).send('Server error');
  }
});

// ---------------- Static ----------------
app.use("/assets", express.static(path.join(PUBLIC, "assets")));
app.use("/products", express.static(path.join(PUBLIC, "products")));
app.use("/admin", express.static(path.join(PUBLIC, "admin")));
app.use(express.static(PUBLIC));

// ---------------- Cookies helper ----------------
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}
function setCookie(res, name, value) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${isProd ? "; Secure" : ""
    }`
  );
}
function clearCookie(res, name) {
  res.setHeader(
    "Set-Cookie",
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  );
}

// ---------------- Supabase JWT Admin Auth ----------------
// The ADMIN_EMAIL env var controls which Supabase user gets admin access.
// The frontend sends "Authorization: Bearer <supabase_access_token>" with every
// admin API request. We decode the JWT payload here without verifying the
// signature (the token was already issued by Supabase; for strict production
// verification you can add the `jsonwebtoken` package and verify with the
// Supabase JWT secret). We keep the old cookie session stubs so existing
// links don't break.

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function getTokenFromRequest(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return parseCookies(req).admin_session || null;
}

// Verify locally-issued JWT signature (HMAC-SHA256)
function verifyLocalJwt(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const expectedSig = crypto
      .createHmac("sha256", LOCAL_AUTH_JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");
    // Timing-safe comparison
    if (expectedSig.length !== parts[2].length) return null;
    const a = Buffer.from(expectedSig);
    const b = Buffer.from(parts[2]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Get effective admin email — DB override takes priority over env var
async function getEffectiveAdminEmail() {
  try {
    const row = await get(`SELECT value FROM site_settings WHERE key='admin_email_override'`);
    return (row?.value || ADMIN_EMAIL || "").toLowerCase();
  } catch {
    return ADMIN_EMAIL;
  }
}

// Middleware: require valid locally-signed JWT whose email matches current admin email
async function requireAdmin(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = verifyLocalJwt(token);
    if (!payload) return res.status(401).json({ error: "Invalid or tampered token" });

    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ error: "Token expired" });
    }

    const email = (payload.email || "").toLowerCase();
    if (!email) return res.status(403).json({ error: "Forbidden: not admin" });

    const effectiveEmail = await getEffectiveAdminEmail();
    if (effectiveEmail && email !== effectiveEmail) {
      return res.status(403).json({ error: "Forbidden: not admin" });
    }

    req.adminUser = { email };
    next();
  } catch (e) {
    return res.status(500).json({ error: "Auth error" });
  }
}

// Middleware: extract any valid Supabase user (for user-facing protected routes)
function extractUser(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = decodeJwtPayload(token);
    if (payload && (!payload.exp || Date.now() / 1000 < payload.exp)) {
      req.supabaseUser = payload;
    }
  }
  next();
}

// Middleware: require any logged-in user
function requireUser(req, res, next) {
  extractUser(req, res, () => {
    if (!req.supabaseUser) return res.status(401).json({ error: "Login required" });
    next();
  });
}

// ── Customer (shopper) JWT ──────────────────────────────────────
const CUSTOMER_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function buildCustomerAccessToken(email, userId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + CUSTOMER_TOKEN_TTL_SEC;
  const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadObj = {
    iss: "chemsus-customer",
    sub: String(userId),
    email: normalizeEmail(email),
    role: "customer",
    iat: nowSec,
    exp: expSec,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sigB64 = crypto
    .createHmac("sha256", LOCAL_AUTH_JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return { accessToken: `${headerB64}.${payloadB64}.${sigB64}`, expSec };
}

function verifyCustomerToken(token) {
  const payload = verifyLocalJwt(token);
  if (!payload || payload.role !== "customer") return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

async function requireCustomer(req, res, next) {
  try {
    const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Login required" });
    const payload = verifyCustomerToken(token);
    if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
    req.customerId = Number(payload.sub);
    req.customerEmail = normalizeEmail(payload.email);
    next();
  } catch {
    return res.status(401).json({ error: "Auth error" });
  }
}


// ---------------- Uploads ----------------
const ADMIN_UPLOAD_DIR = path.join(PUBLIC, "assets", "uploads");
const RECEIPT_DIR = path.join(PUBLIC, "assets", "receipts");
fs.mkdirSync(ADMIN_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RECEIPT_DIR, { recursive: true });

function safeName(originalname) {
  return originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const ADMIN_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const RECEIPT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const ADMIN_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]);
const RECEIPT_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".heic", ".heif"]);

function checkFile(file, allowedMime, allowedExt) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!allowedMime.has(file.mimetype) || !allowedExt.has(ext)) {
    return new Error("Invalid file type");
  }
  return null;
}

const adminUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ADMIN_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const unique = Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      cb(null, unique + "_" + safeName(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => {
    const err = checkFile(file, ADMIN_ALLOWED_MIME, ADMIN_ALLOWED_EXT);
    if (err) return cb(err);
    return cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RECEIPT_DIR),
    filename: (req, file, cb) => {
      const unique = Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      cb(null, unique + "_" + safeName(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => {
    const err = checkFile(file, RECEIPT_ALLOWED_MIME, RECEIPT_ALLOWED_EXT);
    if (err) return cb(err);
    return cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Admin upload (site images/pdfs)
const deps = { run, get, all, db, normalizeEmail, isValidEmail, isValidPhone, safeNumber, purgeOtpSessions, requireUser, receiptUpload, clampInt, requestSupabaseDirect, proxySupabasePasswordAuth, generateOtpCode, sendOtpEmail, sendTransactionalEmail, hashOtp, rateLimiter, OTP_TOKEN_TTL_MIN, OTP_TTL_MIN, OTP_MAX_ATTEMPTS, OTP_RESEND_SEC, resolveSupabaseIps, requestSupabaseViaIp, hashLocalPassword, safeEqualHex, buildLocalAccessToken, buildCustomerAccessToken, verifyCustomerToken, requireCustomer, findLocalAuthUserByEmail, upsertLocalAuthUser, createLocalAuthUser, verifyLocalAuthUser, buildLocalAuthPayload, parseCookies, setCookie, clearCookie, decodeJwtPayload, getTokenFromRequest, requireAdmin, verifyLocalJwt, extractUser, adminUpload, deleteReceiptFile, crypto, path, fs, ADMIN_EMAIL, ADMIN_PASSWORD, getEffectiveAdminEmail, CUSTOMER_TOKEN_TTL_SEC };
app.use('/api', require('./routes/auth')(deps));
app.use('/api', require('./routes/public')(deps));
app.use('/api', require('./routes/orders')(deps));
app.use('/api/admin', require('./routes/admin')(deps));
app.use('/api/customer', require('./routes/customer-auth')(deps));
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.message === "Invalid file type") {
    return res.status(400).json({ error: "Invalid file type" });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large" });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Server error" });
});

const PORT = process.env.PORT || 5656;
async function start() {
  try {
    await initDb();
    app.listen(PORT, () =>
      console.log(`Server running on http://localhost:${PORT}`)
    );
  } catch (e) {
    console.error("DB init failed:", e);
    process.exit(1);
  }
}

start();
