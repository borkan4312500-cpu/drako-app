require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// الثقة بالبروكسي (مهم للنطاقات مثل drako0.com)
app.set('trust proxy', 1);

// --- إعداد المجلدات الأساسية ---
const SOUNDS_DIR = path.join(__dirname, 'sounds');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// --- Multer للمرفقات العامة ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dir = UPLOADS_DIR;
    if (req.originalUrl.includes('/orders/special')) {
      dir = path.join(dir, 'special_orders');
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// --- Multer لملفات الصوت (حفظ دائمًا بامتداد mp3) ---
const soundStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR);
    cb(null, SOUNDS_DIR);
  },
  filename: function (req, file, cb) {
    const event = req.body.event;
    cb(null, event + '.mp3'); // حفظ دائمًا بامتداد mp3
  }
});
const soundUpload = multer({
  storage: soundStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('فقط ملفات الصوت مسموحة'));
  }
});

// --- خدمة المجلدات الثابتة ---
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/sounds', express.static(SOUNDS_DIR));

const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'drako_secret_key_fallback';

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
    } catch (e) { /* منتهي */ }
  }
  next();
});

// ================== دوال قراءة وكتابة البيانات ==================
function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [],
      restaurants: [],
      markets: [],
      pharmacies: [],
      drivers: [],
      orders: [],
      products: [],
      categories: [],
      regions: [
        { id: 'reg_1', name: 'مساكن جمصة', fee: 10 },
        { id: 'reg_2', name: '15 مايو', fee: 15 },
        { id: 'reg_3', name: 'المنصورة الجديدة', fee: 20 },
        { id: 'reg_4', name: 'الدلتا', fee: 25 },
        { id: 'reg_5', name: 'الشيخ زايد', fee: 30 }
      ],
      rechargeRequests: [],
      dailyOrderCounter: { date: new Date().toISOString().slice(0,10), counter: 0 }
    };
    initial.users.push({
      id: "admin1",
      name: "أدمن دراكو",
      phone: "01000000000",
      password: bcrypt.hashSync("123456", 10),
      role: "ADMIN"
    });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.products) data.products = [];
  if (!data.categories) data.categories = [];
  if (!data.regions) data.regions = [];
  if (!data.markets) data.markets = [];
  if (!data.pharmacies) data.pharmacies = [];
  if (!data.rechargeRequests) data.rechargeRequests = [];
  if (!data.dailyOrderCounter) data.dailyOrderCounter = { date: new Date().toISOString().slice(0,10), counter: 0 };
  const adminUser = data.users.find(u => u.phone === '01000000000');
  if (adminUser && adminUser.role !== 'ADMIN') adminUser.role = 'ADMIN';
  return data;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// دالة مساعدة للحصول على رقم الطلب اليومي التصاعدي
function getNextOrderNumber() {
  const data = readData();
  const today = new Date().toISOString().slice(0,10);
  if (data.dailyOrderCounter.date !== today) {
    data.dailyOrderCounter = { date: today, counter: 0 };
  }
  data.dailyOrderCounter.counter += 1;
  writeData(data);
  return data.dailyOrderCounter.counter;
}

// ================== Middlewares ==================
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

// ================== الصفحات الثابتة ==================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'customer.html')));
app.get('/customer', (req, res) => res.sendFile(path.join(__dirname, 'customer.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/restaurant', (req, res) => res.sendFile(path.join(__dirname, 'restaurant.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(__dirname, 'driver.html')));
app.get('/market', (req, res) => res.sendFile(path.join(__dirname, 'market.html')));
app.get('/pharmacy', (req, res) => res.sendFile(path.join(__dirname, 'pharmacy.html')));

// ================== نقطة تسجيل الدخول الموحدة (JSON فقط) ==================
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  const data = readData();
  const user = data.users.find(u => u.phone === phone);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'بيانات خاطئة' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/'); });

app.get('/api/whoami', requireAuth, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'مستخدم غير موجود' });
  res.json({ token: jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '365d' }), user: { id: user.id, name: user.name, role: user.role } });
});

// ==================== ADMIN ====================
app.get('/api/admin/stats', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  res.json({ users: data.users.length, restaurants: data.restaurants.length, drivers: data.drivers.length, orders: data.orders.length, totalRevenue: data.orders.reduce((s, o) => s + (o.total || 0), 0) });
});

app.get('/api/admin/dashboard', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = data.orders.filter(o => o.createdAt?.startsWith(today));
  const activeOrders = data.orders.filter(o => ['PENDING','ACCEPTED','PREPARING','READY','DRIVER_ASSIGNED','ON_THE_WAY'].includes(o.status));
  const availableDrivers = data.users.filter(u => u.role === 'DRIVER').map(u => {
    const dp = data.drivers.find(d => d.userId === u.id) || {};
    const activeCount = data.orders.filter(o => o.driverId === u.id && !['DELIVERED','CANCELLED'].includes(o.status)).length;
    return { id: u.id, name: u.name, phone: u.phone, earnings: dp.earnings || 0, credit: dp.credit || 0, isAvailable: dp.isAvailable !== false, isActive: u.isActive !== false, activeOrdersCount: activeCount };
  });
  res.json({ todayOrders: todayOrders.length, activeOrders: activeOrders.length, restaurants: data.restaurants.length, drivers: data.drivers.length, totalRevenue: data.orders.reduce((s, o) => s + (o.total || 0), 0), recentOrders: data.orders.slice(-10).reverse(), availableDrivers });
});

