/**
 * KlikClip — Cloudflare Worker
 *
 * Edge AI layer for KlikClip: highlight detection, transcript analysis,
 * auth, credit tracking, and job management.
 *
 * ENV VARS:
 *   DEEPSEEK_API_KEY   (primary AI — free tier available)
 *   GEMINI_API_KEY    (fallback if DeepSeek not configured)
 *   GOOGLE_CLOUD_PROJECT (only needed if using Gemini AQ. keys)
 *   JWT_SECRET
 *   RENDER_BASE_URL
 *   KLIKCLIP (KV namespace)
 */

// In-memory job cache — reduces KV reads during polling
// Workers can reuse isolates, so this cache survives across requests in the same isolate
var JOB_CACHE = new Map(); // jobId -> { data, ts }
var JOB_CACHE_TTL = 2000; // 2 seconds

async function getJobCached(kv, jobId) {
  var now = Date.now();
  var cached = JOB_CACHE.get(jobId);
  if (cached && (now - cached.ts) < JOB_CACHE_TTL) { return cached.data; }
  var data = await getJob(kv, jobId);
  JOB_CACHE.set(jobId, { data: data, ts: now });
  // Keep cache small
  if (JOB_CACHE.size > 50) {
    var oldest = JOB_CACHE.keys().next().value;
    JOB_CACHE.delete(oldest);
  }
  return data;
}

// HIGHLIGHT DETECTION PROMPT (exact from spec)
var HIGHLIGHT_SYSTEM_PROMPT = "You are a viral clip detector for TikTok/Shorts.\nYou analyze video transcripts and find the BEST moments to clip.\n\nFor every moment, rate:\n- engagement_score (0-100): Will people rewatch this?\n- hook_potential (0-100): Does this stop the scroll?\n- emotion: funny|shocking|inspiring|controversial|educational|emotional\n- why_viral: Brief explanation\n\nReturn ONLY valid JSON. No markdown, no code fences, no extra text:\n{\n  \"clips\": [\n    {\n      \"start_seconds\": 154.5,\n      \"end_seconds\": 189.2,\n      \"text\": \"transcript of this segment\",\n      \"engagement_score\": 92,\n      \"hook_potential\": 88,\n      \"emotion\": \"shocking\",\n      \"why_viral\": \"Creator reveals unexpected statistic that contradicts common belief\",\n      \"suggested_hook\": \"Wait until you hear this...\"\n    }\n  ],\n  \"meta\": {\n    \"best_clip\": \"clip_3\",\n    \"overall_score\": 85,\n    \"estimated_virality\": \"high\"\n  }\n}";

var SUMMARIZE_PROMPT = 'Summarize the following video transcript in 3-5 concise bullet points. Focus on the key insights, main arguments, and actionable takeaways. Return ONLY valid JSON: { "summary": ["...", "..."] }';

// JWT helpers
function base64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) { str += '='; }
  var chars = atob(str);
  var bytes = new Uint8Array(chars.length);
  for (var i = 0; i < chars.length; i++) {
    bytes[i] = chars.charCodeAt(i);
  }
  return bytes;
}

async function jwtVerify(token, secret) {
  try {
    var parts = token.split('.');
    if (parts.length !== 3) { return null; }
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    var sig = base64urlToBytes(parts[2]);
    var msg = enc.encode(parts[0] + '.' + parts[1]);
    var valid = await crypto.subtle.verify('HMAC', key, sig, msg);
    if (!valid) { return null; }
    var payload = JSON.parse(atob(parts[1]));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) { return null; }
    return payload;
  } catch (e) {
    return null;
  }
}

