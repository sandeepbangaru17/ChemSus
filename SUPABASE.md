# Supabase Integration Plan
ChemSus Order Management System

This document covers the step-by-step process to migrate ChemSus from its current
SQLite + local JWT stack to Supabase (PostgreSQL + Auth + Storage).

---

## What Changes and What Stays the Same

| Layer | Current | After Migration |
|---|---|---|
| Database | SQLite (`db/chemsus.sqlite`) | Supabase PostgreSQL |
| Customer auth | Custom scrypt + HMAC-JWT | Supabase Auth |
| Admin auth | Local JWT (`iss: chemsus-admin`) | Stays the same (no change) |
| OTP (guest checkout) | Custom HMAC + nodemailer | Stays the same (no change) |
| File storage (receipts) | Local `public/assets/receipts/` | Supabase Storage bucket |
| File storage (product images) | Local `public/assets/` | Supabase Storage bucket |
| Backend | Node/Express on PM2 | Stays the same (no change) |
| Frontend | Vanilla JS | Stays the same (no change) |

> **Admin login and guest OTP checkout are NOT migrated.** They work reliably without Supabase
> and have no benefit from the migration. Only customer accounts and file storage move.

---

## Phase 1 — Supabase Project Setup

### 1.1 Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Choose your organisation, set a project name (`chemsus-prod`), pick the **Singapore** region
   (closest to India), and set a strong database password. Save it — you will need it.
4. Wait for provisioning (~2 min).

### 1.2 Collect credentials