// --- المطاعم (أدمن) ---
app.get('/api/admin/restaurants', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const list = data.restaurants.map(r => {
    const owner = data.users.find(u => u.id === r.userId);
    return { ...r, ownerName: owner?.name, ownerPhone: owner?.phone };
  });
  res.json(list);
});
app.post('/api/admin/restaurants', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name, ownerPhone, ownerPassword } = req.body;
  if (!name || !ownerPhone || !ownerPassword) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (data.users.find(u => u.phone === ownerPhone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + Date.now();
  const restaurantId = 'res_' + Date.now();
  const hashed = bcrypt.hashSync(ownerPassword, 10);
  data.users.push({ id: userId, name, phone: ownerPhone, password: hashed, role: 'RESTAURANT' });
  data.restaurants.push({ id: restaurantId, userId, name, isOpen: true });
  writeData(data);
  res.json({ id: restaurantId, name });
});
app.patch('/api/admin/restaurants/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const restaurant = data.restaurants.find(r => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  restaurant.isOpen = !restaurant.isOpen;
  writeData(data);
  res.json({ isOpen: restaurant.isOpen });
});
app.patch('/api/admin/restaurants/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const restaurant = data.restaurants.find(r => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'غير موجود' });
  const { name, ownerPhone } = req.body;
  if (name) restaurant.name = name;
  if (ownerPhone) {
    const user = data.users.find(u => u.id === restaurant.userId);
    if (user) user.phone = ownerPhone;
  }
  writeData(data);
  res.json({ success: true });
});
app.delete('/api/admin/restaurants/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.restaurants.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  const restaurant = data.restaurants[idx];
  const userIndex = data.users.findIndex(u => u.id === restaurant.userId);
  if (userIndex !== -1) data.users.splice(userIndex, 1);
  data.restaurants.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// --- الطيارين (أدمن) ---
app.get('/api/admin/drivers', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const list = data.users.filter(u => u.role === 'DRIVER').map(u => {
    const dp = data.drivers.find(d => d.userId === u.id) || {};
    const activeOrders = data.orders.filter(o => o.driverId === u.id && !['DELIVERED','CANCELLED'].includes(o.status));
    return { id: u.id, name: u.name, phone: u.phone, earnings: dp.earnings || 0, credit: dp.credit || 0, isAvailable: dp.isAvailable !== false, isActive: u.isActive !== false, activeOrdersCount: activeOrders.length };
  });
  res.json(list);
});
app.post('/api/admin/drivers', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (data.users.find(u => u.phone === phone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + Date.now();
  const driverId = 'drv_' + Date.now();
  const hashed = bcrypt.hashSync(password, 10);
  data.users.push({ id: userId, name, phone, password: hashed, role: 'DRIVER' });
  data.drivers.push({ id: driverId, userId, earnings: 0, credit: 0, isAvailable: true });
  writeData(data);
  res.json({ id: userId, name });
});
app.patch('/api/admin/drivers/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'DRIVER');
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const dp = data.drivers.find(d => d.userId === user.id);
  if (dp) dp.isAvailable = !dp.isAvailable;
  writeData(data);
  res.json({ isAvailable: dp?.isAvailable ?? false });
});
app.patch('/api/admin/drivers/:id/block', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'DRIVER');
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  user.isActive = !user.isActive;
  writeData(data);
  res.json({ isActive: user.isActive });
});
app.patch('/api/admin/drivers/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'DRIVER');
  if (!user) return res.status(404).json({ error: 'غير موجود' });
  const { name, phone, password } = req.body;
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (password) user.password = bcrypt.hashSync(password, 10);
  writeData(data);
  res.json({ success: true });
});
app.delete('/api/admin/drivers/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const userIndex = data.users.findIndex(u => u.id === req.params.id && u.role === 'DRIVER');
  if (userIndex === -1) return res.status(404).json({ error: 'غير موجود' });
  const driverIndex = data.drivers.findIndex(d => d.userId === req.params.id);
  if (driverIndex !== -1) data.drivers.splice(driverIndex, 1);
  data.users.splice(userIndex, 1);
  writeData(data);
  res.json({ success: true });
});
app.get('/api/admin/drivers/:id/details', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'DRIVER');
  if (!user) return res.status(404).json({ error: 'الطيار غير موجود' });
  const driver = data.drivers.find(d => d.userId === user.id) || {};
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = data.orders.filter(o =>
    o.driverId === user.id &&
    o.status === 'DELIVERED' &&
    o.deliveredAt && o.deliveredAt.startsWith(today)
  );
  const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0);
  const enrichedOrders = todayOrders.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt,
    customerName: o.customerName,
    total: o.total,
    deliveryFee: o.deliveryFee,
    restaurantName: data.restaurants.find(r => r.id === o.restaurantId)?.name || 'طلب خاص',
    address: o.address
  }));
  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    isAvailable: driver.isAvailable !== false,
    isActive: user.isActive !== false,
    earnings: driver.earnings || 0,
    credit: driver.credit || 0,
    todayOrdersCount: todayOrders.length,
    todayRevenue: todayRevenue,
    todayOrders: enrichedOrders
  });
});

// --- المناطق (أدمن) ---
app.get('/api/admin/regions', requireAuth, adminOnly, (req, res) => { const data = readData(); res.json(data.regions); });
app.post('/api/admin/regions', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name, fee } = req.body;
  if (!name || fee == null) return res.status(400).json({ error: 'بيانات ناقصة' });
  data.regions.push({ id: 'reg_' + Date.now(), name, fee: Number(fee) });
  writeData(data);
  res.json(data.regions);
});
app.patch('/api/admin/regions/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const region = data.regions.find(r => r.id === req.params.id);
  if (!region) return res.status(404).json({ error: 'غير موجود' });
  if (req.body.name !== undefined) region.name = req.body.name;
  if (req.body.fee !== undefined) region.fee = Number(req.body.fee);
  writeData(data);
  res.json(region);
});
app.delete('/api/admin/regions/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.regions.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  data.regions.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// --- المنتجات والتصنيفات (أدمن) ---
app.get('/api/admin/products', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const enriched = data.products.map(p => {
    const restaurant = data.restaurants.find(r => r.id === p.restaurantId);
    return { ...p, restaurantName: restaurant?.name };
  });
  res.json(enriched);
});
app.post('/api/admin/products', requireAuth, adminOnly, upload.single('image'), (req, res) => {
  const data = readData();
  const { name, description, price, category, restaurantId } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });
  const imagePath = req.file ? '/uploads/' + req.file.filename : '';
  const product = { id: 'prod_' + Date.now(), restaurantId, name, description: description || '', price: Number(price), category: category || 'أخرى', image: imagePath, isAvailable: true };
  data.products.push(product);
  writeData(data);
  res.json(product);
});
app.delete('/api/admin/products/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  data.products.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});
app.get('/api/admin/categories', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const enriched = data.categories.map(c => ({ ...c, restaurantName: data.restaurants.find(r => r.id === c.restaurantId)?.name }));
  res.json(enriched);
});
app.post('/api/admin/categories', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  data.categories.push({ id: 'cat_' + Date.now(), restaurantId: '', name });
  writeData(data);
  res.json({ success: true });
});
app.delete('/api/admin/categories/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.categories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  data.categories.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// --- إدارة الأصوات (أدمن) ---
app.post('/api/admin/upload-sound', requireAuth, adminOnly, soundUpload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  const event = req.body.event;
  if (!event) return res.status(400).json({ error: 'اسم الحدث مطلوب' });
  res.json({ success: true, event: event, filename: req.file.filename });
});