// AI helpers — DeepSeek (primary) + Gemini (fallback)
// ENV VARS: DEEPSEEK_API_KEY (primary), GEMINI_API_KEY (fallback)
async function callAI(prompt, systemPrompt, env) {
  var dsKey = env.DEEPSEEK_API_KEY;
  var gmKey = env.GEMINI_API_KEY;

  var messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  // Primary: DeepSeek V4 Flash via OpenCode Go (OpenAI-compatible API)
  if (dsKey) {
    var dsRes = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dsKey },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: messages,
        temperature: 0.4,
        max_tokens: 8192
      })
    });
    if (dsRes.ok) {
      var dsData = await dsRes.json();
      return dsData.choices && dsData.choices[0] && dsData.choices[0].message ? dsData.choices[0].message.content : '';
    }
  }

  // Fallback: Gemini (if DeepSeek unavailable or quota issue)
  if (gmKey) {
    var gmMessages = [];
    if (systemPrompt) {
      gmMessages.push({ role: 'user', parts: [{ text: systemPrompt }] });
      gmMessages.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    gmMessages.push({ role: 'user', parts: [{ text: prompt }] });

    var projectId = env.GOOGLE_CLOUD_PROJECT || '68651145237';
    var vRes = await fetch('https://us-central1-aiplatform.googleapis.com/v1/projects/' + projectId + '/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gmKey },
      body: JSON.stringify({ contents: gmMessages, generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } })
    });

    if (!vRes.ok) {
      var gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + gmKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: gmMessages, generationConfig: { temperature: 0.4, maxOutputTokens: 8192 } })
      });
      vRes = gRes.ok ? gRes : null;
    }

    if (vRes) {
      var gData = await vRes.json();
      var text = '';
      if (gData && gData.candidates && gData.candidates[0] && gData.candidates[0].content && gData.candidates[0].content.parts && gData.candidates[0].content.parts[0]) {
        text = gData.candidates[0].content.parts[0].text || '';
      }
      return text;
    }
  }

  return '{"error":"No AI provider available. Set DEEPSEEK_API_KEY or GEMINI_API_KEY"}';
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (e) {}
  var fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (e) {}
  }
  var braceMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[1]); } catch (e) {}
  }
  return null;
}

// KV helpers — in-memory fallback when KV namespace not bound
var MEMKV = new Map();
function getKv(env) {
  if (env && env.KLIKCLIP) return env.KLIKCLIP;
  // Fallback: in-memory Map (data lost on restart, OK for MVP/free tier)
  console.warn('[KV] KLIKCLIP namespace not bound, using in-memory fallback');
  return {
    get: function(key) { return Promise.resolve(MEMKV.get(key) || null); },
    put: function(key, val) { MEMKV.set(key, val); return Promise.resolve(); },
    delete: function(key) { MEMKV.delete(key); return Promise.resolve(); },
    list: function() { return Promise.resolve({ keys: Array.from(MEMKV.keys()).map(function(k) { return { name: k }; }) }); },
  };
}

async function getUser(kv, userId) {
  if (!kv) { return null; }
  var raw = await kv.get('user:' + userId);
  return raw ? JSON.parse(raw) : null;
}

async function setUser(kv, userId, data) {
  if (!kv) { return; }
  await kv.put('user:' + userId, JSON.stringify(data));
}

async function getJob(kv, jobId) {
  if (!kv) { return null; }
  var raw = await kv.get('job:' + jobId);
  return raw ? JSON.parse(raw) : null;
}

async function setJob(kv, jobId, data) {
  if (!kv) { return; }
  await kv.put('job:' + jobId, JSON.stringify(data));
}

// Credit logic (matches spec pricing tiers)
var PLAN_LIMITS = {
  free:    { clips: 5,  period: 'day' },
  starter: { clips: 50, period: 'month' },
  pro:     { clips: 200, period: 'month' },
  agency:  { clips: 99999, period: 'month' },
};

