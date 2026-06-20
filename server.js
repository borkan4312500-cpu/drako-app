require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const https = require('https');

const app = express();

// --- إعدادات الأمان الأساسية ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

// --- تحديد معدل الطلبات (Rate Limiting) ---
// معدل عام للمستخدمين العاديين
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // زيادة الحد
  message: { error: 'طلبات كثيرة جداً، حاول لاحقاً' }
});

// معدل خاص للأدمن (أعلى بكثير)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,  // ← رفعنا الحد إلى 5000 طلب في 15 دقيقة
  message: { error: 'طلبات كثيرة جداً، حاول لاحقاً' }
});
app.use(generalLimiter);

// ثم بعد تعريف requireAuth و adminOnly، أضف هذا السطر:
app.use('/api/admin', requireAuth, adminOnly, adminLimiter);

// --- إعداد المسار الدائم (Railway Volume) ---
const DATA_DIR = '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'drako.db');
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');

// تأكد من وجود المجلدات
if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- إعداد قاعدة البيانات SQLite ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// إنشاء الجداول إذا لم تكن موجودة
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','RESTAURANT','DRIVER','CUSTOMER','MARKET','PHARMACY')),
    regionId TEXT,
    address TEXT DEFAULT '',
    isActive INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS restaurants (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '',
    description TEXT DEFAULT '',
    isOpen INTEGER DEFAULT 1,
    visible INTEGER DEFAULT 1,
    "order" INTEGER DEFAULT 0,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '',
    isOpen INTEGER DEFAULT 1,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS pharmacies (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '',
    isOpen INTEGER DEFAULT 1,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    earnings REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    isAvailable INTEGER DEFAULT 1,
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    orderNumber INTEGER,
    type TEXT DEFAULT 'restaurant',
    orderType TEXT,
    storeId TEXT,
    restaurantId TEXT,
    customerName TEXT,
    customerPhone TEXT,
    address TEXT,
    regionName TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    total REAL DEFAULT 0,
    orderPrice REAL,
    deliveryFee REAL DEFAULT 0,
    platformFee REAL DEFAULT 0,
    paymentMethod TEXT DEFAULT 'CASH',
    status TEXT DEFAULT 'PENDING',
    driverId TEXT,
    adminApproved INTEGER DEFAULT 0,
    isDirect INTEGER DEFAULT 0,
    invoiceAmount REAL,
    invoiceBy TEXT,
    notes TEXT DEFAULT '',
    orderNotes TEXT DEFAULT '',
    adminNotes TEXT DEFAULT '',
    cancelReason TEXT,
    lastDigits TEXT,
    transactionId TEXT,
    extraFee REAL,
    attachments TEXT DEFAULT '[]',
    createdAt TEXT,
    preparingAt TEXT,
    deliveredAt TEXT
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    restaurantId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    basePrice REAL DEFAULT 0,
    category TEXT DEFAULT 'أخرى',
    image TEXT DEFAULT '',
    isAvailable INTEGER DEFAULT 1,
    groups TEXT DEFAULT '[]',
    type TEXT DEFAULT 'single',
    FOREIGN KEY (restaurantId) REFERENCES restaurants(id)
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    restaurantId TEXT,
    name TEXT NOT NULL,
    FOREIGN KEY (restaurantId) REFERENCES restaurants(id)
  );
  CREATE TABLE IF NOT EXISTS regions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fee REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rechargeRequests (
    id TEXT PRIMARY KEY,
    driverId TEXT NOT NULL,
    driverName TEXT,
    driverPhone TEXT,
    amount REAL,
    last4digits TEXT,
    status TEXT DEFAULT 'PENDING',
    createdAt TEXT,
    processedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS dailyOrderCounter (
    date TEXT PRIMARY KEY,
    counter INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// مؤشرات
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_driverId ON orders(driverId);
  CREATE INDEX IF NOT EXISTS idx_orders_restaurantId ON orders(restaurantId);
  CREATE INDEX IF NOT EXISTS idx_orders_storeId ON orders(storeId);
  CREATE INDEX IF NOT EXISTS idx_orders_createdAt ON orders(createdAt);
`);

// دوال مساعدة
function getSetting(key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// إعداد البيانات الأولية
function initializeData() {
  const adminExists = db.prepare('SELECT id FROM users WHERE phone = ?').get('01000000000');
  if (!adminExists) {
    const adminId = 'admin1';
    db.prepare('INSERT INTO users (id, name, phone, password, role) VALUES (?,?,?,?,?)')
      .run(adminId, 'أدمن دراكو', '01000000000', bcrypt.hashSync('123456', 10), 'ADMIN');
    const regions = [
      { id: 'reg_1', name: 'مساكن جمصة', fee: 10 },
      { id: 'reg_2', name: '15 مايو', fee: 15 },
      { id: 'reg_3', name: 'المنصورة الجديدة', fee: 20 },
      { id: 'reg_4', name: 'الدلتا', fee: 25 },
      { id: 'reg_5', name: 'الشيخ زايد', fee: 30 }
    ];
    const insertRegion = db.prepare('INSERT OR IGNORE INTO regions (id, name, fee) VALUES (?,?,?)');
    regions.forEach(r => insertRegion.run(r.id, r.name, r.fee));
    setSetting('dispatchMode', 'manual');
  }
}
initializeData();

// --- إعدادات واتساب (CallMeBot) ---
const WHATSAPP_ENABLED = true;
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'PASTE_YOUR_API_KEY_HERE'; // ⚠️ استبدل بمفتاحك
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '201064530217';

function sendWhatsAppMessage(text) {
  if (!WHATSAPP_ENABLED || !WHATSAPP_API_KEY || WHATSAPP_API_KEY === 'PASTE_YOUR_API_KEY_HERE') return;
  const encoded = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${WHATSAPP_PHONE}&text=${encoded}&apikey=${WHATSAPP_API_KEY}`;
  https.get(url).on('error', (e) => console.error('WhatsApp error:', e.message));
}

// --- إعدادات Multer للملفات ---
const fileFilter = (req, file, cb) => {
  const allowedMimes = /^(image\/|audio\/|application\/pdf|text\/|application\/msword|application\/vnd\.openxmlformats)/;
  if (allowedMimes.test(file.mimetype)) cb(null, true);
  else cb(new Error('نوع الملف غير مسموح به'), false);
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dir = UPLOADS_DIR;
    if (req.originalUrl.includes('/orders/special')) dir = path.join(dir, 'special_orders');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'));
  }
});
const upload = multer({ storage, fileFilter });

const soundUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SOUNDS_DIR),
    filename: (req, file, cb) => cb(null, req.body.event + '.mp3')
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('فقط ملفات الصوت مسموحة'));
  }
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/sounds', express.static(SOUNDS_DIR));

// --- إعداد Socket.io ---
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = process.env.JWT_SECRET || 'drako_secret_fallback_replace_in_production';

const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

// تجديد الكوكي تلقائياً
app.use((req, res, next) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure(req),
        maxAge: 365 * 24 * 60 * 60 * 1000
      });
    } catch (e) {}
  }
  next();
});

