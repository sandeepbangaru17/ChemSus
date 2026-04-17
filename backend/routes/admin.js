const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all, requireAdmin,
        adminUpload, deleteReceiptFile,
        rateLimiter, normalizeEmail,
        ADMIN_EMAIL, ADMIN_PASSWORD,
        buildLocalAccessToken, crypto,
        hashLocalPassword, safeEqualHex,
        getEffectiveAdminEmail
    } = deps;

    // ---------------- Admin Login (no auth required) ----------------
    router.post("/login", rateLimiter(15 * 60 * 1000, 10), async (req, res) => {
        try {
            const emailOrUsername = normalizeEmail(req.body?.email || req.body?.username || "");
            const password = String(req.body?.password || "");

            // Get effective admin email (DB override or env)
            const effectiveEmail = await getEffectiveAdminEmail();
            if (!effectiveEmail) {
                return res.status(503).json({ error: "Admin credentials not configured on server" });
            }

            if (emailOrUsername !== effectiveEmail) {
                return res.status(401).json({ error: "Invalid credentials" });
            }

            // Check DB-stored hashed password first, then fall back to env plain-text
            let isPasswordMatch = false;
            const dbPassRow = await get(`SELECT value FROM site_settings WHERE key='admin_password_hash'`);
            if (dbPassRow?.value) {
                const [saltHex, hashHex] = String(dbPassRow.value).split(":");
                const inputHash = hashLocalPassword(password, saltHex);
                isPasswordMatch = safeEqualHex(inputHash, hashHex);
            } else {
                if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin credentials not configured on server" });
                try {
                    const a = Buffer.from(password);
                    const b = Buffer.from(ADMIN_PASSWORD);
                    isPasswordMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
                } catch { isPasswordMatch = false; }
            }

            if (!isPasswordMatch) {
                return res.status(401).json({ error: "Invalid credentials" });
            }

            const tokenData = buildLocalAccessToken(effectiveEmail, 0);
            return res.json({
                ok: true,
                token: tokenData.accessToken,
                expiresAt: tokenData.expSec
            });
        } catch (e) {
            console.error("[ADMIN-LOGIN]", e);
            return res.status(500).json({ error: "Login failed" });
        }
    });

    // ---------------- Change Admin Credentials ----------------
    router.post("/change-credentials", requireAdmin, async (req, res) => {
        try {
            const { currentPassword, newEmail, newPassword } = req.body || {};
            if (!currentPassword) return res.status(400).json({ error: "Current password required" });

            // Verify current password
            const effectiveEmail = await getEffectiveAdminEmail();
            let isPasswordMatch = false;
            const dbPassRow = await get(`SELECT value FROM site_settings WHERE key='admin_password_hash'`);
            if (dbPassRow?.value) {
                const [saltHex, hashHex] = String(dbPassRow.value).split(":");
                const inputHash = hashLocalPassword(String(currentPassword), saltHex);
                isPasswordMatch = safeEqualHex(inputHash, hashHex);
            } else {
                try {
                    const a = Buffer.from(String(currentPassword));
                    const b = Buffer.from(ADMIN_PASSWORD || "");
                    isPasswordMatch = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
                } catch { isPasswordMatch = false; }
            }

            if (!isPasswordMatch) return res.status(401).json({ error: "Current password is incorrect" });

            // Update email if provided
            if (newEmail) {
                const emailNorm = normalizeEmail(newEmail);
                if (!emailNorm) return res.status(400).json({ error: "Invalid email" });
                await run(
                    `INSERT INTO site_settings (key, value) VALUES ('admin_email_override', ?)
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
                    [emailNorm]
                );
            }

            // Update password if provided
            if (newPassword) {
                if (String(newPassword).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
                const saltHex = crypto.randomBytes(16).toString("hex");
                const hashHex = hashLocalPassword(String(newPassword), saltHex);
                await run(
                    `INSERT INTO site_settings (key, value) VALUES ('admin_password_hash', ?)
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
                    [`${saltHex}:${hashHex}`]
                );
            }

            return res.json({ ok: true });
        } catch (e) {
            console.error("[CHANGE-CREDENTIALS]", e);
            return res.status(500).json({ error: "Failed to update credentials" });
        }
    });

    // ---------------- Admin upload (site images/pdfs) ----------------
    router.post(
        "/upload",
        requireAdmin,
        adminUpload.single("file"),
        async (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ error: "No file provided" });
                const url = `/assets/uploads/${req.file.filename}`;
                await run(
                    `INSERT INTO site_settings (key, value) VALUES ('last_upload', ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
                    [url]
                );
                res.json({ ok: true, path: url }); // Frontend expects 'path' in some places, but others use 'url'. Let's provide both or check admin.html.
            } catch (e) {
                console.error("Upload error:", e);
                res.status(500).json({ error: "DB error" });
            }
        }
    );

    // ---------------- Admin CRUD: Products Page ----------------
    router.post("/brochure", requireAdmin, async (req, res) => {
        try {
            const url = (req.body?.url || "").trim();
            await run(
                `INSERT INTO site_settings (key, value) VALUES ('brochure_url', ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
                [url]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.get("/products-page", requireAdmin, async (req, res) => {
        try {
            const rows = await all(
                `SELECT * FROM products_page ORDER BY sort_order ASC, id ASC`,
                []
            );
            res.json(rows);
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.post("/products-page", requireAdmin, async (req, res) => {
        try {
            const b = req.body || {};
            const r = await run(
                `INSERT INTO products_page
         (name, description, image, link, is_active, sort_order)
         VALUES (?,?,?,?,?,?)`,
                [
                    b.name || "",
                    b.description || "",
                    b.image || "",
                    b.link || "",
                    b.isactive ? 1 : 0,
                    Number(b.sortorder || 0),
                ]
            );
            res.json({ ok: true, id: r.lastID });
        } catch (e) {
            console.error("Save product error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.put("/products-page/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const b = req.body || {};
            const r = await run(
                `UPDATE products_page
         SET name=?, description=?, image=?, link=?, is_active=?, sort_order=?, updated_at=datetime('now')
         WHERE id=?`,
                [
                    b.name || "",
                    b.description || "",
                    b.image || "",
                    b.link || "",
                    b.isactive ? 1 : 0,
                    Number(b.sortorder || 0),
                    id,
                ]
            );
            res.json({ ok: true, changed: r.changes });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/products-page/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const r = await run(`DELETE FROM products_page WHERE id=?`, [id]);
            res.json({ ok: true, deleted: r.changes });
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    // ---------------- Admin CRUD: Shop Items ----------------
    router.get("/shop-items", requireAdmin, async (req, res) => {
        try {
            const rows = await all(
                `SELECT * FROM shop_items ORDER BY sort_order ASC, id ASC`,
                []
            );
            res.json(rows);
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    router.post("/shop-items", requireAdmin, async (req, res) => {
        try {
            const b = req.body || {};
            const features_json = JSON.stringify(b.features || []);
            const r = await run(
                `INSERT INTO shop_items
         (name, subtitle, price, features_json, image, is_active, sort_order, stockStatus, showBadge, badge, moreLink)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    b.name || "",
                    b.subtitle || "",
                    Number(b.price || 0),
                    features_json,
                    b.image || "",
                    b.isactive ? 1 : 0,
                    Number(b.sortorder || 0),
                    b.stockStatus || "in-stock",
                    b.showBadge ? 1 : 0,
                    b.badge || "",
                    b.moreLink || "",
                ]
            );
            res.json({ ok: true, id: r.lastID });
        } catch (e) {
            console.error("Save shop item error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.put("/shop-items/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const b = req.body || {};
            const features_json = JSON.stringify(b.features || []);
            const r = await run(
                `UPDATE shop_items
         SET name=?, subtitle=?, price=?, features_json=?, image=?, is_active=?, sort_order=?, stockStatus=?, showBadge=?, badge=?, moreLink=?, updated_at=datetime('now')
         WHERE id=?`,
                [
                    b.name || "",
                    b.subtitle || "",
                    Number(b.price || 0),
                    features_json,
                    b.image || "",
                    b.isactive ? 1 : 0,
                    Number(b.sortorder || 0),
                    b.stockStatus || "in-stock",
                    b.showBadge ? 1 : 0,
                    b.badge || "",
                    b.moreLink || "",
                    id,
                ]
            );
            res.json({ ok: true, changed: r.changes });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/shop-items/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            await run(`DELETE FROM pack_pricing WHERE shop_item_id=?`, [id]);
            const r = await run(`DELETE FROM shop_items WHERE id=?`, [id]);
            res.json({ ok: true, deleted: r.changes });
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    // ---------------- Admin CRUD: Pack Pricing ----------------
    router.get("/pack-pricing/:shopItemId", requireAdmin, async (req, res) => {
        try {
            const shopItemId = Number(req.params.shopItemId);
            const rows = await all(
                `SELECT * FROM pack_pricing WHERE shop_item_id=? ORDER BY sort_order ASC, id ASC`,
                [shopItemId]
            );
            res.json(rows);
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    // RESTful version
    router.post("/pack-pricing/:shopItemId", requireAdmin, async (req, res) => {
        try {
            const shopItemId = Number(req.params.shopItemId);
            const b = req.body || {};
            const r = await run(
                `INSERT INTO pack_pricing
         (shop_item_id, pack_size, our_price, biofm_usd, biofm_inr, is_active, sort_order)
         VALUES (?,?,?,?,?,?,?)`,
                [
                    shopItemId,
                    b.packSize || "",
                    Number(b.ourPrice || 0),
                    Number(b.biofmUsd || 0),
                    Number(b.biofmInr || 0),
                    b.isActive ? 1 : 0,
                    Number(b.sortOrder || 0),
                ]
            );
            res.json({ ok: true, id: r.lastID });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // Legacy compatibility for POST /api/admin/pack-pricing
    router.post("/pack-pricing", requireAdmin, async (req, res) => {
        try {
            const b = req.body || {};
            const shopItemId = Number(b.shopItemId);
            if (!shopItemId) return res.status(400).json({ error: "shopItemId required" });
            const r = await run(
                `INSERT INTO pack_pricing
         (shop_item_id, pack_size, our_price, biofm_usd, biofm_inr, is_active, sort_order)
         VALUES (?,?,?,?,?,?,?)`,
                [
                    shopItemId,
                    b.packSize || "",
                    Number(b.ourPrice || 0),
                    Number(b.biofmUsd || 0),
                    Number(b.biofmInr || 0),
                    b.isActive ? 1 : 0,
                    Number(b.sortOrder || 0),
                ]
            );
            res.json({ ok: true, id: r.lastID });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.put("/pack-pricing/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const b = req.body || {};
            const r = await run(
                `UPDATE pack_pricing
         SET pack_size=?, our_price=?, biofm_usd=?, biofm_inr=?, is_active=?, sort_order=?, updated_at=datetime('now')
         WHERE id=?`,
                [
                    b.packSize || "",
                    Number(b.ourPrice || 0),
                    Number(b.biofmUsd || 0),
                    Number(b.biofmInr || 0),
                    b.isActive ? 1 : 0,
                    Number(b.sortOrder || 0),
                    id,
                ]
            );
            res.json({ ok: true, changed: r.changes });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/pack-pricing/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const r = await run(`DELETE FROM pack_pricing WHERE id=?`, [id]);
            res.json({ ok: true, deleted: r.changes });
        } catch {
            res.status(500).json({ error: "DB error" });
        }
    });

    // ---------------- Admin: Orders + Payments ----------------
    router.get("/orders", requireAdmin, async (req, res) => {
        try {
            const rows = await all(
                `SELECT
           id, purchase_id AS purchaseid, payment_status AS paymentstatus, customername, email, phone,
           companyName, address, city, region, pincode, country,
           productname, quantity, unitprice, totalprice, paymentmode,
           created_at AS createdat, updated_at AS updatedat, order_status
         FROM orders
         ORDER BY id DESC`,
                []
            );
            res.json(rows);
        } catch (e) {
            console.error("Admin orders error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.put("/orders/:id/status", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const { order_status } = req.body;
            if (!order_status) return res.status(400).json({ error: "Status required" });

            await run(
                `UPDATE orders SET order_status=?, updated_at=datetime('now') WHERE id=?`,
                [order_status, id]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e.message || e) });
        }
    });

    router.put("/orders/:id/payment-status", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const { payment_status } = req.body;
            const allowed = ['PENDING', 'PROFORMA_SENT', 'PAYMENT_RECEIVED', 'CONFIRMED', 'FAILED'];
            if (!payment_status || !allowed.includes(payment_status)) {
                return res.status(400).json({ error: "Invalid payment_status. Allowed: " + allowed.join(', ') });
            }
            await run(
                `UPDATE orders SET payment_status=?, updated_at=datetime('now') WHERE id=?`,
                [payment_status, id]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e.message || e) });
        }
    });

    router.get("/payments", requireAdmin, async (req, res) => {
        try {
            const rows = await all(
                `SELECT 
           p.id, 
           p.order_id AS orderid, 
           p.status, 
           p.amount, 
           p.rating, 
           p.receipt_path AS receiptpath, 
           p.feedback,
           p.customername,
           p.email,
           p.phone,
           p.created_at AS createdat,
           o.productname, 
           o.totalprice, 
           o.payment_status
         FROM payments p
         LEFT JOIN orders o ON o.id = p.order_id
         ORDER BY p.id DESC`,
                []
            );
            res.json(rows);
        } catch (e) {
            console.error("Admin payments error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/orders/:id", requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        try {
            const pays = await all(`SELECT receipt_path FROM payments WHERE order_id = ?`, [id]);
            pays.forEach((p) => deleteReceiptFile(p.receipt_path));
            await run("DELETE FROM payments WHERE order_id = ?", [id]);
            await run("DELETE FROM order_items WHERE order_id = ?", [id]);
            await run("DELETE FROM orders WHERE id = ?", [id]);
            // Reset auto-increment sequences when tables are empty
            const remaining = await get(`SELECT COUNT(*) AS c FROM orders`);
            if ((remaining?.c || 0) === 0) {
                await run(`DELETE FROM sqlite_sequence WHERE name IN ('orders','order_items','payments','email_otp_sessions')`);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // Delete ALL orders and reset sequences
    router.delete("/orders", requireAdmin, async (req, res) => {
        try {
            const allPays = await all(`SELECT receipt_path FROM payments`);
            allPays.forEach((p) => deleteReceiptFile(p.receipt_path));
            await run("DELETE FROM payments");
            await run("DELETE FROM order_items");
            await run("DELETE FROM orders");
            await run("DELETE FROM email_otp_sessions");
            await run(`DELETE FROM sqlite_sequence WHERE name IN ('orders','order_items','payments','email_otp_sessions')`);
            res.json({ ok: true, message: "All orders deleted and ID sequences reset." });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/payments/:id", requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        try {
            const pay = await get(`SELECT receipt_path FROM payments WHERE id = ?`, [id]);
            if (pay?.receipt_path) deleteReceiptFile(pay.receipt_path);
            await run("DELETE FROM payments WHERE id = ?", [id]);
            const remaining = await get(`SELECT COUNT(*) AS c FROM payments`);
            if ((remaining?.c || 0) === 0) {
                await run(`DELETE FROM sqlite_sequence WHERE name='payments'`);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // RESTful version
    router.post("/payments/:id/success", requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        try {
            const pay = await get(`SELECT order_id FROM payments WHERE id = ?`, [id]);
            if (!pay) return res.status(404).json({ error: "Payment not found" });

            await run(`UPDATE payments SET status = 'SUCCESS' WHERE id = ?`, [id]);
            await run(
                `UPDATE orders SET payment_status = 'SUCCESS', updated_at=datetime('now') WHERE id = ?`,
                [pay.order_id]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.post("/payments/:id/failed", requireAdmin, async (req, res) => {
        const id = Number(req.params.id);
        try {
            const pay = await get(`SELECT order_id FROM payments WHERE id = ?`, [id]);
            if (!pay) return res.status(404).json({ error: "Payment not found" });

            await run(`UPDATE payments SET status = 'FAILED' WHERE id = ?`, [id]);
            await run(
                `UPDATE orders SET payment_status = 'FAILED', updated_at=datetime('now') WHERE id = ?`,
                [pay.order_id]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // Legacy compatibility for POST /api/admin/payment-status
    router.post("/payment-status", requireAdmin, async (req, res) => {
        try {
            const paymentId = Number(req.body?.paymentId);
            const status = (req.body?.status || "").toUpperCase();
            if (!paymentId || !status) return res.status(400).json({ error: "paymentId and status required" });

            const pay = await get(`SELECT order_id FROM payments WHERE id = ?`, [paymentId]);
            if (!pay) return res.status(404).json({ error: "Payment not found" });

            await run(`UPDATE payments SET status = ? WHERE id = ?`, [status, paymentId]);
            await run(
                `UPDATE orders SET payment_status = ?, updated_at=datetime('now') WHERE id = ?`,
                [status, pay.order_id]
            );
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // ---------------- Sample Requests ----------------
    router.get("/sample-requests", requireAdmin, async (req, res) => {
        try {
            const rows = await all(`SELECT * FROM sample_requests ORDER BY created_at DESC`);
            res.json(rows);
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/sample-requests/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id) return res.status(400).json({ error: "Invalid ID" });
            await run(`DELETE FROM sample_requests WHERE id = ?`, [id]);
            const remaining = await get(`SELECT COUNT(*) AS c FROM sample_requests`);
            if ((remaining?.c || 0) === 0) {
                await run(`DELETE FROM sqlite_sequence WHERE name='sample_requests'`);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // ---------------- Contact Messages ----------------
    router.get("/contact-messages", requireAdmin, async (req, res) => {
        try {
            const rows = await all(`SELECT * FROM contact_messages ORDER BY created_at DESC`);
            res.json(rows);
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.patch("/contact-messages/:id/read", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id) return res.status(400).json({ error: "Invalid ID" });
            await run(`UPDATE contact_messages SET status='read' WHERE id=?`, [id]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/contact-messages/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id) return res.status(400).json({ error: "Invalid ID" });
            await run(`DELETE FROM contact_messages WHERE id=?`, [id]);
            const remaining = await get(`SELECT COUNT(*) AS c FROM contact_messages`);
            if ((remaining?.c || 0) === 0) {
                await run(`DELETE FROM sqlite_sequence WHERE name='contact_messages'`);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    // ---------------- Customers ----------------

    router.get("/customers", requireAdmin, async (req, res) => {
        try {
            const customers = await all(`
                SELECT
                    cu.id,
                    cu.email,
                    cu.name,
                    cu.phone,
                    cu.company_name,
                    cu.city,
                    cu.region,
                    cu.country,
                    cu.is_verified,
                    cu.created_at,
                    cu.last_login_at,
                    COUNT(o.id) AS order_count,
                    SUM(CASE WHEN o.payment_status IN ('SUCCESS','PAID','CONFIRMED','PAYMENT_RECEIVED') THEN o.totalprice ELSE 0 END) AS total_spent
                FROM customer_users cu
                LEFT JOIN orders o ON LOWER(o.email) = LOWER(cu.email)
                GROUP BY cu.id
                ORDER BY cu.created_at DESC
            `);
            res.json(customers);
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.delete("/customers/:id", requireAdmin, async (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!id) return res.status(400).json({ error: "Invalid ID" });
            await run(`DELETE FROM customer_users WHERE id=?`, [id]);
            const remaining = await get(`SELECT COUNT(*) AS c FROM customer_users`);
            if ((remaining?.c || 0) === 0) {
                await run(`DELETE FROM sqlite_sequence WHERE name='customer_users'`);
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.post("/logout", (req, res) => res.json({ ok: true }));
    router.get("/me", requireAdmin, (req, res) => res.json({ loggedIn: true, email: req.adminUser?.email }));

    // ---------------- Analytics ----------------
    router.get("/analytics/views", requireAdmin, async (req, res) => {
        try {
            const days30 = await all(`
                SELECT date(created_at) AS day, COUNT(*) AS views
                FROM page_views
                WHERE created_at >= datetime('now', '-30 days')
                GROUP BY date(created_at)
                ORDER BY day ASC
            `);
            const months12 = await all(`
                SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS views
                FROM page_views
                WHERE created_at >= datetime('now', '-365 days')
                GROUP BY strftime('%Y-%m', created_at)
                ORDER BY month ASC
            `);
            const total30 = days30.reduce((s, r) => s + r.views, 0);
            const total365 = months12.reduce((s, r) => s + r.views, 0);
            res.json({ days30, months12, total30, total365 });
        } catch (e) {
            res.status(500).json({ error: 'DB error' });
        }
    });

    router.get("/analytics/geo", requireAdmin, async (req, res) => {
        try {
            const byCountry = await all(`
                SELECT country, country_code, COUNT(*) AS views
                FROM page_views
                WHERE country != '' AND country NOT IN ('Local', '')
                GROUP BY country
                ORDER BY views DESC
                LIMIT 50
            `);
            res.json({ byCountry });
        } catch (e) {
            res.status(500).json({ error: 'DB error' });
        }
    });

    return router;
};