// --- طلبات الشحن (أدمن) ---
app.get('/api/admin/recharge-requests', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const status = req.query.status || 'PENDING';
  const requests = data.rechargeRequests.filter(r => r.status === status);
  res.json(requests);
});
app.patch('/api/admin/recharge-requests/:id/approve', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const reqItem = data.rechargeRequests.find(r => r.id === req.params.id);
  if (!reqItem) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (reqItem.status !== 'PENDING') return res.status(400).json({ error: 'تمت معالجته مسبقاً' });
  reqItem.status = 'APPROVED';
  reqItem.processedAt = new Date().toISOString();
  const driver = data.drivers.find(d => d.userId === reqItem.driverId);
  if (driver) driver.credit = (driver.credit || 0) + reqItem.amount;
  writeData(data);
  res.json({ success: true, message: 'تمت الموافقة وإضافة الرصيد' });
});
app.patch('/api/admin/recharge-requests/:id/reject', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const reqItem = data.rechargeRequests.find(r => r.id === req.params.id);
  if (!reqItem) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (reqItem.status !== 'PENDING') return res.status(400).json({ error: 'تمت معالجته مسبقاً' });
  reqItem.status = 'REJECTED';
  reqItem.processedAt = new Date().toISOString();
  writeData(data);
  res.json({ success: true, message: 'تم رفض الطلب' });
});

// --- الطلبات وتعيين طيار وتجريبي وتقارير ---
app.get('/api/orders', (req, res) => {
  const data = readData();
  const enriched = data.orders.map(o => ({
    ...o,
    restaurantName: data.restaurants.find(r => r.id === o.restaurantId)?.name,
    driverName: data.users.find(u => u.id === o.driverId)?.name || '—',
    customerName: o.customerName || data.users.find(u => u.phone === o.customerPhone)?.name
  }));
  res.json(enriched);
});
app.patch('/api/admin/orders/:id/assign-driver', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  order.driverId = req.body.driverId;
  order.status = 'DRIVER_ASSIGNED';
  writeData(data);
  res.json({ success: true });
});
app.post('/api/admin/test-order', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'اختر مطعماً' });
  const orderNumber = getNextOrderNumber();
  const order = {
    id: 'test_' + Date.now(),
    orderNumber,
    restaurantId,
    customerName: 'عميل تجريبي',
    customerPhone: '0100000000',
    address: 'العنوان التجريبي',
    regionName: '',
    items: [{ name: 'منتج تجريبي', price: 50, quantity: 2 }],
    total: 100,
    paymentMethod: 'CASH',
    status: 'PENDING',
    driverId: null,
    deliveryFee: 10,
    adminApproved: false,
    createdAt: new Date().toISOString(),
    deliveredAt: null
  };
  data.orders.push(order);
  writeData(data);
  res.json({ success: true, order });
});
app.get('/api/admin/reports/full', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const orders = data.orders.filter(o => o.status === 'DELIVERED');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString().slice(0, 10);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const todayOrders = orders.filter(o => o.deliveredAt?.startsWith(today));
  const weekOrders = orders.filter(o => o.deliveredAt && o.deliveredAt >= startOfWeek);
  const monthOrders = orders.filter(o => o.deliveredAt && o.deliveredAt >= startOfMonth);

  function calcStats(list) {
    const productRevenue = list.reduce((s, o) => s + (o.total - (o.deliveryFee || 0)), 0);
    const deliveryRevenue = list.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const platformFee = list.reduce((s, o) => s + (o.platformFee || 0), 0);
    return { productRevenue, deliveryRevenue, platformFee, totalRevenue: productRevenue + deliveryRevenue, count: list.length };
  }

  function groupBy(list, key) {
    const m = {};
    list.forEach(o => {
      const k = o[key];
      if (!k) return;
      if (!m[k]) m[k] = { productRevenue: 0, deliveryRevenue: 0, platformFee: 0, count: 0 };
      m[k].productRevenue += (o.total || 0) - (o.deliveryFee || 0);
      m[k].deliveryRevenue += (o.deliveryFee || 0);
      m[k].platformFee += (o.platformFee || 0);
      m[k].count++;
    });
    return m;
  }

  function enrich(g, type) {
    return Object.entries(g).map(([id, s]) => {
      let name = '—';
      if (type === 'restaurant') {
        const r = data.restaurants.find(r => r.id === id);
        name = r?.name || id;
        return { id, name, productRevenue: s.productRevenue, platformFee: s.platformFee, netRevenue: s.productRevenue - s.platformFee, count: s.count };
      } else if (type === 'driver') {
        const d = data.users.find(u => u.id === id);
        name = d?.name || id;
        return { id, name, revenue: s.deliveryRevenue, count: s.count };
      }
      return { id, name, revenue: 0, count: 0 };
    });
  }

  res.json({
    daily: calcStats(todayOrders),
    weekly: calcStats(weekOrders),
    monthly: calcStats(monthOrders),
    total: calcStats(orders),
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
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  order.adminApproved = true;
  writeData(data);
  res.json({ success: true });
});

app.patch('/api/admin/orders/:id/reject', requireAuth, adminOnly, (req, res) => {
  const { reason } = req.body;
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  order.status = 'CANCELLED';
  order.cancelReason = reason || 'ألغاه الأدمن';
  order.adminApproved = false;
  writeData(data);
  io.emit('orderCancelled', { orderId: order.id });
  res.json({ success: true });
});

app.patch('/api/admin/orders/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const { items, total, adminNotes, orderNotes } = req.body;
  if (items !== undefined) order.items = items;
  if (total !== undefined) order.total = Number(total);
  if (adminNotes !== undefined) order.adminNotes = adminNotes;
  if (orderNotes !== undefined) order.orderNotes = orderNotes;
  writeData(data);
  res.json({ success: true });
});

