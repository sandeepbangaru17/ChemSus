const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const { all } = deps;

    router.get("/brochure", async (req, res) => {
        try {
            const row = await all(`SELECT value FROM site_settings WHERE key='brochure_url'`, []);
            res.json({ url: row[0]?.value || "" });
        } catch (e) {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.get("/products-page", async (req, res) => {
        try {
            const rows = await all(
                `SELECT * FROM products_page WHERE is_active=1 ORDER BY sort_order ASC, id ASC`,
                []
            );
            res.json(rows);
        } catch (e) {
            console.error("Products page fetch error stack:", e);
            res.status(500).json({ error: "DB error", details: String(e.message || e) });
        }
    });

    router.get("/shop-items", async (req, res) => {
        try {
            const rows = await all(
                `SELECT * FROM shop_items WHERE is_active=1 ORDER BY sort_order ASC, id ASC`,
                []
            );
            res.json(rows);
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.get("/pack-pricing/:shopItemId", async (req, res) => {
        try {
            const shopItemId = Number(req.params.shopItemId);
            const rows = await all(
                `SELECT pack_size, biofm_usd, biofm_inr, our_price FROM pack_pricing 
         WHERE shop_item_id=? AND is_active=1 ORDER BY sort_order ASC, id ASC`,
                [shopItemId]
            );
            res.json(rows);
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.get("/pack-pricing-all", async (req, res) => {
        try {
            const rows = await all(
                `SELECT shop_item_id, pack_size, biofm_usd, biofm_inr, our_price
         FROM pack_pricing
         WHERE is_active=1 ORDER BY sort_order ASC, id ASC`,
                []
            );
            // Group by shop_item_id for easy lookup in the frontend
            const grouped = {};
            rows.forEach(row => {
                if (!grouped[row.shop_item_id]) grouped[row.shop_item_id] = [];
                grouped[row.shop_item_id].push({
                    pack_size: row.pack_size,
                    biofm_usd: row.biofm_usd,
                    biofm_inr: row.biofm_inr,
                    our_price: row.our_price
                });
            });
            res.json(grouped);
        } catch (e) {
            console.error("Pack pricing all error:", e);
            res.status(500).json({ error: "DB error" });
        }
    });

    router.post("/sample-request", async (req, res) => {
        try {
            const {
                companyName,
                individualName,
                email: rawEmail,
                phone,
                designation,
                website,
                intendedUse,
                quantity,
                timeline,
                orderFrequency,
                verificationToken
            } = req.body;

            const email = deps.normalizeEmail(rawEmail);

            if (!companyName || !individualName || !deps.isValidEmail(email) || !phone || !designation || !website || !intendedUse || !quantity || !timeline || !orderFrequency) {
                return res.status(400).json({ error: "Missing required fields or invalid email." });
            }

            // Verify OTP token
            const otpSession = await deps.get(
                `SELECT * FROM email_otp_sessions WHERE email=? AND verification_token=? AND token_expires_at > datetime('now')`,
                [email, verificationToken]
            );

            if (!otpSession) {
                return res.status(401).json({ error: "Email not verified or verification expired." });
            }

            // Save to database
            await deps.run(
                `INSERT INTO sample_requests (company_name, individual_name, email, phone, designation, website, intended_use, quantity, timeline, order_frequency)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [companyName, individualName, email, phone, designation, website, intendedUse, quantity, timeline, orderFrequency]
            );

            // Mark OTP as used
            await deps.run(
                `UPDATE email_otp_sessions SET used_at=datetime('now') WHERE id=?`,
                [otpSession.id]
            );

            res.json({ ok: true, message: "Sample request submitted successfully." });
        } catch (e) {
            console.error("Sample request submit error:", e);
            res.status(500).json({ error: "Failed to submit sample request." });
        }
    });

    router.get("/test", (req, res) =>
        res.json({ ok: true, apiBase: "/api", backendURL: req.headers.host })
    );

    return router;
};
