
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import session from 'express-session';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// -------- Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions (change SESSION_SECRET in production)
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_secret';
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8h
}));

// Auth helpers
function ensureAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: 'Non autorisé' });
}

// SQLite setup
const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    description TEXT,
    language TEXT DEFAULT 'fr',
    price_cents INTEGER DEFAULT 0,
    categories TEXT,
    cover_path TEXT,
    pdf_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'cover') cb(null, path.join(__dirname, 'uploads', 'covers'));
    else cb(null, path.join(__dirname, 'uploads', 'pdfs'));
  },
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^\w\.-]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

// -------- Auth routes
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.email = email;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Identifiants incorrects' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ isAdmin: !!req.session?.isAdmin, email: req.session?.email || null });
});

// -------- Protect admin HTML before static
app.get('/admin.html', (req, res, next) => {
  if (!req.session?.isAdmin) return res.redirect('/login.html');
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/', express.static(path.join(__dirname, 'public')));

// -------- API routes

// Add ebook (ADMIN)
app.post('/api/ebooks', ensureAdmin, upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), (req, res) => {
  try {
    const { title, author, description, language, price_cents, categories } = req.body;
    const cover = req.files?.cover?.[0]?.path?.replace(__dirname, '');
    const pdf = req.files?.pdf?.[0]?.path?.replace(__dirname, '');

    if (!title || !author || !pdf) {
      return res.status(400).json({ error: 'Titre, auteur et fichier PDF obligatoires.' });
    }

    const stmt = db.prepare(`INSERT INTO ebooks (title, author, description, language, price_cents, categories, cover_path, pdf_path)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(title, author, description || '', language || 'fr', Number(price_cents || 0), categories || '', cover ? cover.replace(/^\/?/, '/') : null, pdf ? pdf.replace(/^\/?/, '/') : null, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    });
    stmt.finalize();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List/search ebooks (PUBLIC)
app.get('/api/ebooks', (req, res) => {
  const { q = '', lang = '', category = '' } = req.query;
  const terms = `%${q}%`;
  let where = "WHERE 1=1";
  const params = [];

  if (q) {
    where += " AND (title LIKE ? OR author LIKE ? OR description LIKE ? OR categories LIKE ?)";
    params.push(terms, terms, terms, terms);
  }
  if (lang) { where += " AND language = ?"; params.push(lang); }
  if (category) { where += " AND categories LIKE ?"; params.push(`%${category}%`); }

  db.all(`SELECT * FROM ebooks ${where} ORDER BY created_at DESC`, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get one ebook (PUBLIC)
app.get('/api/ebooks/:id', (req, res) => {
  db.get(`SELECT * FROM ebooks WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

// Update ebook (ADMIN) - metadata + optional file replacement
app.put('/api/ebooks/:id', ensureAdmin, upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]), (req, res) => {
  const id = req.params.id;
  const { title, author, description, language, price_cents, categories } = req.body;
  const cover = req.files?.cover?.[0]?.path?.replace(__dirname, '');
  const pdf = req.files?.pdf?.[0]?.path?.replace(__dirname, '');

  const fields = [];
  const params = [];

  if (title !== undefined) { fields.push('title=?'); params.push(title); }
  if (author !== undefined) { fields.push('author=?'); params.push(author); }
  if (description !== undefined) { fields.push('description=?'); params.push(description); }
  if (language !== undefined) { fields.push('language=?'); params.push(language); }
  if (price_cents !== undefined) { fields.push('price_cents=?'); params.push(Number(price_cents)); }
  if (categories !== undefined) { fields.push('categories=?'); params.push(categories); }
  if (cover) { fields.push('cover_path=?'); params.push(cover.replace(/^\/?/, '/')); }
  if (pdf) { fields.push('pdf_path=?'); params.push(pdf.replace(/^\/?/, '/')); }

  if (!fields.length) return res.json({ updated: 0 });

  const sql = `UPDATE ebooks SET ${fields.join(', ')} WHERE id = ?`;
  params.push(id);
  db.run(sql, params, function(err2) {
    if (err2) return res.status(500).json({ error: err2.message });
    res.json({ updated: this.changes });
  });
});

// Delete ebook (ADMIN)
app.delete('/api/ebooks/:id', ensureAdmin, (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM ebooks WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });

    // Delete files
    if (row.cover_path) {
      const p = path.join(__dirname, row.cover_path);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (row.pdf_path) {
      const p = path.join(__dirname, row.pdf_path);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    db.run(`DELETE FROM ebooks WHERE id = ?`, [id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ deleted: this.changes });
    });
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