// --- العملاء (أدمن) ---
app.get('/api/admin/customers', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const search = req.query.search || '';
  let customers = data.users.filter(u => u.role === 'CUSTOMER');
  if (search) {
    const q = search.toLowerCase();
    customers = customers.filter(u => u.name.toLowerCase().includes(q) || u.phone.includes(q) || (u.address || '').toLowerCase().includes(q));
  }
  const enriched = customers.map(u => {
    const region = data.regions.find(r => r.id === u.regionId);
    const orders = data.orders.filter(o => o.customerPhone === u.phone);
    const lastOrder = orders.length ? orders.reduce((latest, o) => new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest) : null;
    return { id: u.id, name: u.name, phone: u.phone, regionId: u.regionId || '', regionName: region ? region.name : '—', regionFee: region ? region.fee : 0, address: u.address || '—', totalOrders: orders.length, lastOrderDate: lastOrder ? lastOrder.createdAt : null };
  });
  res.json(enriched);
});
app.get('/api/admin/customers/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'CUSTOMER');
  if (!user) return res.status(404).json({ error: 'العميل غير موجود' });
  const region = data.regions.find(r => r.id === user.regionId);
  const orders = data.orders.filter(o => o.customerPhone === user.phone);
  const lastOrder = orders.length ? orders.reduce((latest, o) => new Date(o.createdAt) > new Date(latest.createdAt) ? o : latest) : null;
  res.json({ id: user.id, name: user.name, phone: user.phone, regionId: user.regionId || '', regionName: region ? region.name : '—', regionFee: region ? region.fee : 0, address: user.address || '—', totalOrders: orders.length, lastOrderDate: lastOrder ? lastOrder.createdAt : null });
});
app.patch('/api/admin/customers/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id && u.role === 'CUSTOMER');
  if (!user) return res.status(404).json({ error: 'العميل غير موجود' });
  const { name, phone, regionId, address } = req.body;
  if (name !== undefined) { if (!name.trim()) return res.status(400).json({ error: 'الاسم لا يمكن أن يكون فارغاً' }); user.name = name.trim(); }
  if (phone !== undefined) { if (!phone.trim()) return res.status(400).json({ error: 'الهاتف لا يمكن أن يكون فارغاً' }); const existing = data.users.find(u => u.phone === phone.trim() && u.id !== user.id); if (existing) return res.status(400).json({ error: 'الهاتف مستخدم من عميل آخر' }); user.phone = phone.trim(); }
  if (regionId !== undefined) { if (regionId && !data.regions.find(r => r.id === regionId)) return res.status(400).json({ error: 'المنطقة غير موجودة' }); user.regionId = regionId; }
  if (address !== undefined) user.address = address;
  writeData(data);
  res.json({ success: true });
});

// --- الأسواق والصيدليات (أدمن) ---
app.get('/api/admin/markets', requireAuth, adminOnly, (req, res) => { const data = readData(); res.json(data.markets || []); });
app.post('/api/admin/markets', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name, ownerPhone, ownerPassword } = req.body;
  if (!name || !ownerPhone || !ownerPassword) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (data.users.find(u => u.phone === ownerPhone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + Date.now();
  const marketId = 'market_' + Date.now();
  const hashed = bcrypt.hashSync(ownerPassword, 10);
  data.users.push({ id: userId, name, phone: ownerPhone, password: hashed, role: 'MARKET' });
  data.markets.push({ id: marketId, userId, name, logo: '', isOpen: true });
  writeData(data);
  res.json({ id: marketId, name });
});
app.patch('/api/admin/markets/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const market = data.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'غير موجود' });
  market.isOpen = !market.isOpen;
  writeData(data);
  res.json({ success: true });
});
app.patch('/api/admin/markets/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const market = data.markets.find(m => m.id === req.params.id);
  if (!market) return res.status(404).json({ error: 'غير موجود' });
  const { name, ownerPhone } = req.body;
  if (name) market.name = name;
  if (ownerPhone) {
    const user = data.users.find(u => u.id === market.userId);
    if (user) user.phone = ownerPhone;
  }
  writeData(data);
  res.json({ success: true });
});
app.delete('/api/admin/markets/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.markets.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  const market = data.markets[idx];
  const userIndex = data.users.findIndex(u => u.id === market.userId);
  if (userIndex !== -1) data.users.splice(userIndex, 1);
  data.markets.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/admin/pharmacies', requireAuth, adminOnly, (req, res) => { const data = readData(); res.json(data.pharmacies || []); });
app.post('/api/admin/pharmacies', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const { name, ownerPhone, ownerPassword } = req.body;
  if (!name || !ownerPhone || !ownerPassword) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (data.users.find(u => u.phone === ownerPhone)) return res.status(400).json({ error: 'الهاتف مستخدم' });
  const userId = 'usr_' + Date.now();
  const pharmacyId = 'pharm_' + Date.now();
  const hashed = bcrypt.hashSync(ownerPassword, 10);
  data.users.push({ id: userId, name, phone: ownerPhone, password: hashed, role: 'PHARMACY' });
  data.pharmacies.push({ id: pharmacyId, userId, name, logo: '', isOpen: true });
  writeData(data);
  res.json({ id: pharmacyId, name });
});
app.patch('/api/admin/pharmacies/:id/toggle', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const pharmacy = data.pharmacies.find(p => p.id === req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'غير موجود' });
  pharmacy.isOpen = !pharmacy.isOpen;
  writeData(data);
  res.json({ success: true });
});
app.patch('/api/admin/pharmacies/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const pharmacy = data.pharmacies.find(p => p.id === req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'غير موجود' });
  const { name, ownerPhone } = req.body;
  if (name) pharmacy.name = name;
  if (ownerPhone) {
    const user = data.users.find(u => u.id === pharmacy.userId);
    if (user) user.phone = ownerPhone;
  }
  writeData(data);
  res.json({ success: true });
});
app.delete('/api/admin/pharmacies/:id', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const idx = data.pharmacies.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  const pharm = data.pharmacies[idx];
  const userIndex = data.users.findIndex(u => u.id === pharm.userId);
  if (userIndex !== -1) data.users.splice(userIndex, 1);
  data.pharmacies.splice(idx, 1);
  writeData(data);
  res.json({ success: true });
});

// --- إيرادات المنصة ---
app.get('/api/admin/platform-revenue', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const orders = data.orders.filter(o => o.status === 'DELIVERED' && o.platformFee);
  const totalPlatform = orders.reduce((s, o) => s + (o.platformFee || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayPlatform = orders.filter(o => o.deliveredAt?.startsWith(today)).reduce((s, o) => s + (o.platformFee || 0), 0);
  res.json({ total: totalPlatform, today: todayPlatform });
});
// عرض الطلبات المباشرة من المطاعم (للأدمن)
app.get('/api/admin/restaurant-direct-orders', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const orders = data.orders.filter(o => o.isDirect);
  const enriched = orders.map(o => ({
    ...o,
    restaurantName: data.restaurants.find(r => r.id === o.restaurantId)?.name || '—',
    driverName: data.users.find(u => u.id === o.driverId)?.name || '—'
  }));
  res.json(enriched);
});

