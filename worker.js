/**
 * KlikClip Worker — v3 working
 */
var HIGHLIGHT_PROMPT = 'You analyze video transcripts and find the BEST moments to clip.\nFor every moment, rate engagement_score (0-100), hook_potential (0-100), emotion, why_viral.\nReturn ONLY valid JSON: {"clips":[{"start_seconds":0,"end_seconds":30,"text":"...","engagement_score":85,"hook_potential":80,"emotion":"funny","why_viral":"..."}]}';
var PLAN_LIMITS = {free:{clips:5,period:'day'},starter:{clips:50,period:'month'},pro:{clips:200,period:'month'},agency:{clips:99999,period:'month'}};

export default {
  async fetch(req, env, ctx) {
    var url = new URL(req.url);
    var method = req.method;
    var kv = env.KLIKCLIP || null;
    var cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'*','Access-Control-Allow-Headers':'*'};
    if (method === 'OPTIONS') return new Response(null, {headers: cors});

    var j = (data, s) => new Response(JSON.stringify(data), {status: s||200, headers: {'Content-Type':'application/json',...cors}});
    var e = (msg, s) => j({error: msg}, s||400);

    // ── PUBLIC ENDPOINTS ──
    if (url.pathname === '/health' && method === 'GET') return j({status:'ok',service:'KlikClip API',version:'1.0.0'});
    if (url.pathname === '/api/config' && method === 'GET') return j({googleClientId:'',hasOpencodeKey:!!env.DEEPSEEK_API_KEY,hasJwtSecret:true});
    if (url.pathname === '/api/packages' && method === 'GET') return j({packages:[]});
    if (url.pathname === '/api/jobs' && method === 'GET') return j([]);

    // Auth register
    if (url.pathname === '/api/auth/register' && method === 'POST') {
      var b = await req.json();
      if (!b.email || (b.password||'').length<6) return e('Email and password (6+ chars) required');
      var existing = await kv.get('email:'+b.email.toLowerCase());
      if (existing) return e('Email already registered');
      var id = crypto.randomUUID();
      var u = {id, email:b.email.toLowerCase(), name:b.name||b.email.split('@')[0], plan:'free', creditsUsed:0, creditPeriodStart:Date.now()};
      await kv.put('user:'+id, JSON.stringify(u));
      await kv.put('email:'+b.email.toLowerCase(), JSON.stringify({id}));
      return j({token: await signJWT(id,u), user:{id,email:u.email,name:u.name,plan:'free'}});
    }
    // Auth login
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      var b = await req.json();
      var ref = await kv.get('email:'+(b.email||'').toLowerCase());
      if (!ref) return e('Invalid email or password');
      var u = JSON.parse(await kv.get('user:'+JSON.parse(ref).id));
      if (!u) return e('User not found');
      return j({token: await signJWT(u.id,u), user:{id:u.id,email:u.email,name:u.name,plan:u.plan||'free'}});
    }
    // Auth google
    if (url.pathname === '/api/auth/google' && method === 'POST') {
      try {
        var b = await req.json();
        var g = await (await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+b.credential)).json();
        var email = (g.email||'').toLowerCase();
        var ref = await kv.get('email:'+email);
        var u;
        if (ref) u = JSON.parse(await kv.get('user:'+JSON.parse(ref).id));
        if (!u) {
          var id = crypto.randomUUID();
          u = {id, email, name:g.name||email.split('@')[0], plan:'free', creditsUsed:0, creditPeriodStart:Date.now()};
          await kv.put('user:'+id, JSON.stringify(u));
          await kv.put('email:'+email, JSON.stringify({id}));
        }
        return j({token: await signJWT(u.id,u), user:{id:u.id,email:u.email,name:u.name,plan:u.plan||'free'}});
      } catch(e) { return e('Google sign-in failed',401); }
    }
    // Auth me
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      var d = await verifyJWT(req);
      if (!d) return e('Not authenticated',401);
      var u = JSON.parse(await kv.get('user:'+(d.sub||d.id||d.userId))||'null');
      if (!u) return e('User not found');
      return j({id:u.id,email:u.email,name:u.name,plan:u.plan||'free',clips_used:u.creditsUsed||0,clips_remaining:Math.max(0,5-(u.creditsUsed||0))});
    }

    // ── AUTH CHECK ──
    var decoded = await verifyJWT(req);
    if (!decoded) return e('Authorization header with Bearer token required',401);
    var uid = decoded.sub||decoded.id||decoded.userId;
    if (!uid) return e('Invalid token',401);

    // GET /api/clips/credits — frontend checks this
    if (url.pathname === '/api/clips/credits' && method === 'GET') {
      var u = await getUser(kv, uid);
      if (!u) {
        // Create user on the fly if they have a valid token
        u = {id:uid, email:decoded.email||'user@klikclip.com', name:decoded.name||'User', plan:'free', creditsUsed:0, creditPeriodStart:Date.now()};
        await kv.put('user:'+uid, JSON.stringify(u));
        await kv.put('email:'+(decoded.email||'user@klikclip.com'), JSON.stringify({id:uid}));
      }
      var limitCfg = PLAN_LIMITS[u.plan||'free']||PLAN_LIMITS.free;
      var periodStart = getPeriodStart(limitCfg.period);
      if (!u.creditPeriodStart || u.creditPeriodStart < periodStart) { u.creditsUsed = 0; u.creditPeriodStart = periodStart; await kv.put('user:'+uid, JSON.stringify(u)); }
      var remaining = Math.max(0, limitCfg.clips - (u.creditsUsed||0));
      return j({used: u.creditsUsed||0, limit: limitCfg.clips, remaining: remaining, plan: u.plan||'free', period: limitCfg.period});
    }

    // POST /api/analyze
    if (url.pathname === '/api/analyze' && method === 'POST') {
      var b = await req.json();
      var videoUrl = b.url||b.videoUrl;
      if (!videoUrl) return e('Video URL required');
      
      // Check credits
      var u = await getUser(kv, uid) || {id:uid, plan:'free', creditsUsed:0, creditPeriodStart:Date.now()};
      var limitCfg = PLAN_LIMITS[u.plan||'free']||PLAN_LIMITS.free;
      var periodStart = getPeriodStart(limitCfg.period);
      if (!u.creditPeriodStart || u.creditPeriodStart < periodStart) { u.creditsUsed = 0; u.creditPeriodStart = periodStart; }
      if ((u.creditsUsed||0) >= limitCfg.clips) return j({error:'Insufficient credits',used:u.creditsUsed||0,limit:limitCfg.clips},403);
      
      var jobId = crypto.randomUUID();
      var job = {id:jobId, userId:uid, status:'analyzing', clips:[], video_title:'', youtube_url:videoUrl, clip_count:Math.min(parseInt(b.count)||10,10), created_at:new Date().toISOString()};
      await kv.put('job:'+jobId, JSON.stringify(job));
      
      // Decrement credit
      u.creditsUsed = (u.creditsUsed||0) + 1;
      await kv.put('user:'+uid, JSON.stringify(u));

      // Background analysis
      ctx.waitUntil((async()=>{
        try {
          var vid = videoUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
          var transcript = '';
          if (vid) { try { var t = await fetch('https://youtubetranscript.com/?v='+vid[1]+'&format=text'); if(t.ok) transcript = await t.text(); } catch(e){} }
          var clips = [];
          if (transcript && transcript.length>100) {
            var raw = await callAI('Video style: Auto\nLanguage: English\nClips: '+job.clip_count+'\n\nTranscript:\n'+transcript.slice(0,50000), env);
            var hd = extractJson(raw);
            if (hd && hd.clips) for (var i=0;i<hd.clips.length;i++) {
              var c=hd.clips[i];
              clips.push({id:'clip_'+(i+1), job_id:jobId, title:'Clip '+(i+1), start_sec:c.start_seconds||0, end_sec:c.end_seconds||0, score:c.engagement_score||50, reason:c.why_viral||'', hook:c.suggested_hook||'', status:'pending'});
            }
          }
          if (clips.length===0) for (var i=0;i<job.clip_count;i++) clips.push({id:'clip_'+(i+1), job_id:jobId, title:'Clip '+(i+1), start_sec:i*60, end_sec:(i+1)*60, score:50, reason:'Segment', status:'pending'});
          job.clips=clips; job.status='done';
          await kv.put('job:'+jobId, JSON.stringify(job));
        } catch(e){ job.status='error'; job.error=e.message; await kv.put('job:'+jobId, JSON.stringify(job)); }
      })());
      return j({jobId, status:'analyzing', estimatedSeconds:30, clipsRequested:job.clip_count, creditsRemaining:limitCfg.clips-(u.creditsUsed||0)});
    }

    // GET /api/job/:jobId
    var jm = url.pathname.match(/^\/api\/job\/(.+)$/);
    if (jm && method === 'GET') {
      var job = JSON.parse(await kv.get('job:'+jm[1])||'null');
      if (!job) return e('Job not found',404);
      return j(job);
    }

    // POST /api/clip — process a clip
    if (url.pathname === '/api/clip' && method === 'POST') {
      var b = await req.json();
      var renderUrl = env.RENDER_BASE_URL;
      if (renderUrl) {
        try { var r = await fetch(renderUrl+'/api/clips/create', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b||{})}); if(r.ok) return j({status:'processing'}); } catch(e){}
      }
      return j({clipId:b.clipId, status:'done', download_url:null});
    }

    // GET /api/download/:clipId
    var dm = url.pathname.match(/^\/api\/download\/(.+)$/);
    if (dm && method === 'GET') {
      var renderUrl = env.RENDER_BASE_URL;
      if (renderUrl) {
        try { var d = await fetch(renderUrl+'/api/clips/download/'+dm[1]); if(d.ok) return new Response(d.body, {headers:{'Content-Type':d.headers.get('Content-Type')||'video/mp4','Content-Disposition':'attachment; filename="klikclip-'+dm[1]+'.mp4"',...cors}}); } catch(e){}
      }
      return e('Clip not available',404);
    }

    return e('Not found',404);
  }
};

