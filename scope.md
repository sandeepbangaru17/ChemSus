# Project Scope  
ChemSus Order Management System

## 1. Purpose of the Project
The purpose of this project is to provide ChemSus with a reliable and secure
online order system that ensures genuine customer orders through email OTP verification
and verified online payments.

This system is intended to replace manual order handling and reduce fake inquiries.

---

## 2. In-Scope Features

### 2.1 Customer Features
- Product ordering through website (Buy Now and Cart flows)
- Secure checkout with email OTP verification (guest flow — no account required)
- Optional customer accounts: sign up with email + password, log in via password or email OTP
- **Forgot Password** — OTP-based password reset flow (`/forgot-password.html`)
- Profile management: update name, phone, company, delivery address
- Order history: view past orders, track status, resume 48-hour payment window
- UPI payment with receipt upload (receipt ownership verified via auth token)
- Order confirmation page after submission
- Sample request form with email OTP verification

### 2.2 Admin Features
- Separate admin login at `/admin/login.html` (3-step: OTP verification + password)
- Full CRUD for Products, Shop Items, and Pack Pricing
- Orders management — view, filter, update delivery status, delete
- Payments management — view receipts, approve/reject, delete
- Sample requests management — view and delete
- Contact messages management — view and delete
- Customer accounts view
- File uploads for images and PDFs
- Brochure URL management
- Change admin email and password from Settings panel
- **Analytics dashboard** — page views over 30 days / 12 months with charts, and visitor breakdown by country
- Callback requests management — view, update status (new / called / done), delete
- Bulk order enquiries management — view, update status (new / contacted / quoted / done), delete
- Distributor applications management — view, update status (new / reviewing / contacted / approved / rejected), delete

### 2.3 System Capabilities
- Email OTP generation and validation (expiry, rate limiting, one-time use)
- JWT-based admin session (locally signed, 8-hour TTL, stored in `sessionStorage`)
- Customer sessions stored in `sessionStorage` — auto-cleared on browser/tab close
- Page-view analytics tracked server-side; geographic lookup via `ip-api.com`
- Payment receipt upload and review
- Order status tracking by admin (Processing → Confirmed → Shipped → Delivered → Cancelled)
- **Automated email notifications** to customer when admin updates order delivery status
- SQLite database with auto-migration on startup

### 2.4 Platform Support
- Desktop browsers
- Mobile browsers
- Responsive web design (all pages)

---

## 3. Out of Scope (Current Phase)
The following features are **not included in the current scope**:

- Refund management
- Subscription-based orders
- Multi-currency payments
- International shipping
- Inventory management
- Refund management (still out of scope)
- Multi-currency payments

---

## 4. Constraints
- OTP delivery depends on SMTP provider reliability (Zoho Mail or Gmail App Password).
- Payment is manual UPI — no automated gateway integration.
- Admin is a single user defined by `ADMIN_EMAIL` in `.env`.
- Deployment limited to India-based payments in the initial phase.

---

## 5. Assumptions
- Customers are familiar with OTP-based verification.
- Customers have access to UPI payment methods.
- ChemSus will manage SMTP credentials for OTP emails.
- Website traffic is moderate in the initial phase.
- Admin manages all order fulfilment manually via the dashboard.