// تعيين طيار لطلب مباشر
app.patch('/api/admin/restaurant-direct-orders/:id/assign-driver', requireAuth, adminOnly, (req, res) => {
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  order.driverId = req.body.driverId;
  order.status = 'DRIVER_ASSIGNED';
  writeData(data);
  res.json({ success: true });
});

// ==================== RESTAURANT ====================
app.get('/api/restaurant/profile', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  res.json({ id: restaurant.id, name: restaurant.name, logo: restaurant.logo || '' });
});
app.patch('/api/restaurant/profile', requireAuth, upload.single('logo'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  if (req.file) restaurant.logo = '/uploads/' + req.file.filename;
  writeData(data);
  res.json({ logo: restaurant.logo });
});

app.get('/api/restaurant/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  let orders = data.orders.filter(o => o.restaurantId === restaurant.id && o.adminApproved === true);
  if (req.query.date) orders = orders.filter(o => o.createdAt && o.createdAt.startsWith(req.query.date));
  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const enriched = orders.map(o => ({
    ...o,
    customerName: o.customerName || 'زائر',
    customerPhone: o.customerPhone || '',
    items: o.items || []
  }));
  res.json(enriched);
});

app.patch('/api/restaurant/orders/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const restaurant = data.restaurants.find(r => r.id === order.restaurantId);
  if (!restaurant || restaurant.userId !== req.user.id) return res.status(403).json({ error: 'ليس مطعمك' });
  const { status } = req.body;
  if (!['ACCEPTED', 'PREPARING', 'READY', 'CANCELLED'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  order.status = status;
  if (status === 'PREPARING') order.preparingAt = new Date().toISOString();
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  if (status === 'ACCEPTED') io.emit('orderAccepted', { orderId: order.id });
  else if (status === 'CANCELLED') io.emit('orderCancelled', { orderId: order.id });
  res.json({ success: true });
});
// طلب مباشر من المطعم إلى الأدمن
app.post('/api/restaurant/order-from-restaurant', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const { customerName, customerPhone, regionId, regionName, address, orderPrice, deliveryFee, total, notes } = req.body;
  if (!customerName || !customerPhone || !address || !orderPrice || !deliveryFee || !total) {
    return res.status(400).json({ error: 'بيانات ناقصة' });
  }
  const orderNumber = getNextOrderNumber();
  const newOrder = {
    id: 'dir_' + Date.now(),
    orderNumber,
    restaurantId: restaurant.id,
    customerName,
    customerPhone,
    regionName,
    address,
    items: [{ name: 'أوردر مطعم', price: orderPrice, quantity: 1 }],
    total,
    deliveryFee,
    orderPrice,
    paymentMethod: 'CASH',
    status: 'PENDING',
    driverId: null,
    adminApproved: true, // موافقة تلقائية لأنه من المطعم
    isDirect: true, // علامة مميزة
    notes: notes || '',
    createdAt: new Date().toISOString(),
    deliveredAt: null
  };
  data.orders.push(newOrder);
  writeData(data);
  io.emit('newOrder', { orderId: newOrder.id, restaurantId: restaurant.id, customerName });
  res.json({ success: true, orderId: newOrder.id });
});

// عرض الطلبات المباشرة الخاصة بالمطعم
app.get('/api/restaurant/my-direct-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const orders = data.orders.filter(o => o.restaurantId === restaurant.id && o.isDirect);
  res.json(orders);
});

// تصنيفات المطعم
app.get('/api/restaurant/categories', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const categories = data.categories.filter(c => c.restaurantId === restaurant.id);
  res.json(categories);
});
app.post('/api/restaurant/categories', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
  const category = { id: 'cat_' + Date.now(), restaurantId: restaurant.id, name };
  data.categories.push(category);
  writeData(data);
  res.json(category);
});
app.delete('/api/restaurant/categories/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const index = data.categories.findIndex(c => c.id === req.params.id && c.restaurantId === restaurant.id);
  if (index === -1) return res.status(404).json({ error: 'التصنيف غير موجود' });
  data.categories.splice(index, 1);
  writeData(data);
  res.json({ success: true });
});
app.patch('/api/restaurant/categories/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const cat = data.categories.find(c => c.id === req.params.id && c.restaurantId === restaurant.id);
  if (!cat) return res.status(404).json({ error: 'التصنيف غير موجود' });
  if (req.body.name !== undefined) cat.name = req.body.name;
  writeData(data);
  res.json(cat);
});

// منتجات المطعم
app.get('/api/restaurant/products', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const products = data.products.filter(p => p.restaurantId === restaurant.id);
  res.json(products);
});

app.post('/api/restaurant/products', requireAuth, upload.single('image'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const { name, description, category, groups, basePrice } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });
  let groupsParsed = [];
  try { if (groups) groupsParsed = JSON.parse(groups); } catch(e) {}
  const imagePath = req.file ? '/uploads/' + req.file.filename : '';
  const product = {
    id: 'prod_' + Date.now(),
    restaurantId: restaurant.id,
    name,
    description: description || '',
    basePrice: Number(basePrice) || 0,
    category: category || 'أخرى',
    image: imagePath,
    isAvailable: true,
    groups: groupsParsed,
    type: groupsParsed.length ? 'multi' : 'single'
  };
  data.products.push(product);
  writeData(data);
  res.json(product);
});

app.patch('/api/restaurant/products/:id', requireAuth, upload.single('image'), (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const product = data.products.find(p => p.id === req.params.id && p.restaurantId === restaurant.id);
  if (!product) return res.status(404).json({ error: 'المنتج غير موجود' });
  const { name, description, category, isAvailable, groups, basePrice } = req.body;
  if (name !== undefined) product.name = name;
  if (description !== undefined) product.description = description;
  if (category !== undefined) product.category = category;
  if (isAvailable !== undefined) product.isAvailable = (isAvailable === 'true' || isAvailable === true);
  if (basePrice !== undefined) product.basePrice = Number(basePrice);
  if (groups !== undefined) { try { product.groups = JSON.parse(groups); } catch(e) {} }
  if (req.file) product.image = '/uploads/' + req.file.filename;
  writeData(data);
  res.json(product);
});

app.delete('/api/restaurant/products/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const index = data.products.findIndex(p => p.id === req.params.id && p.restaurantId === restaurant.id);
  if (index === -1) return res.status(404).json({ error: 'المنتج غير موجود' });
  data.products.splice(index, 1);
  writeData(data);
  res.json({ success: true });
});