function getPlanLimit(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function getCreditPeriodStart(period) {
  var now = Date.now();
  var d;
  if (period === 'month') {
    d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function checkCredits(kv, userId, plan) {
  var user = await getUser(kv, userId);
  if (!user) { return { ok: false, used: 0, limit: 0, remaining: 0, period: 'day', plan: 'free' }; }
  var resolvedPlan = plan || user.plan || 'free';
  var limitConfig = getPlanLimit(resolvedPlan);
  var periodStart = getCreditPeriodStart(limitConfig.period);
  if (!user.creditPeriodStart || user.creditPeriodStart < periodStart) {
    user.creditsUsed = 0;
    user.creditPeriodStart = periodStart;
  }
  var used = user.creditsUsed || 0;
  var remaining = limitConfig.clips - used;
  return {
    ok: remaining > 0,
    used: used,
    limit: limitConfig.clips,
    remaining: Math.max(0, remaining),
    period: limitConfig.period,
    plan: resolvedPlan,
  };
}

async function consumeCredit(kv, userId, plan) {
  var user = await getUser(kv, userId);
  if (!user) { return false; }
  var resolvedPlan = plan || user.plan || 'free';
  var limitConfig = getPlanLimit(resolvedPlan);
  var periodStart = getCreditPeriodStart(limitConfig.period);
  if (!user.creditPeriodStart || user.creditPeriodStart < periodStart) {
    user.creditsUsed = 0;
    user.creditPeriodStart = periodStart;
  }
  user.creditsUsed = (user.creditsUsed || 0) + 1;
  await setUser(kv, userId, user);
  return true;
}

// Rate limiter
async function checkRateLimit(kv, key, maxReqs, windowMs) {
  if (!kv) { return { ok: true }; }
  if (maxReqs === undefined) { maxReqs = 30; }
  if (windowMs === undefined) { windowMs = 60000; }
  var now = Date.now();
  var windowKey = 'rate:' + key + ':' + Math.floor(now / windowMs);
  var countRaw = await kv.get(windowKey);
  var count = parseInt(countRaw || '0', 10);
  if (count >= maxReqs) {
    var retryAfter = Math.ceil((windowMs - (now % windowMs)) / 1000);
    return { ok: false, retryAfter: retryAfter };
  }
  await kv.put(windowKey, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) });
  return { ok: true };
}

// Response helpers
var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function mergeHeaders(a, b) {
  for (var k in b) { a[k] = b[k]; }
  return a;
}

function json(data, status) {
  if (status === undefined) { status = 200; }
  return new Response(JSON.stringify(data), {
    status: status,
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, CORS_HEADERS),
  });
}

function error(msg, status) {
  if (status === undefined) { status = 400; }
  return json({ error: msg }, status);
}

function requireAuth(request) {
  var auth = request.headers.get('Authorization');
  if (!auth || auth.indexOf('Bearer ') !== 0) { return null; }
  return auth.slice(7);
}

