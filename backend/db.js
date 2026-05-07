const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const ROOT = path.join(__dirname, "..");
const DEFAULT_DB_PATH = path.join(ROOT, "db", "chemsus.sqlite");
const PRIMARY_DB_PATH = resolveDbPath(process.env.DB_PATH);
const FALLBACK_DB_PATH = resolveDbPath(
  process.env.DB_FALLBACK_PATH || path.join(os.tmpdir(), `chemsus_${crypto.createHash('md5').update(ROOT).digest('hex').slice(0, 8)}.sqlite`)
);

function resolveDbPath(rawPath) {
  const val = String(rawPath || "").trim();
  if (!val) return DEFAULT_DB_PATH;
  return path.isAbsolute(val) ? val : path.join(ROOT, val);
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isWritable(filePath) {
  try {
    ensureDirFor(filePath);
    const dir = path.dirname(filePath);
    const probeName = `.chemsus_write_probe_${process.pid}_${Date.now()}.tmp`;
    const probePath = path.join(dir, probeName);

    // Real write probe to avoid false positives from permission bits only.
    fs.writeFileSync(probePath, "ok");
    fs.unlinkSync(probePath);

    // Ensure DB file itself can be opened in read-write mode if it already exists.
    if (fs.existsSync(filePath)) {
      try {
        const fd = fs.openSync(filePath, "r+");
        fs.closeSync(fd);
      } catch (e) {
        console.warn(`[DB-PROBE] File exists but not writable: ${filePath} (${e.message})`);
        return false;
      }
    }

    return true;
  } catch (e) {
    console.warn(`[DB-PROBE] Path or directory not writable: ${filePath} (${e.message})`);
    return false;
  }
}

function pickDbPath() {
  const primary = PRIMARY_DB_PATH;
  const forceFallback = String(process.env.DB_FORCE_FALLBACK || "").toLowerCase() === "true";
  if (!forceFallback && isWritable(primary)) return primary;

  const fallback = FALLBACK_DB_PATH;
  ensureDirFor(fallback);

  // Seed fallback DB with existing data once when possible.
  if (fs.existsSync(primary) && !fs.existsSync(fallback)) {
    try {
      fs.copyFileSync(primary, fallback);
    } catch (e) {
      console.warn("[DB] Failed to seed fallback DB:", e.message || e);
    }
  }

  if (isWritable(fallback)) {
    console.warn(
      `[DB] Primary DB path is not writable: ${primary}. Using fallback: ${fallback}`
    );
    return fallback;
  }

  // Last resort: return primary so startup still surfaces a clear SQLite error.
  return primary;
}

function seedFallbackFromPrimary(primary, fallback) {
  if (primary === fallback) return;
  if (fs.existsSync(primary) && !fs.existsSync(fallback)) {
    try {
      fs.copyFileSync(primary, fallback);
      console.warn(`[DB] Seeded fallback DB from primary: ${fallback}`);
    } catch (e) {
      console.warn("[DB] Failed to seed fallback DB:", e.message || e);
    }
  }
}

let ACTIVE_DB_PATH = pickDbPath();
let activeDb = new sqlite3.Database(ACTIVE_DB_PATH);
console.log(`[DB] SQLite path: ${ACTIVE_DB_PATH}`);

function isReadonlyError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || err || "").toLowerCase();
  return (
    code === "SQLITE_READONLY" ||
    msg.includes("readonly") ||
    msg.includes("read-only") ||
    msg.includes("permission denied")
  );
}

function switchToFallbackIfReadonly(err) {
  if (!isReadonlyError(err)) return false;
  if (ACTIVE_DB_PATH === ":memory:") return false;

  const oldPath = ACTIVE_DB_PATH;
  const oldDb = activeDb;

  let nextPath = FALLBACK_DB_PATH;
  if (ACTIVE_DB_PATH === FALLBACK_DB_PATH || !isWritable(FALLBACK_DB_PATH)) {
    nextPath = ":memory:";
  } else {
    ensureDirFor(nextPath);
    seedFallbackFromPrimary(ACTIVE_DB_PATH, nextPath);
  }

  try {
    activeDb = new sqlite3.Database(nextPath);
    ACTIVE_DB_PATH = nextPath;
    console.warn(
      `[DB] SQLite became read-only at ${oldPath}. Switched to fallback: ${nextPath}`
    );
    oldDb.close(() => { });
    return true;
  } catch (e) {
    console.error(`[DB] Failed to switch to fallback ${nextPath}:`, e.message);
    return false;
  }
}

