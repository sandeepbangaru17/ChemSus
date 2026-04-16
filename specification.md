# Project Specification  
ChemSus Order Management System (Web)

## 1. Overview
This project is a web-based order and payment system for the ChemSus website.  
It allows customers to place product orders, verify their email using OTP,
complete UPI payment, and receive order confirmation.

The system is designed to prevent fake orders, ensure valid customer details,
and provide a smooth checkout experience — without requiring customers to create an account.

---

## 2. User Roles

- **Guest Customer**
  - Browses products and shop items
  - Adds to cart or buys directly
  - Verifies email using OTP at checkout (no account required)
  - Submits UPI payment receipt
  - Receives order confirmation email

- **Registered Customer**
  - Signs up with email + password at `/signup.html`
  - Logs in at `/login.html` (password or email OTP)
  - JWT stored in `localStorage` (`chemsus_customer_token`), 7-day TTL
  - Checkout pre-fills from saved profile; skips OTP step
  - Views full order history at `/my-orders.html`
  - Manages profile at `/profile.html`

- **Admin (director@chemsus.in)**
  - Logs in at `/admin/login.html` with email + password
  - Manages Products, Shop Items, and Pack Pricing
  - Views and manages all orders and payments
  - Updates order delivery status
  - Uploads brochure and product images
  - Changes admin credentials from Settings panel

---

## 3. Functional Requirements

### 3.1 Order Placement
- Customer selects products and quantity from shop or cart.
- Customer enters personal details:
  - Full Name
  - Phone Number
  - Email
  - Delivery Address
  - Company Name (optional)
- Order cannot be placed without valid email OTP verification.

### 3.2 Email OTP Verification
- OTP is generated on the server (6-digit numeric code).
- OTP is sent to the entered email via SMTP (Zoho Mail; configurable via `OTP_SMTP_*` env vars).
- OTP expires in 10 minutes (configurable via `OTP_TTL_MIN`).
- Maximum 5 attempts before OTP is invalidated.
- Resend allowed after 60 seconds cooldown.
- Verified OTP issues a short-lived verification token used exactly once.

### 3.3 Payment Processing
- Payment page is accessible only after order is placed.
- Payment method: UPI (manual bank transfer).
- Customer uploads a payment receipt screenshot/PDF.
- Receipt upload requires an ownership proof: customer JWT (registered) or OTP verification token (guest).
- Admin reviews and marks payment as SUCCESS or FAILED.

### 3.4 Order Confirmation & Quotation
- After order is placed, customer is redirected to `/quotation.html`.
- The quotation page is ChemSus-branded with full sidebar navigation.
- It shows an **"Order Placed!"** hero banner with:
  - Green success icon and reference number chip
  - **Download Quotation PDF** button (primary CTA)
  - **View Quotation** button (scrolls to the document)
  - **My Orders** and **Continue Shopping** secondary links
- The quotation document is rendered below the hero with all order details.
- Customer downloads the PDF, attaches a Purchase Order, and emails to `sales@chemsus.in`.
- Order confirmation email sent to customer when payment receipt is uploaded.
- Admin team contacts customer with shipping details.

### 3.5 Customer Accounts
- Sign up at `/signup.html` — email + password with OTP email verification.
- Log in at `/login.html` — password login tab or email OTP tab.
- JWT token (`iss: "chemsus-customer"`) issued on login; 7-day TTL.
- Profile page at `/profile.html` — edit name, phone, company, delivery address.
- Order history at `/my-orders.html` — lists all past orders with status and 48-hour payment recovery link.

### 3.6 Guest-to-Customer Upgrade
- Guest orders are matched to registered accounts by email.
- If a customer later signs up with the same email, `my-orders.html` shows all prior guest orders.

---

## 4. Admin Requirements

### 4.1 Admin Authentication
- Admin logs in at `/admin/login.html` with email + password.
- JWT token issued on successful login (8-hour session).
- Token stored in `localStorage`, sent as `Authorization: Bearer` header.
- Admin can change email/password from Settings panel (no server restart needed).

### 4.2 Product Management
- Admin can create, read, update, and delete products shown on `products.html`.
- Each product has: name, description, image, page link, active status, sort order.

### 4.3 Shop Item Management
- Admin can create, read, update, and delete shop items shown on `shop.html`.
- Each item has: name, subtitle, features, base price, stock status, badge, image.

### 4.4 Pack Pricing Management
- Admin can define pack sizes and prices per shop item.
- Prices are shown on shop.html and used to validate order amounts.

### 4.5 Orders Management
- Admin can view all orders with full customer details.
- Admin can filter by payment status and delivery status.
- Admin can update delivery status: Processing → Confirmed → Shipped → Delivered → Cancelled.
- Admin can delete orders (also deletes associated payments and receipts).

### 4.6 Payments Management
- Admin can view all payment submissions with receipts.
- Admin can mark payments as SUCCESS or FAILED.
- Marking payment SUCCESS updates the linked order's payment_status.
- Admin can delete payment records.

### 4.7 Contact Form Management
- Admin can view all contact form submissions from the Contact page.
- Messages stored in `contact_messages` table with timestamp.

### 4.8 Sample Request Management
- Admin can view all sample requests submitted via `/request-sample.html`.
- Sample requests require email OTP verification before submission.
- Stored in `sample_requests` table with full applicant details.

---

## 5. Non-Functional Requirements
- Mobile-responsive design on all pages
- Rate limiting on login, OTP, and sensitive endpoints
- Security headers on all responses (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
- File upload validation (MIME type + extension)
- Passwords hashed with scrypt before storage
- OTP codes hashed with HMAC-SHA256 before storage
- Receipt upload gated behind order ownership verification

---

## 6. Frontend Design Standards

### 6.1 Sidebar Navigation
- All main public pages use a fixed left sidebar (240px wide) with ChemSus brand blue (`#0074c7`).
- Sidebar has a mobile toggle button (hamburger) fixed at `top: 16px, left: 16px`.
- On mobile (≤ 1050px) the sidebar slides off-screen; toggle button shows to open it.
- Sidebar sections use `.nav-section-label` for grouping (Main / Shop / Company / Support / Account).

### 6.2 Product Pages (`/products/*.html`)
- Layout: sidebar + main-wrapper with hero banner, product card (2-col grid → 1-col on mobile), PubChem link.
- Hero section gets `padding-top: 72px` on mobile (≤ 1050px) to clear the fixed toggle button.
- Responsive breakpoints: 1050px (sidebar collapse), 900px (product card stacks), 480px (small font/padding tweaks).

### 6.3 Quotation Page (`/quotation.html`)
- Full ChemSus-branded page with sidebar navigation and footer.
- Top section: "Order Placed!" hero with success badge, ref number chip, and action buttons.
- Action buttons: Download Quotation PDF (primary), View Quotation (scroll), My Orders, Continue Shopping.
- Quotation document rendered below the hero; PDF generated client-side via jsPDF.
