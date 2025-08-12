// server.js — Node ES Modules + Sessions + Supabase (DB + Storage)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// ---------- Helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Static + parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions (MemoryStore : OK sur Render Free pour une petite app)
app.set('trust proxy', 1);
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,          // passe à true si tu ajoutes un domaine HTTPS + proxy correct
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // côté serveur uniquement
);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ebook-site2';

// Upload en mémoire (PAS d’écriture disque locale → Render Free OK)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 Mo
});

// Petite utilitaire d’upload vers Supabase Storage
async function uploadToSupabase(file, destPath) {
  const { error } = await supabase
    .storage.from(SUPABASE_BUCKET)
    .upload(destPath, file.buffer, {
      cacheControl: '31536000',
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });
  if (error) throw error;

  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
  return data.publicUrl; // URL publique
}

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
    const ok = email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid' });

    req.session.user = { email };
    req.session.save(err => {
      if (err) return res.status(500).json({ ok: false, error: 'session' });
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ ok: false, error: 'server' });
  }
});

app.get('/api/me', (req, res) => res.json({ user: req.session?.user?.email || null }));
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('sid'); res.json({ ok: true }); });
});

// ---------- API Ebooks (DB = table public.ebooks) ----------

// Liste / recherche
// Liste / recherche avec filtres + pagination (Supabase)
app.get('/api/ebooks', async (req, res) => {
  try {
    // paramètres
    const q         = (req.query.q || '').trim();
    const language  = (req.query.language || '').trim();   // ex: 'fr' ou ''
    const category  = (req.query.category || '').trim();   // mot clé dans categories
    const page      = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize  = Math.min(30, Math.max(1, parseInt(req.query.pageSize || '8', 10)));
    const from      = (page - 1) * pageSize;
    const to        = from + pageSize - 1;

    let query = supabase
      .from('ebooks')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .range(from, to);

    if (q) {
      // recherche multi-champs
      query = query.or(
        `title.ilike.%${q}%,author.ilike.%${q}%,description.ilike.%${q}%,categories.ilike.%${q}%`
      );
    }
    if (language && language !== 'all') {
      query = query.eq('language', language);
    }
    if (category && category !== 'all') {
      query = query.ilike('categories', `%${category}%`);
    }

    const { data, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const total    = count || 0;
    const hasPrev  = page > 1;
    const hasNext  = to + 1 < total;

    return res.json({
      items: data || [],
      total,
      page,
      pageSize,
      hasPrev,
      hasNext
    });
  } catch (e) {
    console.error('List ebooks error:', e);
    return res.status(500).json({ error: 'server' });
  }
});
    const q = (req.query.q || '').trim();
    let query = supabase.from('ebooks').select('*').order('id', { ascending: false });
    if (q) {
      // filtre sur plusieurs colonnes
      query = query.or(
        `title.ilike.%${q}%,author.ilike.%${q}%,description.ilike.%${q}%,categories.ilike.%${q}%`
      );
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error('GET /api/ebooks error:', e);
    res.status(500).json({ error: 'db' });
  }
});

// Détail
app.get('/api/ebooks/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, error } = await supabase.from('ebooks').select('*').eq('id', id).single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('GET /api/ebooks/:id error:', e);
    res.status(404).json({ error: 'not_found' });
  }
});

// Ajout (ADMIN)
app.post(
  '/api/ebooks',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { title, author, description, language, price_cents, categories } = req.body || {};
      const coverFile = req.files?.cover?.[0] || null;
      const pdfFile = req.files?.pdf?.[0];

      if (!title || !author || !pdfFile) {
        return res.status(400).json({ error: 'Titre, auteur et PDF obligatoires.' });
      }

      const sanitize = (n) => String(n).replace(/[^\w.\-]/g, '_');
      const now = Date.now();

      let cover_url = null;
      if (coverFile) {
        cover_url = await uploadToSupabase(coverFile, `covers/${now}-${sanitize(coverFile.originalname)}`);
      }
      const pdf_url = await uploadToSupabase(pdfFile, `pdfs/${now}-${sanitize(pdfFile.originalname)}`);

      // Insert dans la table
      const { data, error } = await supabase.from('ebooks')
        .insert([{
          title,
          author,
          description: description || '',
          language: language || 'fr',
          price_cents: Number(price_cents || 0),
          categories: categories || '',
          cover_path: cover_url,
          pdf_path: pdf_url
        }])
        .select()
        .single();

      if (error) throw error;
      res.json({ ok: true, id: data.id });
    } catch (e) {
      console.error('POST /api/ebooks error:', e);
      res.status(500).json({ error: 'upload_or_db' });
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
      const { title, author, description, language, price_cents, categories } = req.body || {};
      const coverFile = req.files?.cover?.[0] || null;
      const pdfFile = req.files?.pdf?.[0] || null;

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (author !== undefined) updates.author = author;
      if (description !== undefined) updates.description = description;
      if (language !== undefined) updates.language = language;
      if (price_cents !== undefined) updates.price_cents = Number(price_cents || 0);
      if (categories !== undefined) updates.categories = categories;

      const sanitize = (n) => String(n).replace(/[^\w.\-]/g, '_');
      const now = Date.now();

      if (coverFile) {
        updates.cover_path = await uploadToSupabase(coverFile, `covers/${now}-${sanitize(coverFile.originalname)}`);
      }
      if (pdfFile) {
        updates.pdf_path = await uploadToSupabase(pdfFile, `pdfs/${now}-${sanitize(pdfFile.originalname)}`);
      }

      const { data, error } = await supabase.from('ebooks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json({ ok: true, updated: data ? 1 : 0 });
    } catch (e) {
      console.error('PUT /api/ebooks/:id error:', e);
      res.status(500).json({ error: 'update' });
    }
  }
);

// Suppression (ADMIN)
app.delete('/api/ebooks/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('ebooks').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/ebooks/:id error:', e);
    res.status(500).json({ error: 'delete' });
  }
});

// ---------- Pages ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/ebook', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ebook.html'))); // page détail
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- Start ----------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
