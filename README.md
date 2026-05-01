# ChemSus Technologies — Web Application

A full-stack web application for **ChemSus Technologies Pvt Ltd**, featuring a **product showcase**, **e-commerce shop**, **order & payment flow with email OTP verification**, **customer accounts**, a **secure admin dashboard**, and **built-in page-view analytics with geographic visitor tracking**.

---

## Live Site

| | URL |
|---|---|
| **Customer site** | [https://chemsus.in](https://chemsus.in) · [https://www.chemsus.in](https://www.chemsus.in) |
| **Admin login** | [https://chemsus.in/admin/login.html](https://chemsus.in/admin/login.html) |
| **Admin dashboard** | [https://chemsus.in/admin/admin.html](https://chemsus.in/admin/admin.html) |

> Hosted on Ubuntu 24.04 · Nginx reverse proxy · PM2 process manager · SSL via Let's Encrypt

---

## Project Overview

* Public website for **products, shop, and company info**
* **Customer accounts** — sign up with email + password, OTP email verification
* **Order placement** — Buy Now and Cart flows with OTP-verified checkout; each order gets a unique quotation reference in the format `CST-YYYY-YY-NNNN` (Indian FY-based, auto-incrementing)
* **Dual payment path** — after confirming an order, the customer chooses *Get Quotation* (PDF emailed, bank transfer) or *Direct Payment* (UPI QR scan on `payment.html`); receipt upload triggers a branded confirmation email with a `PAY-000001`-style Payment ID
* **Full SEO** — meta descriptions, keywords, canonical URLs, Open Graph, Twitter Cards, JSON-LD structured data on all public pages; `noindex/nofollow` on all private/account pages; `robots.txt` + `sitemap.xml`
* **Admin dashboard** — Full control for the designated admin:
  * Products page management (CRUD)
  * Shop items CRUD
  * Pack pricing management (with competitor pricing fields)
  * Orders management — listing, filtering, and deletion
  * Payments and receipt verification (mark SUCCESS/FAILED)
  * Sample requests and contact messages management
  * Customer accounts view
  * Site settings (brochure upload, admin credentials)
  * Change admin email/password from the dashboard
  * **Analytics** — page views over last 30 days and 12 months with charts, plus visitor breakdown by country (geographic data via ip-api.com)
  * **Dynamic sidebar badges** — live counts on Orders (pending), Payments (pending), Samples, Contact (unread), Collab Notify, Customers
* **Session-based auth** — admin and customer sessions are cleared automatically when the browser tab/window is closed (no manual logout required for security)

Built with **Node.js + Express + SQLite** — lightweight, fast, and easy to deploy.

---

## Features

### 🔐 Customer Accounts

* Register with email + password (OTP email verification)
* Log in via password or email OTP
* **Forgot Password** — OTP-based password reset flow at `/forgot-password.html`
* Profile management — name, phone, company, delivery address (with branded profile hero page)
* Order history with payment status tracking
* Guest checkout also supported (no account required)

### 📧 Email OTP (Checkout & Verification)

* OTP sent to customer email before order is placed
* OTP expires after 10 minutes (configurable)
* Rate-limited to prevent abuse
* Verified token stored in DB, used exactly once

### 🛍️ Public Website

| Page | Description |
|---|---|
| `/index.html` | Home page |
| `/about.html` | About ChemSus Technologies |
| `/products.html` | Product catalogue |
| `/shop.html` | Shop with pricing and Buy Now / Add to Cart |
| `/cart.html` | Shopping cart |
| `/buy.html` | Buy Now / Cart checkout |
| `/buynow.html` | Direct buy flow |
| `/orders.html` | Order placement form (with email OTP verification) → payment choice modal |
| `/payment.html` | Direct UPI payment — QR scan, order summary, drag-and-drop receipt upload |
| `/payment2.html` | Legacy UPI payment page |
| `/success.html` | Order success confirmation |
| `/login.html` | Customer login (password or OTP) |
| `/signup.html` | Customer registration with email verification |
| `/profile.html` | Customer profile & delivery address |
| `/my-orders.html` | Customer order history with View Quotation and Download PDF per order |
| `/forgot-password.html` | OTP-based customer password reset |
| `/collaboration.html` | Collaboration info |
| `/recognitions.html` | Awards & recognitions |
| `/investors.html` | Investor information |
| `/contact.html` | Contact details |
| `/request-sample.html` | Sample request form (with email OTP) |
| `/quotation.html` | Order Placed page — download/view quotation PDF (ref format: `CST-YYYY-YY-NNNN`) |
| `/thankyou.html` | Thank you / confirmation page |
| `/bulk-order.html` | Bulk order request form |
| `/distributorship.html` | Distributorship / channel partner information and application form |

### 🛠️ Admin Dashboard (`/admin/admin.html`)

* **Separate login page** at `/admin/login.html` — email + password (no Supabase)
* **JWT-protected** — locally signed token, 8-hour session; stored in `sessionStorage` (auto-clears on browser close)
* Products page CRUD
* Shop items CRUD
* Pack pricing CRUD (per product) — includes competitor pricing (USD/INR)
* Orders — listing, filtering by payment status, deletion
* Payments — view receipts, mark SUCCESS/FAILED, delete
* Sample requests — view and delete submitted sample requests
* Contact messages — view and manage customer messages
* Customers — view registered customer accounts
* File uploads — images and PDFs
* Brochure URL management
* **Analytics** — sidebar section showing daily/monthly page view charts (Chart.js) and a country breakdown table with flag emojis and share bars
* **Change admin email/password** without restarting server
* Callback requests — view, update status (new / called / done), delete
* Distributor applications — view, update status (new / reviewing / contacted / approved / rejected), delete
* Bulk orders — view, update status (new / contacted / quoted / done), delete
* Fully mobile-responsive with collapsible sidebar

---

## Tech Stack

### Frontend
* HTML5, CSS3 (custom, responsive, mobile-first breakpoints), Vanilla JavaScript
* Google Fonts (Montserrat, Open Sans)
* No external frameworks — lightweight and fast

### Backend
* Node.js + Express.js
* SQLite3 (auto-migrated on startup)
* Multer (file uploads)
* Nodemailer (transactional emails via Gmail SMTP — OTP, order confirmation, quotation PDF, payment receipt confirmation)

### Authentication
* **Admin**: Local JWT (HMAC-SHA256), credentials in `.env` + DB override, 8-hour TTL, stored in `sessionStorage`
* **Customers**: Email + password (scrypt hashed), OTP email verification on signup, 7-day JWT sessions stored in `sessionStorage` (auto-logout on browser close)

---

## Project Structure

```
ChemSus/
├── backend/
│   ├── routes/
│   │   ├── admin.js          # Admin CRUD + login + credentials
│   │   ├── auth.js           # OTP send/verify endpoints
│   │   ├── customer-auth.js  # Customer signup, login, profile, order history
│   │   ├── orders.js         # Order placement + receipt upload
│   │   └── public.js         # Public read-only endpoints
│   ├── server.js             # Express server entry point
│   └── db.js                 # SQLite schema, migrations, seeding
├── public/
│   ├── admin/
│   │   ├── admin.html        # Admin dashboard (JWT-protected)
│   │   └── login.html        # Admin login page
│   ├── assets/
│   │   ├── js/
│   │   │   └── checkout-gate.js   # Cart & checkout flow logic
│   │   ├── uploads/          # Admin-uploaded product images
│   │   └── receipts/         # Customer payment receipts
│   ├── products/             # Individual product detail pages (8 products)
│   ├── index.html            # Home page
│   ├── login.html            # Customer login
│   ├── signup.html           # Customer registration
│   ├── profile.html          # Customer profile management
│   ├── my-orders.html        # Customer order history
│   └── (other public pages)
├── db/
│   └── chemsus.sqlite        # SQLite database (auto-created)
├── .env                      # Environment variables (see below)
├── nginx-chemsus.conf        # Nginx reverse proxy config
├── DEPLOYMENT.md             # Production deployment guide
├── PAYMENT.md                # Razorpay integration guide
└── package.json
```

---

## Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD` | Admin login password |
| `LOCAL_AUTH_JWT_SECRET` | Secret for signing admin + customer JWTs |
| `OTP_HASH_SECRET` | Secret for HMAC-hashing OTP codes |
| `OTP_SMTP_HOST` | SMTP server (default: smtp.gmail.com) |
| `OTP_SMTP_PORT` | SMTP port (default: 587) |
| `OTP_SMTP_USER` | SMTP username / from address |
| `OTP_SMTP_PASS` | SMTP password / app password |
| `OTP_EMAIL_FROM` | Display name for OTP emails |
| `OTP_TTL_MIN` | OTP expiry in minutes (default: 10) |
| `OTP_RESEND_SEC` | Cooldown between OTP sends (default: 60) |
| `OTP_MAX_ATTEMPTS` | Max OTP verify attempts (default: 5) |
| `OTP_TOKEN_TTL_MIN` | Verification token lifetime after OTP success (default: 30) |
| `DB_PATH` | SQLite file path (default: db/chemsus.sqlite) |
| `PORT` | Server port (default: 5656) |

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `products_page` | Product catalogue cards |
| `shop_items` | Shop items with pricing |
| `pack_pricing` | Pack sizes and tiered pricing |
| `orders` | Customer orders (with `order_status` and `payment_status`) |
| `order_items` | Order line items |
| `payments` | Payment records and receipts |
| `customer_users` | Registered customer accounts (email + scrypt hash) |
| `auth_users` | Admin credentials (email + scrypt hash) |
| `site_settings` | Brochure URL, admin credentials override |
| `email_otp_sessions` | Email OTP sessions (checkout + signup verification) |
| `sample_requests` | Sample request form submissions |
| `contact_messages` | Contact form submissions |
| `collab_notify` | Emails registered for collaboration portal launch notification |
| `page_views` | Page view analytics — path, IP, country, city, timestamp |
| `callback_requests` | Callback request submissions from the callback widget |
| `bulk_orders` | Bulk order enquiries submitted via `/bulk-order.html` |
| `distributor_applications` | Distributorship / channel partner application form submissions |

Database auto-migrates on startup — new columns and indexes are added automatically.

---

## API Endpoints

### Admin APIs (require Bearer JWT token)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/admin/login/send-otp` | Step 1 — Send OTP to admin email |
| POST | `/api/admin/login/verify-otp` | Step 2 — Verify OTP code |
| POST | `/api/admin/login` | Step 3 — Complete login with password, receive JWT |
| POST | `/api/admin/change-credentials` | Update admin email/password |
| GET | `/api/admin/me` | Check admin session |
| GET | `/api/admin/products-page` | List products |
| POST | `/api/admin/products-page` | Create product |
| PUT | `/api/admin/products-page/:id` | Update product |
| DELETE | `/api/admin/products-page/:id` | Delete product |
| GET | `/api/admin/shop-items` | List shop items |
| POST | `/api/admin/shop-items` | Create shop item |
| PUT | `/api/admin/shop-items/:id` | Update shop item |
| DELETE | `/api/admin/shop-items/:id` | Delete shop item |
| GET | `/api/admin/pack-pricing/:shopItemId` | List pack prices |
| POST | `/api/admin/pack-pricing/:shopItemId` | Create pack |
| PUT | `/api/admin/pack-pricing/:id` | Update pack |
| DELETE | `/api/admin/pack-pricing/:id` | Delete pack |
| GET | `/api/admin/orders` | List all orders |
| PUT | `/api/admin/orders/:id/status` | Update order delivery status |
| PUT | `/api/admin/orders/:id/payment-status` | Update order payment status |
| DELETE | `/api/admin/orders/:id` | Delete order |
| DELETE | `/api/admin/orders` | Bulk delete orders |
| GET | `/api/admin/payments` | List payments |
| DELETE | `/api/admin/payments/:id` | Delete payment |
| POST | `/api/admin/payments/:id/success` | Mark payment SUCCESS |
| POST | `/api/admin/payments/:id/failed` | Mark payment FAILED |
| GET | `/api/admin/sample-requests` | List sample requests |
| DELETE | `/api/admin/sample-requests/:id` | Delete sample request |
| GET | `/api/admin/contact-messages` | List contact messages |
| PATCH | `/api/admin/contact-messages/:id/read` | Mark message as read |
| DELETE | `/api/admin/contact-messages/:id` | Delete contact message |
| GET | `/api/admin/customers` | List customer accounts |
| DELETE | `/api/admin/customers/:id` | Delete customer account |
| GET | `/api/admin/collab-notify` | List collaboration notify registrations |
| DELETE | `/api/admin/collab-notify/:id` | Delete collab notify entry |
| GET | `/api/admin/callback-requests` | List callback requests |
| PATCH | `/api/admin/callback-requests/:id/status` | Update callback status |
| DELETE | `/api/admin/callback-requests/:id` | Delete callback request |
| GET | `/api/admin/bulk-orders` | List bulk order enquiries |
| PATCH | `/api/admin/bulk-orders/:id/status` | Update bulk order status |
| DELETE | `/api/admin/bulk-orders/:id` | Delete bulk order enquiry |
| GET | `/api/admin/distributor-applications` | List distributor applications |
| PATCH | `/api/admin/distributor-applications/:id/status` | Update distributor application status |
| DELETE | `/api/admin/distributor-applications/:id` | Delete distributor application |
| POST | `/api/admin/upload` | Upload site assets |
| POST | `/api/admin/brochure` | Save brochure URL |
| GET | `/api/admin/analytics/views` | Page view counts (30 days + 12 months) |
| GET | `/api/admin/analytics/geo` | Visitor breakdown by country |

### Customer Auth APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/customer/signup` | Register + send OTP verification |
| POST | `/api/customer/verify-email` | Verify OTP, create session |
| POST | `/api/customer/login` | Login with password |
| POST | `/api/customer/send-login-otp` | Login with OTP (send) |
| POST | `/api/customer/login-otp` | Login with OTP (verify) |
| GET | `/api/customer/profile` | Get profile (requires auth) |
| PUT | `/api/customer/profile` | Update profile (requires auth) |
| GET | `/api/customer/orders` | Get order history (requires auth) |
| POST | `/api/customer/logout` | Logout (clears session server-side) |
| POST | `/api/customer/forgot-password` | Send password reset OTP |
| POST | `/api/customer/reset-password` | Reset password with OTP token |

### Public APIs

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/otp/email/send` | Send order verification OTP |
| POST | `/api/otp/email/verify` | Verify order OTP |
| POST | `/api/orders` | Place an order |
| POST | `/api/payments` | Upload UPI payment receipt + send confirmation email |
| GET | `/api/brochure` | Get brochure URL |
| GET | `/api/shop-items` | List active shop items |
| GET | `/api/pack-pricing-all` | Bulk load pack prices |
| GET | `/api/pack-pricing/:shopItemId` | Get specific pack pricing |
| GET | `/api/products-page` | List active products |
| POST | `/api/sample-request` | Submit sample request |
| POST | `/api/contact` | Submit contact form |
| POST | `/api/collab-notify` | Register email for collaboration portal notification |
| POST | `/api/callback` | Submit callback request |
| POST | `/api/bulk-order` | Submit bulk order enquiry |
| POST | `/api/distributor-application` | Submit distributorship application |

---

## How to Run

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your values
```

### 3. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

### 4. Open in browser

```
http://localhost:5656
```

Admin panel: `http://localhost:5656/admin/login.html`

> For production deployment steps (PM2, Nginx, SSL, Cloudflare), see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Security

* Admin access controlled by **local JWT + HMAC-SHA256 signature**, 8-hour TTL
* **Sessions stored in `sessionStorage`** — both admin and customer sessions are automatically cleared when the browser tab/window is closed
* Customer sessions use **JWT with 7-day TTL**, scrypt-hashed passwords
* Passwords stored as `scrypt` hash with random salt (never plain-text in DB)
* OTP codes hashed with HMAC-SHA256 before DB storage
* File uploads type-validated (MIME + extension check), 10 MB limit
* Security headers on all responses (X-Frame-Options, CSP, X-Content-Type-Options, X-XSS-Protection)
* Rate limiting on login and OTP endpoints
* SQL injection prevented via parameterized queries throughout

---

## License

© 2026 **ChemSus Technologies Pvt Ltd**. All rights reserved.