const getNextOrderNumber = () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT counter FROM dailyOrderCounter WHERE date = ?').get(today);
  let counter = row ? row.counter : 0;
  counter += 1;
  if (row) {
    db.prepare('UPDATE dailyOrderCounter SET counter = ? WHERE date = ?').run(counter, today);
  } else {
    db.prepare('INSERT INTO dailyOrderCounter (date, counter) VALUES (?, ?)').run(today, counter);
  }
  return counter;
};

function getStoreNameForOrder(order) {
  if (order.type === 'special') {
    if (order.orderType === 'market' && order.storeId) {
      const market = db.prepare('SELECT name FROM markets WHERE id = ?').get(order.storeId);
      return market ? market.name : 'ماركت';
    } else if (order.orderType === 'pharmacy' && order.storeId) {
      const pharmacy = db.prepare('SELECT name FROM pharmacies WHERE id = ?').get(order.storeId);
      return pharmacy ? pharmacy.name : 'صيدلية';
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'انتهت الجلسة' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'صلاحيات غير كافية' });
  next();
}

// ============== الصفحات الثابتة ==============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'customer.html')));
app.get('/customer', (req, res) => res.sendFile(path.join(__dirname, 'customer.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/restaurant', (req, res) => res.sendFile(path.join(__dirname, 'restaurant.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'driver.html')));
app.get('/market', (req, res) => res.sendFile(path.join(__dirname, 'market.html')));
app.get('/pharmacy', (req, res) => res.sendFile(path.join(__dirname, 'pharmacy.html')));

// ============== المصادقة ==============
app.post('/api/login', authLimiter, (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'الهاتف وكلمة المرور مطلوبان' });
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/'); });

app.get('/api/whoami', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '365d' });
  res.json({ token, user });
});

// ==================== ADMIN ROUTES ====================
app.get('/api/admin/stats', requireAuth, adminOnly, (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const restaurantsCount = db.prepare('SELECT COUNT(*) as count FROM restaurants').get().count;
  const driversCount = db.prepare('SELECT COUNT(*) as count FROM drivers').get().count;
  const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total),0) as total FROM orders').get().total;
  res.json({ users: usersCount, restaurants: restaurantsCount, drivers: driversCount, orders: ordersCount, totalRevenue });
});

app.get('/api/admin/dashboard', requireAuth, adminOnly, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE createdAt LIKE ?").get(today + '%').count;
  const activeOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status IN ('PENDING','ACCEPTED','PREPARING','READY','DRIVER_ASSIGNED','ON_THE_WAY')").get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total),0) as total FROM orders').get().total;

  const availableDrivers = db.prepare(`
    SELECT u.id, u.name, u.phone, d.earnings, d.credit, d.isAvailable, u.isActive
    FROM users u JOIN drivers d ON u.id = d.userId
    WHERE u.role = 'DRIVER'
  `).all().map(d => {
    const activeCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE driverId = ? AND status NOT IN ('DELIVERED','CANCELLED')").get(d.id).count;
    return { ...d, isAvailable: !!d.isAvailable, isActive: !!d.isActive, activeOrdersCount: activeCount };
  });

  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 10').all();
  res.json({ todayOrders, activeOrders, restaurants: db.prepare('SELECT COUNT(*) as count FROM restaurants').get().count, drivers: db.prepare('SELECT COUNT(*) as count FROM drivers').get().count, totalRevenue, recentOrders, availableDrivers });
});

app.get('/api/admin/dispatch-mode', requireAuth, adminOnly, (req, res) => {
  const mode = getSetting('dispatchMode', 'manual');
  res.json({ mode });
});

app.patch('/api/admin/dispatch-mode', requireAuth, adminOnly, (req, res) => {
  const { mode } = req.body;
  if (!['manual', 'auto'].includes(mode)) return res.status(400).json({ error: 'وضع غير صالح' });
  setSetting('dispatchMode', mode);
  res.json({ mode });
});

// المطاعم
app.get('/api/admin/restaurants', requireAuth, adminOnly, (req, res) => {
  const restaurants = db.prepare(`
    SELECT r.*, u.name as ownerName, u.phone as ownerPhone
    FROM restaurants r JOIN users u ON r.userId = u.id
  `).all();
  res.json(restaurants);
});

app.post('/api/admin/restaurants', requireAuth, adminOnly, (req, res) => {
  const { name, ownerPhone, ownerPassword } = req.body;
  if (!name || !ownerPhone || !ownerPassword) return res.status(400).json({ error: 'بيانات ناقصة' });
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(ownerPhone);
  if (existing) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + uuidv4();
  const restaurantId = 'res_' + uuidv4();
  const hashed = bcrypt.hashSync(ownerPassword, 10);
  db.prepare('INSERT INTO users (id, name, phone, password, role) VALUES (?,?,?,?,?)').run(userId, name, ownerPhone, hashed, 'RESTAURANT');
  db.prepare('INSERT INTO restaurants (id, userId, name) VALUES (?,?,?)').run(restaurantId, userId, name);
  res.json({ id: restaurantId, name });
});

app.patch('/api/admin/restaurants/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('UPDATE restaurants SET isOpen = ? WHERE id = ?').run(restaurant.isOpen ? 0 : 1, req.params.id);
  res.json({ isOpen: !restaurant.isOpen });
});

app.patch('/api/admin/restaurants/:id', requireAuth, adminOnly, (req, res) => {
  const { name, ownerPhone, visible, order } = req.body;
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  if (name !== undefined) db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run(name, req.params.id);
  if (ownerPhone !== undefined) {
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(ownerPhone, restaurant.userId);
  }
  if (visible !== undefined) db.prepare('UPDATE restaurants SET visible = ? WHERE id = ?').run(visible ? 1 : 0, req.params.id);
  if (order !== undefined) db.prepare('UPDATE restaurants SET "order" = ? WHERE id = ?').run(order, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/restaurants/:id', requireAuth, adminOnly, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('DELETE FROM users WHERE id = ?').run(restaurant.userId);
  db.prepare('DELETE FROM restaurants WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// الطيارين
app.get('/api/admin/drivers', requireAuth, adminOnly, (req, res) => {
  const drivers = db.prepare(`
    SELECT u.id, u.name, u.phone, d.earnings, d.credit, d.isAvailable, u.isActive
    FROM users u JOIN drivers d ON u.id = d.userId
    WHERE u.role = 'DRIVER'
  `).all().map(d => {
    const activeCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE driverId = ? AND status NOT IN ('DELIVERED','CANCELLED')").get(d.id).count;
    return { ...d, isAvailable: !!d.isAvailable, isActive: !!d.isActive, activeOrdersCount: activeCount };
  });
  res.json(drivers);
});

app.post('/api/admin/drivers', requireAuth, adminOnly, (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + uuidv4();
  const driverId = 'drv_' + uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, name, phone, password, role) VALUES (?,?,?,?,?)').run(userId, name, phone, hashed, 'DRIVER');
  db.prepare('INSERT INTO drivers (id, userId, isAvailable) VALUES (?,?,1)').run(driverId, userId);
  res.json({ id: userId, name });
});

app.patch('/api/admin/drivers/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'DRIVER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const driver = db.prepare('SELECT * FROM drivers WHERE userId = ?').get(req.params.id);
  if (driver) {
    db.prepare('UPDATE drivers SET isAvailable = ? WHERE userId = ?').run(driver.isAvailable ? 0 : 1, req.params.id);
    res.json({ isAvailable: !driver.isAvailable });
  } else {
    res.status(404).json({ error: 'ملف السائق غير موجود' });
  }
});

app.patch('/api/admin/drivers/:id/block', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'DRIVER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('UPDATE users SET isActive = ? WHERE id = ?').run(user.isActive ? 0 : 1, req.params.id);
  res.json({ isActive: !user.isActive });
});

app.patch('/api/admin/drivers/:id', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'DRIVER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const { name, phone, password } = req.body;
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.params.id);
  if (phone) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.params.id);
  if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/drivers/:id', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'DRIVER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('DELETE FROM drivers WHERE userId = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/drivers/:id/details', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'DRIVER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'الطيار غير موجود' });
  const driver = db.prepare('SELECT * FROM drivers WHERE userId = ?').get(user.id) || {};
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = db.prepare(`
    SELECT * FROM orders WHERE driverId = ? AND status = 'DELIVERED' AND deliveredAt LIKE ?
  `).all(user.id, today + '%');
  const todayRevenue = todayOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
  const enriched = todayOrders.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    customerName: o.customerName,
    total: o.total,
    deliveryFee: o.deliveryFee,
    restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : getStoreNameForOrder(o) || 'طلب خاص',
    address: o.address
  }));
  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    isAvailable: !!driver.isAvailable,
    isActive: !!user.isActive,
    earnings: driver.earnings || 0,
    credit: driver.credit || 0,
    todayOrdersCount: todayOrders.length,
    todayRevenue,
    todayOrders: enriched
  });
});