// تقارير وإحصائيات المطعم
app.get('/api/restaurant/reports', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const orders = data.orders.filter(o => o.restaurantId === restaurant.id && o.adminApproved === true && o.status === 'DELIVERED');
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString().slice(0, 10);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const filterByDate = (list, start) => list.filter(o => o.deliveredAt && o.deliveredAt >= start);
  const sumRevenue = (list) => {
    const productRevenue = list.reduce((s, o) => s + (o.total - (o.deliveryFee || 0)), 0);
    const platformFee = list.reduce((s, o) => s + (o.platformFee || 0), 0);
    return { productRevenue, platformFee, netRevenue: productRevenue - platformFee, totalOrders: list.length };
  };
  res.json({
    daily: sumRevenue(orders.filter(o => o.deliveredAt?.startsWith(today))),
    weekly: sumRevenue(filterByDate(orders, startOfWeek)),
    monthly: sumRevenue(filterByDate(orders, startOfMonth)),
    total: sumRevenue(orders)
  });
});

app.get('/api/restaurant/stats', requireAuth, (req, res) => {
  if (req.user.role !== 'RESTAURANT') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const restaurant = data.restaurants.find(r => r.userId === req.user.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const orders = data.orders.filter(o => o.restaurantId === restaurant.id && o.adminApproved === true);
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

// ==================== DRIVER ====================
function getStoreNameForOrder(order, data) {
  if (order.type === 'special') {
    if (order.orderType === 'market') {
      const market = data.markets.find(m => m.id === order.storeId);
      return market ? market.name : 'ماركت';
    } else if (order.orderType === 'pharmacy') {
      const pharmacy = data.pharmacies.find(p => p.id === order.storeId);
      return pharmacy ? pharmacy.name : 'صيدلية';
    }
    return 'طلب خاص';
  }
  return null;
}

app.get('/api/driver/available-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const orders = data.orders.filter(o => o.status === 'READY' && !o.driverId).map(o => {
    const restaurant = data.restaurants.find(r => r.id === o.restaurantId);
    const storeName = getStoreNameForOrder(o, data);
    return { ...o, restaurantName: restaurant?.name || storeName || '—', customerAddress: o.address || '' };
  });
  res.json(orders);
});

app.get('/api/driver/my-orders', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const orders = data.orders.filter(o => o.driverId === req.user.id && ['DRIVER_ASSIGNED', 'ON_THE_WAY'].includes(o.status)).map(o => {
    const restaurant = data.restaurants.find(r => r.id === o.restaurantId);
    const storeName = getStoreNameForOrder(o, data);
    return { ...o, restaurantName: restaurant?.name || storeName || '—', customerAddress: o.address || '' };
  });
  res.json(orders);
});

app.patch('/api/driver/orders/:id/accept', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id && o.status === 'READY' && !o.driverId);
  if (!order) return res.status(404).json({ error: 'الطلب غير متاح' });

  const driver = data.drivers.find(d => d.userId === req.user.id);
  if (!driver) return res.status(404).json({ error: 'لم يتم العثور على ملف السائق' });

  const productValue = (order.total || 0) - (order.deliveryFee || 0);
  const estimatedCommission = Math.round(productValue * 0.20);
  if ((driver.credit || 0) < estimatedCommission) {
    return res.status(400).json({ error: `رصيدك غير كافٍ (${driver.credit} ج). العمولة المتوقعة ${estimatedCommission} ج. الرجاء شحن الرصيد.` });
  }

  order.driverId = req.user.id;
  order.status = 'DRIVER_ASSIGNED';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  io.emit('driverArrived', { orderId: order.id, driverName: req.user.name || 'طيار' });
  res.json({ success: true });
});

app.patch('/api/driver/orders/:id/status', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id && o.driverId === req.user.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const { status } = req.body;
  if (!['ON_THE_WAY', 'DELIVERED'].includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  order.status = status;
  if (status === 'DELIVERED') {
    const driver = data.drivers.find(d => d.userId === req.user.id);
    if (driver) {
      driver.earnings = (driver.earnings || 0) + (order.deliveryFee || 10);
      const productValue = (order.total || 0) - (order.deliveryFee || 0);
      order.platformFee = Math.round(productValue * 0.20);
      driver.credit = (driver.credit || 0) - order.platformFee;
    }
    order.deliveredAt = new Date().toISOString();
  }
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.get('/api/driver/earnings', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const driver = data.drivers.find(d => d.userId === req.user.id);
  const totalAllTime = driver?.earnings || 0;
  if (req.query.today === 'true') {
    const today = new Date().toISOString().slice(0, 10);
    const todayDelivered = data.orders.filter(o => o.driverId === req.user.id && o.status === 'DELIVERED' && o.deliveredAt?.startsWith(today));
    const todayEarnings = todayDelivered.reduce((sum, o) => sum + (o.deliveryFee || 10), 0);
    return res.json({ total: todayEarnings, isToday: true });
  }
  res.json({ total: totalAllTime });
});

app.get('/api/driver/profile', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const dp = data.drivers.find(d => d.userId === req.user.id) || {};
  res.json({ name: user.name, phone: user.phone, isAvailable: dp.isAvailable !== false, earnings: dp.earnings || 0, credit: dp.credit || 0 });
});

app.patch('/api/driver/toggle-status', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const dp = data.drivers.find(d => d.userId === req.user.id);
  if (!dp) return res.status(404).json({ error: 'لم يتم العثور على ملف الطيار' });
  dp.isAvailable = !dp.isAvailable;
  writeData(data);
  res.json({ isAvailable: dp.isAvailable });
});

app.get('/api/driver/history', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  let orders = data.orders.filter(o => o.driverId === req.user.id && o.status === 'DELIVERED');
  if (req.query.date) orders = orders.filter(o => o.deliveredAt && o.deliveredAt.startsWith(req.query.date));
  orders.sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
  const enriched = orders.map(o => {
    const restaurant = data.restaurants.find(r => r.id === o.restaurantId);
    const storeName = getStoreNameForOrder(o, data);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      deliveredAt: o.deliveredAt,
      restaurantName: restaurant?.name || storeName || '—',
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      address: o.address,
      total: o.total,
      deliveryFee: o.deliveryFee || 10,
      paymentMethod: o.paymentMethod,
      items: o.items || []
    };
  });
  res.json(enriched);
});

