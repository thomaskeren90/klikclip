/**
 * db.js — PostgreSQL connection + schema for KlikClip
 * Auto-creates tables on first run.
 */
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn('[DB] No DATABASE_URL set — falling back to JSON file storage');
      return null;
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kc_users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  plan VARCHAR(20) NOT NULL DEFAULT 'free',
  clips_used INTEGER NOT NULL DEFAULT 0,
  total_processed INTEGER NOT NULL DEFAULT 0,
  google_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kc_transactions (
  order_id VARCHAR(100) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES kc_users(id),
  package_id VARCHAR(50),
  credits INTEGER NOT NULL DEFAULT 0,
  amount_idr INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kc_jobs (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL DEFAULT 'anonymous',
  youtube_url TEXT,
  local_file TEXT,
  clip_count INTEGER NOT NULL DEFAULT 10,
  video_title VARCHAR(500) NOT NULL DEFAULT '',
  video_thumb TEXT NOT NULL DEFAULT '',
  video_duration REAL NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'analyzing',
  highlights JSONB,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kc_clips (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES kc_jobs(id),
  title VARCHAR(500),
  start_sec REAL,
  end_sec REAL,
  score INTEGER DEFAULT 0,
  reason TEXT,
  hook TEXT,
  caption TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  file_path TEXT,
  file_size BIGINT DEFAULT 0,
  download_url TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

async function initDb() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(SCHEMA_SQL);
    console.log('[DB] Tables ready');
    return true;
  } catch (e) {
    console.error('[DB] Init error:', e.message);
    return false;
  }
}

// ─── USER FUNCTIONS ──────────────────────────────────────────────────────────
async function dbCreateUser(user) {
  const p = getPool();
  if (!p) { throw new Error('DB not available'); }
  await p.query(
    `INSERT INTO kc_users (id, email, password, name, plan, clips_used, total_processed, google_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.id, user.email, user.password, user.name, user.plan, user.clips_used || 0, user.total_processed || 0, user.google_id || null]
  );
}

async function dbFindUserByEmail(email) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_users WHERE email = $1', [email.toLowerCase().trim()]);
  return r.rows[0] || null;
}

async function dbFindUserById(id) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_users WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function dbFindUserByGoogleId(googleId) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_users WHERE google_id = $1', [googleId]);
  return r.rows[0] || null;
}

async function dbUpdateUserQuota(userId, increment = 1) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    'UPDATE kc_users SET clips_used = clips_used + $1, total_processed = total_processed + 1 WHERE id = $2',
    [increment, userId]
  );
  return true;
}

async function dbAddCredits(userId, amount) {
  const p = getPool();
  if (!p) return false;
  await p.query(
    'UPDATE kc_users SET clips_used = GREATEST(0, clips_used - $1) WHERE id = $2',
    [amount, userId]
  );
  return true;
}

async function dbGetAllUsers() {
  const p = getPool();
  if (!p) return {};
  const r = await p.query('SELECT * FROM kc_users');
  const map = {};
  r.rows.forEach(u => { map[u.email] = u; });
  return map;
}

// ─── TRANSACTION FUNCTIONS ────────────────────────────────────────────────────
async function dbCreateTransaction(tx) {
  const p = getPool();
  if (!p) return;
  await p.query(
    `INSERT INTO kc_transactions (order_id, user_id, package_id, credits, amount_idr, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tx.orderId, tx.userId, tx.packageId, tx.credits, tx.amountIdr, tx.status || 'PENDING']
  );
}

async function dbUpdateTransactionStatus(orderId, status) {
  const p = getPool();
  if (!p) return;
  await p.query('UPDATE kc_transactions SET status = $1 WHERE order_id = $2', [status, orderId]);
}

async function dbGetTransaction(orderId) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_transactions WHERE order_id = $1', [orderId]);
  return r.rows[0] || null;
}

async function dbGetAllTransactions() {
  const p = getPool();
  if (!p) return {};
  const r = await p.query('SELECT * FROM kc_transactions');
  const map = {};
  r.rows.forEach(t => { map[t.order_id] = t; });
  return map;
}