// المناطق
app.get('/api/admin/regions', requireAuth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM regions').all());
});

app.post('/api/admin/regions', requireAuth, adminOnly, (req, res) => {
  const { name, fee } = req.body;
  if (!name || fee == null) return res.status(400).json({ error: 'بيانات ناقصة' });
  const id = 'reg_' + uuidv4();
  db.prepare('INSERT INTO regions (id, name, fee) VALUES (?,?,?)').run(id, name, Number(fee));
  res.json(db.prepare('SELECT * FROM regions').all());
});

app.patch('/api/admin/regions/:id', requireAuth, adminOnly, (req, res) => {
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
  if (!region) return res.status(404).json({ error: 'غير موجود' });
  if (req.body.name) db.prepare('UPDATE regions SET name = ? WHERE id = ?').run(req.body.name, req.params.id);
  if (req.body.fee !== undefined) db.prepare('UPDATE regions SET fee = ? WHERE id = ?').run(Number(req.body.fee), req.params.id);
  res.json(db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/regions/:id', requireAuth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM regions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// المنتجات والتصنيفات
app.get('/api/admin/products', requireAuth, adminOnly, (req, res) => {
  const products = db.prepare(`
    SELECT p.*, r.name as restaurantName FROM products p LEFT JOIN restaurants r ON p.restaurantId = r.id
  `).all();
  res.json(products.map(p => ({ ...p, groups: JSON.parse(p.groups || '[]') })));
});

app.post('/api/admin/products', requireAuth, adminOnly, upload.single('image'), (req, res) => {
  const { name, description, price, category, restaurantId } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });
  const id = 'prod_' + uuidv4();
  const imagePath = req.file ? '/uploads/' + req.file.filename : '';
  db.prepare('INSERT INTO products (id, restaurantId, name, description, basePrice, category, image) VALUES (?,?,?,?,?,?,?)')
    .run(id, restaurantId, name, description || '', Number(price), category || 'أخرى', imagePath);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

app.delete('/api/admin/products/:id', requireAuth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/categories', requireAuth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories').all());
});

app.post('/api/admin/categories', requireAuth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  db.prepare('INSERT INTO categories (id, name, restaurantId) VALUES (?,?,?)').run('cat_' + uuidv4(), name, '');
  res.json({ success: true });
});

app.delete('/api/admin/categories/:id', requireAuth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// رفع الأصوات
app.post('/api/admin/upload-sound', requireAuth, adminOnly, soundUpload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  res.json({ success: true, event: req.body.event, filename: req.file.filename });
});

// طلبات الشحن
app.get('/api/admin/recharge-requests', requireAuth, adminOnly, (req, res) => {
  const status = req.query.status || 'PENDING';
  res.json(db.prepare('SELECT * FROM rechargeRequests WHERE status = ?').all(status));
});

