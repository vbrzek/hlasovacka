'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// Veřejná adresa (např. https://hlasovani.example.cz) – použije se v QR kódu.
// Když není nastavená, odvodí se z hlavičky Host požadavku.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const COLORS = ['#5769e7', '#f17e73', '#2e3a6b', '#8f97e8', '#f3b06b', '#3fa98c', '#b45bb5', '#7c8597'];
const VOTE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const longToken = () => crypto.randomBytes(18).toString('base64url');
function voteTokenGen() {
  let t;
  do {
    const b = crypto.randomBytes(6);
    t = Array.from(b, (x) => VOTE_ALPHABET[x % VOTE_ALPHABET.length]).join('');
  } while (tokens.has(t));
  return t;
}

/* ------------------------------------------------------------------ úložiště */

const presentations = new Map(); // id -> prezentace
const tokens = new Map(); // token -> { id, role }

function register(p) {
  presentations.set(p.id, p);
  tokens.set(p.adminToken, { id: p.id, role: 'admin' });
  tokens.set(p.screenToken, { id: p.id, role: 'screen' });
  tokens.set(p.voteToken, { id: p.id, role: 'voter' });
}

for (const f of fs.readdirSync(DATA_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    register(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));
  } catch (e) {
    console.error('Nelze načíst', f, e.message);
  }
}

const dirty = new Set();
const markDirty = (p) => dirty.add(p.id);
const fileOf = (id) => path.join(DATA_DIR, id + '.json');

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  for (const id of [...dirty]) {
    dirty.delete(id);
    const p = presentations.get(id);
    if (!p) continue;
    try {
      const f = fileOf(id);
      await fs.promises.writeFile(f + '.tmp', JSON.stringify(p));
      await fs.promises.rename(f + '.tmp', f);
    } catch (e) {
      console.error('Ukládání selhalo', id, e.message);
      dirty.add(id);
    }
  }
  flushing = false;
}
setInterval(flush, 1500);

function flushSync() {
  for (const id of dirty) {
    const p = presentations.get(id);
    if (p) fs.writeFileSync(fileOf(id), JSON.stringify(p));
  }
  dirty.clear();
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flushSync();
    process.exit(0);
  });
}

/* --------------------------------------------------------------- pomocníci */

const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
const cleanImage = (v) =>
  typeof v === 'string' && /^\/uploads\/[\w-]+\.(png|jpe?g|gif|webp)$/.test(v) ? v : '';

function cleanSlide(s) {
  s = s && typeof s === 'object' ? s : {};
  const options = (Array.isArray(s.options) ? s.options : []).slice(0, 8).map((o, i) => ({
    text: str(o && o.text, 200),
    color: o && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : COLORS[i % COLORS.length],
  }));
  return {
    id: typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : crypto.randomBytes(6).toString('base64url'),
    type: s.type === 'choice' ? 'choice' : 'static',
    title: str(s.title, 500),
    image: cleanImage(s.image),
    options,
    showPercent: s.showPercent !== false,
  };
}

const currentSlide = (p) => p.slides.find((s) => s.id === p.currentId) || null;

function results(p, s) {
  const counts = s.options.map(() => 0);
  const votes = p.votes[s.id];
  let total = 0;
  if (votes) {
    for (const v of Object.values(votes)) {
      if (v < counts.length) {
        counts[v]++;
        total++;
      }
    }
  }
  return { slideId: s.id, counts, total };
}

function publicState(p) {
  const s = currentSlide(p);
  return {
    title: p.title,
    logo: p.logo,
    intro: p.intro,
    showQr: p.showQr,
    voteToken: p.voteToken,
    publicUrl: PUBLIC_URL,
    currentId: p.currentId,
    index: s ? p.slides.indexOf(s) : -1,
    count: p.slides.length,
    slide: s,
    results: s && s.type === 'choice' ? results(p, s) : null,
  };
}

const roomSize = (room) => io.sockets.adapter.rooms.get(room)?.size || 0;
const myVote = (p, voterId) => {
  const v = p.votes[p.currentId]?.[voterId];
  return v === undefined ? null : v;
};

function broadcastState(p) {
  const st = publicState(p);
  io.to(['a:' + p.id, 's:' + p.id]).emit('state', st);
  // hlasujícím posíláme personalizovaný stav (jestli už hlasovali)
  for (const sid of io.sockets.adapter.rooms.get('v:' + p.id) || []) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit('state', { ...st, myVote: myVote(p, sock.data.voterId) });
  }
}

