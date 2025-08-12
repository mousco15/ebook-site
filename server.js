// server.js — Express + Sessions (Render) + Supabase (Storage + DB) + Pagination
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

// ---------- Résolution des chemins ----------
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
  cookie: {
    httpOnly: true,
    sameSite: 'lax',       // compatible sur free Render
    secure: false,         // passera à true si tu mets un proxy/https + sameSite:'none'
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 jours
  }
}));

// ---------- Supabase (Storage + DB) ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ebook-site2';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------- Auth admin très simple ----------
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

function requireAuth(req, res, next) {
  if (req.session?.user?.email === ADMIN_EMAIL) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
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
    res.clearCookie('sid');
    return res.json({ ok: true });
  });
});

// ---------- Upload vers Supabase Storage ----------
const memStorage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const upload = multer({ storage: memStorage });

function sanitize(name) {
  return (name || '').replace(/[^\w.\-]/g, '_');
}

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

// Liste + recherche + pagination (page 1..n, pageSize 6 par défaut)
app.get('/api/ebooks', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const language = (req.query.language || '').trim();
    const category = (req.query.category || '').trim();
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '6', 10), 1), 50);

    let query = supabase.from('ebooks').select('*', { count: 'exact' });

    if (q) {
      // titre/auteur/description/categories en ilike
      query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%,description.ilike.%${q}%,categories.ilike.%${q}%`);
    }
    if (language) query = query.ilike('language', `%${language}%`);
    if (category) query = query.ilike('categories', `%${category}%`);

    // tri du plus récent
    query = query.order('id', { ascending: false });

    // pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ data: data || [], page, pageSize, total: count || 0 });
  } catch (e) {
    console.error('GET /api/ebooks error:', e);
    return res.status(500).json({ data: [], page: 1, pageSize: 0, total: 0 });
  }
});

// Ajout (ADMIN) — cover (optionnelle) + pdf (obligatoire)
app.post(
  '/api/ebooks',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { title, author, description, language, price_cents, categories } = req.body || {};
      const coverFile = req.files?.cover?.[0] || null;
      const pdfFile = req.files?.pdf?.[0] || null;

      if (!title || !author || !pdfFile) {
        return res.status(400).json({ ok: false, error: 'missing_fields' });
      }

      const now = Date.now();
      let coverUrl = null;
      if (coverFile) {
        const dest = `covers/${now}-${sanitize(coverFile.originalname)}`;
        coverUrl = await uploadToSupabase(coverFile, dest);
      }
      const pdfDest = `pdfs/${now}-${sanitize(pdfFile.originalname)}`;
      const pdfUrl = await uploadToSupabase(pdfFile, pdfDest);

      // Insert dans la table 'ebooks' (Supabase Postgres)
      const { data, error } = await supabase
        .from('ebooks')
        .insert({
          title,
          author,
          description: description || '',
          language: language || 'fr',
          price_cents: Number(price_cents || 0),
          categories: categories || '',
          cover_path: coverUrl,
          pdf_path: pdfUrl
        })
        .select()
        .single();

      if (error) throw error;

      return res.json({ ok: true, ebook: data });
    } catch (e) {
      console.error('POST /api/ebooks error:', e);
      return res.status(500).json({ ok: false, error: 'upload_failed' });
    }
  }
);

// (Facultatif) suppression ADMIN
app.delete('/api/ebooks/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('ebooks').delete().eq('id', id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/ebooks error:', e);
    return res.status(500).json({ ok: false });
  }
});

// ---------- Pages ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
