/**
 * KlikClip — Express Server v2
 * DeepSeek + FFmpeg clipper. JSON file storage. No SQLite.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { requireAuth, optionalAuth, register, login, checkAndDecrementQuota, addCredits, loadUsers, saveUsers, PLAN_LIMITS } = require('./lib/Auth');
const { createSnapToken, verifyWebhookSignature, isPaymentSuccess, CREDIT_PACKAGES, getPackage } = require('./lib/Midtrans');
const { getVideoInfo, downloadVideo, processClip, cleanupTmp, getClipPath, clipExists } = require('./lib/Clipper');
const { detectHighlights, fallbackHighlights } = require('./lib/AIHighlight');
const db = require('./lib/db');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3030;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CLIPS_DIR = process.env.CLIPS_DIR || path.join(__dirname, 'clips');
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, 'tmp');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

// Ensure dirs exist
[CLIPS_DIR, TMP_DIR, UPLOAD_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── In-memory job store (lost on restart, fine for MVP) ────────────────────
const jobs = new Map();
let dbReady = false;

// ─── Database init ────────────────────────────────────────────────────────────
(async () => {
  dbReady = await db.initDb();
  if (dbReady) console.log('[DB] PostgreSQL connected');
  // Reload jobs from DB into memory
  try {
    const p = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
    const r = await p.query('SELECT id FROM kc_jobs WHERE status NOT IN ($1,$2)', ['done', 'error']);
    for (const row of r.rows) {
      const job = await db.dbGetJob(row.id);
      if (job) jobs.set(job.id, job);
    }
    await p.end();
    console.log(`[DB] Restored ${r.rows.length} active jobs`);
  } catch {}
})();

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/clips', express.static(CLIPS_DIR));

const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    console.error('[VS]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
};

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const result = await register(email, password, name);
  res.json(result);
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib' });
  const result = await login(email, password);
  res.json(result);
}));

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  let user;
  if (dbReady) {
    user = await db.dbFindUserById(req.user.id);
  } else {
    const users = loadUsers();
    user = Object.values(users).find(u => u.id === req.user.id);
  }
  if (!user) return res.status(404).json({ error: 'User not found' });

  const limit = user.plan === 'free' ? PLAN_LIMITS.free : PLAN_LIMITS[user.plan] || 999;
  res.json({
    id: user.id, email: user.email, name: user.name, plan: user.plan,
    clips_used: user.clips_used || 0,
    clips_remaining: Math.max(0, limit - (user.clips_used || 0)),
    total_processed: user.total_processed || 0,
  });
}));

// ─── GOOGLE AUTH ────────────────────────────────────────────────────────────
app.post('/api/auth/google', wrap(async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Credential required' });

  // Verify with Google's tokeninfo endpoint (no SDK needed)
  const axios = require('axios');
  let payload;
  try {
    const verifyResp = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`, { timeout: 5000 });
    payload = verifyResp.data;
  } catch (e) {
    return res.status(401).json({ error: 'Invalid Google credential' });
  }

  // Verify audience matches our client ID
  const expectedAud = process.env.GOOGLE_CLIENT_ID;
  if (expectedAud && payload.aud !== expectedAud) {
    return res.status(401).json({ error: 'Invalid audience' });
  }

  const googleEmail = payload.email;
  if (!googleEmail) return res.status(401).json({ error: 'Email required from Google' });

  // Find or create user (DB first, then JSON fallback)
  let user;
  if (dbReady) {
    user = await db.dbFindUserByEmail(googleEmail);
    if (!user) {
      const newUser = {
        id: uuidv4(), email: googleEmail.toLowerCase(), password: '',
        name: payload.name || payload.email.split('@')[0],
        plan: 'free', clips_used: 0, total_processed: 0,
        google_id: payload.sub, created_at: new Date().toISOString(),
      };
      await db.dbCreateUser(newUser);
      user = newUser;
    }
  } else {
    const users = loadUsers();
    user = users[googleEmail.toLowerCase()];
    if (!user) {
      user = {
        id: uuidv4(), email: googleEmail.toLowerCase(), password: '',
        name: payload.name || payload.email.split('@')[0],
        plan: 'free', clips_used: 0, total_processed: 0,
        google_id: payload.sub, created_at: new Date().toISOString(),
      };
      users[googleEmail.toLowerCase()] = user;
      saveUsers(users);
    }
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, clips_used: user.clips_used } });
}));

// ─── ANALYZE: extract highlights (URL or file upload) ────────────────────────
app.post('/api/analyze', optionalAuth, upload.single('video'), wrap(async (req, res) => {
  const { url, count } = req.body;
  const file = req.file;
  
  if (!url && !file) return res.status(400).json({ error: 'URL or video file required' });
  if (url && !url.includes('youtu')) return res.status(400).json({ error: 'Invalid YouTube URL' });

  const jobId = uuidv4();
  const clipCount = parseInt(count) || 10;
  const job = {
    id: jobId, youtube_url: url || null, local_file: file ? file.path : null,
    clip_count: clipCount, user_id: req.user?.id || 'anonymous',
    status: 'analyzing', highlights: null, clips: [], error: null,
    video_title: '', video_thumb: '', video_duration: 0,
    created_at: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  if (dbReady) { db.dbSaveJob(job).catch(() => {}); }

  // Return immediately, process async
  res.json({ jobId, status: 'analyzing' });

  processAsync(job);
}));

async function processAsync(job) {
  try {
    let info;
    if (job.local_file) {
      // Uploaded file mode — basic info (no yt-dlp needed)
      info = { id: path.basename(job.local_file), title: 'Uploaded Video', description: '', duration: 600, thumbnail: '', uploader: '', chapters: [], transcript: '' };
      // Try to get duration via ffprobe
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const ffprobe = process.env.FFMPEG_PATH || 'ffprobe';
        const { stdout } = await execAsync(`${ffprobe} -v error -show_entries format=duration -of csv=p=0 "${job.local_file}"`, { timeout: 10000 });
        info.duration = parseFloat(stdout) || 600;
      } catch {}
    } else {
      // YouTube URL mode
      const ytdlp = require('./lib/Clipper');
      info = await ytdlp.getVideoInfo(job.youtube_url);
    }
    
    job.video_title = info.title;
    job.video_thumb = info.thumbnail || '';
    job.video_duration = info.duration;

    // 2. AI detects highlights (pass clip count)
    let highlights;
    try {
      highlights = await detectHighlights(info, job.clip_count);
    } catch (e) {
      console.warn('[VS] AI failed, using fallback:', e.message);
      highlights = fallbackHighlights(info.duration, job.clip_count);
    }

    // 3. Create clip records
    job.highlights = highlights;
    job.clips = (highlights.clips || []).slice(0, job.clip_count).map((h, i) => ({
      id: uuidv4(), job_id: job.id, title: h.title || h.hook_text || 'Clip ' + (i + 1),
      start_sec: h.start_sec || h.start_time, end_sec: h.end_sec || h.end_time,
      score: h.total_score || h.hook_score, reason: h.context_note || h.reason || '', hook: h.caption || h.hook_text || '',
      status: 'pending',
    }));
    job.status = 'done';
    if (dbReady) { db.dbSaveJob(job).catch(() => {}); }
  } catch (err) {
    console.error('[VS] Analyze error:', err.message);
    job.status = 'error';
    job.error = err.message;
  }
}

// ─── JOB STATUS ──────────────────────────────────────────────────────────────
app.get('/api/job/:jobId', wrap(async (req, res) => {
  let job = jobs.get(req.params.jobId);
  if (!job && dbReady) {
    job = await db.dbGetJob(req.params.jobId);
  }
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
}));

// ─── PROCESS CLIP (requires auth, decrements quota) ─────────────────────────
app.post('/api/clip', requireAuth, wrap(async (req, res) => {
  const { jobId, clipId, caption, cropMode = 'center', addCaptions = true } = req.body;
  if (!jobId || !clipId) return res.status(400).json({ error: 'jobId dan clipId wajib' });

  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const clip = job.clips.find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  // Check quota
  checkAndDecrementQuota(req.user.id);

  clip.status = 'processing';
  res.json({ clipId, status: 'processing' });

  // Process async
  (async () => {
    try {
      // Get video source — download from YouTube or use uploaded file
      const sourcePath = job.local_file || await downloadVideo(job.youtube_url, job.id);
      clip.status = 'processing';

      // Cut + crop + caption
      const result = await processClip({
        sourcePath, startSec: clip.start_sec, endSec: clip.end_sec,
        clipId, caption: caption || clip.title || clip.hook,
        cropMode, addCaptions,
      });

      clip.status = 'done';
      clip.file_path = result.path;
      clip.file_size = result.size;
      clip.download_url = `${BASE_URL}/clips/${clipId}.mp4`;

      if (dbReady) { db.dbUpdateClipStatus(clipId, 'done', { file_path: result.path, file_size: result.size, download_url: `${BASE_URL}/clips/${clipId}.mp4` }).catch(() => {}); }

      // Update user total
      if (dbReady) {
        await db.dbUpdateUserQuota(req.user.id, 0); // +1 to total_processed only (quota already decremented)
      } else {
        const users = loadUsers();
        const user = Object.values(users).find(u => u.id === req.user.id);
        if (user) { user.total_processed = (user.total_processed || 0) + 1; saveUsers(users); }
      }
    } catch (err) {
      console.error('[VS] Clip error:', err.message);
      clip.status = 'error';
      clip.error = err.message;
    } finally {
      cleanupTmp(job.id);
      // Clean up uploaded file
      if (job.local_file) { try { fs.unlinkSync(job.local_file); } catch {} }
    }
  })();
}));

// ─── CLIP STATUS ─────────────────────────────────────────────────────────────
app.get('/api/clip/:clipId', wrap(async (req, res) => {
  // Check in-memory jobs first
  for (const job of jobs.values()) {
    const clip = job.clips.find(c => c.id === req.params.clipId);
    if (clip) return res.json(clip);
  }
  // Fallback to DB
  if (dbReady) {
    const clip = await db.dbGetClip(req.params.clipId);
    if (clip) return res.json(clip);
  }
  res.status(404).json({ error: 'Clip not found' });
}));

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────
app.get('/api/download/:clipId', (req, res) => {
  // Support both header auth and query param auth
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
    jwt.verify(token, secret);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const filePath = getClipPath(req.params.clipId);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Clip not found' });
  res.download(filePath, 'klikclip-' + req.params.clipId + '.mp4');
});

// ─── PAYMENT ─────────────────────────────────────────────────────────────────
app.post('/api/payment/create', requireAuth, wrap(async (req, res) => {
  const { packageId } = req.body;
  const pkg = getPackage(packageId);
  if (!pkg) return res.status(400).json({ error: 'Invalid package' });

  let user;
  if (dbReady) {
    user = await db.dbFindUserById(req.user.id);
  } else {
    const users = loadUsers();
    user = Object.values(users).find(u => u.id === req.user.id);
  }
  if (!user) return res.status(404).json({ error: 'User not found' });

  const orderId = `VS-${user.id.slice(-8).toUpperCase()}-${Date.now()}`;
  const { token, redirectUrl } = await createSnapToken(orderId, packageId, {
    id: user.id, email: user.email,
  });

  // Save pending transaction
  const transactions = loadTransactions();
  transactions[orderId] = { orderId, userId: user.id, packageId, credits: pkg.credits, amountIdr: pkg.amountIdr, status: 'PENDING' };
  saveTransactions(transactions);

  res.json({ snapToken: token, redirectUrl, orderId });
}));

app.post('/api/payment/webhook', wrap(async (req, res) => {
  const body = req.body;
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

  const valid = verifyWebhookSignature(order_id, status_code, gross_amount, signature_key);
  if (!valid) return res.status(403).json({ error: 'Invalid signature' });

  const transactions = loadTransactions();
  const tx = transactions[order_id];
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  if (tx.status === 'SUCCESS') return res.json({ status: 'already_processed' });

  if (isPaymentSuccess(transaction_status, fraud_status)) {
    tx.status = 'SUCCESS';
    addCredits(tx.userId, tx.credits);  // gives user more clip quota
    console.log(`[payment] ✅ ${tx.credits} credits to user ${tx.userId}`);
  } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
    tx.status = transaction_status === 'expire' ? 'EXPIRED' : 'FAILED';
  }
  saveTransactions(transactions);
  res.json({ status: 'ok' });
}));

// ─── Transactions store ───────────────────────────────────────────────────
function loadTransactions() {
  // This is kept for backward compat — new code uses DB
  try { const p = path.join(__dirname, 'transactions.json'); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  return {};
}
function saveTransactions(t) {
  try { fs.writeFileSync(path.join(__dirname, 'transactions.json'), JSON.stringify(t, null, 2)); } catch {}
}

// Also save to DB if available
async function persistTransaction(tx) {
  if (dbReady) {
    try { await db.dbCreateTransaction(tx); } catch {}
  }
}

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0', ts: new Date().toISOString() }));
app.get('/api/config', (req, res) => res.json({ 
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  hasYoutubeKey: !!process.env.YOUTUBE_API_KEY,
  hasOpencodeKey: !!process.env.OPENCODE_KEY,
  hasJwtSecret: !!process.env.JWT_SECRET,
  opencodeBase: process.env.OPENCODE_BASE || 'default',
}));
app.get('/api/packages', (req, res) => res.json({ packages: CREDIT_PACKAGES }));

// ─── MY JOBS HISTORY ─────────────────────────────────────────────────────────
app.get('/api/jobs', requireAuth, wrap(async (req, res) => {
  let userJobs = [];
  for (const job of jobs.values()) {
    if (job.user_id === req.user.id) userJobs.push(job);
  }
  if (userJobs.length === 0 && dbReady) {
    userJobs = await db.dbGetUserJobs(req.user.id);
  }
  res.json(userJobs.slice(0, 20));
}));

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬 KlikClip v2 running at ${BASE_URL}`);
  console.log(`   AI: DeepSeek V4 Flash (opencode-go)`);
  console.log(`   Midtrans: ${process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'PRODUCTION' : 'Sandbox'}`);
  console.log(`   Free tier: ${PLAN_LIMITS.free} clips total\n`);
});

module.exports = app;
