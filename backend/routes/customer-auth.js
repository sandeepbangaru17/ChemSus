const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all,
        normalizeEmail, isValidEmail, isValidPhone,
        hashLocalPassword, safeEqualHex, crypto,
        buildCustomerAccessToken, requireCustomer,
        sendTransactionalEmail, generateOtpCode, hashOtp,
        OTP_TTL_MIN, OTP_RESEND_SEC, OTP_MAX_ATTEMPTS,
        rateLimiter
    } = deps;

    const LIMIT_AUTH = rateLimiter(15 * 60 * 1000, 10);

    function otpExpiresAt(minutes) {
        return new Date(Date.now() + minutes * 60 * 1000)
            .toISOString().replace('T', ' ').slice(0, 19);
    }
    function cooldownAt(seconds) {
        return new Date(Date.now() + seconds * 1000)
            .toISOString().replace('T', ' ').slice(0, 19);
    }

    async function issueCustomerToken(email) {
        const user = await get('SELECT id FROM customer_users WHERE email=?', [normalizeEmail(email)]);
        if (!user) throw new Error('User not found');
        await run('UPDATE customer_users SET last_login_at=datetime("now"), updated_at=datetime("now") WHERE id=?', [user.id]);
        return buildCustomerAccessToken(normalizeEmail(email), user.id);
    }

    // ── POST /api/customer/signup ──────────────────────────────
    router.post('/signup', LIMIT_AUTH, async (req, res) => {
        try {
            const { password } = req.body || {};
            const email = normalizeEmail(req.body?.email || '');
            if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required.' });
            if (!password || String(password).length < 6)
                return res.status(400).json({ error: 'Password must be at least 6 characters.' });

            const existing = await get('SELECT id, is_verified FROM customer_users WHERE email=?', [email]);
            if (existing?.is_verified)
                return res.status(409).json({ error: 'Email already registered. Please log in.' });

            const saltHex = crypto.randomBytes(16).toString('hex');
            const hashHex = hashLocalPassword(String(password), saltHex);

            if (existing) {
                await run('UPDATE customer_users SET password_salt=?, password_hash=?, updated_at=datetime("now") WHERE id=?',
                    [saltHex, hashHex, existing.id]);
            } else {
                await run('INSERT INTO customer_users (email, password_salt, password_hash) VALUES (?,?,?)',
                    [email, saltHex, hashHex]);
            }

            // Send verification OTP
            const otp = generateOtpCode();
            const challengeId = crypto.randomBytes(16).toString('hex');
            const otpHash = hashOtp(email, otp, challengeId);

            await run(
                `INSERT INTO email_otp_sessions (challenge_id, email, otp_hash, expires_at, cooldown_until, max_attempts)
                 VALUES (?,?,?,?,?,?)`,
                [challengeId, email, otpHash, otpExpiresAt(OTP_TTL_MIN), cooldownAt(OTP_RESEND_SEC), OTP_MAX_ATTEMPTS]
            );

            sendTransactionalEmail(
                email,
                'Verify your ChemSus account',
                `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
                  <h2 style="color:#0074c7;">Verify your email</h2>
                  <p>Your ChemSus account verification OTP is:</p>
                  <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#0f172a;">${otp}</p>
                  <p style="color:#64748b;font-size:13px;">Expires in ${OTP_TTL_MIN} minutes. Do not share this OTP.</p>
                </div>`,
                `Your ChemSus account verification OTP is ${otp}. Expires in ${OTP_TTL_MIN} minutes.`
            ).catch(() => { });

            res.json({ ok: true, challengeId, resendInSec: OTP_RESEND_SEC });
        } catch (e) {
            console.error('[CUSTOMER-SIGNUP]', e);
            res.status(500).json({ error: 'Signup failed.' });
        }
    });

    // ── POST /api/customer/verify-email ───────────────────────
    router.post('/verify-email', LIMIT_AUTH, async (req, res) => {
        try {
            const { challengeId, otp } = req.body || {};
            const email = normalizeEmail(req.body?.email || '');
            if (!email || !challengeId || !otp) return res.status(400).json({ error: 'Missing fields.' });

            const session = await get(
                `SELECT * FROM email_otp_sessions
                 WHERE challenge_id=? AND email=? AND used_at IS NULL
                   AND datetime(expires_at) > datetime('now')`,
                [challengeId, email]
            );
            if (!session) return res.status(400).json({ error: 'Invalid or expired OTP session.' });
            if (session.attempts >= session.max_attempts)
                return res.status(429).json({ error: 'Too many attempts. Request a new OTP.' });

            const expected = hashOtp(email, otp, challengeId);
            if (expected !== session.otp_hash) {
                await run('UPDATE email_otp_sessions SET attempts=attempts+1 WHERE id=?', [session.id]);
                return res.status(400).json({ error: 'Incorrect OTP.' });
            }

            await run('UPDATE customer_users SET is_verified=1, updated_at=datetime("now") WHERE email=?', [email]);
            await run('UPDATE email_otp_sessions SET used_at=datetime("now"), verified_at=datetime("now") WHERE id=?', [session.id]);

            const tok = await issueCustomerToken(email);
            res.json({ ok: true, token: tok.accessToken, expiresAt: tok.expSec });
        } catch (e) {
            console.error('[CUSTOMER-VERIFY-EMAIL]', e);
            res.status(500).json({ error: 'Verification failed.' });
        }
    });

    // ── POST /api/customer/login ───────────────────────────────
    router.post('/login', LIMIT_AUTH, async (req, res) => {
        try {
            const { password } = req.body || {};
            const email = normalizeEmail(req.body?.email || '');
            if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

            const user = await get('SELECT * FROM customer_users WHERE email=?', [email]);
            if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
            if (!user.is_verified) return res.status(403).json({ error: 'Email not verified. Please verify your email first.', needsVerification: true });

            const inputHash = hashLocalPassword(String(password), user.password_salt);
            if (!safeEqualHex(inputHash, user.password_hash))
                return res.status(401).json({ error: 'Invalid email or password.' });

            const tok = await issueCustomerToken(email);
            res.json({
                ok: true, token: tok.accessToken, expiresAt: tok.expSec,
                profile: { name: user.name, email: user.email, phone: user.phone }
            });
        } catch (e) {
            console.error('[CUSTOMER-LOGIN]', e);
            res.status(500).json({ error: 'Login failed.' });
        }
    });

    // ── POST /api/customer/send-login-otp ─────────────────────
    router.post('/send-login-otp', LIMIT_AUTH, async (req, res) => {
        try {
            const email = normalizeEmail(req.body?.email || '');
            if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required.' });

            // Create unverified account if doesn't exist (OTP login auto-registers)
            const existing = await get('SELECT id FROM customer_users WHERE email=?', [email]);
            if (!existing) {
                await run('INSERT INTO customer_users (email, password_salt, password_hash) VALUES (?,?,?)',
                    [email, '', '']);
            }

            // Cooldown check
            const recent = await get(
                `SELECT cooldown_until FROM email_otp_sessions
                 WHERE email=? AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
                [email]
            );
            if (recent?.cooldown_until && new Date(recent.cooldown_until) > new Date()) {
                const secs = Math.ceil((new Date(recent.cooldown_until) - Date.now()) / 1000);
                return res.status(429).json({ error: `Please wait ${secs}s before requesting a new OTP.`, retryAfterSec: secs });
            }

            const otp = generateOtpCode();
            const challengeId = crypto.randomBytes(16).toString('hex');
            const otpHash = hashOtp(email, otp, challengeId);

            await run(
                `INSERT INTO email_otp_sessions (challenge_id, email, otp_hash, expires_at, cooldown_until, max_attempts)
                 VALUES (?,?,?,?,?,?)`,
                [challengeId, email, otpHash, otpExpiresAt(OTP_TTL_MIN), cooldownAt(OTP_RESEND_SEC), OTP_MAX_ATTEMPTS]
            );

            sendTransactionalEmail(
                email,
                'Your ChemSus login OTP',
                `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
                  <h2 style="color:#0074c7;">Login to ChemSus</h2>
                  <p>Your one-time login code is:</p>
                  <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#0f172a;">${otp}</p>
                  <p style="color:#64748b;font-size:13px;">Expires in ${OTP_TTL_MIN} minutes. Do not share.</p>
                </div>`,
                `Your ChemSus login OTP is ${otp}. Expires in ${OTP_TTL_MIN} minutes.`
            ).catch(() => { });

            res.json({ ok: true, challengeId, resendInSec: OTP_RESEND_SEC });
        } catch (e) {
            console.error('[CUSTOMER-SEND-LOGIN-OTP]', e);
            res.status(500).json({ error: 'Failed to send OTP.' });
        }
    });

    // ── POST /api/customer/login-otp ──────────────────────────
    router.post('/login-otp', LIMIT_AUTH, async (req, res) => {
        try {
            const { challengeId, otp } = req.body || {};
            const email = normalizeEmail(req.body?.email || '');
            if (!email || !challengeId || !otp) return res.status(400).json({ error: 'Missing fields.' });

            const session = await get(
                `SELECT * FROM email_otp_sessions
                 WHERE challenge_id=? AND email=? AND used_at IS NULL
                   AND datetime(expires_at) > datetime('now')`,
                [challengeId, email]
            );
            if (!session) return res.status(400).json({ error: 'Invalid or expired OTP.' });
            if (session.attempts >= session.max_attempts)
                return res.status(429).json({ error: 'Too many attempts.' });

            const expected = hashOtp(email, otp, challengeId);
            if (expected !== session.otp_hash) {
                await run('UPDATE email_otp_sessions SET attempts=attempts+1 WHERE id=?', [session.id]);
                return res.status(400).json({ error: 'Incorrect OTP.' });
            }

            // Auto-verify account on successful OTP login
            await run('UPDATE customer_users SET is_verified=1, updated_at=datetime("now") WHERE email=?', [email]);
            await run('UPDATE email_otp_sessions SET used_at=datetime("now"), verified_at=datetime("now") WHERE id=?', [session.id]);

            const tok = await issueCustomerToken(email);
            const user = await get('SELECT name, phone FROM customer_users WHERE email=?', [email]);
            res.json({
                ok: true, token: tok.accessToken, expiresAt: tok.expSec,
                profile: { name: user?.name || '', email, phone: user?.phone || '' }
            });
        } catch (e) {
            console.error('[CUSTOMER-LOGIN-OTP]', e);
            res.status(500).json({ error: 'Login failed.' });
        }
    });

    // ── GET /api/customer/profile ──────────────────────────────
    router.get('/profile', requireCustomer, async (req, res) => {
        try {
            const user = await get(
                'SELECT id, email, is_verified, name, phone, company_name, address, city, region, pincode, country, created_at FROM customer_users WHERE id=?',
                [req.customerId]
            );
            if (!user) return res.status(404).json({ error: 'User not found.' });
            res.json(user);
        } catch (e) {
            res.status(500).json({ error: 'Failed to load profile.' });
        }
    });

    // ── PUT /api/customer/profile ──────────────────────────────
    router.put('/profile', requireCustomer, async (req, res) => {
        try {
            const b = req.body || {};
            await run(
                `UPDATE customer_users SET
                   name=?, phone=?, company_name=?, address=?, city=?, region=?, pincode=?, country=?,
                   updated_at=datetime('now')
                 WHERE id=?`,
                [
                    (b.name || '').trim(),
                    (b.phone || '').trim(),
                    (b.company_name || '').trim(),
                    (b.address || '').trim(),
                    (b.city || '').trim(),
                    (b.region || '').trim(),
                    (b.pincode || '').trim(),
                    (b.country || 'India').trim(),
                    req.customerId
                ]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'Failed to update profile.' });
        }
    });

    // ── GET /api/customer/orders ───────────────────────────────
    router.get('/orders', requireCustomer, async (req, res) => {
        try {
            const rows = await all(
                `SELECT id, purchase_id, productname, quantity, unitprice, totalprice,
                        payment_status, order_status, created_at, updated_at,
                        customername, email, phone, companyName,
                        address, city, region, pincode, country
                 FROM orders
                 WHERE user_id=?
                 ORDER BY id DESC`,
                [String(req.customerId)]
            );
            // Attach order_items for each order (for quotation PDF regeneration)
            const result = await Promise.all(rows.map(async o => {
                const items = await all(
                    `SELECT product_name, pack_size, unit_price, quantity, total_price
                     FROM order_items WHERE order_id=? ORDER BY id ASC`,
                    [o.id]
                );
                return { ...o, items };
            }));
            res.json(result);
        } catch (e) {
            console.error('[CUSTOMER-ORDERS]', e);
            res.status(500).json({ error: 'Failed to load orders.' });
        }
    });

    // ── POST /api/customer/logout ──────────────────────────────
    router.post('/logout', (req, res) => res.json({ ok: true }));

    return router;
};