app.patch('/api/admin/recharge-requests/:id/approve', requireAuth, adminOnly, (req, res) => {
  const request = db.prepare('SELECT * FROM rechargeRequests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'غير موجود' });
  if (request.status !== 'PENDING') return res.status(400).json({ error: 'تمت معالجته مسبقاً' });
  db.prepare('UPDATE rechargeRequests SET status = ?, processedAt = ? WHERE id = ?').run('APPROVED', new Date().toISOString(), req.params.id);
  db.prepare('UPDATE drivers SET credit = credit + ? WHERE userId = ?').run(request.amount, request.driverId);
  res.json({ success: true, message: 'تمت الموافقة وإضافة الرصيد' });
});

app.patch('/api/admin/recharge-requests/:id/reject', requireAuth, adminOnly, (req, res) => {
  const request = db.prepare('SELECT * FROM rechargeRequests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'غير موجود' });
  if (request.status !== 'PENDING') return res.status(400).json({ error: 'تمت معالجته مسبقاً' });
  db.prepare('UPDATE rechargeRequests SET status = ?, processedAt = ? WHERE id = ?').run('REJECTED', new Date().toISOString(), req.params.id);
  res.json({ success: true, message: 'تم رفض الطلب' });
});

// الطلبات
app.get('/api/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC').all().map(o => {
    let items = [];
    try { items = JSON.parse(o.items || '[]'); } catch(e) { items = []; }
    let attachments = [];
    try { attachments = JSON.parse(o.attachments || '[]'); } catch(e) { attachments = []; }
    return {
      ...o,
      items,
      attachments,
      restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : getStoreNameForOrder(o) || '—',
      driverName: o.driverId ? (db.prepare('SELECT name FROM users WHERE id = ?').get(o.driverId)?.name) : '—'
    };
  });
  res.json(orders);
});
app.patch('/api/admin/orders/:id/assign-driver', requireAuth, adminOnly, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  db.prepare('UPDATE orders SET driverId = ?, status = ? WHERE id = ?').run(req.body.driverId, 'DRIVER_ASSIGNED', req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/test-order', requireAuth, adminOnly, (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'اختر مطعماً' });
  const orderNumber = getNextOrderNumber();
  const orderId = 'test_' + uuidv4();
  db.prepare(`
    INSERT INTO orders (id, orderNumber, restaurantId, customerName, customerPhone, address, items, total, paymentMethod, status, deliveryFee, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderId, orderNumber, restaurantId, 'عميل تجريبي', '0100000000', 'العنوان التجريبي', JSON.stringify([{ name: 'منتج تجريبي', price: 50, quantity: 2 }]), 100, 'CASH', 'PENDING', 10, new Date().toISOString());
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  sendWhatsAppMessage(`🧪 طلب تجريبي #${orderNumber}\n👤 ${order.customerName}\n💰 ${order.total} ج`);
  res.json({ success: true, order });
});

// التقارير
app.get('/api/admin/reports/full', requireAuth, adminOnly, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'DELIVERED'").all();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString().slice(0, 10);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const filter = (list, start) => list.filter(o => o.deliveredAt && o.deliveredAt >= start);
  const sumRevenue = (list) => {
    const productRevenue = list.reduce((s, o) => s + (o.total - (o.deliveryFee || 0)), 0);
    const deliveryRevenue = list.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const platformFee = list.reduce((s, o) => s + (o.platformFee || 0), 0);
    return { productRevenue, deliveryRevenue, platformFee, totalRevenue: productRevenue + deliveryRevenue, count: list.length };
  };

  const groupBy = (list, key) => {
    const map = {};
    list.forEach(o => {
      const k = o[key];
      if (!k) return;
      if (!map[k]) map[k] = { productRevenue: 0, deliveryRevenue: 0, platformFee: 0, count: 0 };
      map[k].productRevenue += o.total - (o.deliveryFee || 0);
      map[k].deliveryRevenue += (o.deliveryFee || 0);
      map[k].platformFee += (o.platformFee || 0);
      map[k].count++;
    });
    return map;
  };

  const enrich = (map, type) => Object.entries(map).map(([id, s]) => {
    let name = '—';
    if (type === 'restaurant') name = db.prepare('SELECT name FROM restaurants WHERE id = ?').get(id)?.name || id;
    else if (type === 'driver') name = db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || id;
    return { id, name, ...(type === 'restaurant' ? { productRevenue: s.productRevenue, platformFee: s.platformFee, netRevenue: s.productRevenue - s.platformFee, count: s.count } : { revenue: s.deliveryRevenue, count: s.count }) };
  });

  const todayOrders = orders.filter(o => o.deliveredAt?.startsWith(today));
  const weekOrders = filter(orders, startOfWeek);
  const monthOrders = filter(orders, startOfMonth);

  res.json({
    daily: sumRevenue(todayOrders),
    weekly: sumRevenue(weekOrders),
    monthly: sumRevenue(monthOrders),
    total: sumRevenue(orders),
    restaurants: {
      today: enrich(groupBy(todayOrders, 'restaurantId'), 'restaurant'),
      week: enrich(groupBy(weekOrders, 'restaurantId'), 'restaurant'),
      month: enrich(groupBy(monthOrders, 'restaurantId'), 'restaurant'),
      all: enrich(groupBy(orders, 'restaurantId'), 'restaurant')
    },
    drivers: {
      today: enrich(groupBy(todayOrders, 'driverId'), 'driver'),
      week: enrich(groupBy(weekOrders, 'driverId'), 'driver'),
      month: enrich(groupBy(monthOrders, 'driverId'), 'driver'),
      all: enrich(groupBy(orders, 'driverId'), 'driver')
    }
  });
});

app.patch('/api/admin/orders/:id/approve', requireAuth, adminOnly, (req, res) => {
  db.prepare('UPDATE orders SET adminApproved = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.patch('/api/admin/orders/:id/reject', requireAuth, adminOnly, (req, res) => {
  const { reason } = req.body;
  db.prepare('UPDATE orders SET status = ?, cancelReason = ?, adminApproved = 0 WHERE id = ?').run('CANCELLED', reason || 'ألغاه الأدمن', req.params.id);
  io.emit('orderCancelled', { orderId: req.params.id });
  res.json({ success: true });
});

app.patch('/api/admin/orders/:id', requireAuth, adminOnly, (req, res) => {
  const { items, total, adminNotes, orderNotes } = req.body;
  if (items) db.prepare('UPDATE orders SET items = ? WHERE id = ?').run(JSON.stringify(items), req.params.id);
  if (total !== undefined) db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(Number(total), req.params.id);
  if (adminNotes !== undefined) db.prepare('UPDATE orders SET adminNotes = ? WHERE id = ?').run(adminNotes, req.params.id);
  if (orderNotes !== undefined) db.prepare('UPDATE orders SET orderNotes = ? WHERE id = ?').run(orderNotes, req.params.id);
  res.json({ success: true });
});

// --- تغيير حالة الطلب من الأدمن ---
app.patch('/api/admin/orders/:id/change-status', requireAuth, adminOnly, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const { status } = req.body;
  const allowedStatuses = ['PENDING','ACCEPTED','PREPARING','READY','DRIVER_ASSIGNED','ON_THE_WAY','DELIVERED','CANCELLED','INVOICE_ADDED'];
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });

  if (status === 'PREPARING') {
    db.prepare('UPDATE orders SET status = ?, preparingAt = ? WHERE id = ?').run(status, new Date().toISOString(), req.params.id);
  } else if (status === 'DELIVERED') {
    const productValue = (order.total || 0) - (order.deliveryFee || 0);
    const commission = Math.round(productValue * 0.2);
    db.prepare('UPDATE orders SET status = ?, platformFee = ?, deliveredAt = ? WHERE id = ?').run(status, commission, new Date().toISOString(), req.params.id);
    if (order.driverId) {
      db.prepare('UPDATE drivers SET earnings = earnings + ?, credit = credit - ? WHERE userId = ?').run(order.deliveryFee || 10, commission, order.driverId);
    }
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  io.emit('orderStatusUpdate', { orderId: order.id, status });
  res.json({ success: true });
});

// العملاء
app.get('/api/admin/customers', requireAuth, adminOnly, (req, res) => {
  const search = req.query.search || '';
  let query = "SELECT * FROM users WHERE role = 'CUSTOMER'";
  const params = [];
  if (search) {
    query += " AND (name LIKE ? OR phone LIKE ? OR address LIKE ?)";
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const customers = db.prepare(query).all(...params);
  const enriched = customers.map(u => {
    const region = u.regionId ? db.prepare('SELECT * FROM regions WHERE id = ?').get(u.regionId) : null;
    const orders = db.prepare('SELECT * FROM orders WHERE customerPhone = ?').all(u.phone);
    const lastOrder = orders.length ? orders.reduce((latest, o) => new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest) : null;
    return {
      id: u.id, name: u.name, phone: u.phone, regionId: u.regionId, regionName: region?.name || '—',
      regionFee: region?.fee || 0, address: u.address, totalOrders: orders.length, lastOrderDate: lastOrder?.createdAt || null
    };
  });
  res.json(enriched);
});

app.get('/api/admin/customers/:id', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'CUSTOMER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const region = user.regionId ? db.prepare('SELECT * FROM regions WHERE id = ?').get(user.regionId) : null;
  const orders = db.prepare('SELECT * FROM orders WHERE customerPhone = ?').all(user.phone);
  const lastOrder = orders.length ? orders.reduce((latest, o) => new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest) : null;
  // نعيد كلمة المرور للأدمن (لأيقونة العين)
  res.json({
    id: user.id, name: user.name, phone: user.phone, password: user.password,
    regionId: user.regionId, regionName: region?.name || '—', regionFee: region?.fee || 0,
    address: user.address, totalOrders: orders.length, lastOrderDate: lastOrder?.createdAt || null
  });
});

