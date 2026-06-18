const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_FILE = './data.json';
const DB_PATH = './drako.db';

if (!fs.existsSync(DATA_FILE)) {
  console.error('data.json غير موجود!');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const db = new Database(DB_PATH);

// إنشاء الجداول لو مش موجودة
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, phone TEXT UNIQUE, password TEXT, role TEXT, regionId TEXT, address TEXT DEFAULT '', isActive INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS restaurants (id TEXT PRIMARY KEY, userId TEXT UNIQUE, name TEXT, logo TEXT DEFAULT '', description TEXT DEFAULT '', isOpen INTEGER DEFAULT 1, visible INTEGER DEFAULT 1, "order" INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS markets (id TEXT PRIMARY KEY, userId TEXT UNIQUE, name TEXT, logo TEXT DEFAULT '', isOpen INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS pharmacies (id TEXT PRIMARY KEY, userId TEXT UNIQUE, name TEXT, logo TEXT DEFAULT '', isOpen INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS drivers (id TEXT PRIMARY KEY, userId TEXT UNIQUE, earnings REAL DEFAULT 0, credit REAL DEFAULT 0, isAvailable INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, orderNumber INTEGER, type TEXT DEFAULT 'restaurant', orderType TEXT, storeId TEXT, restaurantId TEXT, customerName TEXT, customerPhone TEXT, address TEXT, regionName TEXT DEFAULT '', items TEXT DEFAULT '[]', total REAL DEFAULT 0, orderPrice REAL, deliveryFee REAL DEFAULT 0, platformFee REAL DEFAULT 0, paymentMethod TEXT DEFAULT 'CASH', status TEXT DEFAULT 'PENDING', driverId TEXT, adminApproved INTEGER DEFAULT 0, isDirect INTEGER DEFAULT 0, invoiceAmount REAL, invoiceBy TEXT, notes TEXT DEFAULT '', orderNotes TEXT DEFAULT '', adminNotes TEXT DEFAULT '', cancelReason TEXT, lastDigits TEXT, transactionId TEXT, extraFee REAL, attachments TEXT DEFAULT '[]', createdAt TEXT, preparingAt TEXT, deliveredAt TEXT);
  CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, restaurantId TEXT, name TEXT, description TEXT DEFAULT '', basePrice REAL DEFAULT 0, category TEXT DEFAULT 'أخرى', image TEXT DEFAULT '', isAvailable INTEGER DEFAULT 1, groups TEXT DEFAULT '[]', type TEXT DEFAULT 'single');
  CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, restaurantId TEXT, name TEXT);
  CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, fee REAL);
  CREATE TABLE IF NOT EXISTS rechargeRequests (id TEXT PRIMARY KEY, driverId TEXT, driverName TEXT, driverPhone TEXT, amount REAL, last4digits TEXT, status TEXT DEFAULT 'PENDING', createdAt TEXT, processedAt TEXT);
  CREATE TABLE IF NOT EXISTS dailyOrderCounter (date TEXT PRIMARY KEY, counter INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

// دوال الإدراج
const insertUser = db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?,?)');
const insertRestaurant = db.prepare('INSERT OR IGNORE INTO restaurants VALUES (?,?,?,?,?,?,?,?)');
const insertMarket = db.prepare('INSERT OR IGNORE INTO markets VALUES (?,?,?,?,?)');
const insertPharmacy = db.prepare('INSERT OR IGNORE INTO pharmacies VALUES (?,?,?,?,?)');
const insertDriver = db.prepare('INSERT OR IGNORE INTO drivers VALUES (?,?,?,?,?)');
const insertProduct = db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,?,?,?,?,?,?,?)');
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories VALUES (?,?,?)');
const insertRegion = db.prepare('INSERT OR IGNORE INTO regions VALUES (?,?,?)');
const insertOrder = db.prepare(`INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertRecharge = db.prepare('INSERT OR IGNORE INTO rechargeRequests VALUES (?,?,?,?,?,?,?,?,?)');

// نقل المستخدمين
(data.users || []).forEach(u => insertUser.run(u.id, u.name, u.phone, u.password, u.role, u.regionId || null, u.address || '', u.isActive != null ? (u.isActive ? 1 : 0) : 1));

// المطاعم
(data.restaurants || []).forEach(r => insertRestaurant.run(r.id, r.userId, r.name, r.logo || '', r.description || '', r.isOpen ? 1 : 0, r.visible != null ? (r.visible ? 1 : 0) : 1, r.order || 0));

// الأسواق والصيدليات
(data.markets || []).forEach(m => insertMarket.run(m.id, m.userId, m.name, m.logo || '', m.isOpen ? 1 : 0));
(data.pharmacies || []).forEach(p => insertPharmacy.run(p.id, p.userId, p.name, p.logo || '', p.isOpen ? 1 : 0));

// السائقين
(data.drivers || []).forEach(d => insertDriver.run(d.id, d.userId, d.earnings || 0, d.credit || 0, d.isAvailable != null ? (d.isAvailable ? 1 : 0) : 1));

// المنتجات
(data.products || []).forEach(p => {
  insertProduct.run(p.id, p.restaurantId, p.name, p.description || '', p.price || p.basePrice || 0, p.category || 'أخرى', p.image || '', p.isAvailable != null ? (p.isAvailable ? 1 : 0) : 1, JSON.stringify(p.groups || []), p.type || (p.groups?.length ? 'multi' : 'single'));
});

// التصنيفات
(data.categories || []).forEach(c => insertCategory.run(c.id, c.restaurantId || '', c.name));

// المناطق (لنحتفظ بالمناطق الافتراضية لو موجودة)
(data.regions || []).forEach(r => insertRegion.run(r.id, r.name, r.fee));

// الطلبات
(data.orders || []).forEach(o => {
  insertOrder.run(
    o.id, o.orderNumber, o.type || 'restaurant', o.orderType || null, o.storeId || null, o.restaurantId || null,
    o.customerName, o.customerPhone, o.address, o.regionName || '',
    JSON.stringify(o.items || []), o.total || 0, o.orderPrice || null, o.deliveryFee || 0,
    o.platformFee || 0, o.paymentMethod || 'CASH', o.status || 'PENDING', o.driverId || null,
    o.adminApproved ? 1 : 0, o.isDirect ? 1 : 0, o.invoiceAmount || null, o.invoiceBy || null,
    o.notes || '', o.orderNotes || '', o.adminNotes || '', o.cancelReason || null,
    o.lastDigits || null, o.transactionId || null, o.extraFee || null,
    JSON.stringify(o.attachments || []), o.createdAt || new Date().toISOString(),
    o.preparingAt || null, o.deliveredAt || null
  );
});

// طلبات الشحن
(data.rechargeRequests || []).forEach(r => insertRecharge.run(r.id, r.driverId, r.driverName, r.driverPhone, r.amount, r.last4digits, r.status, r.createdAt, r.processedAt || null));

// عداد الطلبات اليومي
if (data.dailyOrderCounter) {
  db.prepare('INSERT OR REPLACE INTO dailyOrderCounter VALUES (?,?)').run(data.dailyOrderCounter.date, data.dailyOrderCounter.counter);
}

// إعدادات النظام
if (data.dispatchMode) {
  db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run('dispatchMode', data.dispatchMode);
}

console.log('✅ تم نقل جميع البيانات بنجاح من data.json إلى drako.db');
db.close();
