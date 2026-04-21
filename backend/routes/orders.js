const express = require('express');

module.exports = function (deps) {
    const router = express.Router();
    const {
        run, get, all,
        normalizeEmail, isValidEmail, isValidPhone, safeNumber,
        purgeOtpSessions, requireUser, clampInt,
        sendTransactionalEmail, crypto, verifyCustomerToken,
        receiptUpload, fs
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
        <li>You will receive your <strong>Quotation PDF</strong> as an attachment in a follow-up email shortly. Download it, attach with your <strong>Purchase Order (PO)</strong> and email both to <a href="mailto:sales@chemsus.in" style="color:#0074c7;">sales@chemsus.in</a> — Ref No. <strong>${purchaseId}</strong></li>
        <li>Our team will review and send you a <strong>Proforma Invoice</strong> with bank account details.</li>
        <li>Complete 100% advance payment via bank transfer and send the receipt to sales@chemsus.in.</li>
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

        const text = `Dear ${customerName},\n\nThank you for your order with ChemSus Technologies! Your quotation has been generated.\n\nQuotation ID: ${purchaseId}\n\nProduct: ${productname}\nQuantity: ${quantity}\nQuoted Amount (incl. 18% GST): Rs.${amountFormatted}\n${shippingNote}\n\nNEXT STEPS:\n1. You will receive your Quotation PDF as an attachment in a follow-up email shortly. Download it, attach with your Purchase Order (PO) and email both to sales@chemsus.in — Ref No. ${purchaseId}\n2. Our team will send you a Proforma Invoice with bank account details.\n3. Complete 100% advance payment via bank transfer and send the receipt to sales@chemsus.in.\n\nNeed help? Contact sales@chemsus.in or +91 84868 77575\n\nThank you,\nChemSus Technologies Pvt Ltd`;

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

    router.post('/orders/:id/send-quotation-pdf', async (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            if (!orderId || isNaN(orderId)) return res.status(400).json({ error: 'Invalid order id' });

            const { pdfBase64, email } = req.body || {};
            if (!pdfBase64 || !email) return res.status(400).json({ error: 'Missing pdfBase64 or email' });

            const order = await get('SELECT id, email, purchase_id FROM orders WHERE id=?', [orderId]);
            if (!order) return res.status(404).json({ error: 'Order not found' });

            if (normalizeEmail(order.email) !== normalizeEmail(email)) {
                return res.status(403).json({ error: 'Email mismatch' });
            }

            const pdfBuffer = Buffer.from(pdfBase64, 'base64');

            await sendTransactionalEmail(
                order.email,
                `Quotation PDF – ${order.purchase_id} | ChemSus Technologies`,
                `<p>Dear Customer,</p><p>Please find your Quotation PDF attached for order <strong>${order.purchase_id}</strong>.</p><p>Thank you,<br>ChemSus Technologies Pvt Ltd</p>`,
                `Dear Customer,\n\nPlease find your Quotation PDF attached for order ${order.purchase_id}.\n\nThank you,\nChemSus Technologies Pvt Ltd`,
                [{
                    filename: `Quotation_${order.purchase_id}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            );

            res.json({ ok: true });
        } catch (e) {
            console.error('[QUOTATION-PDF-EMAIL] Error:', e);
            res.status(500).json({ error: 'Failed to send email', details: String(e) });
        }
    });

    // Customer submits direct payment with receipt upload
    router.post('/payments', receiptUpload.single('receipt'), async (req, res) => {
        try {
            const orderId = parseInt(req.body?.orderId, 10);
            const paymentRef = (req.body?.paymentRef || '').trim();
            const customername = (req.body?.customername || '').trim();
            const email = (req.body?.email || '').trim();
            const phone = (req.body?.phone || '').trim();

            if (!orderId || isNaN(orderId)) {
                if (req.file) fs.unlink(req.file.path, () => {});
                return res.status(400).json({ error: 'Invalid order ID' });
            }
            if (!paymentRef) {
                if (req.file) fs.unlink(req.file.path, () => {});
                return res.status(400).json({ error: 'Payment reference is required' });
            }

            const order = await get('SELECT id, totalprice, email, customername, phone FROM orders WHERE id=?', [orderId]);
            if (!order) {
                if (req.file) fs.unlink(req.file.path, () => {});
                return res.status(404).json({ error: 'Order not found' });
            }

            const receiptFilename = req.file ? req.file.filename : '';

            const r = await run(
                `INSERT INTO payments (order_id, provider, payment_ref, amount, currency, status, receipt_path, customername, email, phone, updated_at)
                 VALUES (?, 'UPI', ?, ?, 'INR', 'PENDING', ?, ?, ?, ?, datetime('now'))`,
                [orderId, paymentRef, order.totalprice, receiptFilename,
                 customername || order.customername, email || order.email, phone || order.phone]
            );

            await run(
                `UPDATE orders SET payment_status='PAYMENT_RECEIVED', paymentmode='UPI', updated_at=datetime('now') WHERE id=?`,
                [orderId]
            );

            const paymentId = `PAY-${String(r.lastID).padStart(6, '0')}`;

            // Send confirmation email to customer (fire-and-forget)
            const toEmail = email || order.email;
            const toName = customername || order.customername || 'Customer';
            if (toEmail) {
                const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f7fb;font-family:'Open Sans',Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#041424 0%,#062a4a 100%);padding:32px 36px 28px;text-align:center;border-bottom:3px solid #00b8b0;">
      <img src="https://chemsus.in/assets/logo.jpg" alt="ChemSus" style="height:48px;width:48px;border-radius:10px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">
      <h1 style="font-family:Montserrat,sans-serif;font-size:22px;font-weight:700;color:#fff;margin:0 0 4px;">Payment Receipt Received</h1>
      <p style="color:rgba(255,255,255,.7);font-size:13px;margin:0;">ChemSus Technologies Pvt Ltd</p>
    </div>
    <!-- Body -->
    <div style="padding:32px 36px;">
      <p style="font-size:15px;color:#1f2933;margin:0 0 20px;">Dear <strong>${toName}</strong>,</p>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
        Thank you for your payment! We have received your payment receipt and it is currently under review by our team. Your order will be confirmed within <strong>1 business day</strong>.
      </p>
      <!-- Payment ID box -->
      <div style="background:linear-gradient(135deg,#0074c7,#00b8b0);border-radius:12px;padding:20px 24px;margin:0 0 24px;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,.85);text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px;">Your Payment Reference ID</div>
        <div style="font-family:Montserrat,sans-serif;font-size:28px;font-weight:700;color:#fff;letter-spacing:3px;">${paymentId}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:6px;">Please save this ID for your records</div>
      </div>
      <!-- Order details -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px 14px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #f1f5f9;">Order ID</td>
          <td style="padding:10px 14px;font-size:13px;color:#1f2933;font-weight:700;border-bottom:1px solid #f1f5f9;">#${orderId}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #f1f5f9;">Amount Paid</td>
          <td style="padding:10px 14px;font-size:13px;color:#1f2933;font-weight:700;border-bottom:1px solid #f1f5f9;">₹${Number(order.totalprice || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px 14px;font-size:13px;color:#64748b;font-weight:600;">Status</td>
          <td style="padding:10px 14px;"><span style="background:#fef9c3;color:#854d0e;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">Under Review</span></td>
        </tr>
      </table>
      <!-- Next steps -->
      <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 10px 10px 0;padding:16px 18px;margin-bottom:24px;">
        <h4 style="font-family:Montserrat,sans-serif;font-size:13px;color:#16a34a;margin:0 0 10px;">What happens next?</h4>
        <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.9;">
          <li>Our team will verify your payment receipt</li>
          <li>You will receive an order confirmation email once verified</li>
          <li>Your order will be dispatched after payment confirmation</li>
        </ul>
      </div>
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0;">
        If you have any questions, please contact us at
        <a href="mailto:chemsustech@gmail.com" style="color:#0074c7;font-weight:600;">chemsustech@gmail.com</a>
      </p>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;">
      <p style="font-size:12px;color:#94a3b8;margin:0;">© ${new Date().getFullYear()} ChemSus Technologies Pvt Ltd · <a href="https://chemsus.in" style="color:#0074c7;">chemsus.in</a></p>
    </div>
  </div>
</body>
</html>`;
                sendTransactionalEmail(
                    toEmail,
                    `Payment Received – ${paymentId} | ChemSus Technologies`,
                    emailHtml,
                    `Dear ${toName},\n\nThank you for your payment. Your Payment ID is ${paymentId}.\n\nWe will verify your receipt within 1 business day and confirm your order.\n\nChemSus Technologies Pvt Ltd`
                ).catch(err => console.error('[PAYMENT-EMAIL] Failed to send:', err.message));
            }

            res.json({ paymentId, paymentDbId: r.lastID, paymentRef });
        } catch (e) {
            console.error('[PAYMENT] Error:', e);
            if (req.file) fs.unlink(req.file.path, () => {});
            res.status(500).json({ error: 'Payment submission failed', details: String(e) });
        }
    });

    return router;
};
