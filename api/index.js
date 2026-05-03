require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

// ── Database Mode: MongoDB or In-Memory ──
let db = null;
let User, Responden;
let useMemory = false;

// In-memory storage (fallback jika MongoDB tidak tersedia)
const memoryDB = {
  users: [],
  responden: []
};

// Define Models early so they are available
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'enumerator'], required: true },
  full_name: { type: String, required: true }
});

const respondenSchema = new mongoose.Schema({
  no_responden: { type: String, required: true },
  nama_lengkap: { type: String, required: true },
  kategori: { type: String, enum: ['Hamil', 'Balita'], required: true },
  wilayah_kecamatan: { type: String, required: true },
  desa_kelurahan: { type: String, required: true },
  usia: Number,
  usia_hamil: Number,
  berat_badan: Number,
  tinggi_badan: Number,
  LILA: Number,
  status_gizi: String,
  nama_enumerator: String,
  alamat_lengkap: String,
  catatan: String
}, { timestamps: true });

User = mongoose.models.User || mongoose.model('User', userSchema);
Responden = mongoose.models.Responden || mongoose.model('Responden', respondenSchema);

async function connectDB() {
  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    setupMemoryMode('Environment MONGODB_URI not set');
    return;
  }

  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ MongoDB Connected');
    db = 'mongo';
  } catch (err) {
    setupMemoryMode(err.message);
  }
}

async function setupMemoryMode(reason) {
  console.log('⚠️  MongoDB tidak tersedia, menggunakan mode IN-MEMORY');
  console.log('   (' + reason + ')');
  useMemory = true;
  db = 'memory';

  // Seed default users ke memory jika belum ada
  if (memoryDB.users.length === 0) {
    memoryDB.users = [
      { _id: '1', username: 'ihsan avindo', password: await bcrypt.hash('1hsan-siskom', 10), role: 'admin', full_name: 'Ihsan Avindo' },
      { _id: '2', username: 'dian chindika sari', password: await bcrypt.hash('dian110202', 10), role: 'admin', full_name: 'Dian Chindika Sari' },
      { _id: '3', username: 'selvira olivia', password: await bcrypt.hash('vioboost10', 10), role: 'admin', full_name: 'Selvira Olivia' },
      { _id: '4', username: 'enumerator', password: await bcrypt.hash('gizitrack-user', 10), role: 'enumerator', full_name: 'Tim Enumerator Pontianak' }
    ];
    console.log('✅ 4 user default tersedia (mode in-memory)');
  }
}