// MAIN FETCH HANDLER
export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var method = request.method;
    var kv = getKv(env);
    // AI keys configured via environment — checked inside callAI()

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Public endpoints (no auth) ──

    // GET /health
    if (url.pathname === '/health' && method === 'GET') {
      return json({
        status: 'ok',
        service: 'KlikClip API',
        version: '1.0.0',
        endpoints: [
          'POST /api/clips/create', 'GET /api/clips/:jobId',
          'GET /api/clips/:jobId/download/:clipId',
          'POST /api/clips/:jobId/regenerate', 'GET /api/clips/credits',
          'POST /transcript', 'POST /summarize', 'POST /ask', 'GET /health'
        ],
      });
    }

    // POST /transcript
    if (url.pathname === '/transcript' && method === 'POST') {
      var body = await request.json();
      if (!body.videoId) { return error('videoId required'); }
      var raw = await callAI(
        'Generate a detailed transcript with timestamps for the YouTube video with ID: ' + body.videoId + '. Return ONLY valid JSON: { "videoId": "' + body.videoId + '", "segments": [{ "start": 0, "end": 30, "text": "..." }], "duration": 0 }',
        null, env
      );
      var data = extractJson(raw);
      return json({
        videoId: body.videoId,
        segments: (data && data.segments) ? data.segments : [],
        duration: (data && data.duration) ? data.duration : 0,
      });
    }

    // POST /summarize
    if (url.pathname === '/summarize' && method === 'POST') {
      var body = await request.json();
      var text = body.text || body.transcript;
      if (!text) { return error('text or transcript required'); }
      var raw = await callAI('Transcript:\n\n' + text.slice(0, 30000), SUMMARIZE_PROMPT, env);
      var data = extractJson(raw);
      return json({ summary: (data && data.summary) ? data.summary : [] });
    }

    // POST /ask
    if (url.pathname === '/ask' && method === 'POST') {
      var body = await request.json();
      var question = body.question || body.q;
      var context = body.context || body.transcript || '';
      if (!question) { return error('question required'); }
      var raw = await callAI(
        'Context:\n' + context.slice(0, 30000) + '\n\nQuestion: ' + question,
        'Answer based only on the provided context.', env
      );
      return json({ answer: raw, question: question });
    }

    // ── AUTH ENDPOINTS (public) ──

    // POST /api/auth/register
    if (url.pathname === '/api/auth/register' && method === 'POST') {
      var body = await request.json();
      var email = (body.email || '').trim().toLowerCase();
      var pass = body.password || '';
      var name = body.name || email.split('@')[0];
      if (!email || pass.length < 6) { return error('Valid email and password (min 6 chars) required'); }
      var existing = await getUser(kv, 'email:' + email);
      if (existing) { return error('Email already registered'); }
      var enc = new TextEncoder();
      var hash = await crypto.subtle.digest('SHA-256', enc.encode(email + ':' + pass));
      var hashStr = Array.from(new Uint8Array(hash)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      var userId = crypto.randomUUID();
      var userData = { id: userId, email: email, name: name, plan: 'free', creditsUsed: 0, creditPeriodStart: Date.now(), createdAt: Date.now() };
      await setUser(kv, userId, userData);
      await setUser(kv, 'email:' + email, { id: userId });
      var secret = env.JWT_SECRET || 'klikclip-dev-secret';
      var payload = JSON.stringify({ sub: userId, email: email, name: name, plan: 'free', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
      var enc2 = new TextEncoder();
      var header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      var payB64 = btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      var key = await crypto.subtle.importKey('raw', enc2.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      var sig = await crypto.subtle.sign('HMAC', key, enc2.encode(header + '.' + payB64));
      var sigB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      return json({ token: header + '.' + payB64 + '.' + sigB64, user: { id: userId, email: email, name: name, plan: 'free' } });
    }

    // POST /api/auth/login
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      var body = await request.json();
      var email = (body.email || '').trim().toLowerCase();
      var pass = body.password || '';
      if (!email || !pass) { return error('Email and password required'); }
      var emailRef = await getUser(kv, 'email:' + email);
      if (!emailRef) { return error('Invalid email or password'); }
      var user = await getUser(kv, emailRef.id);
      if (!user) { return error('User not found'); }
      var enc = new TextEncoder();
      var hash = await crypto.subtle.digest('SHA-256', enc.encode(email + ':' + pass));
      var hashStr = Array.from(new Uint8Array(hash)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      if (user.passwordHash && user.passwordHash !== hashStr) { return error('Invalid email or password'); }
      var secret = env.JWT_SECRET || 'klikclip-dev-secret';
      var payload = JSON.stringify({ sub: user.id, email: user.email, name: user.name, plan: user.plan || 'free', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
      var enc2 = new TextEncoder();
      var header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      var payB64 = btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      var key = await crypto.subtle.importKey('raw', enc2.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      var sig = await crypto.subtle.sign('HMAC', key, enc2.encode(header + '.' + payB64));
      var sigB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      return json({ token: header + '.' + payB64 + '.' + sigB64, user: { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free' } });
    }

    // GET /api/auth/google/url — get Google OAuth URL
    if (url.pathname === '/api/auth/google/url' && method === 'GET') {
      var clientId = env.GOOGLE_CLIENT_ID || 'GOOGLE_CLIENT_ID';
      var redirectUri = encodeURIComponent(url.origin + '/api/auth/google/callback');
      var scope = encodeURIComponent([
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.download',
      ].join(' '));
      var state = crypto.randomUUID();
      // Store state in KV for 10 minutes to prevent CSRF
      await kv.put('oauth_state:' + state, '1', { expirationTtl: 600 });
      var oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
        '?client_id=' + clientId +
        '&redirect_uri=' + redirectUri +
        '&response_type=code' +
        '&scope=' + scope +
        '&access_type=offline' +
        '&prompt=consent' +
        '&state=' + state;
      return json({ url: oauthUrl });
    }

    // GET /api/auth/google/callback — handle OAuth callback
    if (url.pathname === '/api/auth/google/callback' && method === 'GET') {
      var code = url.searchParams.get('code');
      var state = url.searchParams.get('state');
      var errorParam = url.searchParams.get('error');
      if (errorParam) {
        return new Response('<script>window.location="/?error=' + encodeURIComponent(errorParam) + '"</script>', { headers: { 'Content-Type': 'text/html' } });
      }
      if (!code || !state) { return error('Missing code or state'); }
      // Verify state
      var storedState = await kv.get('oauth_state:' + state);
      if (!storedState) { return error('Invalid or expired state'); }
      await kv.delete('oauth_state:' + state);
      try {
        var clientId = env.GOOGLE_CLIENT_ID || 'GOOGLE_CLIENT_ID';
        var clientSecret = env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET';
        var redirectUri = url.origin + '/api/auth/google/callback';
        // Exchange code for tokens
        var tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'code=' + encodeURIComponent(code) +
            '&client_id=' + encodeURIComponent(clientId) +
            '&client_secret=' + encodeURIComponent(clientSecret) +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&grant_type=authorization_code',
        });
        var tokens = await tokenRes.json();
        if (!tokens.access_token) { return error('Failed to get access token: ' + JSON.stringify(tokens)); }
        // Get user profile
        var profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { 'Authorization': 'Bearer ' + tokens.access_token }
        });
        var profile = await profileRes.json();
        var email = (profile.email || '').toLowerCase();
        var name = profile.name || profile.given_name || email.split('@')[0];
        if (!email) { return error('Google email not available'); }
        // Find or create user
        var emailRef = await getUser(kv, 'email:' + email);
        var user;
        if (emailRef) { user = await getUser(kv, emailRef.id); }
        if (!user) {
          var userId = crypto.randomUUID();
          user = { id: userId, email: email, name: name, plan: 'free', creditsUsed: 0, creditPeriodStart: Date.now(), googleId: profile.id, createdAt: Date.now() };
          await setUser(kv, userId, user);
          await setUser(kv, 'email:' + email, { id: userId });
        }
        // Store YouTube OAuth tokens in KV (for downloading videos)
        await kv.put('yt_tokens:' + user.id, JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: Date.now() + (tokens.expires_in * 1000),
        }), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
        // Issue KlikClip JWT
        var secret = env.JWT_SECRET || 'klikclip-dev-secret';
        var payload = JSON.stringify({ sub: user.id, email: user.email, name: user.name, plan: user.plan || 'free', hasYoutube: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
        var enc2 = new TextEncoder();
        var header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        var payB64 = btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        var key = await crypto.subtle.importKey('raw', enc2.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        var sig = await crypto.subtle.sign('HMAC', key, enc2.encode(header + '.' + payB64));
        var sigB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        var jwtToken = header + '.' + payB64 + '.' + sigB64;
        // Redirect to frontend with token
        return new Response(
          '<script>localStorage.setItem("kc_token","' + jwtToken + '");window.location="/";</script>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      } catch(e) { return error('Google OAuth failed: ' + e.message); }
    }

    // POST /api/auth/google (legacy — keep for backward compat)
    if (url.pathname === '/api/auth/google' && method === 'POST') {
      var body = await request.json();
      var credential = body.credential;
      if (!credential) { return error('Google credential required'); }
      try {
        var gRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
        if (!gRes.ok) { return error('Invalid Google token'); }
        var gData = await gRes.json();
        var email = (gData.email || '').toLowerCase();
        var name = gData.name || gData.given_name || email.split('@')[0];
        if (!email) { return error('Google email not available'); }
        var emailRef = await getUser(kv, 'email:' + email);
        var user;
        if (emailRef) { user = await getUser(kv, emailRef.id); }
        if (!user) {
          var userId = crypto.randomUUID();
          user = { id: userId, email: email, name: name, plan: 'free', creditsUsed: 0, creditPeriodStart: Date.now(), googleId: gData.sub, createdAt: Date.now() };
          await setUser(kv, userId, user);
          await setUser(kv, 'email:' + email, { id: userId });
        }
        var secret = env.JWT_SECRET || 'klikclip-dev-secret';
        var payload = JSON.stringify({ sub: user.id, email: user.email, name: user.name, plan: user.plan || 'free', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
        var enc2 = new TextEncoder();
        var header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        var payB64 = btoa(payload).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        var key = await crypto.subtle.importKey('raw', enc2.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        var sig = await crypto.subtle.sign('HMAC', key, enc2.encode(header + '.' + payB64));
        var sigB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        return json({ token: header + '.' + payB64 + '.' + sigB64, user: { id: user.id, email: user.email, name: user.name, plan: user.plan || 'free' } });
      } catch(e) { return error('Google sign-in failed: ' + e.message); }
    }

    // GET /api/auth/me
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      var token = requireAuth(request);
      if (!token) { return error('Not authenticated', 401); }
      var secret = env.JWT_SECRET || 'klikclip-dev-secret';
      var decoded = await jwtVerify(token, secret);
      if (!decoded) { return error('Invalid token', 401); }
      var uid = decoded.sub || decoded.id || decoded.userId;
      var u = await getUser(kv, uid);
      if (!u) { return error('User not found', 404); }
      return json({ id: u.id, email: u.email, name: u.name, plan: u.plan || 'free', creditsUsed: u.creditsUsed || 0 });
    }

    // ── Auth check ──

    var token = requireAuth(request);
    if (!token) { return error('Authorization header with Bearer token required', 401); }

    var secret = env.JWT_SECRET || 'klikclip-dev-secret';
    var decoded = await jwtVerify(token, secret);
    if (!decoded) { return error('Invalid or expired token', 401); }

    var userId = decoded.sub || decoded.id || decoded.userId;
    if (!userId) { return error('Token missing user identifier', 401); }

    var rl = await checkRateLimit(kv, userId);
    if (!rl.ok) {
      return json({ error: 'Rate limit exceeded', retryAfter: rl.retryAfter }, 429);
    }

    // GET /api/clips/credits
    if (url.pathname === '/api/clips/credits' && method === 'GET') {
      var s = await checkCredits(kv, userId, decoded.plan);
      return json({
        used: s.used, limit: s.limit, remaining: s.remaining,
        plan: s.plan, period: s.period,
      });
    }

    // ── FRONTEND API ENDPOINTS (v2 format) ──

    // GET /api/youtube/channels — get user's YouTube channel videos
    if (url.pathname === '/api/youtube/channels' && method === 'GET') {
      var ytTokensRaw = await kv.get('yt_tokens:' + userId);
      if (!ytTokensRaw) { return json({ connected: false, videos: [] }); }
      var ytTokens = JSON.parse(ytTokensRaw);
      // Refresh token if expired
      if (Date.now() > ytTokens.expires_at - 60000) {
        var refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'refresh_token=' + encodeURIComponent(ytTokens.refresh_token) +
            '&client_id=GOOGLE_CLIENT_ID' +
            '&client_secret=' + encodeURIComponent(env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET') +
            '&grant_type=refresh_token',
        });
        var refreshed = await refreshRes.json();
        if (refreshed.access_token) {
          ytTokens.access_token = refreshed.access_token;
          ytTokens.expires_at = Date.now() + (refreshed.expires_in * 1000);
          await kv.put('yt_tokens:' + userId, JSON.stringify(ytTokens), { expirationTtl: 60 * 60 * 24 * 30 });
        }
      }
      // Get channel uploads
      var chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', {
        headers: { 'Authorization': 'Bearer ' + ytTokens.access_token }
      });
      var chData = await chRes.json();
      if (!chData.items || !chData.items[0]) { return json({ connected: true, videos: [] }); }
      var uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;
      var vidRes = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=' + uploadsId, {
        headers: { 'Authorization': 'Bearer ' + ytTokens.access_token }
      });
      var vidData = await vidRes.json();
      var videos = (vidData.items || []).map(function(v) {
        return {
          id: v.snippet.resourceId.videoId,
          title: v.snippet.title,
          thumbnail: v.snippet.thumbnails && v.snippet.thumbnails.medium ? v.snippet.thumbnails.medium.url : '',
          publishedAt: v.snippet.publishedAt,
          url: 'https://www.youtube.com/watch?v=' + v.snippet.resourceId.videoId,
        };
      });
      return json({ connected: true, videos: videos });
    }
    if (url.pathname === '/api/analyze' && method === 'POST') {
      var body = await request.json();
      var videoUrl = body.url || body.videoUrl;
      var count = Math.min(parseInt(body.count) || 10, 10);
      if (!videoUrl) { return error('Video URL required'); }

      var credits = await checkCredits(kv, userId, decoded.plan);
      if (!credits.ok) {
        return json({ error: 'Insufficient credits' }, 403);
      }

      var jobId = crypto.randomUUID();
      var vidMatch = videoUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      var videoId = vidMatch ? vidMatch[1] : '';

      // Return job ID immediately, process in background
      var job = {
        id: jobId, userId: userId, status: 'analyzing',
        progress: 0, clips: [], videoId: videoId,
        video_title: '', video_thumb: '', video_duration: 0,
        youtube_url: videoUrl, clip_count: count, error: null,
        created_at: new Date().toISOString(),
      };
      await setJob(kv, jobId, job);
      await consumeCredit(kv, userId, decoded.plan);
      // Update user job index for fast clip lookups
      var uJobsKey = 'userjobs:' + userId;
      var uJobs = await kv.get(uJobsKey, { type: 'json' }) || [];
      uJobs.unshift(jobId);
      if (uJobs.length > 20) uJobs = uJobs.slice(0, 20);
      await kv.put(uJobsKey, JSON.stringify(uJobs));

      // Background AI analysis
      ctx.waitUntil((async function() {
        try {
          var transcript = '';
          // Fetch transcript
          if (videoId) {
            try {
              var ytRes = await fetch('https://youtubetranscript.com/?v=' + videoId + '&format=text');
              if (ytRes.ok) transcript = await ytRes.text();
            } catch(e) {}
          }

          var clips = [];
          if (transcript && transcript.length > 100) {
            var prompt = 'Video style: Auto detect\nLanguage: English\nNumber of clips: ' + count + '\n\nTranscript:\n' + transcript.slice(0, 50000);
            var raw = await callAI(prompt, HIGHLIGHT_SYSTEM_PROMPT, env);
            var hd = extractJson(raw);
            if (hd && hd.clips) {
              for (var i = 0; i < hd.clips.length; i++) {
                var c = hd.clips[i];
                clips.push({
                  id: 'clip_' + (i + 1), job_id: jobId,
                  title: 'Clip ' + (i + 1),
                  start_sec: c.start_seconds || 0,
                  end_sec: c.end_seconds || 0,
                  score: c.engagement_score || 50,
                  reason: c.why_viral || c.text?.slice(0, 100) || '',
                  hook: c.suggested_hook || '',
                  status: 'pending',
                });
              }
            }
          }

          // If no clips from AI, create evenly spaced clips
          if (clips.length === 0) {
            var dur = 600;
            var segDur = Math.min(dur / count, 60);
            for (var i = 0; i < count; i++) {
              clips.push({
                id: 'clip_' + (i + 1), job_id: jobId,
                title: 'Clip ' + (i + 1),
                start_sec: i * segDur,
                end_sec: Math.min((i + 1) * segDur, dur),
                score: 50, reason: 'Segment', hook: '',
                status: 'pending',
              });
            }
          }

          var updated = await getJob(kv, jobId);
          if (updated) {
            updated.clips = clips;
            updated.status = 'done';
            updated.progress = 100;
            updated.updatedAt = Date.now();
            await setJob(kv, jobId, updated);
          }
        } catch(err) {
          var failed = await getJob(kv, jobId);
          if (failed) {
            failed.status = 'error';
            failed.error = err.message;
            await setJob(kv, jobId, failed);
          }
        }
      })());

      return json({ jobId: jobId, status: 'analyzing' });
    }

    // GET /api/job/:jobId — get job status (frontend calls this)
    var jobMatch = url.pathname.match(/^\/api\/job\/([^\/]+)$/);
    if (jobMatch && method === 'GET') {
      var gotJob = await getJobCached(kv, jobMatch[1]);
      if (!gotJob) { return error('Job not found', 404); }
      if (gotJob.userId !== userId) { return error('Access denied', 403); }
      return json(gotJob);
    }

    // GET /api/clip/:clipId — get clip status (frontend polls this)
    var clipStatusMatch = url.pathname.match(/^\/api\/clip\/([^\/]+)$/);
    if (clipStatusMatch && method === 'GET') {
      var clipId = clipStatusMatch[1];
      // jobId passed as query param for direct lookup — no scanning needed
      var jobId = url.searchParams.get('jobId');
      if (jobId) {
        var jData = await getJobCached(kv, jobId);
        if (jData && jData.userId === userId && jData.clips) {
          var foundClip = jData.clips.find(function(c) { return c.id === clipId; });
          if (foundClip) { return json(foundClip); }
        }
      } else {
        // Fallback: check user job index (no KV list scan)
        var uJobsKey = 'userjobs:' + userId;
        var uJobIds = await kv.get(uJobsKey, { type: 'json' }) || [];
        for (var ki = 0; ki < uJobIds.length; ki++) {
          var jData2 = await getJob(kv, uJobIds[ki]);
          if (jData2 && jData2.clips) {
            var fc = jData2.clips.find(function(c) { return c.id === clipId; });
            if (fc) { return json(fc); }
          }
        }
      }
      return json({ id: clipId, status: 'pending' });
    }

    // POST /api/clip — process a clip synchronously, return download_url when done
    if (url.pathname === '/api/clip' && method === 'POST') {
      var clipBody = await request.json();
      var renderUrl = env.RENDER_BASE_URL;
      if (renderUrl) {
        try {
          // Find clip details from job
          var clipJobId = clipBody.jobId;
          var clipId = clipBody.clipId;
          var clipJob = clipJobId ? await getJobCached(kv, clipJobId) : null;
          var clipInfo = clipJob && clipJob.clips ? clipJob.clips.find(function(c) { return c.id === clipId; }) : null;

          // Get YouTube OAuth tokens for this user
          var ytTokensRaw2 = await kv.get('yt_tokens:' + userId);
          var ytAccessToken = null;
          if (ytTokensRaw2) {
            var ytTok = JSON.parse(ytTokensRaw2);
            // Refresh if needed
            if (Date.now() > ytTok.expires_at - 60000 && ytTok.refresh_token) {
              var rfRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'refresh_token=' + encodeURIComponent(ytTok.refresh_token) +
                  '&client_id=GOOGLE_CLIENT_ID' +
                  '&client_secret=' + encodeURIComponent(env.GOOGLE_CLIENT_SECRET || 'GOOGLE_CLIENT_SECRET') +
                  '&grant_type=refresh_token',
              });
              var rfData = await rfRes.json();
              if (rfData.access_token) {
                ytTok.access_token = rfData.access_token;
                ytTok.expires_at = Date.now() + (rfData.expires_in * 1000);
                await kv.put('yt_tokens:' + userId, JSON.stringify(ytTok), { expirationTtl: 60 * 60 * 24 * 30 });
              }
            }
            ytAccessToken = ytTok.access_token;
          }

          var rRes = await fetch(renderUrl + '/api/clip/direct', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': request.headers.get('Authorization') || ''
            },
            body: JSON.stringify({
              jobId: clipJobId,
              clipId: clipId,
              youtubeUrl: clipJob ? clipJob.youtube_url : clipBody.youtubeUrl,
              startSec: clipInfo ? clipInfo.start_sec : clipBody.startSec,
              endSec: clipInfo ? clipInfo.end_sec : clipBody.endSec,
              ytAccessToken: ytAccessToken,
            }),
          });
          if (rRes.ok) {
            var rData = await rRes.json();
            // Update clip status in KV
            if (clipJob && clipInfo) {
              clipInfo.status = 'done';
              clipInfo.download_url = rData.download_url || null;
              await setJob(kv, clipJobId, clipJob);
              JOB_CACHE.delete(clipJobId); // Bust cache
            }
            return json({ status: 'done', clipId: clipId, download_url: rData.download_url });
          } else {
            var errText = await rRes.text();
            return json({ status: 'error', error: errText }, 500);
          }
        } catch(e) {
          return json({ status: 'error', error: e.message }, 500);
        }
      }
      return json({ status: 'error', error: 'Render backend not configured' }, 500);
    }

    // GET /api/download/:clipId — download clip (frontend calls this)
    var dlMatch = url.pathname.match(/^\/api\/download\/([^\/]+)$/);
    if (dlMatch && method === 'GET') {
      var renderUrl = env.RENDER_BASE_URL;
      if (renderUrl) {
        try {
          // Forward to Render's download route, with auth so it can verify the JWT
          var dRes1 = await fetch(renderUrl + '/api/download/' + dlMatch[1], {
            headers: { 'Authorization': request.headers.get('Authorization') || '' }
          });
          if (dRes1.ok) {
            var dlHeaders = mergeHeaders({
              'Content-Type': dRes1.headers.get('Content-Type') || 'video/mp4',
              'Content-Disposition': 'attachment; filename="klikclip-' + dlMatch[1] + '.mp4"',
            }, CORS_HEADERS);
            return new Response(dRes1.body, { status: 200, headers: dlHeaders });
          }
        } catch(e) {}
      }
      return error('Clip not available. Render backend not connected.', 404);
    }

    // GET /api/jobs — job history for current user
    if (url.pathname === '/api/jobs' && method === 'GET') {
      return json([]);
    }

    // GET /api/config
    if (url.pathname === '/api/config' && method === 'GET') {
      return json({
        googleClientId: '',
        hasOpencodeKey: !!env.DEEPSEEK_API_KEY,
        hasJwtSecret: !!env.JWT_SECRET,
      });
    }

    // GET /api/packages
    if (url.pathname === '/api/packages' && method === 'GET') {
      return json({ packages: [] });
    }

    // Fallback
    return error('Not found', 404);
  },
};