app.patch('/api/admin/customers/:id', requireAuth, adminOnly, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'CUSTOMER'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const { name, phone, regionId, address, password } = req.body;
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (phone) {
    if (db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone.trim(), req.params.id))
      return res.status(400).json({ error: 'الهاتف مستخدم' });
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone.trim(), req.params.id);
  }
  if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password.trim(), 10), req.params.id);
  if (regionId !== undefined) db.prepare('UPDATE users SET regionId = ? WHERE id = ?').run(regionId || null, req.params.id);
  if (address !== undefined) db.prepare('UPDATE users SET address = ? WHERE id = ?').run(address, req.params.id);
  res.json({ success: true });
});

// الأسواق والصيدليات
const manageStore = (storeType) => {
  const table = storeType === 'market' ? 'markets' : 'pharmacies';
  const role = storeType === 'market' ? 'MARKET' : 'PHARMACY';
  return (app) => {
    app.get(`/api/admin/${table}`, requireAuth, adminOnly, (req, res) => res.json(db.prepare(`SELECT * FROM ${table}`).all()));
    app.post(`/api/admin/${table}`, requireAuth, adminOnly, (req, res) => {
      const { name, ownerPhone, ownerPassword } = req.body;
      if (!name || !ownerPhone || !ownerPassword) return res.status(400).json({ error: 'بيانات ناقصة' });
      if (db.prepare('SELECT id FROM users WHERE phone = ?').get(ownerPhone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
      const userId = 'usr_' + uuidv4();
      const storeId = (storeType === 'market' ? 'market_' : 'pharm_') + uuidv4();
      db.prepare('INSERT INTO users (id, name, phone, password, role) VALUES (?,?,?,?,?)').run(userId, name, ownerPhone, bcrypt.hashSync(ownerPassword, 10), role);
      db.prepare(`INSERT INTO ${table} (id, userId, name) VALUES (?,?,?)`).run(storeId, userId, name);
      res.json({ id: storeId, name });
    });
    app.patch(`/api/admin/${table}/:id/toggle`, requireAuth, adminOnly, (req, res) => {
      const store = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      db.prepare(`UPDATE ${table} SET isOpen = ? WHERE id = ?`).run(store.isOpen ? 0 : 1, req.params.id);
      res.json({ success: true });
    });
    app.patch(`/api/admin/${table}/:id`, requireAuth, adminOnly, (req, res) => {
      const { name, ownerPhone } = req.body;
      const store = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      if (name) db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, req.params.id);
      if (ownerPhone) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(ownerPhone, store.userId);
      res.json({ success: true });
    });
    app.delete(`/api/admin/${table}/:id`, requireAuth, adminOnly, (req, res) => {
      const store = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(store.userId);
      res.json({ success: true });
    });
  };
};
manageStore('market')(app);
manageStore('pharmacy')(app);

// --- اوردرات المطاعم المباشرة (مفقود سابقاً) ---
app.get('/api/admin/restaurant-direct-orders', requireAuth, adminOnly, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE isDirect = 1").all();
  const enriched = orders.map(o => {
    let items = [];
    try { items = JSON.parse(o.items || '[]'); } catch(e) {}
    let attachments = [];
    try { attachments = JSON.parse(o.attachments || '[]'); } catch(e) {}
    return {
      ...o,
      items,
      attachments,
      restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : '—',
      driverName: o.driverId ? (db.prepare('SELECT name FROM users WHERE id = ?').get(o.driverId)?.name) : '—'
    };
  });
  res.json(enriched);
});

app.patch('/api/admin/restaurant-direct-orders/:id/assign-driver', requireAuth, adminOnly, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  db.prepare('UPDATE orders SET driverId = ?, status = ? WHERE id = ?').run(req.body.driverId, 'DRIVER_ASSIGNED', req.params.id);
  res.json({ success: true });
});

// --- إيرادات المنصة (مفقود سابقاً) ---
app.get('/api/admin/platform-revenue', requireAuth, adminOnly, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'DELIVERED' AND platformFee > 0").all();
  const total = orders.reduce((s, o) => s + (o.platformFee || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayTotal = orders.filter(o => o.deliveredAt?.startsWith(today)).reduce((s, o) => s + (o.platformFee || 0), 0);
  res.json({ total, today: todayTotal });
});

// ==================== RESTAURANT ROUTES ====================
app.get('/api/restaurant/profile', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  res.json({ id: restaurant.id, name: restaurant.name, logo: restaurant.logo });
});

app.patch('/api/restaurant/profile', requireAuth, upload.single('logo'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  if (req.body.name) db.prepare('UPDATE restaurants SET name = ? WHERE id = ?').run(req.body.name, restaurant.id);
  if (req.body.description !== undefined) db.prepare('UPDATE restaurants SET description = ? WHERE id = ?').run(req.body.description, restaurant.id);
  if (req.file) db.prepare('UPDATE restaurants SET logo = ? WHERE id = ?').run('/uploads/' + req.file.filename, restaurant.id);
  res.json(db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant.id));
});

app.get('/api/restaurant/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  let orders = db.prepare('SELECT * FROM orders WHERE restaurantId = ? AND adminApproved = 1').all(restaurant.id);
  if (req.query.date) orders = orders.filter(o => o.createdAt?.startsWith(req.query.date));
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items || '[]') })));
});

app.patch('/api/restaurant/orders/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'غير موجود' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant || order.restaurantId !== restaurant.id) return res.status(403).json({ error: 'ليس مطعمك' });
  const { status } = req.body;
  if (!['ACCEPTED','PREPARING','READY','CANCELLED'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  if (status === 'PREPARING') db.prepare('UPDATE orders SET status = ?, preparingAt = ? WHERE id = ?').run(status, new Date().toISOString(), req.params.id);
  else db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  io.emit('orderStatusUpdate', { orderId: order.id, status });
  if (status === 'ACCEPTED') io.emit('orderAccepted', { orderId: order.id });
  else if (status === 'CANCELLED') io.emit('orderCancelled', { orderId: order.id });
  res.json({ success: true });
});

app.post('/api/restaurant/order-from-restaurant', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const { customerName, customerPhone, regionName, address, orderPrice, deliveryFee, total, notes } = req.body;
  if (!customerName || !customerPhone || !address || !orderPrice || !deliveryFee || !total)
    return res.status(400).json({ error: 'بيانات ناقصة' });
  const orderNumber = getNextOrderNumber();
  const orderId = 'dir_' + uuidv4();
  db.prepare(`
    INSERT INTO orders (id, orderNumber, restaurantId, customerName, customerPhone, regionName, address, items, total, orderPrice, deliveryFee, paymentMethod, status, isDirect, notes, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderId, orderNumber, restaurant.id, customerName, customerPhone, regionName, address,
    JSON.stringify([{ name: 'أوردر مطعم', price: orderPrice, quantity: 1 }]),
    total, orderPrice, deliveryFee, 'CASH', 'PENDING', 1, notes || '', new Date().toISOString());
  io.emit('newOrder', { orderId, restaurantId: restaurant.id, customerName });
  sendWhatsAppMessage(`🍽️ طلب مطعم مباشر #${orderNumber}\n👤 ${customerName}\n📞 ${customerPhone}\n💰 ${total} ج`);
  res.json({ success: true, orderId });
});

app.get('/api/restaurant/my-direct-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  res.json(db.prepare('SELECT * FROM orders WHERE restaurantId = ? AND isDirect = 1').all(restaurant.id));
});