// ── Database Abstraction Layer ──
const DB = {
  async findUser(query) {
    if (useMemory) return memoryDB.users.find(u => Object.keys(query).every(k => u[k] === query[k])) || null;
    return User.findOne(query);
  },
  async countUsers(query = {}) {
    if (useMemory) return memoryDB.users.filter(u => Object.keys(query).every(k => u[k] === query[k])).length;
    return User.countDocuments(query);
  },
  async allUsers(sort) {
    if (useMemory) return memoryDB.users;
    return User.find().sort(sort);
  },
  async findResponden(query = {}, options = {}) {
    if (useMemory) {
      let results = memoryDB.responden.filter(r => {
        return Object.keys(query).every(k => {
          if (k === '$or') return query.$or.some(orQ => Object.keys(orQ).every(ok => {
            if (orQ[ok] && orQ[ok].$regex) return r[ok] && r[ok].toLowerCase().includes(orQ[ok].$regex.toLowerCase());
            return r[ok] === orQ[ok];
          }));
          if (query[k] && query[k].$lt) return r[k] < query[k].$lt;
          return r[k] === query[k];
        });
      });
      results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (options.limit) results = results.slice(0, options.limit);
      return results;
    }
    let q = Responden.find(query).sort({ createdAt: -1 });
    if (options.limit) q = q.limit(options.limit);
    return q;
  },
  async countResponden(query = {}) {
    if (useMemory) return memoryDB.responden.filter(r => Object.keys(query).every(k => (query[k] && query[k].$lt) ? r[k] < query[k].$lt : r[k] === query[k])).length;
    return Responden.countDocuments(query);
  },
  async distinctWilayah() {
    if (useMemory) return [...new Set(memoryDB.responden.map(r => r.wilayah_kecamatan).filter(Boolean))];
    return Responden.distinct('wilayah_kecamatan');
  },
  async createResponden(data) {
    if (useMemory) {
      const doc = { _id: String(Date.now()), ...data, createdAt: new Date(), updatedAt: new Date() };
      memoryDB.responden.push(doc);
      return doc;
    }
    return Responden.create(data);
  },
  async findRespondenById(id) {
    if (useMemory) return memoryDB.responden.find(r => r._id === id) || null;
    return Responden.findById(id);
  },
  async updateResponden(id, data) {
    if (useMemory) {
      const idx = memoryDB.responden.findIndex(r => r._id === id);
      if (idx >= 0) { memoryDB.responden[idx] = { ...memoryDB.responden[idx], ...data, updatedAt: new Date() }; return memoryDB.responden[idx]; }
      return null;
    }
    return Responden.findByIdAndUpdate(id, data, { new: true });
  },
  async deleteResponden(id) {
    if (useMemory) { memoryDB.responden = memoryDB.responden.filter(r => r._id !== id); return true; }
    return Responden.findByIdAndDelete(id);
  },
  async getLastResponden() {
    if (useMemory) return memoryDB.responden.length === 0 ? null : memoryDB.responden[memoryDB.responden.length - 1];
    return Responden.findOne().sort({ _id: -1 });
  },
  async aggregateSebaran() {
    if (useMemory) {
      const map = {};
      memoryDB.responden.forEach(r => {
        if (!map[r.wilayah_kecamatan]) map[r.wilayah_kecamatan] = { _id: r.wilayah_kecamatan, jml_hamil: 0, jml_balita: 0 };
        if (r.kategori === 'Hamil') map[r.wilayah_kecamatan].jml_hamil++; else map[r.wilayah_kecamatan].jml_balita++;
      });
      return Object.values(map).sort((a, b) => a._id.localeCompare(b._id));
    }
    return Responden.aggregate([{ $group: { _id: '$wilayah_kecamatan', jml_hamil: { $sum: { $cond: [{ $eq: ['$kategori', 'Hamil'] }, 1, 0] } }, jml_balita: { $sum: { $cond: [{ $eq: ['$kategori', 'Balita'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]);
  },
  async aggregateStatus() {
    if (useMemory) {
      const map = {};
      memoryDB.responden.forEach(r => { const s = r.status_gizi || 'Lainnya'; if (!map[s]) map[s] = { _id: s, count: 0 }; map[s].count++; });
      return Object.values(map).sort((a, b) => b.count - a.count);
    }
    return Responden.aggregate([{ $group: { _id: '$status_gizi', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
  }
};

// ── Middleware Setup ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Session Setup (Always before routes)
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'egizitrack-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
};

// Use MongoStore only if MONGODB_URI is set AND we are not forcing memory mode
// In local dev without a running mongo, this often causes crashes
if (process.env.MONGODB_URI && process.env.NODE_ENV === 'production') {
  sessionConfig.store = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60
  });
}

app.use(session(sessionConfig));

// DB Connection Middleware (to ensure DB is ready)
app.use(async (req, res, next) => {
  if (db === null) await connectDB();
  res.locals.session = req.session;
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session || !req.session.username) return res.redirect('/login');
  next();
}

// ── ROUTES ──
app.get('/', async (req, res) => {
    if (req.session.username) return res.redirect('/dashboard');
    
    // Fetch stats for login page
    let totalEntri = 0;
    let totalWilayah = 0;
    let totalEnum = 4; // Default seed count

    try {
        const allData = await Responden.find();
        totalEntri = allData.length;
        totalWilayah = [...new Set(allData.map(d => d.wilayah_kecamatan))].length;
        const users = await User.find();
        if (users.length > 0) totalEnum = users.length;
    } catch (e) {
        console.log('Stats fetch error:', e);
    }

    res.render('login', { totalEntri, totalWilayah, totalEnum });
});

app.get('/login', async (req, res) => {
  if (req.session && req.session.username) return res.redirect('/dashboard');
  const [totalData, wilayah, totalEnum] = await Promise.all([
    DB.countResponden(),
    DB.distinctWilayah(),
    DB.countUsers({ role: 'enumerator' })
  ]);
  res.render('login', { totalData, totalWilayah: wilayah.length, totalEnum });
});

app.post('/login', async (req, res) => {
  const { username, password, role } = req.body;
  const user = await DB.findUser({ username, role });
  if (!user) return res.send("<script>alert('Akun tidak ditemukan!'); window.location='/login';</script>");
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.send("<script>alert('Password salah!'); window.location='/login';</script>");
  req.session.username = user.username;
  req.session.nama = user.full_name;
  req.session.role = user.role;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/dashboard', requireAuth, async (req, res) => {
  const filter = req.query.filter || 'semua';
  const search = req.query.search || '';
  const [totalHamil, totalBalita, wilayah, totalEnum] = await Promise.all([
    DB.countResponden({ kategori: 'Hamil' }),
    DB.countResponden({ kategori: 'Balita' }),
    DB.distinctWilayah(),
    DB.countUsers({ role: 'enumerator' })
  ]);
  let query = {};
  if (filter === 'hamil') query.kategori = 'Hamil';
  if (filter === 'balita') query.kategori = 'Balita';
  if (search) query.$or = [{ nama_lengkap: { $regex: search, $options: 'i' } }, { no_responden: { $regex: search, $options: 'i' } }];
  const data = await DB.findResponden(query, { limit: 50 });
  res.render('dashboard', { currentPage: 'dashboard', totalHamil, totalBalita, totalWilayah: wilayah.length, totalEnum, data, filter, search, totalEntri: totalHamil + totalBalita });
});

app.get('/tambah', requireAuth, async (req, res) => {
  const last = await DB.getLastResponden();
  let nextNum = 1;
  if (last && last.no_responden) { const m = last.no_responden.match(/(\d+)$/); if (m) nextNum = parseInt(m[1]) + 1; }
  res.render('tambah', { currentPage: 'tambah', success: false, error: '', nextNum });
});

app.post('/tambah', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    await DB.createResponden({
      no_responden: d.no_responden, nama_lengkap: d.nama_responden, kategori: d.kategori, wilayah_kecamatan: d.wilayah, desa_kelurahan: d.desa,
      usia: d.usia ? parseInt(d.usia) : null, usia_hamil: (d.kategori === 'Hamil' && d.usia_hamil) ? parseInt(d.usia_hamil) : null,
      berat_badan: d.berat ? parseFloat(d.berat) : null, tinggi_badan: d.tinggi ? parseFloat(d.tinggi) : null, LILA: d.lila ? parseFloat(d.lila) : null,
      status_gizi: d.status_gizi, nama_enumerator: d.nama_enumerator, alamat_lengkap: d.alamat, catatan: d.catatan
    });
    const last = await DB.getLastResponden();
    let nextNum = 1;
    if (last && last.no_responden) { const m = last.no_responden.match(/(\d+)$/); if (m) nextNum = parseInt(m[1]) + 1; }
    res.render('tambah', { currentPage: 'tambah', success: true, error: '', nextNum });
  } catch (err) { res.render('tambah', { currentPage: 'tambah', success: false, error: err.message, nextNum: 1 }); }
});

app.get('/rekap', requireAuth, async (req, res) => {
  const search = req.query.search || '';
  const kat = req.query.kat || '';
  let query = {};
  if (kat && ['Hamil', 'Balita'].includes(kat)) query.kategori = kat;
  if (search) query.$or = [{ nama_lengkap: { $regex: search, $options: 'i' } }, { no_responden: { $regex: search, $options: 'i' } }, { nama_enumerator: { $regex: search, $options: 'i' } }];
  const [data, totalAll, totalHamil, totalBalita] = await Promise.all([DB.findResponden(query), DB.countResponden(), DB.countResponden({ kategori: 'Hamil' }), DB.countResponden({ kategori: 'Balita' })]);
  res.render('rekap_data', { currentPage: 'rekap', data, search, filterKat: kat, totalAll, totalHamil, totalBalita });
});

app.get('/edit/:id', requireAuth, async (req, res) => {
  const data = await DB.findRespondenById(req.params.id);
  if (!data) return res.send("<script>alert('Data tidak ditemukan.'); window.location='/dashboard';</script>");
  res.render('edit', { currentPage: '', data, success: false, error: '' });
});

app.post('/edit/:id', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    await DB.updateResponden(req.params.id, {
      no_responden: d.no_responden, nama_lengkap: d.nama_responden, kategori: d.kategori, wilayah_kecamatan: d.wilayah, desa_kelurahan: d.desa,
      usia: d.usia ? parseInt(d.usia) : null, usia_hamil: (d.kategori === 'Hamil' && d.usia_hamil) ? parseInt(d.usia_hamil) : null,
      berat_badan: d.berat ? parseFloat(d.berat) : null, tinggi_badan: d.tinggi ? parseFloat(d.tinggi) : null, LILA: d.lila ? parseFloat(d.lila) : null,
      status_gizi: d.status_gizi, alamat_lengkap: d.alamat, catatan: d.catatan
    });
    const data = await DB.findRespondenById(req.params.id);
    res.render('edit', { currentPage: '', data, success: true, error: '' });
  } catch (err) { const data = await DB.findRespondenById(req.params.id); res.render('edit', { currentPage: '', data, success: false, error: err.message }); }
});

app.get('/hapus/:id', requireAuth, async (req, res) => { await DB.deleteResponden(req.params.id); res.redirect(req.get('Referer') || '/dashboard'); });

app.get('/laporan', requireAuth, async (req, res) => {
  const [totalHamil, totalBalita, totalKek, sebaran, statusDist] = await Promise.all([DB.countResponden({ kategori: 'Hamil' }), DB.countResponden({ kategori: 'Balita' }), DB.countResponden({ LILA: { $lt: 23.5 } }), DB.aggregateSebaran(), DB.aggregateStatus()]);
  res.render('laporan', { currentPage: 'laporan', totalHamil, totalBalita, totalKek, sebaran, statusDist });
});

app.get('/pengaturan', requireAuth, async (req, res) => {
  const adminList = ['ihsan avindo', 'dian chindika sari', 'selvira olivia'];
  const isAdmin = adminList.includes(req.session.username.toLowerCase());
  const userEntries = await DB.countResponden({ nama_enumerator: req.session.nama });
  let users = []; if (isAdmin) users = await DB.allUsers({ role: 1, full_name: 1 });
  res.render('pengaturan', { currentPage: 'pengaturan', isAdmin, userEntries, users });
});

app.get('/export', requireAuth, async (req, res) => {
  const data = await DB.findResponden();
  const d = new Date();
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="Rekap_E-GiziTrack_${d.getDate()}-${d.getMonth()+1}.xls"`);
  let html = '<table border="1"><tr>'; ['No','Kategori','No Responden','Nama','Wilayah','Desa','Usia','Usia Hamil','BB (kg)','TB (cm)','LILA (cm)','Status Gizi','Enumerator','Alamat','Catatan','Tanggal'].forEach(h => html += `<th style="background:#14532d;color:white;">${h}</th>`); html += '</tr>';
  data.forEach((r, i) => { const tgl = r.createdAt ? new Date(r.createdAt).toLocaleDateString('id-ID') : '-'; html += `<tr><td>${i+1}</td><td>${r.kategori}</td><td>${r.no_responden}</td><td>${r.nama_lengkap}</td><td>${r.wilayah_kecamatan}</td><td>${r.desa_kelurahan}</td><td>${r.usia||'-'}</td><td>${r.usia_hamil||'-'}</td><td>${r.berat_badan||'-'}</td><td>${r.tinggi_badan||'-'}</td><td>${r.LILA||'-'}</td><td>${r.status_gizi||'-'}</td><td>${r.nama_enumerator||'-'}</td><td>${r.alamat_lengkap||'-'}</td><td>${r.catatan||'-'}</td><td>${tgl}</td></tr>`; });
  html += '</table>'; res.send(html);
});

app.get('/seed', async (req, res) => {
  if (useMemory) return res.json({ message: 'Memory mode: seeded auto' });
  const count = await User.countDocuments();
  if (count > 0) return res.json({ message: 'Already seeded' });
  await User.insertMany([
    { username: 'ihsan avindo', password: await bcrypt.hash('1hsan-siskom', 10), role: 'admin', full_name: 'Ihsan Avindo' },
    { username: 'dian chindika sari', password: await bcrypt.hash('dian110202', 10), role: 'admin', full_name: 'Dian Chindika Sari' },
    { username: 'selvira olivia', password: await bcrypt.hash('vioboost10', 10), role: 'admin', full_name: 'Selvira Olivia' },
    { username: 'enumerator', password: await bcrypt.hash('gizitrack-user', 10), role: 'enumerator', full_name: 'Tim Enumerator Pontianak' }
  ]);
  res.json({ message: 'Seeded' });
});

// Start Server
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 E-GiziTrack running on http://localhost:${PORT}`);
    console.log(`   Login: username="enumerator" password="gizitrack-user" role=enumerator`);
  });
}

module.exports = app;
