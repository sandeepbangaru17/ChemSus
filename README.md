# ChemSus Technologies - Web Application

A full-stack web application for **ChemSus Technologies Pvt Ltd**, including a **product showcase**, **shop**, **order & payment flow**, and a **secure admin dashboard** to manage products, orders, payments, and receipts.

---

## Project Overview

This project provides:

* Public website for **products and shop**
* **Order placement** (Buy Now and Cart flow)
* **UPI payment receipt upload**
* **Admin dashboard** for full control:
  * Products page
  * Shop items
  * Pack pricing
  * Orders management
  * Payments and receipt verification
  * Site settings (brochure upload)

The system is lightweight, fast, and built with **Node.js + SQLite**, making it easy to deploy and maintain.

---

## Features

### Public Website

* Products listing (`products.html`)
* Shop with Buy Now and Add to Cart (`shop.html`)
* Order form (`orders.html`)
* Payment via UPI QR (`payment2.html`)
* Receipt upload + rating (`payment2.html`)
* Success page after payment (`success.html`)

### Admin Dashboard

* Secure admin login
* Products page CRUD
* Shop items CRUD
* Pack pricing CRUD
* Order listing with filters and delete
* Payments and receipts:
  * View uploaded receipts
  * Mark payments SUCCESS / FAILED
  * Delete payments
* Upload images and PDFs
* Manage brochure download link
* Fully mobile-responsive

---

## Tech Stack

### Frontend

* HTML5
* CSS3 (custom, responsive)
* Vanilla JavaScript
* Google Fonts (Montserrat, Open Sans)

### Backend

* Node.js
* Express.js
* SQLite3
* Multer (file uploads)

### Database

* SQLite (`chemsus.sqlite`)
* Auto-migrated (no manual DB setup)

---

## Project File Structure

```text
project_chem/
|-- backend/
|   |-- server.js            # Express server
|   |-- db.js                # SQLite schema and init
|-- public/
|   |-- admin/               # Admin dashboard UI
|   |-- assets/              # Images, uploads, receipts
|   |-- products/            # Individual product pages
|   |-- index.html
|   |-- products.html
|   |-- shop.html
|   |-- cart.html
|   |-- buy.html
|   |-- orders.html
|   |-- payment2.html
|   |-- success.html
|-- db/
|   |-- chemsus.sqlite        # SQLite database (do not delete)
|-- seed-data.sql
|-- seed.js
|-- package.json
|-- README.md
```

---

## Pages and Routes

### Public Pages

| Page             | Description           |
| ---------------- | --------------------- |
| `/index.html`    | Home                  |
| `/products.html` | Product listing       |
| `/shop.html`     | Shop page             |
| `/cart.html`     | Cart                  |
| `/buy.html`      | Buy Now / Cart review |
| `/orders.html`   | Order form            |
| `/payment2.html` | Payment page          |
| `/success.html`  | Order success         |

### Admin

| URL                 | Description     |
| ------------------- | --------------- |
| `/admin/admin.html` | Admin dashboard |

---

## Admin Login

**Default credentials:**

```text
Username: admin
Password: chemsus123
```

For production, set environment variables:

```text
ADMIN_USER=your_admin_user
ADMIN_PASS=your_admin_password
```

For email OTP verification on checkout, set SMTP and OTP variables:

```text
OTP_SMTP_HOST=smtp.your-provider.com
OTP_SMTP_PORT=587
OTP_SMTP_SECURE=false
OTP_SMTP_USER=your_smtp_user
OTP_SMTP_PASS=your_smtp_password
OTP_EMAIL_FROM=no-reply@yourdomain.com
OTP_HASH_SECRET=change_this_secret
OTP_TTL_MIN=10
OTP_RESEND_SEC=60
OTP_MAX_ATTEMPTS=5
OTP_TOKEN_TTL_MIN=30
```

---

## Database Tables

* `products_page` - Products page cards
* `shop_items` - Shop items
* `pack_pricing` - Pack sizes and pricing
* `orders` - Customer orders
* `order_items` - Order line items
* `payments` - Payment and receipt records
* `site_settings` - Brochure and site settings
* `email_otp_sessions` - Email OTP sessions for checkout verification

Database is persistent - `chemsus.sqlite` is never deleted automatically.

---

## API Overview

### Admin APIs

* `POST /api/admin/login`
* `POST /api/admin/logout`
* `GET /api/admin/products-page`
* `GET /api/admin/shop-items`
* `GET /api/admin/pack-pricing/:shopItemId`
* `GET /api/admin/orders`
* `GET /api/admin/payments`
* `DELETE /api/admin/orders/:id`
* `DELETE /api/admin/payments/:id`
* `POST /api/admin/payment-status`

### Public APIs

* `POST /api/otp/email/send`
* `POST /api/otp/email/verify`
* `POST /api/orders`
* `POST /api/receipts`
* `GET /api/site/brochure`
* `GET /api/shop-items`
* `GET /api/pack-pricing/:shopItemId`

---

## How to Run the Project

### 1) Install dependencies

```bash
npm install
```

### 2) Start the server

```bash
npm start
```

or (development):

```bash
npm run dev
```

### 3) Open in browser

```text
http://localhost:3000
```

---

## Security Notes

* Admin authentication uses HTTP-only cookies
* Admin requests use same-origin checks
* File uploads are type-validated
* Receipt deletion removes DB entry and file
* Static files are served only from `public/`

---

## Future Improvements (Optional)

* Role-based admin access
* Email notifications
* Payment gateway integration
* Pagination for orders and payments
* Cloud storage for receipts

---

## License

? 2025 **ChemSus Technologies Pvt Ltd**
All rights reserved.