function invokeWithReadonlyRetry(methodName, args) {
  const userCb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
  if (!userCb) return activeDb[methodName](...args);

  const callArgs = args.slice(0, -1);
  const runAttempt = (allowRetry) =>
    activeDb[methodName](...callArgs, function (err, ...rest) {
      if (err && allowRetry && switchToFallbackIfReadonly(err)) {
        return runAttempt(false);
      }
      return userCb.call(this, err, ...rest);
    });

  return runAttempt(true);
}

const db = {
  run(...args) {
    return invokeWithReadonlyRetry("run", args);
  },
  get(...args) {
    return invokeWithReadonlyRetry("get", args);
  },
  all(...args) {
    return invokeWithReadonlyRetry("all", args);
  },
  exec(...args) {
    return invokeWithReadonlyRetry("exec", args);
  },
  close(...args) {
    return activeDb.close(...args);
  },
};

function exec(sql) {
  return new Promise((resolve, reject) => db.exec(sql, (e) => (e ? reject(e) : resolve())));
}
function get(sql, p = []) {
  return new Promise((resolve, reject) => db.get(sql, p, (e, r) => (e ? reject(e) : resolve(r))));
}
function run(sql, p = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, p, function (e) {
      if (e) reject(e);
      else resolve(this);
    })
  );
}

function all(sql, p = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, p, (e, rows) => (e ? reject(e) : resolve(rows)))
  );
}

async function seed() {
  const st = await get(`SELECT COUNT(*) AS c FROM site_settings`);
  if ((st?.c || 0) === 0) {
    await run(`INSERT INTO site_settings(key,value) VALUES ('brochure_url','assets/brochure.pdf')`);
    console.log("✅ Seeded brochure_url");
  }
  await run(`INSERT OR IGNORE INTO site_settings(key,value) VALUES ('brochure_enabled','0')`);
}

