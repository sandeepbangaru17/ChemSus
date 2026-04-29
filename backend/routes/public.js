const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const { all, run, get, normalizeEmail } = deps;

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

    // ---------------- Contact Form ----------------
    router.post("/contact", async (req, res) => {
        try {
            const { name, email: rawEmail, subject, message } = req.body || {};
            const email = deps.normalizeEmail(rawEmail);

            if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
            if (!deps.isValidEmail(email)) return res.status(400).json({ error: "Valid email is required." });
            if (!message || !message.trim()) return res.status(400).json({ error: "Message is required." });

            await deps.run(
                `INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)`,
                [name.trim(), email, (subject || '').trim(), message.trim()]
            );

            res.json({ ok: true, message: "Your message has been received. We'll get back to you soon!" });
        } catch (e) {
            console.error("Contact form error:", e);
            res.status(500).json({ error: "Failed to send message. Please try again." });
        }
    });

    router.get("/test", (req, res) =>
        res.json({ ok: true, apiBase: "/api", backendURL: req.headers.host })
    );

    router.post("/distributor-application", async (req, res) => {
        try {
            const {
                applicant_type,
                full_name,
                email: rawEmail,
                phone,
                company_name,
                region,
                industry_background,
                years_experience,
                experience_description,
                interest_description
            } = req.body || {};

            const email = deps.normalizeEmail(rawEmail);

            if (!full_name || !full_name.trim())
                return res.status(400).json({ error: "Full name is required." });
            if (!deps.isValidEmail(email))
                return res.status(400).json({ error: "Valid email is required." });
            if (!phone || !phone.trim())
                return res.status(400).json({ error: "Phone number is required." });
            if (!region || !region.trim())
                return res.status(400).json({ error: "Region of interest is required." });
            if (!industry_background || !industry_background.trim())
                return res.status(400).json({ error: "Industry background is required." });
            if (!years_experience || !years_experience.trim())
                return res.status(400).json({ error: "Years of experience is required." });
            if (!experience_description || !experience_description.trim())
                return res.status(400).json({ error: "Experience description is required." });
            if (!interest_description || !interest_description.trim())
                return res.status(400).json({ error: "Interest description is required." });

            const type = (applicant_type === 'individual') ? 'individual' : 'company';

            await deps.run(
                `INSERT INTO distributor_applications
                 (applicant_type, full_name, email, phone, company_name, region, industry_background, years_experience, experience_description, interest_description)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [type, full_name.trim(), email, phone.trim(), (company_name || '').trim(),
                 region.trim(), industry_background.trim(), years_experience.trim(),
                 experience_description.trim(), interest_description.trim()]
            );

            res.json({ ok: true, message: "Your distributorship application has been submitted. We will get back to you soon!" });
        } catch (e) {
            console.error("Distributor application error:", e);
            res.status(500).json({ error: "Failed to submit application. Please try again." });
        }
    });

    router.post("/collab-notify", async (req, res) => {
        try {
            const raw = String(req.body?.email || '').trim();
            if (!raw) return res.status(400).json({ error: "Email is required." });
            const email = normalizeEmail(raw);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                return res.status(400).json({ error: "Invalid email address." });
            const existing = await get(`SELECT id FROM collab_notify WHERE email=?`, [email]);
            if (existing) return res.json({ ok: true, message: "Already registered." });
            await run(`INSERT INTO collab_notify (email) VALUES (?)`, [email]);
            res.json({ ok: true });
        } catch (e) {
            console.error("collab-notify error:", e);
            res.status(500).json({ error: "Failed to save. Please try again." });
        }
    });

    return router;
};
