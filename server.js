// server.js — version complète (ES Modules) avec Supabase Storage + Session + Auth

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// ---------- Helpers chemin ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- App ----------
const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Static & body parsers ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- Sessions (une seule fois) ----------
app.set('trust proxy', 1); // Render est derrière un proxy
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  proxy: true, // IMPORTANT derrière proxy pour les cookies "secure"
  cookie: {
    httpOnly: true,
    // MODE TEST compatible partout : quand tout marche, passe à { sameSite:'none', secure:true }
    sameSite: 'lax',
    secure: false,
    path: '/',                // cookie valable sur tout le site
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
  }
}));

// ---------- BDD SQLite ----------
sqlite3.verbose();
const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      description TEXT DEFAULT '',
      language TEXT DEFAULT 'fr',
      price_cents INTEGER DEFAULT 0,
      categories TEXT DEFAULT '',
      cover_path TEXT,
      pdf_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ---------- Auth minimal ----------
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

function requireAuth(req, res, next) {
  if (req.session?.user?.email === ADMIN_EMAIL) return next();
  return res.status(401).json({ error: 'Non autorisé' });
}

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'missing' });

    const ok = (email === ADMIN_EMAIL && password === ADMIN_PASSWORD);
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid' });

    req.session.user = { email };
    req.session.save(err => {
      if (err) return res.status(500).json({ ok: false, error: 'session' });
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ ok: false, error: 'server' });
  }
});

app.get('/api/me', (req, res) => {
  const user = req.session?.user?.email || null;
  return res.json({ user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid', { path: '/' });
    return res.json({ ok: true });
  });
});

// ---- DEBUG TEMP (retire-le quand tout marche) ----
app.get('/api/debug-session', (req, res) => {
  res.json({
    gotCookieHeader: !!req.headers.cookie,
    cookieHeader: req.headers.cookie || null,
    sessionID: req.sessionID || null,
    sessionUser: req.session?.user || null
  });
});

// ---------- Supabase Storage ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ebook-site2';

// Multer en mémoire (pas d’écriture disque Render)
const storage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 Mo
});
const upload = multer({ storage });

async function uploadToSupabase(file, destPath) {
  const { error } = await supabase
    .storage
    .from(SUPABASE_BUCKET)
    .upload(destPath, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      cacheControl: '31536000',
      upsert: false
    });
  if (error) throw error;

  const { data: pub } = supabase
    .storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(destPath);

  return pub.publicUrl;
}

// ---------- API ebooks ----------

// Liste / recherche
app.get('/api/ebooks', (req, res) => {
  const q = (req.query.q || '').trim();
  const base = `SELECT * FROM ebooks`;
  if (!q) {
    return db.all(base + ` ORDER BY id DESC`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    });
  }
  const like = `%${q}%`;
  db.all(
    base + ` WHERE title LIKE ? OR author LIKE ? OR description LIKE ? OR categories LIKE ? ORDER BY id DESC`,
    [like, like, like, like],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    }
  );
});

// Ajout (ADMIN)
app.post(
  '/api/ebooks',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { title, author, description, language, price_cents, categories } = req.body;
      const coverFile = req.files?.cover?.[0];
      const pdfFile = req.files?.pdf?.[0];

      if (!title || !author || !pdfFile) {
        return res.status(400).json({ error: 'Titre, auteur et fichier PDF obligatoires.' });
      }

      const sanitize = (n) => n.replace(/[^\w\.-]/g, '_');
      const now = Date.now();
      let coverUrl = null;
      let pdfUrl = null;

      if (coverFile) {
        const dest = `covers/${now}-${sanitize(coverFile.originalname)}`;
        coverUrl = await uploadToSupabase(coverFile, dest);
      }
      {
        const dest = `pdfs/${now}-${sanitize(pdfFile.originalname)}`;
        pdfUrl = await uploadToSupabase(pdfFile, dest);
      }

      const stmt = db.prepare(
        `INSERT INTO ebooks
         (title, author, description, language, price_cents, categories, cover_path, pdf_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        title,
        author,
        description || '',
        language || 'fr',
        Number(price_cents || 0),
        categories || '',
        coverUrl,
        pdfUrl,
        function (err) {
          if (err) return res.status(500).json({ error: 'DB error' });
          res.json({ ok: true, id: this.lastID });
        }
      );
    } catch (e) {
      console.error('Upload error:', e);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// Edition (ADMIN)
app.put(
  '/api/ebooks/:id',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { title, author, description, language, price_cents, categories } = req.body;
      const coverFile = req.files?.cover?.[0];
      const pdfFile = req.files?.pdf?.[0];

      const sanitize = (n) => n.replace(/[^\w\.-]/g, '_');
      const fields = [];
      const params = [];

      if (title) { fields.push('title=?'); params.push(title); }
      if (author) { fields.push('author=?'); params.push(author); }
      if (description !== undefined) { fields.push('description=?'); params.push(description); }
      if (language) { fields.push('language=?'); params.push(language); }
      if (price_cents !== undefined) { fields.push('price_cents=?'); params.push(Number(price_cents || 0)); }
      if (categories !== undefined) { fields.push('categories=?'); params.push(categories); }

      if (coverFile) {
        const dest = `covers/${Date.now()}-${sanitize(coverFile.originalname)}`;
        const url = await uploadToSupabase(coverFile, dest);
        fields.push('cover_path=?'); params.push(url);
      }
      if (pdfFile) {
        const dest = `pdfs/${Date.now()}-${sanitize(pdfFile.originalname)}`;
        const url = await uploadToSupabase(pdfFile, dest);
        fields.push('pdf_path=?'); params.push(url);
      }

      if (!fields.length) return res.json({ ok: true, updated: 0 });

      params.push(id);
      const sql = `UPDATE ebooks SET ${fields.join(', ')} WHERE id=?`;
      db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ ok: true, updated: this.changes });
      });
    } catch (e) {
      console.error('Update error:', e);
      res.status(500).json({ error: 'Update failed' });
    }
  }
);

// Suppression (ADMIN)
app.delete('/api/ebooks/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.run(`DELETE FROM ebooks WHERE id=?`, [id], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ ok: true, deleted: this.changes });
  });
});

// ---------- Pages (accès direct) ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Lancement ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