// تصنيفات ومنتجات المطعم
app.get('/api/restaurant/categories', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  res.json(db.prepare('SELECT * FROM categories WHERE restaurantId = ?').all(restaurant.id));
});

app.post('/api/restaurant/categories', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const id = 'cat_' + uuidv4();
  db.prepare('INSERT INTO categories (id, restaurantId, name) VALUES (?,?,?)').run(id, restaurant.id, name);
  res.json({ id, name, restaurantId: restaurant.id });
});

app.delete('/api/restaurant/categories/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  db.prepare('DELETE FROM categories WHERE id = ? AND restaurantId = ?').run(req.params.id, restaurant?.id);
  res.json({ success: true });
});

app.patch('/api/restaurant/categories/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (req.body.name) db.prepare('UPDATE categories SET name = ? WHERE id = ? AND restaurantId = ?').run(req.body.name, req.params.id, restaurant?.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

app.get('/api/restaurant/products', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const products = db.prepare('SELECT * FROM products WHERE restaurantId = ?').all(restaurant.id).map(p => ({ ...p, groups: JSON.parse(p.groups || '[]') }));
  res.json(products);
});

app.post('/api/restaurant/products', requireAuth, upload.single('image'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const { name, description, category, groups, basePrice } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });
  let groupsParsed = [];
  try { if (groups) groupsParsed = JSON.parse(groups); } catch(e) {}
  const imagePath = req.file ? '/uploads/' + req.file.filename : '';
  const id = 'prod_' + uuidv4();
  db.prepare('INSERT INTO products (id, restaurantId, name, description, basePrice, category, image, groups, type) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, restaurant.id, name, description || '', Number(basePrice) || 0, category || 'أخرى', imagePath, JSON.stringify(groupsParsed), groupsParsed.length ? 'multi' : 'single');
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

app.patch('/api/restaurant/products/:id', requireAuth, upload.single('image'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND restaurantId = ?').get(req.params.id, restaurant.id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
  const { name, description, category, isAvailable, groups, basePrice } = req.body;
  if (name) db.prepare('UPDATE products SET name = ? WHERE id = ?').run(name, product.id);
  if (description !== undefined) db.prepare('UPDATE products SET description = ? WHERE id = ?').run(description, product.id);
  if (category !== undefined) db.prepare('UPDATE products SET category = ? WHERE id = ?').run(category, product.id);
  if (isAvailable !== undefined) db.prepare('UPDATE products SET isAvailable = ? WHERE id = ?').run(isAvailable === 'true' || isAvailable === true ? 1 : 0, product.id);
  if (basePrice !== undefined) db.prepare('UPDATE products SET basePrice = ? WHERE id = ?').run(Number(basePrice), product.id);
  if (groups !== undefined) { try { db.prepare('UPDATE products SET groups = ? WHERE id = ?').run(JSON.stringify(JSON.parse(groups)), product.id); } catch(e) {} }
  if (req.file) db.prepare('UPDATE products SET image = ? WHERE id = ?').run('/uploads/' + req.file.filename, product.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
});

app.delete('/api/restaurant/products/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('DELETE FROM products WHERE id = ? AND restaurantId = ?').run(req.params.id, restaurant.id);
  res.json({ success: true });
});

app.get('/api/restaurant/reports', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const orders = db.prepare("SELECT * FROM orders WHERE restaurantId = ? AND adminApproved = 1 AND status = 'DELIVERED'").all(restaurant.id);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString().slice(0, 10);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const sum = (list) => {
    const pr = list.reduce((s, o) => s + (o.total - (o.deliveryFee || 0)), 0);
    const pf = list.reduce((s, o) => s + (o.platformFee || 0), 0);
    return { productRevenue: pr, platformFee: pf, netRevenue: pr - pf, totalOrders: list.length };
  };
  res.json({
    daily: sum(orders.filter(o => o.deliveredAt?.startsWith(today))),
    weekly: sum(orders.filter(o => o.deliveredAt >= startOfWeek)),
    monthly: sum(orders.filter(o => o.deliveredAt >= startOfMonth)),
    total: sum(orders)
  });
});

app.get('/api/restaurant/stats', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE userId = ?').get(req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const orders = db.prepare("SELECT * FROM orders WHERE restaurantId = ? AND adminApproved = 1").all(restaurant.id);
  const today = new Date().toISOString().slice(0, 10);
  const todayDelivered = orders.filter(o => o.status === 'DELIVERED' && o.deliveredAt?.startsWith(today));
  const revenue = todayDelivered.reduce((s, o) => s + (o.total - (o.deliveryFee || 0)), 0);
  const platformFee = todayDelivered.reduce((s, o) => s + (o.platformFee || 0), 0);
  res.json({
    pending: orders.filter(o => o.status === 'PENDING').length,
    accepted: orders.filter(o => o.status === 'ACCEPTED').length,
    preparing: orders.filter(o => o.status === 'PREPARING').length,
    ready: orders.filter(o => o.status === 'READY').length,
    todayOrders: todayDelivered.length,
    todayRevenue: revenue,
    todayPlatformFee: platformFee,
    todayNetRevenue: revenue - platformFee
  });
});

// ==================== DRIVER ROUTES ====================
app.get('/api/driver/available-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const mode = getSetting('dispatchMode', 'manual');
  if (mode === 'manual') return res.json([]);
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'READY' AND driverId IS NULL").all().map(o => ({
    ...o,
    restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : getStoreNameForOrder(o) || '—'
  }));
  res.json(orders);
});

app.get('/api/driver/my-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const orders = db.prepare("SELECT * FROM orders WHERE driverId = ? AND status IN ('DRIVER_ASSIGNED','ON_THE_WAY')").all(req.user.id).map(o => ({
    ...o,
    restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : getStoreNameForOrder(o) || '—'
  }));
  res.json(orders);
});

app.patch('/api/driver/orders/:id/accept', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'READY' AND driverId IS NULL").get(req.params.id);
  if (!order) return res.status(404).json({ error: 'غير متاح' });
  const driver = db.prepare('SELECT * FROM drivers WHERE userId = ?').get(req.user.id);
  if (!driver) return res.status(404).json({ error: 'لم يتم العثور على ملف السائق' });
  const productValue = (order.total || 0) - (order.deliveryFee || 0);
  const estimatedCommission = Math.round(productValue * 0.2);
  if ((driver.credit || 0) < estimatedCommission) {
    return res.status(400).json({ error: `رصيدك غير كافٍ (${driver.credit} ج). العمولة المتوقعة ${estimatedCommission} ج.` });
  }
  db.prepare("UPDATE orders SET driverId = ?, status = 'DRIVER_ASSIGNED' WHERE id = ?").run(req.user.id, req.params.id);
  io.emit('orderStatusUpdate', { orderId: order.id, status: 'DRIVER_ASSIGNED' });
  res.json({ success: true });
});

