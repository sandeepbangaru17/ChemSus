const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all, requireAdmin,
        adminUpload, deleteReceiptFile
    } = deps;

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
         (shop_item_id, pack_size, our_price, is_active, sort_order)
         VALUES (?,?,?,?,?)`,
                [
                    shopItemId,
                    b.packSize || "",
                    Number(b.ourPrice || 0),
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
         (shop_item_id, pack_size, our_price, is_active, sort_order)
         VALUES (?,?,?,?,?)`,
                [
                    shopItemId,
                    b.packSize || "",
                    Number(b.ourPrice || 0),
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
         SET pack_size=?, our_price=?, is_active=?, sort_order=?, updated_at=datetime('now')
         WHERE id=?`,
                [
                    b.packSize || "",
                    Number(b.ourPrice || 0),
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
           id, payment_status AS paymentstatus, customername, email, phone,
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
            await run("DELETE FROM orders WHERE id = ?", [id]);
            res.json({ ok: true });
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

    // Legacy admin endpoints
    router.post("/login", (req, res) => res.json({ ok: false, message: "Use Supabase login" }));
    router.post("/logout", (req, res) => res.json({ ok: true }));
    router.get("/me", requireAdmin, (req, res) => res.json({ loggedIn: true, email: req.supabaseUser?.email }));

    return router;
};
