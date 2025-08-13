// server.js — Express (ESM) + Sessions (Render) + Supabase Storage + Supabase Postgres

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Static & parsers
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.set('trust proxy', 1);
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7*24*60*60*1000 }
}));

// Auth minimal
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
function requireAuth(req, res, next) {
  if (req.session?.user?.email === ADMIN_EMAIL) return next();
  return res.status(401).json({ ok:false, error:'unauthorized' });
}
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'missing' });
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).json({ ok:false, error:'invalid' });
  req.session.user = { email };
  req.session.save(err => err ? res.status(500).json({ ok:false, error:'session' }) : res.json({ ok:true }));
});
app.get('/api/me', (req,res)=> res.json({ user: req.session?.user?.email || null }));
app.post('/api/logout', (req,res)=> req.session.destroy(()=> { res.clearCookie('sid'); res.json({ ok:true }); }));

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'ebook-site2';

// Upload (mémoire) vers Supabase Storage
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50*1024*1024 } });
const sanitize = (n) => (n || '').replace(/[^\w.\-]/g, '_');
async function uploadToSupabase(file, destPath) {
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(destPath, file.buffer, {
    cacheControl: '31536000',
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false
  });
  if (error) { console.error('Supabase upload error:', error); throw error; }
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
  return data.publicUrl;
}

// --------- API ebooks (Supabase Postgres) ---------

// Liste + filtres + pagination
app.get('/api/ebooks', async (req, res) => {
  try {
    const qRaw = (req.query.q || '').trim();
    const language = (req.query.language || req.query.lang || '').trim();
    const category = (req.query.category || req.query.cat || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(30, Math.max(1, parseInt(req.query.pageSize || '8', 10)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase.from('ebooks').select('*', { count: 'exact' }).order('id', { ascending: false }).range(from, to);
    if (qRaw) {
      const q = `%${qRaw}%`;
      query = query.or(`title.ilike.${q},author.ilike.${q},description.ilike.${q},categories.ilike.${q}`);
    }
    if (language) query = query.eq('language', language);
    if (category) query = query.ilike('categories', `%${category}%`);

    const { data, count, error } = await query;
    if (error) throw error;

    const total = count || 0;
    res.json({
      items: data || [],
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      hasPrev: page > 1,
      hasNext: to + 1 < total
    });
  } catch (e) {
    console.error('GET /api/ebooks error:', e);
    res.status(500).json({ items: [], total: 0, page: 1, pageSize: 0, pages: 1 });
  }
});

// Détail
app.get('/api/ebooks/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data, error } = await supabase.from('ebooks').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'not_found' });
    res.json(data);
  } catch (e) {
    console.error('GET /api/ebooks/:id error:', e);
    res.status(404).json({ error: 'not_found' });
  }
});

// Ajout (ADMIN)
app.post('/api/ebooks',
  requireAuth,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'pdf', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { title, author, description, language, price_cents, categories } = req.body || {};
      const coverFile = req.files?.cover?.[0] || null;
      const pdfFile   = req.files?.pdf?.[0] || null;
      if (!title || !author || !pdfFile) return res.status(400).json({ ok:false, error:'missing_fields' });

      const now = Date.now();
      let coverUrl = null;
      if (coverFile) coverUrl = await uploadToSupabase(coverFile, `covers/${now}-${sanitize(coverFile.originalname)}`);
      const pdfUrl = await uploadToSupabase(pdfFile, `pdfs/${now}-${sanitize(pdfFile.originalname)}`);

      const { data, error } = await supabase.from('ebooks').insert([{
        title,
        author,
        description: description || '',
        language: language || 'Français',
        price_cents: Number(price_cents || 0),
        categories: categories || '',
        cover_path: coverUrl,
        pdf_path: pdfUrl
      }]).select('id').single();

      if (error) throw error;
      res.json({ ok: true, id: data.id });
    } catch (e) {
      console.error('POST /api/ebooks error:', e);
      res.status(500).json({ ok:false, error:'upload_or_db' });
    }
  }
);

// Suppression (ADMIN)
app.delete('/api/ebooks/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('ebooks').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok:true });
  } catch (e) {
    console.error('DELETE /api/ebooks error:', e);
    res.status(500).json({ ok:false });
  }
});

// Pages
app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/ebook.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'ebook.html')));
app.get('/login.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin.html', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Start
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