From **Project Settings → API**, copy:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project URL (e.g. `https://xxxxxxxxxxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | `anon` / `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (keep secret — server-side only) |

From **Project Settings → Database**, copy the **Connection string (URI)** for direct Postgres access.

Add these to `.env`:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Phase 2 — Database Migration (SQLite → PostgreSQL)

### 2.1 Create the schema in Supabase

Open the **SQL Editor** in Supabase and run the following script.
This is a direct translation of `backend/db.js` from SQLite to PostgreSQL.

```sql
-- Enable UUID generation
create extension if not exists "pgcrypto";

-- Products shown on /products.html
create table if not exists products_page (
  id          serial primary key,
  name        text not null,
  description text not null default '',
  image       text not null default '',
  link        text not null default '',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Shop items shown on /shop.html
create table if not exists shop_items (
  id            serial primary key,
  name          text not null,
  subtitle      text not null default '',
  features_json text not null default '[]',
  price         numeric(12,2) not null default 0,
  stock_status  text not null default 'in-stock',
  show_badge    boolean not null default false,
  badge         text not null default '',
  more_link     text not null default '',
  image         text not null default '',
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Pack sizes and pricing per shop item
create table if not exists pack_pricing (
  id           serial primary key,
  shop_item_id integer not null references shop_items(id) on delete cascade,
  pack_size    text not null,
  biofm_usd   numeric(12,2) not null default 0,
  biofm_inr   numeric(12,2) not null default 0,
  our_price   numeric(12,2) not null default 0,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(shop_item_id, pack_size)
);
create index if not exists idx_pack_pricing_item on pack_pricing(shop_item_id);

-- Key-value site settings (e.g. brochure_url)
create table if not exists site_settings (
  key   text primary key,
  value text not null default ''
);
insert into site_settings(key, value) values ('brochure_url', 'assets/brochure.pdf')
  on conflict(key) do nothing;

-- Customer orders
create table if not exists orders (
  id             serial primary key,
  customername   text not null default '',
  email          text not null default '',
  phone          text not null default '',
  company_name   text default '',
  address        text not null default '',
  city           text not null default '',
  region         text not null default '',
  pincode        text not null default '',
  country        text not null default 'India',
  productname    text not null default '',
  quantity       numeric(12,4) not null default 1,
  unitprice      numeric(12,2) not null default 0,
  totalprice     numeric(12,2) not null default 0,
  payment_status text not null default 'PENDING',
  paymentmode    text not null default 'PENDING',
  order_status   text not null default 'Processing',
  purchase_id    text unique,
  notes          text default '',
  user_id        uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_orders_status      on orders(payment_status);
create index if not exists idx_orders_created     on orders(created_at);
create index if not exists idx_orders_user        on orders(user_id);
create index if not exists idx_orders_purchase_id on orders(purchase_id);
create index if not exists idx_orders_order_status on orders(order_status);

-- Line items per order (cart orders)
create table if not exists order_items (
  id           serial primary key,
  order_id     integer not null references orders(id) on delete cascade,
  shop_item_id integer not null references shop_items(id) on delete restrict,
  product_name text not null default '',
  pack_size    text not null default '',
  unit_price   numeric(12,2) not null default 0,
  quantity     numeric(12,4) not null default 1,
  total_price  numeric(12,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_order_items_order on order_items(order_id);

-- Payment receipts submitted by customers
create table if not exists payments (
  id           serial primary key,
  order_id     integer not null references orders(id) on delete cascade,
  provider     text not null default 'UPI',
  payment_ref  text not null default '',
  amount       numeric(12,2) not null default 0,
  currency     text not null default 'INR',
  status       text not null default 'PENDING',
  receipt_path text not null default '',
  rating       integer not null default 0,
  feedback     text not null default '',
  customername text not null default '',
  email        text not null default '',
  phone        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_payments_order  on payments(order_id);
create index if not exists idx_payments_status on payments(status);

-- Guest OTP sessions (email verification at checkout and sample requests)
-- NOTE: these are short-lived and do NOT need to be migrated from SQLite.
create table if not exists email_otp_sessions (
  id                 serial primary key,
  challenge_id       text not null unique,
  email              text not null,
  otp_hash           text not null,
  attempts           integer not null default 0,
  max_attempts       integer not null default 5,
  expires_at         timestamptz not null,
  cooldown_until     timestamptz not null,
  verified_at        timestamptz default null,
  verification_token text default null,
  token_expires_at   timestamptz default null,
  used_at            timestamptz default null,
  order_id           integer default null references orders(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_email_otp_email     on email_otp_sessions(email);
create index if not exists idx_email_otp_challenge on email_otp_sessions(challenge_id);
create index if not exists idx_email_otp_token     on email_otp_sessions(verification_token);

-- Sample requests from /request-sample.html
create table if not exists sample_requests (
  id               serial primary key,
  company_name     text not null,
  individual_name  text not null,
  email            text not null,
  phone            text not null,
  designation      text not null,
  website          text not null,
  intended_use     text not null,
  quantity         text not null,
  timeline         text not null,
  order_frequency  text not null,
  created_at       timestamptz not null default now()
);

-- Contact form messages from /contact.html
create table if not exists contact_messages (
  id         serial primary key,
  name       text not null,
  email      text not null,
  subject    text not null default '',
  message    text not null,
  status     text not null default 'unread',
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_messages_status on contact_messages(status);

-- Admin credentials (local — not Supabase Auth)
create table if not exists auth_users (
  id            serial primary key,
  email         text not null unique,
  password_salt text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz default null
);
create index if not exists idx_auth_users_email on auth_users(email);
```

> **Note:** The `customer_users` table is NOT created here because customer accounts will be
> handled by **Supabase Auth** (see Phase 3). Customer profile data (name, phone, address, etc.)
> will be stored in a separate `customer_profiles` table linked to `auth.users`.

### 2.2 Create the customer_profiles table

```sql
-- Replaces the SQLite customer_users table.
-- Identity (email, password, session) is managed by Supabase Auth.
-- Profile data (name, address, etc.) is stored here.
create table if not exists customer_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '',
  phone        text not null default '',
  company_name text not null default '',
  address      text not null default '',
  city         text not null default '',
  region       text not null default '',
  pincode      text not null default '',
  country      text not null default 'India',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

### 2.3 Migrate existing data from SQLite

If there is existing production data in the SQLite database, export and import it:

1. Export SQLite to CSV using a tool like [DB Browser for SQLite](https://sqlitebrowser.org/)
   or the `sqlite3` CLI:
   ```bash
   sqlite3 db/chemsus.sqlite ".mode csv" ".headers on" ".output orders.csv" "SELECT * FROM orders;" ".quit"
   ```
2. Import the CSV into Supabase via **Table Editor → Import CSV** or via `psql`:
   ```bash
   psql "postgresql://..." -c "\copy orders FROM 'orders.csv' CSV HEADER"
   ```
3. Repeat for: `products_page`, `shop_items`, `pack_pricing`, `payments`, `order_items`,
   `sample_requests`, `contact_messages`, `site_settings`.
4. Do NOT migrate `email_otp_sessions` — they are ephemeral and expire quickly.
5. Do NOT migrate `customer_users` — see Phase 3 for the customer account migration path.

---

## Phase 3 — Customer Auth Migration (custom JWT → Supabase Auth)

### 3.1 Enable Email Auth in Supabase

1. Go to **Authentication → Providers → Email**.
2. Enable **Email** provider.
3. Set **Confirm email** to ON (users must verify email before logging in).
4. Optionally, configure a custom SMTP sender under **Authentication → SMTP Settings**
   so verification emails come from `sales@chemsus.in` instead of Supabase's domain.

### 3.2 Migrate existing customer accounts

For each row in the SQLite `customer_users` table:

1. Use the Supabase **Admin API** to create a user with their email (passwords cannot be
   migrated — they will need to reset via "Forgot Password"):
   ```bash
   curl -X POST 'https://xxxxxxxxxxxx.supabase.co/auth/v1/admin/users' \
     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email": "customer@example.com", "email_confirm": true, "user_metadata": {"name": "Customer Name"}}'
   ```
2. After creating each user, insert a row into `customer_profiles` with the UUID returned
   from the API and the customer's saved profile fields.
3. Send a password-reset email to all migrated customers via
   **Authentication → Users → Send password reset**.

> For a small number of users, this can be done manually via the Supabase dashboard.

### 3.3 Backend changes for customer auth

Replace `backend/routes/customer-auth.js` with Supabase Auth calls.

**Install the Supabase JS client:**
```bash
npm install @supabase/supabase-js
```

**Add to `server.js` or a new `supabase.js` helper:**
```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role for server-side admin operations
);
```

**Key endpoint changes:**

| Old endpoint | New implementation |
|---|---|
| `POST /api/customer/signup` | `supabase.auth.admin.createUser({ email, password, email_confirm: false })` |
| `POST /api/customer/login` | `supabase.auth.signInWithPassword({ email, password })` — returns Supabase JWT |
| `POST /api/customer/send-login-otp` | `supabase.auth.signInWithOtp({ email })` |
| `POST /api/customer/login-otp` | `supabase.auth.verifyOtp({ email, token, type: 'email' })` |
| `GET /api/customer/profile` | Query `customer_profiles` table by user UUID from JWT |
| `PATCH /api/customer/profile` | Update `customer_profiles` row |
| `GET /api/customer/orders` | Query `orders` where `user_id = <uuid from JWT>` |

**Verify Supabase JWTs on the backend:**
```javascript
const { createClient } = require('@supabase/supabase-js');
// Use the anon key for JWT verification — the JWT secret is derived from it
async function verifySupabaseJwt(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;  // { id: uuid, email, ... }
}
```

**Update the `requireCustomer` middleware in `server.js`:**
```javascript
async function requireCustomer(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const user = await verifySupabaseJwt(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token.' });
  req.customerId = user.id;   // UUID now, not an integer
  req.customerEmail = user.email;
  next();
}
```

### 3.4 Frontend changes for customer auth

The customer-facing pages (`login.html`, `signup.html`, `profile.html`, `my-orders.html`)
currently call `/api/customer/*` endpoints. After migration, those endpoints proxy to Supabase,
so **the frontend fetch calls do not change** — only the backend implementation changes.

However, the token stored in `localStorage` will now be a **Supabase JWT** (longer, different
format) instead of the custom JWT. The localStorage keys remain the same:
- `chemsus_customer_token` — Supabase access token
- `chemsus_customer_token_exp` — expiry timestamp
- `chemsus_customer_name` — display name (unchanged)

---

## Phase 4 — File Storage Migration (local → Supabase Storage)

### 4.1 Create Storage buckets

In Supabase Dashboard → **Storage → New bucket**:

| Bucket name | Public | Purpose |
|---|---|---|
| `receipts` | No (private) | Customer payment receipts |
| `product-images` | Yes (public) | Product and shop item images |
| `site-assets` | Yes (public) | Brochure PDF, logos |

### 4.2 Set bucket policies

For the `receipts` bucket (private — admin access only):
```sql
-- Only service role (backend) can upload/read receipts
-- No public access
create policy "service role only"
  on storage.objects for all
  using (bucket_id = 'receipts')
  with check (bucket_id = 'receipts');
```

For `product-images` and `site-assets` (public read):
```sql
create policy "public read"
  on storage.objects for select
  using (bucket_id in ('product-images', 'site-assets'));
```

### 4.3 Backend changes for receipt upload

Replace `multer` local disk storage with Supabase Storage upload in
`backend/routes/orders.js` (`POST /api/receipts`):

```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// In POST /api/receipts — replace multer disk save with:
const fileBuffer = req.file.buffer;   // use multer memoryStorage instead of diskStorage
const fileName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

const { data, error } = await supabase.storage
  .from('receipts')
  .upload(fileName, fileBuffer, { contentType: req.file.mimetype, upsert: false });

if (error) throw new Error(`Storage upload failed: ${error.message}`);

const receipt_path = data.path;  // store this in the payments table
```

**Switch multer to memory storage** (no disk writes):
```javascript
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
```

**Serving receipts to admin** (generate a signed URL):
```javascript
// In GET /api/admin/payments/:id/receipt  (new endpoint needed)
const { data, error } = await supabase.storage
  .from('receipts')
  .createSignedUrl(payment.receipt_path, 60 * 60);  // 1 hour expiry
res.json({ url: data.signedUrl });
```

### 4.4 Migrate existing receipt files

Upload all files from `public/assets/receipts/` to the `receipts` Supabase Storage bucket:

```javascript
// One-time migration script — run locally
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const dir = path.join(__dirname, 'public/assets/receipts');

for (const file of fs.readdirSync(dir)) {
  const buffer = fs.readFileSync(path.join(dir, file));
  const { error } = await supabase.storage.from('receipts').upload(file, buffer, { upsert: true });
  if (error) console.error(`Failed: ${file}`, error.message);
  else console.log(`Uploaded: ${file}`);
}
```

After confirming all files are uploaded and the admin panel displays them correctly,
the local `public/assets/receipts/` directory can be emptied.

---

## Phase 5 — Row Level Security (RLS)

Enable RLS on all tables and define policies so that:
- Customers can only read/write their own data.
- The backend (using `service_role` key) bypasses RLS entirely.
- The public (using `anon` key) can read only public product/shop data.

```sql
-- Enable RLS on all tables
alter table products_page       enable row level security;
alter table shop_items          enable row level security;
alter table pack_pricing        enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table payments            enable row level security;
alter table customer_profiles   enable row level security;
alter table email_otp_sessions  enable row level security;
alter table sample_requests     enable row level security;
alter table contact_messages    enable row level security;
alter table site_settings       enable row level security;

-- Public can read active products and shop items
create policy "public read products" on products_page for select using (is_active = true);
create policy "public read shop"     on shop_items    for select using (is_active = true);
create policy "public read pricing"  on pack_pricing  for select using (is_active = true);

-- Customers can read/write their own profile
create policy "customer own profile"
  on customer_profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- Customers can read their own orders
create policy "customer own orders"
  on orders for select
  using (user_id = auth.uid());

-- All other tables: backend service_role only (no direct client access)
-- service_role bypasses RLS automatically — no policy needed for it.
```

> **Important:** Because the Node/Express backend uses `SUPABASE_SERVICE_ROLE_KEY`,
> it bypasses RLS for all operations. RLS only matters if you ever query Supabase
> directly from the browser using the `anon` key.

---

## Phase 6 — Environment and Deployment Updates

### 6.1 Update `.env`

```env
# Supabase
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# DB — remove or comment out after migration is complete
# DB_PATH=db/chemsus.sqlite
```

### 6.2 Update `.env.example`

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # never expose to browser
```

### 6.3 Install new dependencies

```bash
npm install @supabase/supabase-js pg
```

### 6.4 Remove SQLite dependency (after migration)

```bash
npm uninstall sqlite3
```

Remove or archive `backend/db.js` once Supabase is confirmed working.

---

## Phase 7 — Testing Checklist

Before going live, test each flow end-to-end:

**Admin flows**
- [ ] Admin login at `/admin/login.html` with `ADMIN_EMAIL` + `ADMIN_PASSWORD`
- [ ] Create / edit / delete a product, shop item, pack pricing row
- [ ] View, filter, and update order status
- [ ] View payment receipts (signed URL opens correctly)
- [ ] Mark payment as SUCCESS / FAILED
- [ ] Change admin credentials from Settings panel

**Guest checkout flow**
- [ ] Add item to cart → proceed to `/orders.html`
- [ ] Request OTP → receive email → enter OTP → verify
- [ ] Place order → `order_id` and `purchase_id` returned
- [ ] Navigate to `/payment2.html` → upload receipt (PNG or PDF)
- [ ] Receipt uploaded to Supabase Storage `receipts` bucket
- [ ] `payments` row created; `orders.payment_status` = `VERIFYING`
- [ ] Order confirmation email received

**Registered customer flows**
- [ ] Sign up at `/signup.html` → verification email received → click link
- [ ] Log in at `/login.html` via password tab
- [ ] Log in at `/login.html` via email OTP tab
- [ ] View orders at `/my-orders.html` — both guest and registered orders appear
- [ ] Resume payment from `/my-orders.html` for a pending order
- [ ] Update profile at `/profile.html`
- [ ] Log out

**Data integrity**
- [ ] Orders placed by a guest (no `user_id`) are returned in `my-orders.html` when
      the customer logs in with the same email
- [ ] `customer_profiles` row created automatically on first Supabase sign-up
      (use a database trigger or a `POST /api/customer/signup` server-side call)

---

## Phase 8 — Rollback Plan

If anything goes wrong after migration:

1. Set `DB_PATH=db/chemsus.sqlite` in `.env` and restart PM2 — the backend will revert
   to SQLite immediately.
2. Receipt files remain on local disk until manually cleaned up, so the admin panel
   will still serve them.
3. Keep the SQLite file and all local receipt files for at least 30 days after migration.
4. The custom customer-auth route (`backend/routes/customer-auth.js`) should be kept
   in source control (not deleted) until Supabase Auth is confirmed stable in production.

---

## Recommended Migration Order

1. Phase 1 — Set up the Supabase project and collect credentials.
2. Phase 2 — Create the schema. Test it works by manually inserting a row.
3. Phase 5 — Enable RLS before any real data enters the database.
4. Phase 6 — Update `.env` and install dependencies.
5. Phase 4 — Migrate file storage and test receipt upload/view.
6. Phase 2.3 — Migrate existing data from SQLite.
7. Phase 3 — Switch customer auth to Supabase Auth.
8. Phase 7 — Run the full test checklist.
9. Phase 4.4 — Clean up local receipt files.
10. Phase 6.4 — Remove SQLite dependency.