// طلب شحن الرصيد
app.post('/api/driver/recharge-request', requireAuth, (req, res) => {
  if (req.user.role !== 'DRIVER') return res.status(403).json({ error: 'غير مسموح' });
  const { amount, last4digits } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'المبلغ غير صالح' });
  if (!last4digits || !/^\d{4}$/.test(last4digits)) return res.status(400).json({ error: 'آخر 4 أرقام غير صحيحة' });
  const data = readData();
  const driver = data.drivers.find(d => d.userId === req.user.id);
  if (!driver) return res.status(404).json({ error: 'الطيار غير موجود' });
  const user = data.users.find(u => u.id === req.user.id);
  const request = {
    id: 'req_' + Date.now(),
    driverId: req.user.id,
    driverName: user?.name || 'طيار',
    driverPhone: user?.phone || '',
    amount: Number(amount),
    last4digits: last4digits.trim(),
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    processedAt: null
  };
  data.rechargeRequests.push(request);
  writeData(data);
  res.json({ success: true, message: 'تم إرسال طلب الشحن، بانتظار موافقة الأدمن.' });
});

// ==================== CUSTOMER & PUBLIC ====================
app.get('/api/restaurants', (req, res) => {
  const data = readData();
  const list = data.restaurants.filter(r => r.isOpen).map(r => ({ id: r.id, name: r.name, logo: r.logo || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=150&h=150&fit=crop' }));
  res.json(list);
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const data = readData();
  const restaurant = data.restaurants.find(r => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const restaurantCategories = data.categories.filter(c => c.restaurantId === restaurant.id);
  const categoryMap = new Map();
  restaurantCategories.forEach(cat => categoryMap.set(cat.id, cat.name));
  let products = data.products.filter(p => p.restaurantId === restaurant.id && p.isAvailable);
  products = products.map(p => {
    let categoryName = p.category || 'عام';
    if (categoryMap.has(categoryName)) categoryName = categoryMap.get(categoryName);
    return { ...p, category: categoryName };
  });
  res.json(products);
});

app.get('/api/markets', (req, res) => {
  const data = readData();
  const openMarkets = data.markets.filter(m => m.isOpen !== false);
  res.json(openMarkets);
});

app.get('/api/pharmacies', (req, res) => {
  const data = readData();
  const openPharmacies = data.pharmacies.filter(p => p.isOpen !== false);
  res.json(openPharmacies);
});

// الطلب الخاص
app.post('/api/orders/special', upload.array('files', 10), async (req, res) => {
  let { orderData } = req.body;
  try { orderData = JSON.parse(orderData); } catch(e) { return res.status(400).json({ error: 'بيانات الطلب غير صحيحة' }); }
  const data = readData();
  const { orderType, storeId, items, orderNotes, customerName, customerPhone, address, regionName, paymentMethod, deliveryFee } = orderData;
  if (!customerName || !customerPhone) return res.status(400).json({ error: 'بيانات العميل ناقصة' });
  const files = req.files || [];
  const filePaths = files.map(f => '/uploads/special_orders/' + f.filename);
  const orderNumber = getNextOrderNumber();
  const newOrder = {
    id: 'ord_' + Date.now(),
    orderNumber,
    type: 'special',
    orderType,
    storeId: storeId || null,
    items: items || [],
    orderNotes: orderNotes || '',
    attachments: filePaths,
    customerName,
    customerPhone,
    address: address || '',
    regionName: regionName || '',
    paymentMethod: paymentMethod || 'CASH',
    deliveryFee: deliveryFee || 10,
    total: orderData.total,
    status: 'PENDING',
    adminApproved: false,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    invoiceAmount: null
  };
  data.orders.push(newOrder);
  writeData(data);
  io.emit('newSpecialOrder', { orderId: newOrder.id, orderType, storeId });
  res.json({ success: true, orderId: newOrder.id });
});

// طلب عادي
function customerAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role === 'CUSTOMER') req.customer = decoded;
    } catch (e) {}
  }
  next();
}
app.post('/api/orders', customerAuth, (req, res) => {
  const data = readData();
  let { restaurantId, items, total, customerName, customerPhone, address, paymentMethod, deliveryFee } = req.body;
  if (req.customer) {
    const user = data.users.find(u => u.id === req.customer.id);
    if (user) {
      customerName = user.name;
      customerPhone = user.phone;
      if (!address && user.address) address = user.address;
      if (!deliveryFee && user.regionId) {
        const region = data.regions.find(r => r.id === user.regionId);
        if (region) deliveryFee = region.fee;
      }
    }
  }
  if (!restaurantId || !total || !customerName || !customerPhone || !address) return res.status(400).json({ error: 'بيانات الطلب ناقصة' });
  const restaurant = data.restaurants.find(r => r.id === restaurantId);
  if (!restaurant) return res.status(404).json({ error: 'المطعم غير موجود' });
  const orderNumber = getNextOrderNumber();
  const order = {
    id: 'ord_' + Date.now(),
    orderNumber,
    restaurantId,
    items: items || [],
    total: Number(total),
    customerName,
    customerPhone,
    address,
    regionName: req.body.regionName || '',
    paymentMethod: paymentMethod || 'CASH',
    status: 'PENDING',
    driverId: null,
    deliveryFee: deliveryFee || 10,
    adminApproved: false,
    createdAt: new Date().toISOString(),
    deliveredAt: null
  };
  data.orders.push(order);
  writeData(data);
  io.emit('newOrder', { orderId: order.id, restaurantId, customerName });
  res.json({ success: true, orderId: order.id });
});

app.get('/api/orders/:id/track', (req, res) => {
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  let restaurantName = null, storeName = null;
  if (order.type === 'special') {
    if (order.orderType === 'market') {
      const market = data.markets.find(m => m.id === order.storeId);
      storeName = market ? market.name : 'ماركت';
    } else if (order.orderType === 'pharmacy') {
      const pharmacy = data.pharmacies.find(p => p.id === order.storeId);
      storeName = pharmacy ? pharmacy.name : 'صيدلية';
    } else { storeName = 'طلب خاص'; }
  } else {
    const restaurant = data.restaurants.find(r => r.id === order.restaurantId);
    restaurantName = restaurant ? restaurant.name : null;
  }
  res.json({ ...order, restaurantName, storeName });
});

// مناطق عامة
app.get('/api/regions', (req, res) => {
  const data = readData();
  res.json(data.regions);
});