function voteUrl(req, p) {
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/v/${p.voteToken}`;
}

/* -------------------------------------------------------------------- HTTP */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));

const VIEWS = path.join(__dirname, 'views');
function page(file, role) {
  return (req, res) => {
    const ref = tokens.get(req.params.token);
    if (!ref || ref.role !== role) return res.status(404).sendFile(path.join(VIEWS, '404.html'));
    res.set('Cache-Control', 'no-store').sendFile(path.join(VIEWS, file));
  };
}
app.get('/', (req, res) => res.sendFile(path.join(VIEWS, 'index.html')));
app.get('/a/:token', page('admin.html', 'admin'));
app.get('/s/:token', page('screen.html', 'screen'));
app.get('/v/:token', page('vote.html', 'voter'));

function adminP(req, res) {
  const ref = tokens.get(req.params.token);
  if (!ref || ref.role !== 'admin') {
    res.status(404).json({ error: 'Prezentace nenalezena' });
    return null;
  }
  return presentations.get(ref.id);
}

app.post('/api/presentations', (req, res) => {
  const p = {
    id: crypto.randomBytes(9).toString('base64url'),
    createdAt: new Date().toISOString(),
    title: str(req.body && req.body.title, 200).trim() || 'Nová prezentace',
    adminToken: longToken(),
    screenToken: longToken(),
    voteToken: voteTokenGen(),
    logo: '',
    intro: '',
    showQr: true,
    currentId: null,
    slides: [
      cleanSlide({ type: 'static', title: 'Vítejte!' }),
      cleanSlide({ type: 'choice', title: 'Ukázková otázka?', options: [{ text: 'ANO' }, { text: 'NE' }] }),
    ],
    votes: {},
  };
  register(p);
  markDirty(p);
  res.json({ adminUrl: '/a/' + p.adminToken });
});

app.get('/api/admin/:token', (req, res) => {
  const p = adminP(req, res);
  if (!p) return;
  const { title, logo, intro, showQr, slides, currentId, adminToken, screenToken, voteToken } = p;
  res.json({ title, logo, intro, showQr, slides, currentId, adminToken, screenToken, voteToken, publicUrl: PUBLIC_URL });
});

app.put('/api/admin/:token', (req, res) => {
  const p = adminP(req, res);
  if (!p) return;
  const b = req.body || {};
  const before = JSON.stringify({ ...publicState(p), results: null });

  p.title = str(b.title, 200);
  p.logo = cleanImage(b.logo);
  p.intro = cleanImage(b.intro);
  p.showQr = b.showQr !== false;
  if (Array.isArray(b.slides)) {
    const seen = new Set();
    p.slides = b.slides.slice(0, 200).map(cleanSlide).filter((s) => !seen.has(s.id) && seen.add(s.id));
  }
  if (p.currentId && !currentSlide(p)) p.currentId = null;
  markDirty(p);

  // rozesíláme jen pokud se změnilo něco, co je vidět na plátně / v mobilu
  if (JSON.stringify({ ...publicState(p), results: null }) !== before) broadcastState(p);
  res.json({ ok: true });
});

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
});
app.post(
  '/api/admin/:token/upload',
  (req, res, next) => (adminP(req, res) ? next() : undefined),
  upload.single('file'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nahrajte obrázek PNG, JPG, GIF nebo WebP.' });
    res.json({ url: '/uploads/' + req.file.filename });
  }
);

app.get('/qr/:token', async (req, res) => {
  const ref = tokens.get(req.params.token);
  if (!ref || ref.role !== 'voter') return res.status(404).end();
  const svg = await QRCode.toString(voteUrl(req, presentations.get(ref.id)), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(svg);
});

app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Soubor je příliš velký (max 15 MB).' : 'Chyba serveru';
  if (err.code !== 'LIMIT_FILE_SIZE') console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: msg });
});

/* ------------------------------------------------------------------ sockety */

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4, pingTimeout: 30000 });

const pendingResults = new Set();

io.on('connection', (socket) => {
  const { token, voterId } = socket.handshake.auth || {};
  const ref = tokens.get(token);
  if (!ref) {
    socket.emit('fatal', 'Prezentace nenalezena');
    return socket.disconnect(true);
  }
  const p = presentations.get(ref.id);
  const st = publicState(p);

  if (ref.role === 'admin') {
    socket.join('a:' + p.id);
    socket.emit('state', st);
    socket.emit('stats', { voters: roomSize('v:' + p.id), screens: roomSize('s:' + p.id) });

    socket.on('goto', (data) => {
      const id = data && data.slideId;
      if (id !== null && !p.slides.some((s) => s.id === id)) return;
      p.currentId = id;
      markDirty(p);
      broadcastState(p);
    });
    socket.on('reset', (data) => {
      const id = data && data.slideId;
      if (typeof id !== 'string' || !p.votes[id]) return;
      delete p.votes[id];
      markDirty(p);
      broadcastState(p);
    });
    return;
  }

  if (ref.role === 'screen') {
    socket.join('s:' + p.id);
    socket.emit('state', st);
    return;
  }

  // hlasující
  const vid = typeof voterId === 'string' && /^[\w-]{8,64}$/.test(voterId) ? voterId : null;
  socket.data.voterId = vid;
  socket.join('v:' + p.id);
  socket.emit('state', { ...st, myVote: myVote(p, vid) });

  socket.on('vote', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const s = currentSlide(p);
    const option = data && data.option;
    if (!vid || !s || s.type !== 'choice' || !data || data.slideId !== s.id) {
      return reply({ ok: false, error: 'Hlasování k této otázce už skončilo.' });
    }
    if (!Number.isInteger(option) || option < 0 || option >= s.options.length) {
      return reply({ ok: false, error: 'Neplatná volba.' });
    }
    const votes = (p.votes[s.id] ||= {});
    if (votes[vid] !== undefined) return reply({ ok: true, myVote: votes[vid], results: results(p, s) });
    votes[vid] = option;
    markDirty(p);
    pendingResults.add(p.id);
    reply({ ok: true, myVote: option, results: results(p, s) });
  });
});

// výsledky rozesíláme dávkově – max. ~3× za sekundu, ne po každém hlasu
setInterval(() => {
  for (const id of pendingResults) {
    const p = presentations.get(id);
    const s = p && currentSlide(p);
    if (s && s.type === 'choice') io.to(['a:' + id, 's:' + id, 'v:' + id]).emit('results', results(p, s));
  }
  pendingResults.clear();
}, 300);

// statistiky připojených pro administrátora
setInterval(() => {
  for (const room of io.sockets.adapter.rooms.keys()) {
    if (!room.startsWith('a:')) continue;
    const id = room.slice(2);
    io.to(room).emit('stats', { voters: roomSize('v:' + id), screens: roomSize('s:' + id) });
  }
}, 2000);

server.listen(PORT, undefined, 2048, () => {
  console.log(`Běží na http://localhost:${PORT}  (data: ${DATA_DIR})`);
});