async function initDb() {
  await exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products_page (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      features_json TEXT NOT NULL DEFAULT '[]',
      price REAL NOT NULL DEFAULT 0,
      stockStatus TEXT NOT NULL DEFAULT 'in-stock',
      showBadge INTEGER NOT NULL DEFAULT 0,
      badge TEXT NOT NULL DEFAULT '',
      moreLink TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pack_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_item_id INTEGER NOT NULL,
      pack_size TEXT NOT NULL,
      biofm_usd REAL NOT NULL DEFAULT 0,
      biofm_inr REAL NOT NULL DEFAULT 0,
      our_price REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(shop_item_id) REFERENCES shop_items(id) ON DELETE CASCADE,
      UNIQUE(shop_item_id, pack_size)
    );

    CREATE INDEX IF NOT EXISTS idx_pack_pricing_item ON pack_pricing(shop_item_id);

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customername TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      companyName TEXT DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      pincode TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'India',
      productname TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 1,
      unitprice REAL NOT NULL DEFAULT 0,
      totalprice REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      paymentmode TEXT NOT NULL DEFAULT 'PENDING',
      notes TEXT DEFAULT '',
      user_id TEXT DEFAULT NULL,
      order_status TEXT NOT NULL DEFAULT 'Processing',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(payment_status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

    CREATE TABLE IF NOT EXISTS email_otp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      expires_at TEXT NOT NULL,
      cooldown_until TEXT NOT NULL,
      verified_at TEXT DEFAULT NULL,
      verification_token TEXT DEFAULT NULL,
      token_expires_at TEXT DEFAULT NULL,
      used_at TEXT DEFAULT NULL,
      order_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_otp_email ON email_otp_sessions(email);
    CREATE INDEX IF NOT EXISTS idx_email_otp_challenge ON email_otp_sessions(challenge_id);
    CREATE INDEX IF NOT EXISTS idx_email_otp_token ON email_otp_sessions(verification_token);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      shop_item_id INTEGER NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      pack_size TEXT NOT NULL DEFAULT '',
      unit_price REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      total_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(shop_item_id) REFERENCES shop_items(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'UPI',
      payment_ref TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'PENDING',
      receipt_path TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL DEFAULT 0,
      feedback TEXT NOT NULL DEFAULT '',
      customername TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
    CREATE TABLE IF NOT EXISTS sample_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      individual_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      designation TEXT NOT NULL,
      website TEXT NOT NULL,
      intended_use TEXT NOT NULL,
      quantity TEXT NOT NULL,
      timeline TEXT NOT NULL,
      order_frequency TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);

    CREATE TABLE IF NOT EXISTS customer_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      is_verified INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      pincode TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'India',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_users_email ON customer_users(email);

    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_path TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_country ON page_views(country);

    CREATE TABLE IF NOT EXISTS collab_notify (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_collab_notify_email ON collab_notify(email);

    CREATE TABLE IF NOT EXISTS distributor_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_type TEXT NOT NULL DEFAULT 'company',
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL,
      industry_background TEXT NOT NULL,
      years_experience TEXT NOT NULL,
      experience_description TEXT NOT NULL,
      interest_description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_distributor_applications_status ON distributor_applications(status);

    CREATE TABLE IF NOT EXISTS callback_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      page TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_callback_requests_status ON callback_requests(status);

    CREATE TABLE IF NOT EXISTS bulk_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity TEXT NOT NULL,
      timeline TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bulk_orders_status ON bulk_orders(status);

    CREATE TABLE IF NOT EXISTS blogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      product_link TEXT NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 0,
      published_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
    CREATE INDEX IF NOT EXISTS idx_blogs_published ON blogs(is_published);
  `);

  await seed();

  // Migrate existing DBs — add new columns if they don't exist yet
  const migrateCol = async (table, col, def) => {
    try { await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (_) { /* already exists */ }
  };
  await migrateCol("orders", "user_id", "TEXT DEFAULT NULL");
  await migrateCol("orders", "order_status", "TEXT NOT NULL DEFAULT 'Processing'");
  await migrateCol("orders", "purchase_id", "TEXT DEFAULT NULL");
  await migrateCol("orders", "payment_type", "TEXT NOT NULL DEFAULT 'quotation'");
  await migrateCol("payments", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  await migrateCol("bulk_orders", "customer_id", "INTEGER DEFAULT NULL");
  try { await run("CREATE INDEX IF NOT EXISTS idx_orders_purchase_id ON orders(purchase_id)"); } catch (_) { }
  try { await run("CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)"); } catch (_) { }
  try { await run("CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status)"); } catch (_) { }
  try { await run("CREATE INDEX IF NOT EXISTS idx_bulk_orders_customer ON bulk_orders(customer_id)"); } catch (_) { }

  // Data fix: correct truncated product name in shop_items
  try { await run(`UPDATE shop_items SET name='5-Hydroxymethylfurfural' WHERE id=4 AND name='5-Hydroxymethylfurfura'`); } catch (_) { }

  // Seed blog posts on first run
  try {
    const blogCount = await get(`SELECT COUNT(*) AS c FROM blogs`);
    if ((blogCount?.c || 0) === 0) {
      const blog1Content = `<p>Calcium supplementation is a foundational requirement across human nutrition, animal health, and specialty chemical applications. While traditional calcium salts such as carbonate, citrate, and gluconate have dominated the market for decades, emerging formulation needs are driving interest toward more versatile and functionally efficient alternatives. Calcium levulinate, an organic calcium salt derived from levulinic acid, is gaining attention as a promising ingredient offering a balanced combination of solubility, formulation flexibility, and bioavailability.</p>
<h2>What is Calcium Levulinate?</h2>
<p>Calcium levulinate is the calcium salt of levulinic acid, a bio-based platform molecule derived from biomass. Its organic structure enables improved compatibility with aqueous systems and modern formulations compared to many conventional inorganic calcium salts. The compound can be produced with high purity and consistency, making it suitable for applications ranging from veterinary nutrition to food fortification and specialty chemical uses.</p>
<h2>Key Applications</h2>
<h3>1. Veterinary and Animal Nutrition</h3>
<p>Calcium levulinate is particularly attractive for veterinary formulations where rapid dispersion and consistent delivery of calcium are important. It can be used in:</p>
<ul><li>Liquid calcium supplements for dairy and livestock</li><li>Mineral premixes for feed formulations</li><li>Nutritional support formulations during high-demand phases such as growth and lactation</li></ul>
<p>Its good solubility allows easy incorporation into oral liquid systems and improves handling in premix manufacturing.</p>
<h3>2. Food and Nutraceutical Applications</h3>
<p>In food systems, calcium levulinate can serve as a fortifying agent in:</p>
<ul><li>Functional beverages</li><li>Nutritional powders</li><li>Fortified foods and specialty diets</li></ul>
<p>Its relatively neutral taste profile and dispersibility help minimize common formulation challenges such as chalkiness or sedimentation associated with traditional calcium salts.</p>
<h3>3. Specialty Chemical and Industrial Uses</h3>
<p>Beyond nutrition, calcium levulinate can also be used as:</p>
<ul><li>A precursor for levulinate-based chemicals</li><li>An intermediate in green chemistry applications</li><li>A component in biodegradable material systems</li></ul>
<p>Its bio-based origin aligns with sustainability-driven product development.</p>
<h2>Advantages Over Conventional Calcium Supplements</h2>
<h3>1. Improved Formulation Flexibility</h3>
<p>Compared to calcium carbonate, which is poorly soluble, calcium levulinate offers significantly better dispersibility in aqueous systems. This makes it easier to formulate stable liquid products without sedimentation issues.</p>
<h3>2. Balanced Calcium Content</h3>
<p>While salts like calcium gluconate have very high solubility but low calcium content, calcium levulinate provides a balanced profile—offering moderate elemental calcium content with good solubility. This allows formulators to achieve desired calcium levels without excessively increasing dosage.</p>
<h3>3. Better Organoleptic Properties</h3>
<p>Calcium carbonate often imparts a chalky texture, and calcium citrate can introduce acidity. Calcium levulinate, in contrast, has a milder sensory impact, making it suitable for applications where taste and mouthfeel are critical.</p>
<h3>4. Organic and Bio-Based Origin</h3>
<p>Derived from biomass-based levulinic acid, calcium levulinate supports the transition toward sustainable and renewable chemical ingredients. This provides an added advantage for manufacturers targeting green or eco-friendly product positioning.</p>
<h2>Bioavailability Considerations</h2>
<p>Bioavailability is a key factor in evaluating any calcium supplement. While highly soluble salts like calcium gluconate are often associated with good absorption, they suffer from low calcium density. On the other hand, poorly soluble salts like carbonate may have limited dissolution under certain conditions.</p>
<p>Calcium levulinate occupies a balanced position:</p>
<ul><li>Its organic salt structure supports effective dissolution in aqueous environments</li><li>Moderate solubility enables availability without rapid precipitation</li><li>It provides a reasonable elemental calcium concentration, improving efficiency of delivery</li></ul>
<p>This combination makes calcium levulinate a practical choice for formulations requiring both functional performance and effective calcium delivery, especially in liquid and semi-liquid systems.</p>
<h2>Positioning Calcium Levulinate in the Market</h2>
<p>Calcium levulinate is not intended to replace traditional bulk calcium sources such as calcium carbonate in cost-sensitive, high-volume applications. Instead, it is best positioned as:</p>
<ul><li>A premium formulation ingredient</li><li>A functional additive for advanced nutritional systems</li><li>A specialty calcium source for differentiated products</li></ul>
<p>Its value lies in enabling better product performance, cleaner formulations, and alignment with sustainability trends.</p>
<h2>Conclusion</h2>
<p>As formulation requirements evolve across nutrition and specialty chemical industries, calcium levulinate represents a compelling alternative to conventional calcium salts. With its combination of solubility, balanced calcium content, improved formulation behavior, and bio-based origin, it offers a forward-looking solution for manufacturers seeking both performance and differentiation.</p>
<p>For companies developing next-generation veterinary supplements, functional foods, or specialty formulations, calcium levulinate provides an opportunity to move beyond traditional limitations and create products that meet modern expectations of efficiency, quality, and sustainability.</p>`;

      const blog2Content = `<p>Sodium levulinate is rapidly emerging as a preferred ingredient in clean-label formulations across cosmetics, personal care, and even certain food-contact applications. Derived from renewable biomass, it represents a shift toward sustainable chemistry without compromising functionality.</p>
<h2>What is Sodium Levulinate?</h2>
<p>Levulinic acid, the parent molecule, is obtained from lignocellulosic biomass such as agricultural residues (corn cobs, bagasse, wood). Neutralization of levulinic acid yields sodium levulinate—a mild, multifunctional preservative.</p>
<p>This bio-origin gives sodium levulinate a strong position in the green chemistry and circular economy ecosystem.</p>
<h2>Key Applications</h2>
<h3>1. Cosmetics &amp; Personal Care</h3>
<ul><li>Preservative in creams, lotions, shampoos</li><li>Effective in mild and sensitive-skin formulations</li><li>Often used in combination systems (e.g., with sodium anisate)</li></ul>
<h3>2. Food &amp; Beverage (Limited Use)</h3>
<ul><li>Functions as a flavoring agent and antimicrobial stabilizer</li><li>Compatible with clean-label trends</li></ul>
<h3>3. Pharmaceutical &amp; Topical Formulations</h3>
<ul><li>Used in dermatological products</li><li>Acts as a buffering and stabilizing agent</li></ul>
<h3>4. Industrial &amp; Specialty Chemicals</h3>
<ul><li>Intermediate in bio-based formulations</li><li>Component in green solvents and coatings</li></ul>
<h2>Advantages Over Conventional Preservatives</h2>
<ol>
<li><strong>Natural &amp; Bio-Based Origin:</strong> Unlike parabens or formaldehyde-releasing preservatives, sodium levulinate is derived from renewable biomass, aligning with sustainability goals.</li>
<li><strong>Mildness &amp; Skin Compatibility:</strong> It is non-irritating compared to many synthetic preservatives and is ideal for baby care and sensitive-skin products.</li>
<li><strong>Broad-Spectrum Support (in Blends):</strong> While not always fully broad-spectrum alone, it works synergistically with other mild preservatives and enables paraben-free and phenoxyethanol-free systems.</li>
<li><strong>Regulatory &amp; Consumer Acceptance:</strong> It is accepted in natural and organic-certified formulations and is increasingly preferred by clean beauty brands.</li>
<li><strong>Biodegradability:</strong> It breaks down easily in the environment and has a lower ecological footprint compared to conventional preservatives.</li>
</ol>
<h2>What Makes Sodium Levulinate Unique?</h2>
<ol>
<li><strong>Platform Molecule Derivative:</strong> It originates from levulinic acid, a top bio-based platform chemical, making it part of a broader biorefinery value chain.</li>
<li><strong>Non-Food Biomass Utilization:</strong> It is produced from agricultural waste and not from food crops, supporting waste-to-wealth strategies.</li>
<li><strong>Dual Functionality:</strong> It acts as both preservative and pH adjuster, enhancing formulation stability.</li>
<li><strong>Alignment with Future Chemical Industry:</strong> It fits into carbon-neutral and circular economy frameworks, compatible with green solvent and bio-based polymer ecosystems.</li>
</ol>
<h2>Comparison with Other Natural Preservatives</h2>
<div class="blog-table-wrap"><table class="blog-table"><thead><tr><th>Property</th><th>Sodium Levulinate</th><th>Sodium Benzoate</th><th>Potassium Sorbate</th></tr></thead><tbody><tr><td>Source</td><td>Biomass-derived</td><td>Petro/Bio</td><td>Petro/Bio</td></tr><tr><td>Skin Mildness</td><td>High</td><td>Moderate</td><td>Moderate</td></tr><tr><td>pH Range</td><td>Broad (4–8)</td><td>Acidic only</td><td>Acidic only</td></tr><tr><td>Biodegradability</td><td>Excellent</td><td>Good</td><td>Good</td></tr><tr><td>Clean-label appeal</td><td>Very high</td><td>Moderate</td><td>Moderate</td></tr></tbody></table></div>
<h2>Market Outlook</h2>
<p>With increasing demand for paraben-free products, sustainable ingredients, and bio-based chemicals, sodium levulinate is positioned as a next-generation preservative, especially in premium and eco-conscious product lines.</p>
<p>For companies working on biomass-to-chemicals (like levulinic acid platforms), sodium levulinate is more than just a product—it is a gateway molecule into high-value markets, such as clean beauty, green pharmaceuticals, and sustainable materials.</p>`;

      await run(
        `INSERT OR IGNORE INTO blogs (slug, title, excerpt, content, product_link, meta_description, is_published, published_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
        [
          'calcium-levulinate',
          'Calcium Levulinate: A Next-Generation Organic Calcium Ingredient for Modern Formulations',
          'Discover why calcium levulinate is emerging as a preferred calcium salt for veterinary, food, and specialty chemical formulations — offering superior solubility, balanced calcium content, and bio-based origin.',
          blog1Content,
          '/products/calcium-levulinate.html',
          'Calcium levulinate — a bio-based organic calcium salt with improved solubility and formulation flexibility for veterinary nutrition, food fortification, and specialty chemicals.'
        ]
      );
      await run(
        `INSERT OR IGNORE INTO blogs (slug, title, excerpt, content, product_link, meta_description, is_published, published_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
        [
          'sodium-levulinate',
          'Sodium Levulinate: A Bio-Based Preservative Shaping the Future of Clean Formulations',
          'Sodium levulinate is redefining clean-label preservation in cosmetics, personal care, and food applications. Explore its bio-based origin, dual functionality, and growing market adoption.',
          blog2Content,
          '/products/sodium-levulinate.html',
          'Sodium levulinate — a bio-based, mild, biodegradable preservative from renewable biomass. Ideal for clean-label cosmetics, personal care, and pharmaceutical formulations.'
        ]
      );
    }
  } catch (_) { /* blogs table may not exist on very old DBs — migration will create it */ }

  console.log("✅ SQLite ready with pack_pricing table");
}

function getActivePath() {
  return ACTIVE_DB_PATH;
}

module.exports = { db, initDb, exec, get, run, all, getActivePath };