// حساب العميل
app.post('/api/customer/register', (req, res) => {
  const { name, phone, password, regionId, address } = req.body;
  if (!name || !phone || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const data = readData();
  if (data.users.find(u => u.phone === phone)) return res.status(400).json({ error: 'الهاتف مستخدم بالفعل' });
  const hashed = bcrypt.hashSync(password, 10);
  const userId = 'cus_' + Date.now();
  data.users.push({ id: userId, name, phone, password: hashed, role: 'CUSTOMER', regionId: regionId || '', address: address || '' });
  writeData(data);
  const token = jwt.sign({ id: userId, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  res.json({ success: true, token, name, phone, regionId: regionId || '', address: address || '' });
});
app.post('/api/customer/login', (req, res) => {
  const { phone, password } = req.body;
  const data = readData();
  const user = data.users.find(u => u.phone === phone && u.role === 'CUSTOMER');
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
  const token = jwt.sign({ id: user.id, role: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '365d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  res.json({ success: true, token, name: user.name, phone: user.phone, regionId: user.regionId || '', address: user.address || '' });
});

// ==================== MARKET & PHARMACY PROFILE ====================
app.get('/api/market/profile', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market) return res.status(404).json({ error: 'الماركت غير موجود' });
  const owner = data.users.find(u => u.id === market.userId);
  res.json({ id: market.id, name: market.name, logo: market.logo || '', ownerPhone: owner?.phone });
});

app.patch('/api/market/profile', requireAuth, upload.single('logo'), (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market) return res.status(404).json({ error: 'الماركت غير موجود' });
  if (req.body.name) market.name = req.body.name;
  if (req.file) market.logo = '/uploads/' + req.file.filename;
  writeData(data);
  res.json({ name: market.name, logo: market.logo });
});

app.get('/api/market/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market) return res.status(404).json({ error: 'السوق غير موجود' });
  const orders = data.orders.filter(o => o.type === 'special' && o.storeId === market.id);
  res.json(orders);
});

app.patch('/api/market/orders/:id/items', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market || order.storeId !== market.id) return res.status(403).json({ error: 'ليس طلبك' });
  const { items, total } = req.body;
  if (items) order.items = items;
  if (total !== undefined) order.total = total;
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/market/orders/:id/accept', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market || order.storeId !== market.id) return res.status(403).json({ error: 'ليس طلبك' });
  order.status = 'ACCEPTED';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/market/orders/:id/invoice', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market || order.storeId !== market.id) return res.status(403).json({ error: 'ليس طلبك' });
  const { invoiceAmount } = req.body;
  order.invoiceAmount = invoiceAmount;
  order.invoiceBy = market.name;
  order.total = parseFloat(invoiceAmount) + (order.deliveryFee || 0);
  order.status = 'INVOICE_ADDED';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/market/orders/:id/ready', requireAuth, (req, res) => {
  if (req.user.role !== 'MARKET') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const market = data.markets.find(m => m.userId === req.user.id);
  if (!market || order.storeId !== market.id) return res.status(403).json({ error: 'ليس طلبك' });
  order.status = 'READY';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

// ==================== PHARMACY ORDERS API ====================
app.get('/api/pharmacy/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'PHARMACY') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const pharmacy = data.pharmacies.find(p => p.userId === req.user.id);
  if (!pharmacy) return res.status(404).json({ error: 'الصيدلية غير موجودة' });
  const orders = data.orders.filter(o => o.type === 'special' && o.storeId === pharmacy.id);
  res.json(orders);
});

app.patch('/api/pharmacy/orders/:id/items', requireAuth, (req, res) => {
  if (req.user.role !== 'PHARMACY') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const pharmacy = data.pharmacies.find(p => p.userId === req.user.id);
  if (!pharmacy || order.storeId !== pharmacy.id) return res.status(403).json({ error: 'ليس طلبك' });
  const { items, total } = req.body;
  if (items) order.items = items;
  if (total !== undefined) order.total = total;
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/pharmacy/orders/:id/accept', requireAuth, (req, res) => {
  if (req.user.role !== 'PHARMACY') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const pharmacy = data.pharmacies.find(p => p.userId === req.user.id);
  if (!pharmacy || order.storeId !== pharmacy.id) return res.status(403).json({ error: 'ليس طلبك' });
  order.status = 'ACCEPTED';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/pharmacy/orders/:id/invoice', requireAuth, (req, res) => {
  if (req.user.role !== 'PHARMACY') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const pharmacy = data.pharmacies.find(p => p.userId === req.user.id);
  if (!pharmacy || order.storeId !== pharmacy.id) return res.status(403).json({ error: 'ليس طلبك' });
  const { invoiceAmount } = req.body;
  order.invoiceAmount = invoiceAmount;
  order.invoiceBy = pharmacy.name;
  order.total = parseFloat(invoiceAmount) + (order.deliveryFee || 0);
  order.status = 'INVOICE_ADDED';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

app.patch('/api/pharmacy/orders/:id/ready', requireAuth, (req, res) => {
  if (req.user.role !== 'PHARMACY') return res.status(403).json({ error: 'غير مسموح' });
  const data = readData();
  const order = data.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const pharmacy = data.pharmacies.find(p => p.userId === req.user.id);
  if (!pharmacy || order.storeId !== pharmacy.id) return res.status(403).json({ error: 'ليس طلبك' });
  order.status = 'READY';
  writeData(data);
  io.emit('orderStatusUpdate', { orderId: order.id, status: order.status });
  res.json({ success: true });
});

// ==================== AUTOMATIC STATUS UPDATE ====================
setInterval(() => {
  const data = readData();
  const now = new Date();
  let changed = false;
  const updatedOrders = [];
  data.orders.forEach(order => {
    if (order.status === 'PREPARING' && order.preparingAt) {
      const preparingTime = new Date(order.preparingAt);
      const diffMinutes = (now - preparingTime) / 1000 / 60;
      if (diffMinutes >= 25) {
        order.status = 'READY';
        changed = true;
        updatedOrders.push(order);
      }
    }
  });
  if (changed) {
    writeData(data);
    updatedOrders.forEach(o => io.emit('orderStatusUpdate', { orderId: o.id, status: o.status }));
    const readyCount = data.orders.filter(o => o.status === 'READY' && !o.driverId).length;
    io.emit('driver:newJob', { count: readyCount });
  }
}, 60000);

// معالج أخطاء multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'خطأ في رفع الملف: ' + err.message });
  } else if (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
});

io.on('connection', (socket) => {
  console.log('عميل متصل:', socket.id);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Drako server on port ${PORT}`));
