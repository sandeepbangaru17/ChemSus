# ChemSus — Payment Gateway Guide

> This document covers payment options suitable for ChemSus and step-by-step Razorpay setup when you're ready to integrate.

---

## Current Payment Flow

The current flow is **manual UPI**:

1. Customer places order → gets an Order ID
2. Customer scans the UPI QR code on `/payment2.html` and pays
3. Customer uploads a screenshot/PDF of the transaction
4. Admin reviews the receipt in the dashboard → marks payment **SUCCESS** or **FAILED**
5. Customer sees order confirmation on `/success.html`

---

## Recommended Payment Gateway — Razorpay

Razorpay is the best fit for ChemSus because:
- Supports **UPI, cards, net banking, wallets** in one checkout
- No monthly fee — pay only per transaction (~2% per payment)
- India-first, INR settlements directly to your bank account
- Free test mode — no real money during development

---

## Part 1 — Razorpay Dashboard Setup

### Step 1 — Create an account

1. Go to [https://razorpay.com](https://razorpay.com) → click **Sign Up**
2. Enter your name, email, and phone number
3. Verify email and phone via OTP

### Step 2 — Complete KYC (required for live payments)

1. Dashboard → **Account & Settings → KYC**
2. Fill in:
   - Business type: **Private Limited Company**
   - Business name: **ChemSus Technologies Pvt Ltd**
   - PAN, GSTIN, and bank account details
3. Upload documents:
   - Certificate of Incorporation
   - PAN card
   - Cancelled cheque (for bank account verification)
4. KYC approval takes **1–3 business days**

> Until KYC is approved you can only use **Test Mode** — no real money is charged. You can build and test everything in test mode.

### Step 3 — Get your API Keys

1. Dashboard → **Account & Settings → API Keys**
2. Click **Generate Test Key**
3. You will see:
   - **Key ID**: starts with `rzp_test_...`
   - **Key Secret**: shown **once only** — copy it immediately and store it safely

After KYC approval, repeat this to get **Live Keys** (`rzp_live_...`).

### Step 4 — Configure Webhook (for payment confirmation backup)

1. Dashboard → **Account & Settings → Webhooks**
2. Click **Add New Webhook**
3. Fill in:
   - **Webhook URL**: `https://19062002.xyz/api/razorpay/webhook`
   - **Secret**: generate a strong random string — e.g. run `openssl rand -hex 32` on the server
   - **Active Events**: tick `payment.captured` and `payment.failed`
4. Click **Save**

---

## Part 2 — How Razorpay Would Work in This Project

### Payment flow (once integrated)

```
Customer clicks "Pay Now"
    ↓
Frontend → POST /api/razorpay/create-order  (sends orderId)
    ↓
Backend creates a Razorpay order via Razorpay API
    ↓
Frontend opens Razorpay Checkout modal (customer pays via UPI / card / etc.)
    ↓
On success → Frontend → POST /api/razorpay/verify  (sends payment IDs + signature)
    ↓
Backend verifies HMAC-SHA256 signature → marks order PAID in DB
    ↓
Customer is redirected to success.html
    ↓
Razorpay also sends webhook → POST /api/razorpay/webhook  (backup confirmation)
```

### Backend routes to be created

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/razorpay/create-order` | Creates Razorpay order, returns order ID + key |
| POST | `/api/razorpay/verify` | Verifies HMAC signature, marks order PAID |
| POST | `/api/razorpay/webhook` | Receives Razorpay events as backup |

### Environment variables to add in `.env`

```env
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_string
```

---

## Part 3 — Test Cards (Test Mode)

Use these during development — no real money is charged:

| Type | Card Number | CVV | Expiry |
|------|-------------|-----|--------|
| Visa (success) | 4111 1111 1111 1111 | Any 3 digits | Any future date |
| Mastercard (success) | 5267 3181 8797 5449 | Any 3 digits | Any future date |
| Card (failure) | 4000 0000 0000 0002 | Any | Any future date |

**UPI test ID:** `success@razorpay`

---

## Part 4 — Going Live Checklist

- [ ] KYC approved in Razorpay dashboard
- [ ] Live API keys generated (`rzp_live_...`)
- [ ] `.env` updated with live keys on the server
- [ ] Webhook URL verified: `https://19062002.xyz/api/razorpay/webhook`
- [ ] `pm2 restart chemsus` after updating `.env`
- [ ] End-to-end test with a real payment
- [ ] Payment appears under **Transactions** in Razorpay dashboard
- [ ] Settlement lands in bank account within T+2 days

---

## Part 5 — Fees Reference

| Transaction type | Razorpay fee |
|-----------------|--------------|
| UPI | 0% (up to ₹1 lakh/month, then 1.99%) |
| Domestic cards | ~2% |
| Net banking | ~1.99% |
| Wallets | ~1.99% |

> Fees are subject to change — verify at [https://razorpay.com/pricing](https://razorpay.com/pricing)