// ─── JOB FUNCTIONS ────────────────────────────────────────────────────────────
async function dbSaveJob(job) {
  const p = getPool();
  if (!p) return;
  const existing = await p.query('SELECT id FROM kc_jobs WHERE id = $1', [job.id]);
  if (existing.rows.length > 0) {
    await p.query(
      `UPDATE kc_jobs SET status=$1, video_title=$2, video_thumb=$3, video_duration=$4, highlights=$5, error=$6
       WHERE id=$7`,
      [job.status, job.video_title || '', job.video_thumb || '', job.video_duration || 0,
       job.highlights ? JSON.stringify(job.highlights) : null, job.error || null, job.id]
    );
  } else {
    await p.query(
      `INSERT INTO kc_jobs (id, user_id, youtube_url, local_file, clip_count, video_title, video_thumb, video_duration, status, highlights, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [job.id, job.user_id || 'anonymous', job.youtube_url || null, job.local_file || null, job.clip_count || 10,
       job.video_title || '', job.video_thumb || '', job.video_duration || 0,
       job.status || 'analyzing',
       job.highlights ? JSON.stringify(job.highlights) : null, job.error || null]
    );
  }
  // Save clips
  if (job.clips && job.clips.length > 0) {
    for (const c of job.clips) {
      await p.query(
        `INSERT INTO kc_clips (id, job_id, title, start_sec, end_sec, score, reason, hook, caption, status, file_path, file_size, download_url, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET status=$10, file_path=$11, file_size=$12, download_url=$13, error=$14`,
        [c.id, job.id, c.title || c.hook_text || '', c.start_sec || c.start_time, c.end_sec || c.end_time,
         c.total_score || c.hook_score || 0, c.reason || c.context_note || '', c.hook || c.hook_text || '', c.caption || '',
         c.status || 'pending', c.file_path || null, c.file_size || 0, c.download_url || null, c.error || null]
      );
    }
  }
}

async function dbGetJob(jobId) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_jobs WHERE id = $1', [jobId]);
  if (r.rows.length === 0) return null;
  const job = r.rows[0];
  const clips = await p.query('SELECT * FROM kc_clips WHERE job_id = $1 ORDER BY created_at', [jobId]);
  job.clips = clips.rows;
  if (job.highlights && typeof job.highlights === 'string') {
    try { job.highlights = JSON.parse(job.highlights); } catch {}
  }
  return job;
}

async function dbGetUserJobs(userId, limit = 20) {
  const p = getPool();
  if (!p) return [];
  const r = await p.query(
    'SELECT * FROM kc_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return r.rows;
}

async function dbUpdateClipStatus(clipId, status, fields = {}) {
  const p = getPool();
  if (!p) return;
  const setClauses = ['status = $2'];
  const values = [clipId, status];
  let idx = 3;
  if (fields.file_path !== undefined) { setClauses.push(`file_path = $${idx++}`); values.push(fields.file_path); }
  if (fields.file_size !== undefined) { setClauses.push(`file_size = $${idx++}`); values.push(fields.file_size); }
  if (fields.download_url !== undefined) { setClauses.push(`download_url = $${idx++}`); values.push(fields.download_url); }
  if (fields.error !== undefined) { setClauses.push(`error = $${idx++}`); values.push(fields.error); }
  await p.query(`UPDATE kc_clips SET ${setClauses.join(', ')} WHERE id = $1`, values);
}

async function dbGetClip(clipId) {
  const p = getPool();
  if (!p) return null;
  const r = await p.query('SELECT * FROM kc_clips WHERE id = $1', [clipId]);
  return r.rows[0] || null;
}

module.exports = {
  initDb,
  dbCreateUser, dbFindUserByEmail, dbFindUserById, dbFindUserByGoogleId,
  dbUpdateUserQuota, dbAddCredits, dbGetAllUsers,
  dbCreateTransaction, dbUpdateTransactionStatus, dbGetTransaction, dbGetAllTransactions,
  dbSaveJob, dbGetJob, dbGetUserJobs, dbUpdateClipStatus, dbGetClip,
};