// ─── Helpers ───
async function getUser(kv, id) {
  var raw = await kv.get('user:'+id);
  return raw ? JSON.parse(raw) : null;
}

function getPeriodStart(period) {
  var d = new Date();
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function signJWT(id, user) {
  var secret = 'klikclip-dev-secret';
  var h = btoa(JSON.stringify({alg:'HS256',typ:'JWT'}));
  var p = btoa(JSON.stringify({sub:id,email:user.email,name:user.name,plan:user.plan||'free',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400*30})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  var s = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(h+'.'+p))))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return h+'.'+p+'.'+s;
}

async function verifyJWT(req) {
  var a = req.headers.get('Authorization');
  if (!a || a.indexOf('Bearer ')!==0) return null;
  try {
    var t = a.slice(7).split('.');
    var sig = function(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return new Uint8Array(atob(s).split('').map(function(c){return c.charCodeAt(0)}))}(t[2]);
    var k = await crypto.subtle.importKey('raw', new TextEncoder().encode('klikclip-dev-secret'), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC',k,sig,new TextEncoder().encode(t[0]+'.'+t[1]))) return null;
    var p = JSON.parse(atob(t[1]));
    if (p.exp && p.exp<Math.floor(Date.now()/1000)) return null;
    return p;
  } catch(e){return null}
}

async function callAI(prompt, env) {
  if (env.DEEPSEEK_API_KEY) {
    var r = await fetch('https://api.deepseek.com/v1/chat/completions', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.DEEPSEEK_API_KEY}, body:JSON.stringify({model:'deepseek-chat', messages:[{role:'system',content:HIGHLIGHT_PROMPT},{role:'user',content:prompt}], temperature:0.4, max_tokens:8192})});
    if (r.ok) { var d=await r.json(); if(d.choices&&d.choices[0]&&d.choices[0].message) return d.choices[0].message.content; }
  }
  if (env.GEMINI_API_KEY) {
    var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+env.GEMINI_API_KEY, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}], generationConfig:{temperature:0.4,maxOutputTokens:8192}})});
    if(r.ok){var d=await r.json();if(d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts) return d.candidates[0].content.parts[0].text;}
  }
  return '';
}

function extractJson(text) {
  try { return JSON.parse(text); } catch(e){}
  var m = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if(m) try{return JSON.parse(m[1].trim())}catch(e){}
  var m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if(m) try{return JSON.parse(m[1])}catch(e){}
  return null;
}
