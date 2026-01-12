const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const multer = require("multer");
const os = require("os");

const app = express();

// ✅ CORS: Any device allowed
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ✅ Serve frontend files
const frontendDir = path.join(__dirname, "..");
app.use(express.static(frontendDir));

app.get("/", (req, res) => res.sendFile(path.join(frontendDir, "index.html")));
app.get(/\.html$/, (req, res) => {
  const filePath = path.join(frontendDir, req.path);
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send("Not found");
});

/* ===============================
   CONFIG: AUTO-DETECT BACKEND URL
================================ */
function getBackendBaseURL(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || req.get('host');
  return `${protocol}://${host}`;
}

app.get("/api/config", (req, res) => {
  const baseURL = getBackendBaseURL(req);
  res.json({
    backendURL: baseURL,
    apiBase: `${baseURL}/api`,
    uploadsURL: `${baseURL}/uploads`
  });
});

/* ===============================
   UPLOADS & DB SETUP
================================ */
const uploadsDir = path.join(__dirname, "uploads");
fs.existsSync(uploadsDir) || fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const suffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `receipt_${suffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const dbDir = path.join(__dirname, "db");
fs.existsSync(dbDir) || fs.mkdirSync(dbDir, { recursive: true });
const db = new sqlite3.Database(path.join(dbDir, "chemsus.db"));

// ✅ SCHEMA INITIALIZATION
async function initDB() {
  const run = (sql, params = []) => new Promise((r, j) => db.run(sql, params, function(e) { e ? j(e) : r(this); }));
  
  // Orders table
  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customername TEXT,
    email TEXT,
    phone TEXT,
    productname TEXT,
    quantity INTEGER,
    totalprice REAL,
    paymentmode TEXT DEFAULT 'PENDING',
    status TEXT DEFAULT 'PLACED',
    notes TEXT,
    createdat DATETIME DEFAULT CURRENT_TIMESTAMP,
    address TEXT,
    city TEXT,
    region TEXT,
    pincode TEXT
  )`);

  // Receipts table
  await run(`CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY,
    orderid INTEGER,
    customername TEXT,
    email TEXT,
    phone TEXT,
    amount REAL,
    receiptimage TEXT,
    rating INTEGER,
    feedback TEXT,
    createdat DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ✅ PRODUCTS TABLE (NEW)
  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    link TEXT NOT NULL,
    image LONGTEXT,
    createdat DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedat DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ✅ INSERT DEFAULT PRODUCTS if empty
  const getCount = () => new Promise((r, j) => {
    db.get("SELECT COUNT(*) as count FROM products", (e, row) => {
      e ? j(e) : r(row.count);
    });
  });

  const count = await getCount();
  if (count === 0) {
    const defaultProducts = [
      { name: '5-Hydroxymethylfurfural (5-HMF)', description: 'Biomass-derived platform molecule used in fuels, polymers and pharma.', link: 'products/5-hmf.html', image: 'assets/chemical1.avif' },
      { name: 'Calcium Levulinate', description: 'Highly bioavailable calcium salt for nutraceutical applications.', link: 'products/calcium-levulinate.html', image: 'assets/chemical2.png' },
      { name: 'Sodium Levulinate', description: 'Biodegradable preservative for food and cosmetics.', link: 'products/sodium-levulinate.html', image: 'assets/chemical3.jpg' },
      { name: 'Ethyl Levulinate', description: 'Green solvent and fragrance ingredient.', link: 'products/ethyl-levulinate.html', image: 'assets/chemical4.jpeg' },
      { name: 'Methyl Levulinate', description: 'Bio-based ester used in fuels and fine chemicals.', link: 'products/methyl-levulinate.html', image: 'assets/chemical5.jpeg' },
      { name: 'Levulinic Acid', description: 'Key bio-platform chemical derived from biomass.', link: 'products/levulinic-acid.html', image: 'assets/chemical6.jpeg' }
    ];
    for (const product of defaultProducts) {
      await run(
        'INSERT INTO products (name, description, link, image) VALUES (?, ?, ?, ?)',
        [product.name, product.description, product.link, product.image]
      );
    }
  }

  console.log("✅ DB ready (orders, receipts, products)");
}
initDB().catch(console.error);

/* ===============================
   OTP APIS
================================ */
const otpStore = {};

app.post("/api/send-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length !== 10) return res.json({ success: false, message: "Invalid phone" });
  
  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[phone] = { otp, expires: Date.now() + 300000 };
  
  try {
    const r = await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: { authorization: "PASTE_YOUR_REAL_FAST2SMS_API_KEY", route: "otp", variables_values: otp, numbers: phone }
    });
    res.json({ success: r.data.return === true });
  } catch (e) { res.json({ success: false }); }
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  const rec = otpStore[phone];
  if (!rec || Date.now() > rec.expires || rec.otp != otp) {
    delete otpStore[phone];
    return res.json({ success: false, message: "Invalid OTP" });
  }
  delete otpStore[phone];
  res.json({ success: true });
});

/* ===============================
   ORDERS APIS
================================ */
app.post("/api/orders", (req, res) => {
  const { customername, email, phone, productname, quantity, totalprice, paymentmode, address, city, region, pincode } = req.body;
  db.run(
    `INSERT INTO orders(customername,email,phone,productname,quantity,totalprice,paymentmode,status,address,city,region,pincode)
     VALUES(?,?,?,?,?,?,COALESCE(?,'PENDING'),'PLACED',?,?,?,?)`,
    [customername,email,phone,productname,quantity,totalprice,paymentmode,address||null,city||null,region||null,pincode||null],
    function(e) { e ? res.status(500).json({error:e.message}) : res.json({success:true,orderId:this.lastID}); }
  );
});

app.get("/api/adminorders", (req, res) => {
  db.all("SELECT * FROM orders ORDER BY createdat DESC", (e, rows) => {
    e ? res.status(500).json({error:e.message}) : res.json(rows || []);
  });
});

app.patch("/api/adminorders/:id", (req, res) => {
  const updates = [], params = [], {paymentmode,status,notes,address,city,region,pincode}=req.body;
  if (paymentmode!==undefined) {updates.push("paymentmode=?");params.push(paymentmode);}
  if (status!==undefined) {updates.push("status=?");params.push(status);}
  if (notes!==undefined) {updates.push("notes=?");params.push(notes);}
  if (address!==undefined) {updates.push("address=?");params.push(address);}
  if (city!==undefined) {updates.push("city=?");params.push(city);}
  if (region!==undefined) {updates.push("region=?");params.push(region);}
  if (pincode!==undefined) {updates.push("pincode=?");params.push(pincode);}
  params.push(req.params.id);
  
  db.run(`UPDATE orders SET ${updates.join(",")} WHERE id=?`, params, function(e) {
    e ? res.status(500).json({error:e.message}) : this.changes ? res.json({success:true}) : res.status(404).json({error:"Not found"});
  });
});

app.delete("/api/adminorders/:id", (req, res) => {
  db.run("DELETE FROM orders WHERE id=?", [req.params.id], function(e) {
    e ? res.status(500).json({error:e.message}) : this.changes ? res.json({success:true}) : res.status(404).json({error:"Not found"});
  });
});

/* ===============================
   RECEIPTS APIS
================================ */
app.post("/api/receipts", upload.single("receiptimage"), (req, res) => {
  const {orderid,customername,email,phone,amount,rating,feedback}=req.body;
  const baseURL = getBackendBaseURL(req);
  const receiptimage = req.file ? `${baseURL}/uploads/${req.file.filename}` : null;
  
  db.run(
    `INSERT INTO receipts(orderid,customername,email,phone,amount,receiptimage,rating,feedback) VALUES(?,?,?,?,?,?,?,?)`,
    [orderid,customername,email,phone,amount,receiptimage,rating||null,feedback||null],
    function(e) {
      if (e) return res.status(500).json({error:e.message});
      db.run("UPDATE orders SET paymentmode='PAID' WHERE id=?", [orderid]);
      res.json({success:true,receiptId:this.lastID});
    }
  );
});

app.get("/api/receipts", (req, res) => {
  db.all("SELECT * FROM receipts ORDER BY createdat DESC", (e, rows) => {
    e ? res.status(500).json({error:e.message}) : res.json(rows || []);
  });
});

app.get("/api/receipts/:id", (req, res) => {
  db.get("SELECT * FROM receipts WHERE id=?", [req.params.id], (e, row) => {
    e ? res.status(500).json({error:e.message}) : row ? res.json(row) : res.status(404).json({error:"Not found"});
  });
});

app.delete("/api/receipts/:id", (req, res) => {
  db.get("SELECT receiptimage FROM receipts WHERE id=?", [req.params.id], async (e, row) => {
    if (e || !row) return res.status(404).json({error:"Not found"});
    if (row.receiptimage) {
      const filename = row.receiptimage.split("/").pop();
      fs.unlink(path.join(uploadsDir, filename), () => {});
    }
    db.run("DELETE FROM receipts WHERE id=?", [req.params.id], (e) => {
      e ? res.status(500).json({error:e.message}) : res.json({success:true});
    });
  });
});

/* ===============================
   PRODUCTS APIS (NEW)
================================ */

// GET all products
app.get("/api/products", (req, res) => {
  db.all("SELECT * FROM products ORDER BY id ASC", (e, rows) => {
    e ? res.status(500).json({error:e.message}) : res.json(rows || []);
  });
});

// GET single product by ID
app.get("/api/products/:id", (req, res) => {
  db.get("SELECT * FROM products WHERE id=?", [req.params.id], (e, row) => {
    e ? res.status(500).json({error:e.message}) : row ? res.json(row) : res.status(404).json({error:"Not found"});
  });
});

// CREATE new product
app.post("/api/products", (req, res) => {
  const { name, description, link, image } = req.body;
  if (!name || !description || !link) return res.status(400).json({error:"Missing fields"});
  
  db.run(
    'INSERT INTO products (name, description, link, image) VALUES (?, ?, ?, ?)',
    [name, description, link, image || 'assets/logo.png'],
    function(e) {
      e ? res.status(500).json({error:e.message}) : res.status(201).json({success:true, id:this.lastID});
    }
  );
});

// UPDATE product
app.put("/api/products/:id", (req, res) => {
  const { name, description, link, image } = req.body;
  if (!name || !description || !link) return res.status(400).json({error:"Missing fields"});
  
  db.run(
    'UPDATE products SET name=?, description=?, link=?, image=?, updatedat=CURRENT_TIMESTAMP WHERE id=?',
    [name, description, link, image || 'assets/logo.png', req.params.id],
    function(e) {
      e ? res.status(500).json({error:e.message}) : this.changes ? res.json({success:true}) : res.status(404).json({error:"Not found"});
    }
  );
});

// DELETE product
app.delete("/api/products/:id", (req, res) => {
  db.run('DELETE FROM products WHERE id=?', [req.params.id], function(e) {
    e ? res.status(500).json({error:e.message}) : this.changes ? res.json({success:true}) : res.status(404).json({error:"Not found"});
  });
});

/* ===============================
   TEST ENDPOINT
================================ */
app.get("/api/test", (req, res) => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  res.json({
    status: "✅ Multi-Device Ready",
    backendURL: getBackendBaseURL(req),
    yourIPs: ips,
    message: "Use /api/config in your JS for auto-detection!"
  });
});

// ✅ Bind to ALL interfaces
app.listen(3000, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  console.log("\n🚀 ChemSus → http://0.0.0.0:3000");
  console.log("✅ PC:    http://localhost:3000/");
  console.log("✅ Mobile: http://" + ips.join(" | http://") + ":3000");
  console.log("✅ Test:  http://localhost:3000/api/test");
  console.log("\n📱 MOBILE FIX: Use /api/config for dynamic URLs!");
  console.log("📊 Databases: orders, receipts, products ✅\n");
});
