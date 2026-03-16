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

    router.get("/test", (req, res) =>
        res.json({ ok: true, apiBase: "/api", backendURL: req.headers.host })
    );

    return router;
};
