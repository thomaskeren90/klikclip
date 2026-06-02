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

  // Primary: DeepSeek (OpenAI-compatible API)
  if (dsKey) {
    var dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dsKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
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

// KV helpers
function getKv(env) { return env.KLIKCLIP || null; }

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

    // POST /api/clips/create
    if (url.pathname === '/api/clips/create' && method === 'POST') {
      var body = await request.json();
      var videoUrl = body.videoUrl;
      var style = body.style || 'auto';
      var language = body.language || 'en';
      var count = Math.min(body.count || 10, 10);
      if (!videoUrl) { return error('videoUrl required'); }

      var credits = await checkCredits(kv, userId, decoded.plan);
      if (!credits.ok) {
        return json({ error: 'Insufficient credits', used: credits.used, limit: credits.limit }, 403);
      }

      var jobId = crypto.randomUUID();
      var job = {
        id: jobId, userId: userId, videoUrl: videoUrl,
        style: style, language: language, clipCount: count,
        status: 'analyzing', progress: 0, clips: [], meta: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await setJob(kv, jobId, job);
      await consumeCredit(kv, userId, decoded.plan);

      // Background processing
      ctx.waitUntil((async function() {
        try {
          var renderUrl = env.RENDER_BASE_URL;
          if (renderUrl) {
            await fetch(renderUrl + '/api/clips/create', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
              },
              body: JSON.stringify({
                jobId: jobId, videoUrl: videoUrl,
                style: style, count: count, language: language,
              }),
            });
          }

          var transcript = body.transcript || '';
          // Try fetching transcript from multiple sources
          async function fetchTranscript(vUrl) {
            // Source 1: Render backend (if configured)
            if (renderUrl) {
              try {
                var r = await fetch(renderUrl + '/api/transcript?videoUrl=' + encodeURIComponent(vUrl));
                if (r.ok) {
                  var td = await r.json();
                  if (td.transcript || td.text) return td.transcript || td.text;
                }
              } catch (e) {}
            }
            // Source 2: Free YouTube transcript API
            var vidMatch = vUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
            if (vidMatch) {
              try {
                var ytRes = await fetch('https://youtubetranscript.com/?v=' + vidMatch[1] + '&format=text');
                if (ytRes.ok) {
                  return await ytRes.text();
                }
              } catch (e) {}
            }
            return '';
          }
          if (!transcript) {
            transcript = await fetchTranscript(videoUrl);
          }

          if (transcript) {
            var styleHints = {
              podcast: 'Focus on strong opinions, surprising facts, emotional moments.',
              gaming: 'Focus on highlights, celebrations, fails, clutch moments.',
              vlog: 'Focus on funny moments, beautiful shots, emotional content.',
              auto: 'Automatically detect the best moments regardless of content type.',
            };
            var styleHint = styleHints[style] || styleHints.auto;
            var langLabel = (language === 'id') ? 'Indonesian' : 'English';
            var prompt = 'Video style: ' + styleHint + '\nLanguage: ' + langLabel + '\nNumber of clips: ' + count + '\n\nTranscript:\n' + transcript.slice(0, 50000);

            var raw = await callAI(prompt, HIGHLIGHT_SYSTEM_PROMPT, env);
            var hd = extractJson(raw);

            var updated = await getJob(kv, jobId);
            if (updated) {
              updated.clips = [];
              if (hd && hd.clips) {
                for (var i = 0; i < hd.clips.length; i++) {
                  var c = hd.clips[i];
                  updated.clips.push({
                    id: 'clip_' + (i + 1),
                    startTime: c.start_seconds || 0,
                    endTime: c.end_seconds || 0,
                    duration: (c.end_seconds || 0) - (c.start_seconds || 0),
                    text: c.text || '',
                    engagementScore: c.engagement_score || 0,
                    hookPotential: c.hook_potential || 0,
                    emotion: c.emotion || 'unknown',
                    whyViral: c.why_viral || '',
                    suggestedHook: c.suggested_hook || '',
                    downloadUrl: null,
                  });
                }
              }
              updated.meta = hd ? (hd.meta || null) : null;
              updated.status = 'processing';
              updated.progress = 30;
              updated.updatedAt = Date.now();
              await setJob(kv, jobId, updated);
            }
          }
        } catch (err) {
          var failed = await getJob(kv, jobId);
          if (failed) {
            failed.status = 'failed';
            failed.error = err.message;
            failed.updatedAt = Date.now();
            await setJob(kv, jobId, failed);
          }
        }
      })());

      return json({
        jobId: jobId, status: 'analyzing', estimatedSeconds: 120,
        clipsRequested: count, creditsRemaining: credits.remaining - 1,
      });
    }

    // GET /api/clips/:jobId
    var jobMatch = url.pathname.match(/^\/api\/clips\/([^\/]+)$/);
    if (jobMatch && method === 'GET') {
      var gotJob = await getJob(kv, jobMatch[1]);
      if (!gotJob) { return error('Job not found', 404); }
      if (gotJob.userId !== userId) { return error('Access denied', 403); }
      return json({
        id: gotJob.id, status: gotJob.status, progress: gotJob.progress,
        clips: gotJob.clips || [], meta: gotJob.meta, style: gotJob.style,
        error: gotJob.error || null,
      });
    }

    // GET /api/clips/:jobId/download/:clipId
    var dlMatch = url.pathname.match(/^\/api\/clips\/([^\/]+)\/download\/([^\/]+)$/);
    if (dlMatch && method === 'GET') {
      var dlJob = await getJob(kv, dlMatch[1]);
      if (!dlJob) { return error('Job not found', 404); }
      if (dlJob.userId !== userId) { return error('Access denied', 403); }

      var foundClip = null;
      if (dlJob.clips) {
        for (var i = 0; i < dlJob.clips.length; i++) {
          if (dlJob.clips[i].id === dlMatch[2]) {
            foundClip = dlJob.clips[i];
            break;
          }
        }
      }
      if (!foundClip) { return error('Clip not found', 404); }

      if (foundClip.downloadUrl) {
        return Response.redirect(foundClip.downloadUrl, 302);
      }

      var renderUrl = env.RENDER_BASE_URL;
      if (renderUrl) {
        var proxyRes = await fetch(
          renderUrl + '/api/clips/' + dlMatch[1] + '/download/' + dlMatch[2],
          { headers: { 'Authorization': 'Bearer ' + token } }
        );
        if (proxyRes.ok) {
          var dlHeaders = mergeHeaders({
            'Content-Type': proxyRes.headers.get('Content-Type') || 'video/mp4',
            'Content-Disposition': 'attachment; filename="' + dlMatch[2] + '.mp4"',
          }, CORS_HEADERS);
          return new Response(proxyRes.body, { status: 200, headers: dlHeaders });
        }
      }

      // Fallback: If the original videoUrl is a YouTube link, return a timestamped URL
      var originalUrl = dlJob.videoUrl || '';
      var ytId = originalUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      var watchUrl = originalUrl;
      if (ytId && foundClip.startTime !== undefined) {
        watchUrl = 'https://www.youtube.com/watch?v=' + ytId[1] + '&t=' + Math.floor(foundClip.startTime) + 's';
      }

      return json({
        clip: {
          id: foundClip.id, startTime: foundClip.startTime,
          endTime: foundClip.endTime, duration: foundClip.duration,
          text: foundClip.text,
          engagementScore: foundClip.engagementScore,
          emotion: foundClip.emotion, whyViral: foundClip.whyViral,
        },
        watchUrl: watchUrl,
        note: 'Direct video download requires Render backend. Click watchUrl to preview on YouTube at the clip timestamp.',
      });
    }

    // POST /api/clips/:jobId/regenerate
    var regenMatch = url.pathname.match(/^\/api\/clips\/([^\/]+)\/regenerate$/);
    if (regenMatch && method === 'POST') {
      var body = await request.json();
      var clipId = body.clipId;
      var clipStart = body.startTime;
      var clipEnd = body.endTime;
      if (!clipId || clipStart === undefined || clipEnd === undefined) {
        return error('clipId, startTime, and endTime required');
      }
      var regenJob = await getJob(kv, regenMatch[1]);
      if (!regenJob) { return error('Job not found', 404); }
      if (regenJob.userId !== userId) { return error('Access denied', 403); }

      var rePrompt = 'User adjusted clip ' + clipId + ' to ' + clipStart + 's-' + clipEnd + 's (' + (clipEnd - clipStart).toFixed(1) + 's). Is this a good TikTok clip length? Ideal: 15-60s. Return JSON: { "clip_id": "' + clipId + '", "duration_ok": true, "warning": null, "revised_engagement_score": 0, "suggested_hook": "..." }';
      var raw = await callAI(rePrompt, null, env);
      var regenData = extractJson(raw);

      var updated = await getJob(kv, regenMatch[1]);
      if (updated && updated.clips) {
        for (var i = 0; i < updated.clips.length; i++) {
          if (updated.clips[i].id === clipId) {
            updated.clips[i].startTime = clipStart;
            updated.clips[i].endTime = clipEnd;
            updated.clips[i].duration = clipEnd - clipStart;
            if (regenData && regenData.revised_engagement_score) {
              updated.clips[i].engagementScore = regenData.revised_engagement_score;
            }
            if (regenData && regenData.suggested_hook) {
              updated.clips[i].suggestedHook = regenData.suggested_hook;
            }
            updated.clips[i].manuallyAdjusted = true;
            updated.updatedAt = Date.now();
            break;
          }
        }
        await setJob(kv, regenMatch[1], updated);
      }

      return json({
        clipId: clipId, startTime: clipStart, endTime: clipEnd,
        duration: clipEnd - clipStart,
        analysis: regenData || { duration_ok: true },
      });
    }

    // Fallback
    return error('Not found', 404);
  },
};
