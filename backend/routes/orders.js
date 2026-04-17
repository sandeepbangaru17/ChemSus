const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all,
        normalizeEmail, isValidEmail, isValidPhone, safeNumber,
        purgeOtpSessions, requireUser, clampInt,
        sendTransactionalEmail, crypto, verifyCustomerToken
    } = deps;

    async function generatePurchaseId() {
        const now = new Date();
        const month = now.getMonth() + 1; // 1-12
        const year = now.getFullYear();

        // Indian financial year: April 1 – March 31
        const fyStart = month >= 4 ? year : year - 1;
        const fyEnd = fyStart + 1;
        const fyLabel = `${fyStart}-${String(fyEnd).slice(-2)}`; // e.g. "2026-27"

        const fyStartStr = `${fyStart}-04-01 00:00:00`;
        const fyEndStr   = `${fyEnd}-04-01 00:00:00`;

        const row = await get(
            `SELECT COUNT(*) AS cnt FROM orders WHERE created_at >= ? AND created_at < ?`,
            [fyStartStr, fyEndStr]
        );
        const seq    = (row?.cnt || 0) + 1;
        const seqStr = String(seq).padStart(4, '0');

        return `CST-${fyLabel}-${seqStr}`;
    }

    function buildOrderConfirmationEmail(customerName, purchaseId, productname, quantity, totalprice, country) {
        const isIndia = String(country || '').toLowerCase().includes('india') || !country;
        const shippingNote = isIndia
            ? 'Shipping charges are included in the above price.'
            : 'For international delivery, additional shipping charges will be intimated separately.';
        const amountFormatted = Number(totalprice || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

        const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f3f7fb;padding:24px;border-radius:12px;">
  <div style="background:#fff;border-radius:10px;padding:32px;">
    <img src="https://chemsus.in/assets/logo.jpg" alt="ChemSus" style="height:44px;margin-bottom:20px;" onerror="this.style.display='none'">
    <h2 style="color:#0074c7;margin:0 0 8px;">Order Received – Quotation Ready</h2>
    <p style="color:#475569;margin:0 0 24px;">Dear ${customerName}, thank you for placing your order with ChemSus Technologies. Your quotation has been generated.</p>

    <div style="background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#059669;font-weight:600;">Quotation ID</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#064e3b;letter-spacing:1px;">${purchaseId}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">Please save this Quotation ID for all future correspondence regarding this order.</p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-size:13px;color:#64748b;width:40%;">Product</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;">${productname}</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;">Quantity</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;">${quantity}</td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 12px;font-size:13px;color:#64748b;">Quoted Amount (incl. 18% GST)</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0074c7;">&#8377;${amountFormatted}</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;font-size:13px;color:#64748b;">Shipping</td>
        <td style="padding:10px 12px;font-size:13px;">${shippingNote}</td>
      </tr>
    </table>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0;font-size:14px;font-weight:600;color:#1d4ed8;">Next Steps</p>
      <ol style="margin:10px 0 0;padding-left:18px;font-size:13px;color:#1e40af;line-height:1.8;">
        <li>Download your <strong>Quotation PDF</strong> from the order confirmation page on our website.</li>
        <li>Attach the Quotation PDF along with your <strong>Purchase Order</strong>.</li>
        <li>Email both documents to <a href="mailto:sales@chemsus.in" style="color:#0074c7;">sales@chemsus.in</a></li>
        <li>Our team will review and send you a <strong>Proforma Invoice</strong> with bank payment details.</li>
        <li>Complete the bank transfer and send the payment receipt to sales@chemsus.in.</li>
      </ol>
    </div>

    <div style="font-size:13px;color:#475569;">
      <p style="margin:0 0 6px;font-weight:600;">Need help?</p>
      <p style="margin:0;">&#128231; <a href="mailto:sales@chemsus.in" style="color:#0074c7;">sales@chemsus.in</a></p>
      <p style="margin:4px 0 0;">&#128222; <a href="tel:+918486877575" style="color:#0074c7;">+91 84868 77575</a></p>
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;">&copy; 2025 ChemSus Technologies Pvt Ltd. All rights reserved.</p>
</div>`;

        const text = `Dear ${customerName},\n\nThank you for your order with ChemSus Technologies! Your quotation has been generated.\n\nQuotation ID: ${purchaseId}\n\nProduct: ${productname}\nQuantity: ${quantity}\nQuoted Amount (incl. 18% GST): Rs.${amountFormatted}\n${shippingNote}\n\nNEXT STEPS:\n1. Download your Quotation PDF from the order confirmation page.\n2. Attach the Quotation PDF along with your Purchase Order.\n3. Email both to sales@chemsus.in\n4. Our team will send you a Proforma Invoice with bank payment details.\n5. Complete the bank transfer and send the receipt to sales@chemsus.in.\n\nNeed help? Contact sales@chemsus.in or +91 84868 77575\n\nThank you,\nChemSus Technologies Pvt Ltd`;

        return { html, text };
    }


    router.post("/orders", async (req, res) => {
        try {
            await purgeOtpSessions();
            const b = req.body || {};

            const customername = (b.customername || "").trim();
            const email = (b.email || "").trim();
            const emailNorm = normalizeEmail(email);
            const phone = (b.phone || "").trim();
            const emailOtpToken = String(b.emailOtpToken || "").trim();
            const customerToken = String(b.customerToken || "").trim();
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

            let customerId = null;
            let otpSession = null;

            // Auth path 1: logged-in customer JWT
            if (customerToken) {
                const payload = verifyCustomerToken(customerToken);
                if (!payload || normalizeEmail(payload.email) !== emailNorm) {
                    return res.status(401).json({ error: "Customer token does not match email" });
                }
                customerId = Number(payload.sub);
            } else {
                // Auth path 2: email OTP verification
                if (!emailOtpToken) {
                    return res.status(400).json({ error: "Email verification required" });
                }
                otpSession = await get(
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

            // Apply 18% GST to get the final payable amount
            const GST_RATE = 0.18;
            const subtotal = totalprice;
            totalprice = Math.round(subtotal * (1 + GST_RATE) * 100) / 100;
            const unitprice = totalQty > 0 ? totalprice / totalQty : 0;
            const purchaseId = await generatePurchaseId();
            const r = await run(
                `INSERT INTO orders
          (customername,email,phone,companyName,address,city,region,pincode,country,
           productname,quantity,unitprice,totalprice,payment_status,paymentmode,purchase_id,user_id,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING','PENDING',?,?,datetime('now'))`,
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
                    purchaseId,
                    customerId ? String(customerId) : null,
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

            // Mark OTP session used (only for OTP auth path)
            if (otpSession) {
                await run(
                    `UPDATE email_otp_sessions
                     SET used_at=datetime('now'), order_id=?, updated_at=datetime('now')
                     WHERE id=? AND used_at IS NULL`,
                    [r.lastID, otpSession.id]
                );
            }

            // Update customer profile with latest delivery details
            if (customerId) {
                run(
                    `UPDATE customer_users SET
                       name=COALESCE(NULLIF(?,''),(SELECT name FROM customer_users WHERE id=?)),
                       phone=COALESCE(NULLIF(?,''),(SELECT phone FROM customer_users WHERE id=?)),
                       company_name=COALESCE(NULLIF(?,''),(SELECT company_name FROM customer_users WHERE id=?)),
                       address=COALESCE(NULLIF(?,''),(SELECT address FROM customer_users WHERE id=?)),
                       city=COALESCE(NULLIF(?,''),(SELECT city FROM customer_users WHERE id=?)),
                       region=COALESCE(NULLIF(?,''),(SELECT region FROM customer_users WHERE id=?)),
                       pincode=COALESCE(NULLIF(?,''),(SELECT pincode FROM customer_users WHERE id=?)),
                       country=COALESCE(NULLIF(?,''),(SELECT country FROM customer_users WHERE id=?)),
                       updated_at=datetime('now')
                     WHERE id=?`,
                    [
                        customername, customerId,
                        phone, customerId,
                        companyName, customerId,
                        address, customerId,
                        city, customerId,
                        region, customerId,
                        pincode, customerId,
                        country, customerId,
                        customerId
                    ]
                ).catch(() => { });
            }

            // Send quotation confirmation email (fire-and-forget)
            const { html: confHtml, text: confText } = buildOrderConfirmationEmail(
                customername, purchaseId, productname,
                totalQty || 1, totalprice, country
            );
            sendTransactionalEmail(
                email,
                `Quotation Ready – Ref: ${purchaseId} | ChemSus Technologies`,
                confHtml,
                confText
            ).catch(e => console.warn('[ORDER-EMAIL] Confirmation send failed:', e?.message));

            res.json({ orderId: r.lastID, purchaseId });
        } catch (e) {
            console.error("Order creation error:", e);
            res.status(500).json({ error: "DB error", details: String(e) });
        }
    });

    return router;
};
