try { require("dotenv").config(); } catch { /* dotenv optional */ }
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
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

// ---------------- Security Headers ----------------
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' api.qrserver.com https://*.supabase.co wss://*.supabase.co; frame-src 'self' https://www.openstreetmap.org https://www.google.com https://maps.google.com;"
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

  await transporter.sendMail({
    from,
    to: email,
    subject: "ChemSus Order Verification OTP",
    text: `Your ChemSus OTP is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`,
    html: `<p>Your ChemSus OTP is <b>${otp}</b>.</p><p>This OTP expires in ${OTP_TTL_MIN} minutes.</p>`,
  });
  return { mode: "smtp" };
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

// Middleware: require valid Supabase JWT whose email matches ADMIN_EMAIL
function requireAdmin(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const payload = decodeJwtPayload(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  // Check expiry
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return res.status(401).json({ error: "Token expired" });
  }

  const email = (payload.email || "").toLowerCase();
  if (!email || (ADMIN_EMAIL && email !== ADMIN_EMAIL)) {
    return res.status(403).json({ error: "Forbidden: not admin" });
  }

  req.supabaseUser = payload;
  next();
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
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const ADMIN_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]);
const RECEIPT_ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf"]);

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
const deps = { run, get, all, db, normalizeEmail, isValidEmail, isValidPhone, safeNumber, purgeOtpSessions, requireUser, receiptUpload, clampInt, requestSupabaseDirect, proxySupabasePasswordAuth, generateOtpCode, sendOtpEmail, hashOtp, rateLimiter, OTP_TOKEN_TTL_MIN, OTP_TTL_MIN, OTP_MAX_ATTEMPTS, OTP_RESEND_SEC, resolveSupabaseIps, requestSupabaseViaIp, hashLocalPassword, safeEqualHex, buildLocalAccessToken, findLocalAuthUserByEmail, upsertLocalAuthUser, createLocalAuthUser, verifyLocalAuthUser, buildLocalAuthPayload, parseCookies, setCookie, clearCookie, decodeJwtPayload, getTokenFromRequest, requireAdmin, extractUser, adminUpload, deleteReceiptFile, crypto, path, fs };
app.use('/api', require('./routes/auth')(deps));
app.use('/api', require('./routes/public')(deps));
app.use('/api', require('./routes/orders')(deps));
app.use('/api/admin', require('./routes/admin')(deps));
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

const PORT = process.env.PORT || 5000;
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