app.patch('/api/driver/orders/:id/status', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND driverId = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'غير موجود' });
  const { status } = req.body;
  if (!['ON_THE_WAY','DELIVERED'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  if (status === 'DELIVERED') {
    const productValue = (order.total || 0) - (order.deliveryFee || 0);
    const commission = Math.round(productValue * 0.2);
    db.prepare('UPDATE orders SET status = ?, platformFee = ?, deliveredAt = ? WHERE id = ?').run(status, commission, new Date().toISOString(), req.params.id);
    db.prepare('UPDATE drivers SET earnings = earnings + ?, credit = credit - ? WHERE userId = ?').run(order.deliveryFee || 10, commission, req.user.id);
  } else {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  io.emit('orderStatusUpdate', { orderId: order.id, status });
  res.json({ success: true });
});

app.get('/api/driver/earnings', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const driver = db.prepare('SELECT earnings FROM drivers WHERE userId = ?').get(req.user.id);
  if (req.query.today === 'true') {
    const today = new Date().toISOString().slice(0, 10);
    const todayEarnings = db.prepare("SELECT COALESCE(SUM(deliveryFee),0) as total FROM orders WHERE driverId = ? AND status = 'DELIVERED' AND deliveredAt LIKE ?").get(req.user.id, today + '%').total;
    return res.json({ total: todayEarnings, isToday: true });
  }
  res.json({ total: driver?.earnings || 0 });
});

app.get('/api/driver/profile', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const user = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(req.user.id);
  const driver = db.prepare('SELECT isAvailable, earnings, credit FROM drivers WHERE userId = ?').get(req.user.id);
  res.json({ ...user, ...driver, isAvailable: !!driver?.isAvailable });
});

app.patch('/api/driver/toggle-status', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const driver = db.prepare('SELECT * FROM drivers WHERE userId = ?').get(req.user.id);
  if (!driver) return res.status(404).json({ error: 'غير موجود' });
  const newStatus = driver.isAvailable ? 0 : 1;
  db.prepare('UPDATE drivers SET isAvailable = ? WHERE userId = ?').run(newStatus, req.user.id);
  res.json({ isAvailable: !!newStatus });
});

app.get('/api/driver/history', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  let orders = db.prepare("SELECT * FROM orders WHERE driverId = ? AND status = 'DELIVERED'").all(req.user.id);
  if (req.query.date) orders = orders.filter(o => o.deliveredAt?.startsWith(req.query.date));
  orders.sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
  const enriched = orders.map(o => ({
    ...o,
    restaurantName: o.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(o.restaurantId)?.name) : getStoreNameForOrder(o) || '—'
  }));
  res.json(enriched);
});

app.post('/api/driver/recharge-request', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const { amount, last4digits } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'المبلغ غير صالح' });
  if (!last4digits || !/^\d{4}$/.test(last4digits)) return res.status(400).json({ error: 'آخر 4 أرقام غير صحيحة' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const id = 'req_' + uuidv4();
  db.prepare('INSERT INTO rechargeRequests (id, driverId, driverName, driverPhone, amount, last4digits, createdAt) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user.id, user.name, user.phone, Number(amount), last4digits.trim(), new Date().toISOString());
  res.json({ success: true, message: 'تم إرسال طلب الشحن' });
});

// ==================== CUSTOMER & PUBLIC ====================
app.get('/api/restaurants', (req, res) => {
  const list = db.prepare("SELECT id, name, logo FROM restaurants WHERE isOpen = 1 AND visible = 1 ORDER BY \"order\"").all();
  res.json(list.map(r => ({ ...r, logo: r.logo || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=150&h=150&fit=crop' })));
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });

  // جلب تصنيفات المطعم لتحويل المعرفات إلى أسماء
  const categories = db.prepare('SELECT id, name FROM categories WHERE restaurantId = ?').all(restaurant.id);
  const categoryMap = new Map(categories.map(c => [c.id, c.name]));

  let products = db.prepare('SELECT * FROM products WHERE restaurantId = ? AND isAvailable = 1')
    .all(restaurant.id)
    .map(p => {
      let categoryName = p.category || 'عام';
      // إذا كانت قيمة التصنيف معرّفاً موجوداً في التصنيفات، استبدله بالاسم
      if (categoryMap.has(categoryName)) {
        categoryName = categoryMap.get(categoryName);
      }
      return { ...p, category: categoryName, groups: JSON.parse(p.groups || '[]') };
    });

  res.json(products);
});

app.get('/api/markets', (req, res) => res.json(db.prepare('SELECT * FROM markets WHERE isOpen = 1').all()));
app.get('/api/pharmacies', (req, res) => res.json(db.prepare('SELECT * FROM pharmacies WHERE isOpen = 1').all()));

app.post('/api/orders/special', upload.array('files', 10), (req, res) => {
  let orderData;
  try { orderData = JSON.parse(req.body.orderData); } catch(e) { return res.status(400).json({ error: 'بيانات غير صحيحة' }); }
  const { orderType, storeId, items, orderNotes, customerName, customerPhone, address, regionName, paymentMethod, deliveryFee, total, lastDigits, transactionId, extraFee } = orderData;
  if (!customerName || !customerPhone) return res.status(400).json({ error: 'بيانات العميل ناقصة' });
  const files = req.files || [];
  const attachments = files.map(f => '/uploads/special_orders/' + f.filename);
  const orderNumber = getNextOrderNumber();
  const orderId = 'ord_' + uuidv4();
  db.prepare(`
    INSERT INTO orders (id, orderNumber, type, orderType, storeId, items, orderNotes, attachments, customerName, customerPhone, address, regionName, paymentMethod, deliveryFee, total, lastDigits, transactionId, extraFee, status, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderId, orderNumber, 'special', orderType, storeId, JSON.stringify(items || []), orderNotes, JSON.stringify(attachments), customerName, customerPhone, address, regionName, paymentMethod || 'CASH', deliveryFee || 10, total, lastDigits, transactionId, extraFee, 'PENDING', new Date().toISOString());
  io.emit('newSpecialOrder', { orderId, orderType, storeId });
  sendWhatsAppMessage(`📦 طلب خاص #${orderNumber}\n👤 ${customerName}\n📞 ${customerPhone}\n🏪 ${orderType === 'market' ? 'ماركت' : 'صيدلية'}\n💰 ${total} ج`);
  res.json({ success: true, orderId });
});

function customerAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (token) { try { req.customer = jwt.verify(token, JWT_SECRET); } catch(e) {} }
  next();
}

app.post('/api/orders', customerAuth, (req, res) => {
  let { restaurantId, items, total, customerName, customerPhone, address, paymentMethod, deliveryFee, regionName, lastDigits, transactionId, extraFee } = req.body;
  if (req.customer) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.customer.id);
    if (user) {
      customerName = user.name;
      customerPhone = user.phone;
      if (!address) address = user.address;
      if (!deliveryFee && user.regionId) {
        const region = db.prepare('SELECT fee FROM regions WHERE id = ?').get(user.regionId);
        if (region) deliveryFee = region.fee;
      }
    }
  }
  if (!restaurantId || !total || !customerName || !customerPhone || !address) return res.status(400).json({ error: 'بيانات ناقصة' });
  const restaurant = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(restaurantId);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const orderNumber = getNextOrderNumber();
  const orderId = 'ord_' + uuidv4();
  db.prepare(`
    INSERT INTO orders (id, orderNumber, restaurantId, items, total, customerName, customerPhone, address, regionName, paymentMethod, deliveryFee, lastDigits, transactionId, extraFee, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderId, orderNumber, restaurantId, JSON.stringify(items || []), Number(total), customerName, customerPhone, address, regionName || '', paymentMethod || 'CASH', deliveryFee || 10, lastDigits, transactionId, extraFee, new Date().toISOString());
  io.emit('newOrder', { orderId, restaurantId, customerName });
  const rest = db.prepare('SELECT name FROM restaurants WHERE id = ?').get(restaurantId);
  sendWhatsAppMessage(`🛵 طلب جديد #${orderNumber}\n👤 ${customerName}\n📞 ${customerPhone}\n🍽️ ${rest?.name || '—'}\n💰 ${total} ج`);
  res.json({ success: true, orderId });
});

app.get('/api/orders/:id/track', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'غير موجود' });
  let items = [];
  try { items = JSON.parse(order.items || '[]'); } catch(e) {}
  let attachments = [];
  try { attachments = JSON.parse(order.attachments || '[]'); } catch(e) {}
  const restaurantName = order.restaurantId ? (db.prepare('SELECT name FROM restaurants WHERE id = ?').get(order.restaurantId)?.name) : getStoreNameForOrder(order);
  res.json({ ...order, items, attachments, restaurantName });
});

