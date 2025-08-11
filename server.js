// server.js — en-tête propre + session + auth

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import sqlite3 from 'sqlite3';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// Helpers chemin
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App
const app = express();
const PORT = process.env.PORT || 3000;

// Static + body parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Render est derrière un proxy
app.set('trust proxy', 1);

// ---------- SESSION (UNE seule fois) ----------
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me', // définis SESSION_SECRET dans Render > Environment
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Version compatible partout (test) :
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
// ---------- FIN SESSION ----------

// (optionnel) logs verbeux sqlite
sqlite3.verbose();

// ---------- AUTH ----------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'missing' });
    }

    const ok =
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD;

    if (!ok) {
      return res.status(401).json({ ok: false, error: 'invalid' });
    }

    // enregistre l'utilisateur en session
    req.session.user = { email };
    req.session.save(err => {
      if (err) {
        console.error('session.save error:', err);
        return res.status(500).json({ ok: false, error: 'session' });
      }
      console.log('LOGIN OK for', email);
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
    res.clearCookie('sid');
    return res.json({ ok: true });
  });
});
// --- FIN AUTH ---
// ---------- API livres ----------

// Liste / recherche
app.get('/api/ebooks', (req, res) => {
  const q = (req.query.q || '').trim();
  const sqlBase = `SELECT * FROM ebooks`;
  if (!q) {
    return db.all(sqlBase + ` ORDER BY id DESC`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    });
  }
  const like = `%${q}%`;
  db.all(
    sqlBase +
      ` WHERE title LIKE ? OR author LIKE ? OR description LIKE ? OR categories LIKE ?
        ORDER BY id DESC`,
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

      const sanitize = (name) => name.replace(/[^\w\.-]/g, '_');
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
          if (err) {
            console.error('DB error:', err);
            return res.status(500).json({ error: 'DB error' });
          }
          return res.json({ ok: true, id: this.lastID });
        }
      );
    } catch (e) {
      console.error('Upload error:', e);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// Edition (ADMIN) — facultatif si tu n’en as pas besoin
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

      const fields = [];
      const params = [];

      if (title) { fields.push('title=?'); params.push(title); }
      if (author) { fields.push('author=?'); params.push(author); }
      if (description !== undefined) { fields.push('description=?'); params.push(description); }
      if (language) { fields.push('language=?'); params.push(language); }
      if (price_cents !== undefined) { fields.push('price_cents=?'); params.push(Number(price_cents || 0)); }
      if (categories !== undefined) { fields.push('categories=?'); params.push(categories); }

      const sanitize = (name) => name.replace(/[^\w\.-]/g, '_');
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

// ---------- Pages (si accédées directement) ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Lancement ----------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
