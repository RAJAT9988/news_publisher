// server.js  (ES-module version – works on https://atomo.in:3007)
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import multer from 'multer';
import cors from 'cors';
import os from 'os';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3007;

// ---------------------------------------------------------------------
// 1. Load Let’s Encrypt certs (same paths you use in the first server)
// ---------------------------------------------------------------------
const privateKey = fs.readFileSync('./certs/privkey.pem', 'utf8');
const certificate = fs.readFileSync('./certs/fullchain.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

// ---------------------------------------------------------------------
// 2. Helper: get external IPv4 address (used only for logging)
// ---------------------------------------------------------------------
function getExternalIp() {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) return cfg.address;
    }
  }
  return '127.0.0.1';
}
const EXTERNAL_IP = getExternalIp();

// ---------------------------------------------------------------------
// 3. CORS – production-ready (only atomo.in)
// ---------------------------------------------------------------------
app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (Postman, curl, mobile apps)
      if (!origin) return callback(null, true);

      // development – allow everything
      if (process.env.NODE_ENV !== 'production') return callback(null, true);

      // production – whitelist
      const allowed = ['https://atomo.in'];
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ---------------------------------------------------------------------
// 4. Middleware
// ---------------------------------------------------------------------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));                     // serve everything in cwd
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------------------------------------------------------
// 5. Multer – image uploads (max 5 MB)
// ---------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(__dirname, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, 'uploads/');
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images!'));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---------------------------------------------------------------------
// 6. JSON file handling (news)
// ---------------------------------------------------------------------
const NEWS_FILE = path.join(__dirname, 'news.json');

function initNews() {
  if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, '[]');
}
function readNews() {
  try { return JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); }
  catch { return []; }
}
function writeNews(data) {
  try { fs.writeFileSync(NEWS_FILE, JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
}

// ---------------------------------------------------------------------
// 7. API routes
// ---------------------------------------------------------------------
app.get('/api/news', (req, res) => {
  const news = readNews();
  const base = `${req.protocol}://${req.get('host')}`;
  const withUrl = news.map(n => ({
    ...n,
    image: n.image ? `${base}${n.image}` : null,
  }));
  res.json(withUrl);
});

app.get('/api/news/:id', (req, res) => {
  const id = Number(req.params.id);
  const news = readNews();
  const item = news.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    ...item,
    image: item.image ? `${base}${item.image}` : null,
  });
});

app.post('/api/news', upload.single('image'), (req, res) => {
  const { title, subtitle, date, content } = req.body;
  if (!title || !content) return res.status(400).json({ success: false, message: 'title & content required' });

  const news = readNews();
  const newItem = {
    id: news.length ? Math.max(...news.map(i => i.id)) + 1 : 1,
    title: title.trim(),
    subtitle: subtitle?.trim() ?? '',
    date: date || new Date().toISOString().split('T')[0],
    content: content.trim(),
    image: req.file ? `/uploads/${req.file.filename}` : null,
    createdAt: new Date().toISOString(),
  };

  news.unshift(newItem);
  writeNews(news)
    ? res.json({ success: true, news: newItem })
    : res.status(500).json({ success: false, message: 'write error' });
});

app.delete('/api/news/:id', (req, res) => {
  const id = Number(req.params.id);
  const news = readNews();
  const idx = news.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Not found' });

  // delete image file
  if (news[idx].image) {
    const p = path.join(__dirname, news[idx].image);
    fs.existsSync(p) && fs.unlinkSync(p);
  }

  news.splice(idx, 1);
  writeNews(news)
    ? res.json({ success: true })
    : res.status(500).json({ success: false });
});

// ---------------------------------------------------------------------
// 8. Static pages
// ---------------------------------------------------------------------
app.get('/website', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin',   (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/',        (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------------------------------------------------------------------
// 9. Multer error handling
// ---------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ success: false, message: 'File > 5 MB' });
  res.status(500).json({ success: false, message: err.message });
});

// ---------------------------------------------------------------------
// 10. Start HTTPS server on 0.0.0.0
// ---------------------------------------------------------------------
const server = https.createServer(credentials, app);

server.listen(PORT, '0.0.0.0', () => {
  initNews();
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

  console.log('\nHTTPS Server running on all interfaces');
  console.log(`   Local : https://localhost:${PORT}`);
  console.log(`   LAN   : https://${EXTERNAL_IP}:${PORT}`);
  console.log(`   Public: https://127.0.0.53:${PORT}`);
  console.log(`   Admin : https://3.110.51.14:${PORT}/admin`);
  console.log(`   API   : https://3.110.51.14:${PORT}/api/news\n`);
});
