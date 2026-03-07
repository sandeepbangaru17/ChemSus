const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all,
        normalizeEmail, isValidEmail, isValidPhone, safeNumber,
        purgeOtpSessions, requireUser, receiptUpload, clampInt
    } = deps;

    router.get("/user/orders", requireUser, async (req, res) => {
        try {
            const userId = req.supabaseUser.sub; // Supabase UID
            const rows = await all(
                `SELECT o.id, o.productname, o.quantity, o.unitprice, o.totalprice,
                o.paymentmode, o.payment_status, o.order_status,
                o.address, o.city, o.region, o.country, o.notes,
                o.created_at, o.updated_at
         FROM orders o
         JOIN email_otp_sessions e ON e.order_id = o.id
         WHERE e.supabase_uid = ? OR o.email = ?
         ORDER BY o.id DESC`,
                [userId, req.supabaseUser.email]
            );
            res.json(rows);
        } catch (e) {
            console.error("User orders error:", e);
            res.status(500).json({ error: "DB error" });
        }
    });

    router.post("/orders", async (req, res) => {
        try {
            await purgeOtpSessions();
            const b = req.body || {};

            const customername = (b.customername || "").trim();
            const email = (b.email || "").trim();
            const emailNorm = normalizeEmail(email);
            const phone = (b.phone || "").trim();
            const emailOtpToken = String(b.emailOtpToken || "").trim();
            const companyName = (b.companyName || "").trim();

            if (!customername || !email || !phone) {
                return res.status(400).json({ error: "Missing required fields" });
            }
            if (!isValidEmail(email)) {
                return res.status(400).json({ error: "Invalid email" });
            }
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: "Invalid phone" });
            }
            if (!emailOtpToken) {
                return res.status(400).json({ error: "Email OTP verification required" });
            }

            const otpSession = await get(
                `SELECT id
         FROM email_otp_sessions
         WHERE email=?
           AND verification_token=?
           AND verified_at IS NOT NULL
           AND used_at IS NULL
           AND datetime(token_expires_at) > datetime('now')
         LIMIT 1`,
                [emailNorm, emailOtpToken]
            );
            if (!otpSession) {
                return res.status(400).json({ error: "Invalid or expired email OTP verification" });
            }

            const address = (
                b.address ||
                b.fullAddress ||
                b.fulladdress ||
                b.deliveryAddress ||
                b.shippingAddress ||
                ""
            ).trim();

            const city = (b.city || "").trim();
            const region = (b.region || "").trim();
            const pincode = (b.pincode || "").trim();
            const country = (b.country || "India").trim();

            const itemsIn = Array.isArray(b.items) ? b.items : [];
            let items = [];
            let totalprice = 0;
            let totalQty = 0;
            let productname = (b.productname || "").trim();

            if (itemsIn.length > 0) {
                for (const it of itemsIn) {
                    const shopItemId = Number(it.shopItemId || it.shop_item_id || it.id || 0);
                    const packSize = String(it.packSize || it.pack || "").trim();
                    const quantity = safeNumber(it.quantity || 0, 0);
                    if (!shopItemId || quantity <= 0) {
                        return res.status(400).json({ error: "Invalid items" });
                    }
                    const shop = await get(
                        `SELECT id, name, price FROM shop_items WHERE id=? AND is_active=1`,
                        [shopItemId]
                    );
                    if (!shop) return res.status(400).json({ error: "Invalid item" });

                    let unitPrice = 0;
                    if (packSize) {
                        const pack = await get(
                            `SELECT our_price FROM pack_pricing WHERE shop_item_id=? AND pack_size=? AND is_active=1`,
                            [shopItemId, packSize]
                        );
                        if (!pack) return res.status(400).json({ error: "Invalid pack" });
                        unitPrice = safeNumber(pack.our_price, 0);
                    } else {
                        unitPrice = safeNumber(shop.price, 0);
                    }
                    if (unitPrice <= 0) {
                        return res.status(400).json({ error: "Invalid pricing" });
                    }
                    const lineTotal = unitPrice * quantity;
                    totalprice += lineTotal;
                    totalQty += quantity;
                    items.push({
                        shop_item_id: shopItemId,
                        product_name: shop.name || "",
                        pack_size: packSize,
                        unit_price: unitPrice,
                        quantity,
                        total_price: lineTotal,
                    });
                }

                if (items.length === 1) {
                    const one = items[0];
                    productname = `${one.product_name}${one.pack_size ? " (" + one.pack_size + ")" : ""}`;
                } else {
                    productname = `${items.length} item(s) from Cart`;
                }
            } else {
                if (!productname) {
                    return res.status(400).json({ error: "Missing productname" });
                }
                const quantity = safeNumber(b.quantity || 1, 1);
                const total = safeNumber(b.totalprice || 0, 0);
                if (quantity <= 0 || total <= 0) {
                    return res.status(400).json({ error: "Invalid quantity or price" });
                }
                totalprice = total;
                totalQty = quantity;

                const shopItemId = Number(b.shopItemId || 0);
                const packSize = String(b.packSize || b.pack || "").trim();
                if (shopItemId) {
                    const shop = await get(
                        `SELECT id, name, price FROM shop_items WHERE id=? AND is_active=1`,
                        [shopItemId]
                    );
                    if (shop) {
                        let unitPrice = 0;
                        if (packSize) {
                            const pack = await get(
                                `SELECT our_price FROM pack_pricing WHERE shop_item_id=? AND pack_size=? AND is_active=1`,
                                [shopItemId, packSize]
                            );
                            unitPrice = safeNumber(pack?.our_price || 0, 0);
                        } else {
                            unitPrice = safeNumber(shop.price, 0);
                        }
                        if (unitPrice > 0) {
                            totalprice = unitPrice * quantity;
                            items.push({
                                shop_item_id: shopItemId,
                                product_name: shop.name || "",
                                pack_size: packSize,
                                unit_price: unitPrice,
                                quantity,
                                total_price: totalprice,
                            });
                            productname = `${shop.name || productname}${packSize ? " (" + packSize + ")" : ""
                                }`;
                        }
                    }
                }
            }

            const unitprice = totalQty > 0 ? totalprice / totalQty : 0;
            const r = await run(
                `INSERT INTO orders
          (customername,email,phone,companyName,address,city,region,pincode,country,
           productname,quantity,unitprice,totalprice,payment_status,paymentmode,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING','PENDING',datetime('now'))`,
                [
                    customername,
                    email,
                    phone,
                    companyName,
                    address,
                    city,
                    region,
                    pincode,
                    country,
                    productname,
                    totalQty || 1,
                    unitprice,
                    totalprice,
                ]
            );

            if (items.length > 0) {
                for (const it of items) {
                    await run(
                        `INSERT INTO order_items
             (order_id, shop_item_id, product_name, pack_size, unit_price, quantity, total_price)
             VALUES (?,?,?,?,?,?,?)`,
                        [
                            r.lastID,
                            it.shop_item_id,
                            it.product_name,
                            it.pack_size,
                            it.unit_price,
                            it.quantity,
                            it.total_price,
                        ]
                    );
                }
            }

            await run(
                `UPDATE email_otp_sessions
         SET used_at=datetime('now'), order_id=?, updated_at=datetime('now')
         WHERE id=? AND used_at IS NULL`,
                [r.lastID, otpSession.id]
            );

            res.json({ orderId: r.lastID });
        } catch (e) {
            console.error("Order creation error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    router.post(
        "/receipts",
        receiptUpload.single("receiptimage"),
        async (req, res) => {
            try {
                const body = req.body || {};
                const orderId = Number(body.orderid);

                if (!orderId)
                    return res.status(400).json({ error: "orderid required" });
                if (!req.file)
                    return res.status(400).json({ error: "receiptimage required" });

                const amount = safeNumber(body.amount || 0, 0);
                const ratingRaw = Number(body.rating || 0);
                if (!ratingRaw) return res.status(400).json({ error: "rating required" });
                const rating = clampInt(ratingRaw, 1, 5);
                const feedback = (body.feedback || "").toString().slice(0, 2000);
                const receipt_path = `receipts/${req.file.filename}`;

                const order = await get(`SELECT * FROM orders WHERE id=?`, [orderId]);
                if (!order) return res.status(404).json({ error: "Order not found" });

                const existing = await get(
                    `SELECT id FROM payments WHERE order_id=? LIMIT 1`,
                    [orderId]
                );
                if (existing)
                    return res.status(409).json({ error: "Payment already submitted" });

                const expectedTotal = safeNumber(order.totalprice || 0, 0);
                if (Math.abs(expectedTotal - amount) > 0.01) {
                    return res.status(400).json({ error: "Amount mismatch" });
                }

                const payInsert = await run(
                    `INSERT INTO payments
          (order_id,provider,payment_ref,amount,currency,status,receipt_path,rating,feedback,customername,email,phone)
         VALUES (?, 'UPI', '', ?, 'INR', 'PENDING', ?, ?, ?, ?, ?, ?)`,
                    [
                        orderId,
                        amount,
                        receipt_path,
                        rating,
                        feedback,
                        body.customername || order.customername || "",
                        body.email || order.email || "",
                        body.phone || order.phone || "",
                    ]
                );

                await run(
                    `UPDATE orders SET payment_status='VERIFYING', updated_at=datetime('now') WHERE id=?`,
                    [orderId]
                );

                res.json({
                    ok: true,
                    paymentId: payInsert.lastID,
                    receipt_path: `assets/${receipt_path}`,
                });
            } catch (e) {
                console.error("Receipt upload error:", e);
                res.status(500).json({ error: "DB error", details: String(e) });
            }
        }
    );

    return router;
};
