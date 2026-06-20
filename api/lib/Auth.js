/**
 * Auth.js — JWT authentication (JSON file storage, Render-friendly)
 * Pattern copied from VIO Studio's lib/Auth.js
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'users.json');
const SECRET = process.env.JWT_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET not set. Generated random. Set env var for persistence.');
  return s;
})();
const TOKEN_EXPIRY = '7d';

// Free tier: 3 clips total (not daily)
const FREE_CLIPS = 3;
// Paid tiers
const PLAN_LIMITS = { free: 3, starter: 50, pro: 200, agency: 99999 };

// ─── User Store ──────────────────────────────────────────────────────────────
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) { console.error('Failed to load users:', e.message); }
  return {};
}
function saveUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch (e) { console.error('Failed to save users:', e.message); }
}

// ─── Password (Node.js built-in crypto) ─────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return hash === crypto.scryptSync(password, salt, 64).toString('hex');
}

// ─── JWT ─────────────────────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan }, SECRET, { expiresIn: TOKEN_EXPIRY });
}

// ─── Middleware ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function optionalAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) { try { req.user = jwt.verify(token, SECRET); } catch {} }
  next();
}

// ─── Register ────────────────────────────────────────────────────────────────
async function register(email, password, name) {
  const users = loadUsers();
  const normalized = email.toLowerCase().trim();
  if (users[normalized]) throw Object.assign(new Error('Email already registered'), { status: 409 });

  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    password: hashPassword(password),
    name: name || normalized.split('@')[0],
    plan: 'free',
    clips_used: 0,
    total_processed: 0,
    created_at: new Date().toISOString(),
  };
  users[normalized] = user;
  saveUsers(users);

  const token = generateToken(user);
  return { token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, clips_used: user.clips_used } };
}

// ─── Login ───────────────────────────────────────────────────────────────────
async function login(email, password) {
  const users = loadUsers();
  const user = users[email.toLowerCase().trim()];
  if (!user || !verifyPassword(password, user.password))
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });

  const token = generateToken(user);
  return { token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, clips_used: user.clips_used } };
}

// ─── Quota ──────────────────────────────────────────────────────────────────
function checkAndDecrementQuota(userId) {
  const users = loadUsers();
  const user = Object.values(users).find(u => u.id === userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  const limit = PLAN_LIMITS[user.plan] || FREE_CLIPS;
  if (user.clips_used >= limit) {
    throw Object.assign(new Error('Clip quota exceeded. Upgrade your plan.'), { status: 402 });
  }
  user.clips_used++;
  saveUsers(users);
  return { remaining: limit - user.clips_used };
}

// ─── Add credits after payment ──────────────────────────────────────────────
function addCredits(userId, amount) {
  const users = loadUsers();
  const user = Object.values(users).find(u => u.id === userId);
  if (!user) return false;
  user.clips_used = Math.max(0, user.clips_used - amount);
  saveUsers(users);
  return true;
}

module.exports = { requireAuth, optionalAuth, register, login, checkAndDecrementQuota, addCredits, generateToken, loadUsers, saveUsers, PLAN_LIMITS, SECRET };
