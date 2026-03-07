const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all,
        normalizeEmail, isValidEmail,
        requestSupabaseDirect, proxySupabasePasswordAuth,
        generateOtpCode, sendOtpEmail, hashOtp,
        purgeOtpSessions, rateLimiter,
        OTP_TOKEN_TTL_MIN
    } = deps;

    // Login (Path: /api/auth/password-login)
    router.post("/auth/password-login", async (req, res) => {
        try {
            const email = normalizeEmail(req.body?.email || "");
            const password = String(req.body?.password || "");
            if (!isValidEmail(email) || password.length < 6) {
                return res.status(400).json({ error: "Invalid email or weak password" });
            }

            const upstream = await proxySupabasePasswordAuth("/token?grant_type=password", {
                email,
                password,
            });

            if (upstream.status >= 200 && upstream.status < 300 && upstream.json) {
                try {
                    const userObj = upstream.json.user || {};
                    const uid = userObj.id || "";
                    if (uid) {
                        deps.upsertLocalAuthUser(email, password).catch((err) =>
                            console.error("[AUTH-LOGIN] Failed to sync upstream user to local:", err)
                        );
                    }
                } catch (e) { }
            } else {
                try {
                    const localPayload = await deps.verifyLocalAuthUser(email, password);
                    if (localPayload) {
                        console.log(`[AUTH-LOGIN] successful fallback local login for ${email}`);
                        return res.status(200).json(localPayload);
                    }
                } catch (localErr) {
                    console.warn("[AUTH-LOGIN] Local fallback failed:", localErr?.message || localErr);
                }
            }

            if (upstream.json) return res.status(upstream.status).json(upstream.json);
            return res.status(upstream.status).send(upstream.text);
        } catch (err) {
            console.error("[AUTH-LOGIN] Proxy failed:", err?.message || err);
            try {
                const email = normalizeEmail(req.body?.email || "");
                const password = String(req.body?.password || "");
                const localPayload = await deps.verifyLocalAuthUser(email, password);
                if (localPayload) {
                    console.log(`[AUTH-LOGIN] successful fallback local login (proxy err) for ${email}`);
                    return res.status(200).json(localPayload);
                }
            } catch (localErr) {
                console.warn("[AUTH-LOGIN] Local fallback failed after proxy error:", localErr?.message || localErr);
            }
            return res.status(502).json({ error: "Unable to reach Supabase auth" });
        }
    });

    // Signup (Path: /api/auth/password-signup)
    router.post("/auth/password-signup", async (req, res) => {
        try {
            const email = normalizeEmail(req.body?.email || "");
            const password = String(req.body?.password || "");
            if (!isValidEmail(email) || password.length < 6) {
                return res.status(400).json({ error: "Invalid email or weak password" });
            }

            const upstream = await proxySupabasePasswordAuth("/signup", {
                email,
                password,
            });

            if (upstream.status >= 200 && upstream.status < 300) {
                deps.createLocalAuthUser(email, password).catch((e) =>
                    console.error("Failed to seed local account on signup", e)
                );
            } else {
                try {
                    await deps.createLocalAuthUser(email, password);
                    return res.status(200).json({ local_fallback: true, msg: "Signup via fallback" });
                } catch (localErr) {
                    console.warn("[AUTH-SIGNUP] Local fallback failed:", localErr?.message || localErr);
                }
            }

            if (upstream.json) return res.status(upstream.status).json(upstream.json);
            return res.status(upstream.status).send(upstream.text);
        } catch (err) {
            console.error("[AUTH-SIGNUP] Proxy failed:", err?.message || err);
            try {
                const email = normalizeEmail(req.body?.email || "");
                const password = String(req.body?.password || "");
                await deps.createLocalAuthUser(email, password);
                return res.status(200).json({ local_fallback: true, msg: "Signup via fallback" });
            } catch (localErr) {
                console.warn("[AUTH-SIGNUP] Local fallback failed:", localErr?.message || localErr);
            }
            return res.status(502).json({ error: "Unable to reach Supabase auth" });
        }
    });

    // OTP Send (Path: /api/otp/email/send)
    router.post("/otp/email/send", rateLimiter(15 * 60 * 1000, 5), async (req, res) => {
        try {
            await purgeOtpSessions();
            const email = normalizeEmail(req.body?.email || "");
            if (!isValidEmail(email)) {
                return res.status(400).json({ error: "Invalid email format." });
            }
            const otp = generateOtpCode();
            const challengeId = deps.crypto.randomUUID();
            const hash = hashOtp(email, otp, challengeId);

            await run(
                `INSERT INTO email_otp_sessions (email, challenge_id, otp_hash, expires_at)
             VALUES (?, ?, ?, datetime('now', '+15 minutes'))`,
                [email, challengeId, hash]
            );

            await sendOtpEmail(email, otp);

            res.json({
                ok: true,
                challengeId,
                message: "OTP sent (expires in 15m).",
            });
        } catch (e) {
            if (e.message && e.message.includes("SQLITE_READONLY")) {
                console.error("SQLITE_READONLY ERROR DETECTED ON OTP SEND:", e);
                return res.status(500).json({
                    error: "Database configuration error prevents sending OTP. Please contact admin."
                });
            }
            console.error("OTP Send error stack:", e);
            res.status(500).json({ error: "Failed to send OTP", details: String(e.message || e) });
        }
    });

    // OTP Verify (Path: /api/otp/email/verify)
    router.post("/otp/email/verify", async (req, res) => {
        try {
            await purgeOtpSessions();
            const email = normalizeEmail(req.body?.email || "");
            const challengeId = String(req.body?.challengeId || "").trim();
            const otp = String(req.body?.otp || "").trim();

            if (!isValidEmail(email)) {
                return res.status(400).json({ error: "Invalid email" });
            }
            if (!challengeId || !otp) {
                return res.status(400).json({ error: "Missing challengeId or OTP" });
            }

            const row = await get(
                `SELECT * FROM email_otp_sessions WHERE challenge_id=? AND email=?`,
                [challengeId, email]
            );

            if (!row) {
                return res.status(400).json({ error: "Invalid or expired OTP session." });
            }
            if (row.verified) {
                return res.status(400).json({ error: "This OTP was already verified." });
            }

            const nowMs = Date.now();
            const expiresMs = new Date(row.expires_at + "Z").getTime();
            if (nowMs > expiresMs)
                return res.status(400).json({ error: "OTP expired. Request a new OTP." });
            if (Number(row.attempts) >= Number(row.max_attempts)) {
                return res.status(429).json({ error: "Maximum OTP attempts exceeded. Request a new OTP." });
            }

            const expectedHash = hashOtp(email, otp, challengeId);
            if (expectedHash !== row.otp_hash) {
                await run(
                    `UPDATE email_otp_sessions
               SET attempts = attempts + 1, updated_at=datetime('now')
               WHERE id=?`,
                    [row.id]
                );
                return res.status(400).json({ error: "Incorrect OTP." });
            }

            const verificationToken = deps.crypto.randomUUID();
            await run(
                `UPDATE email_otp_sessions
             SET verified=1,
                 verification_token=?,
                 token_expires_at=datetime('now', ?),
                 updated_at=datetime('now')
             WHERE id=?`,
                [verificationToken, `+${OTP_TOKEN_TTL_MIN} minutes`, row.id]
            );

            return res.json({
                ok: true,
                verificationToken,
                tokenExpiresInSec: OTP_TOKEN_TTL_MIN * 60,
            });
        } catch (e) {
            console.error("OTP verify error stack:", e);
            res.status(500).json({ error: "OTP verification failed", details: String(e.message || e) });
        }
    });

    return router;
};