app.get('/api/regions', (req, res) => res.json(db.prepare('SELECT * FROM regions').all()));

app.post('/api/customer/register', authLimiter, (req, res) => {
  const { name, phone, password, regionId, address } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'cus_' + uuidv4();
  db.prepare('INSERT INTO users (id, name, phone, password, role, regionId, address) VALUES (?,?,?,?,?,?,?)')
    .run(userId, name, phone, bcrypt.hashSync(password, 10), 'CUSTOMER', regionId || null, address || '');
  const token = jwt.sign({ id: userId, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true, token, name, phone, regionId: regionId || '', address: address || '' });
});

app.post('/api/customer/login', authLimiter, (req, res) => {
  const { phone, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND role = 'CUSTOMER'").get(phone);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: user.id, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ success: true, token, name: user.name, phone: user.phone, regionId: user.regionId || '', address: user.address || '' });
});

// ==================== MARKET & PHARMACY PROFILE ====================
const storeProfileRoutes = (storeType) => {
  const table = storeType === 'market' ? 'markets' : 'pharmacies';
  const role = storeType === 'market' ? 'MARKET' : 'PHARMACY';
  return (app) => {
    app.get(`/api/${storeType}/profile`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      const owner = db.prepare('SELECT phone FROM users WHERE id = ?').get(store.userId);
      res.json({ id: store.id, name: store.name, logo: store.logo, ownerPhone: owner?.phone });
    });
    app.patch(`/api/${storeType}/profile`, requireAuth, upload.single('logo'), (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      if (req.body.name) db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(req.body.name, store.id);
      if (req.file) db.prepare(`UPDATE ${table} SET logo = ? WHERE id = ?`).run('/uploads/' + req.file.filename, store.id);
      res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(store.id));
    });
    app.get(`/api/${storeType}/orders`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store) return res.status(404).json({ error: 'غير موجود' });
      const orders = db.prepare("SELECT * FROM orders WHERE type = 'special' AND storeId = ?").all(store.id).map(o => ({ ...o, items: JSON.parse(o.items || '[]') }));
      res.json(orders);
    });
    app.patch(`/api/${storeType}/orders/:id/items`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store || order.storeId !== store.id) return res.status(403).json({ error: 'ليس طلبك' });
      if (req.body.items) db.prepare('UPDATE orders SET items = ? WHERE id = ?').run(JSON.stringify(req.body.items), order.id);
      if (req.body.total !== undefined) db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(req.body.total, order.id);
      io.emit('orderStatusUpdate', { orderId: order.id });
      res.json({ success: true });
    });
    app.patch(`/api/${storeType}/orders/:id/accept`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store || order.storeId !== store.id) return res.status(403).json({ error: 'ليس طلبك' });
      db.prepare("UPDATE orders SET status = 'ACCEPTED' WHERE id = ?").run(order.id);
      io.emit('orderStatusUpdate', { orderId: order.id, status: 'ACCEPTED' });
      res.json({ success: true });
    });
    app.patch(`/api/${storeType}/orders/:id/invoice`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store || order.storeId !== store.id) return res.status(403).json({ error: 'ليس طلبك' });
      const { invoiceAmount } = req.body;
      const newTotal = parseFloat(invoiceAmount) + (order.deliveryFee || 0);
      db.prepare('UPDATE orders SET invoiceAmount = ?, invoiceBy = ?, total = ?, status = ? WHERE id = ?')
        .run(invoiceAmount, store.name, newTotal, 'INVOICE_ADDED', order.id);
      io.emit('orderStatusUpdate', { orderId: order.id, status: 'INVOICE_ADDED' });
      res.json({ success: true });
    });
    app.patch(`/api/${storeType}/orders/:id/ready`, requireAuth, (req, res) => {
      if (req.user.role !== role) return res.status(403).json({ error: 'غير مسموح' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      const store = db.prepare(`SELECT * FROM ${table} WHERE userId = ?`).get(req.user.id);
      if (!store || order.storeId !== store.id) return res.status(403).json({ error: 'ليس طلبك' });
      db.prepare("UPDATE orders SET status = 'READY' WHERE id = ?").run(order.id);
      io.emit('orderStatusUpdate', { orderId: order.id, status: 'READY' });
      res.json({ success: true });
    });
  };
};
storeProfileRoutes('market')(app);
storeProfileRoutes('pharmacy')(app);

// --- التحديث التلقائي لحالة الطلب (PREPARING -> READY) ---
setInterval(() => {
  const now = new Date().toISOString();
  const updated = db.prepare(`
    UPDATE orders SET status = 'READY'
    WHERE status = 'PREPARING' AND preparingAt IS NOT NULL
    AND (strftime('%s', ?) - strftime('%s', preparingAt)) >= 1500
  `).run(now);
  if (updated.changes > 0) {
    const readyOrders = db.prepare("SELECT id FROM orders WHERE status = 'READY' AND driverId IS NULL").all();
    readyOrders.forEach(o => io.emit('orderStatusUpdate', { orderId: o.id, status: 'READY' }));
    io.emit('driver:newJob', { count: readyOrders.length });
  }
}, 60000);

// معالج أخطاء multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'خطأ في رفع الملف: ' + err.message });
  else if (err) return res.status(500).json({ error: err.message });
  next();
});

io.on('connection', (socket) => { console.log('عميل متصل:', socket.id); });

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Drako server on port ${PORT}`));
