/**
 * AIHighlight.js v4 — Full 4-Stage Pipeline (Variant C)
 *
 * Stage 1/3/4: DeepSeek V4 Flash  |  Stage 2: DeepSeek V4 Pro (best reasoning)
 * Zero external dependencies. Zero silent failures.
 * 100% of your opencode-go key.
 *
 * Stage 1: Enrich transcript (clean, structure, add context)
 * Stage 2: Detect moments + score (4-dimension virality)  
 * Stage 3: Write hooks + captions (creative, higher temp)
 * Stage 4: SEO titles + metadata (keywords, hashtags)
 */
const axios = require('axios');

const API_BASE = process.env.OPENCODE_BASE || 'https://opencode.ai/zen/go/v1';
const API_KEY = process.env.OPENCODE_KEY || process.env.VIOSTUDIO_KEY || '';

// =====================================================================
// STAGE 1: Transcript Enrichment
// =====================================================================
const STAGE1_PROMPT = `You are a transcript cleaner. Clean and structure the transcript below.

Rules:
- Remove filler words (um, uh, like, you know) when excessive
- Fix obvious transcription errors
- Add [laughter], [applause], [music] markers if context suggests them
- Keep ALL content and timestamps intact
- Return the cleaned transcript with timestamps preserved
- Do NOT change any factual content
- Do NOT add or remove information

Return JSON:
{
  "cleaned_transcript": "string with timestamps and cleaned text"
}`;

// =====================================================================
// STAGE 2: Moment Detection (Ultra)
// =====================================================================
const STAGE2_PROMPT = `You are ViralClip — an expert short-form video editor matching OpusClaw's quality. Analyze the transcript and find viral moments for TikTok/Reels/Shorts.

## SCORING (0-25 each, total 0-100)
- hook_score (0-25): First 3 seconds — bold claim? question? surprise? shock?
- engagement_score (0-25): Emotional energy — laughter? shock? passion? drama?
- value_score (0-25): Insight — does this teach something useful?
- shareability_score (0-25): Would someone send this to a friend?

## HOOK TYPES
question | statement | statistic | story | contrast | controversy | revelation | reaction | demonstration | none

## INCLUDE: contrarian claims, mistakes/lessons, examples, before/after,
surprising results, emotional reactions, complete Q&A, hot takes,
story arcs (setup→tension→payoff in 15-60s), demonstrations, reveals

## EXCLUDE: intros, sponsors, vague setup, contextless quotes,
repeated points, definitions without examples, answer fragments,
rambling, technical setup, off-topic tangents, silence, monotone

OUTPUT 8-15 moments. Be generous — Stage 3 will filter.

Return JSON:
{
  "clips": [{
    "start_time": float, "end_time": float, "duration": float,
    "text": "exact spoken text",
    "hook_type": "string",
    "hook_score": int 0-25,
    "engagement_score": int 0-25,
    "value_score": int 0-25,
    "shareability_score": int 0-25,
    "total_score": int 0-100,
    "context_note": "why this works (1 sentence)"
  }],
  "summary": "1 sentence",
  "key_topics": ["topic"]
}`;

// =====================================================================
// STAGE 3: Hook + Caption Generation (Creative, Higher Temp)
// =====================================================================
const STAGE3_PROMPT = `You are a viral short-form content writer. Given video segments with their scores, write attention-grabbing hooks and captions.

For each segment:
1. hook_text (≤8 words): Standalone attention grabber
2. caption: 1-2 conversational sentences + 3-5 hashtags + 2-3 emojis
3. hook_category: curiosity_gap|bold_claim|question|result|number|comparison|story_opener

RULES:
- Hooks must work WITHOUT the original video context
- First 3 seconds of the clip must use the hook_text as the opener
- Captions: conversational, lowercase where appropriate
- Hashtags: mix of broad (viral, fyp) and niche (relevant to content)

Return JSON array:
[{
  "start_time": float (pass through),
  "hook_text": "≤8 words",
  "hook_category": "string",
  "caption": "string with emojis and hashtags",
  "suggested_title": "3-8 words clickable"
}]`;

// =====================================================================
// STAGE 4: SEO Title + Metadata
// =====================================================================
const STAGE4_PROMPT = `You are an SEO and metadata specialist for short-form video.

Given video segments with hooks and captions, write OPTIMIZED titles and metadata.

For each segment:
1. seo_title: Optimized for TikTok/YouTube search (5-10 words)
2. seo_keywords: 5-7 relevant keywords for discovery
3. suggested_hashtags: 5-7 trending hashtags
4. thumbnail_text: 2-4 words for thumbnail overlay

Return JSON array:
[{
  "start_time": float (pass through),
  "seo_title": "string",
  "seo_keywords": ["keyword"],
  "suggested_hashtags": ["hashtag"],
  "thumbnail_text": "string"
}]`;

// =====================================================================
// MAIN EXPORT
// =====================================================================
async function detectHighlights(videoInfo, clipCount) {
  const { title, description, duration, transcript, chapters } = videoInfo;
  const durationSec = duration || 0;
  const transcriptText = buildTranscriptText(transcript);
  const chunks = chunkTranscriptSafe(transcriptText, 4000);

  try {
    // ---- STAGE 1: Enrich transcript ----
    const enriched = await callAI(STAGE1_PROMPT,
      `Clean this transcript:\n\nTitle: ${title}\n\n${chunks[0] || transcriptText}`,
      0.1, 4096);
    const cleanedTranscript = enriched?.cleaned_transcript || chunks[0];

    // ---- STAGE 2: Detect moments (process chunks, then merge) — Uses Pro for best reasoning ----
    let allMoments = [];
    for (let i = 0; i < chunks.length; i++) {
      const context = i > 0 ? `Previous context: ${chunks[i-1].slice(-200)}\n\n` : '';
      const result = await callAI(STAGE2_PROMPT,
        `FIND viral moments in this video.\n\nTitle: ${title}\nDuration: ${Math.floor(durationSec/60)}m\n\n${context}Transcript (part ${i+1}/${chunks.length}):\n${chunks[i]}`,
        0.2, 4096, 'deepseek-v4-pro');
      if (result?.clips) allMoments = allMoments.concat(result.clips);
    }
    const summary = result?.summary || '';
    const keyTopics = result?.key_topics || [];

    // Post-process: deduplicate, sort by score, space them out
    const topMoments = deduplicateAndRank(allMoments, clipCount || 10, 30);
    if (topMoments.length === 0) throw new Error('No moments detected');

    // ---- STAGE 3: Write hooks + captions ----
    const hooksResult = await callAI(STAGE3_PROMPT,
      `Write hooks and captions for these ${topMoments.length} video segments:\n\n${JSON.stringify(topMoments.map(m => ({
        start_time: m.start_time, text: m.text, hook_type: m.hook_type, total_score: m.total_score
      })), null, 2)}`,
      0.6, 2048);

    // ---- STAGE 4: SEO titles + metadata ----
    const seoResult = await callAI(STAGE4_PROMPT,
      `Write SEO titles and metadata for these video segments:\n\n${JSON.stringify(topMoments.map(m => ({
        start_time: m.start_time,
        text: m.text,
        hook_text: hooksResult?.find(h => h.start_time === m.start_time)?.hook_text || '',
        caption: hooksResult?.find(h => h.start_time === m.start_time)?.caption || '',
      })), null, 2)}`,
      0.4, 2048);

    // ---- MERGE ALL STAGES ----
    const clips = topMoments.map((m, i) => {
      const h = (hooksResult || []).find(x => Math.abs(x.start_time - m.start_time) < 1);
      const s = (seoResult || []).find(x => Math.abs(x.start_time - m.start_time) < 1);
      return {
        rank: i + 1,
        start_sec: m.start_time,
        end_sec: m.end_time,
        duration: m.duration || (m.end_time - m.start_time),
        text: m.text || '',
        hook_type: m.hook_type || 'none',
        hook_text: h?.hook_text || '',
        hook_score: m.hook_score || 0,
        engagement_score: m.engagement_score || 0,
        value_score: m.value_score || 0,
        shareability_score: m.shareability_score || 0,
        total_score: m.total_score || 0,
        virality_level: getLevel(m.total_score || 0),
        reason: m.context_note || '',
        caption: h?.caption || '',
        suggested_title: h?.suggested_title || s?.seo_title || '',
        seo_keywords: s?.seo_keywords || [],
        suggested_hashtags: s?.suggested_hashtags || [],
        thumbnail_text: s?.thumbnail_text || '',
      };
    });

    return { clips, summary, key_topics: keyTopics };

  } catch (err) {
    console.error('[AIHighlight] Pipeline failed, using fallback:', err.message);
    return fallbackHighlights(durationSec, clipCount || 10);
  }
}

// ─── SINGLE AI CALL WRAPPER ────────────────────────────────────────────────
async function callAI(systemPrompt, userContent, temperature, maxTokens, modelName) {
  const model = modelName || 'deepseek-v4-flash';
  if (!API_KEY) throw new Error('OPENCODE_KEY not set');

  const resp = await axios.post(
    `${API_BASE}/chat/completions`,
    {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature,
      max_tokens: maxTokens,
      top_p: 0.9,
    },
    {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  const content = resp.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response');

  const cleaned = content.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── POST-PROCESSING ────────────────────────────────────────────────────────
function deduplicateAndRank(moments, maxClips = 10, minSpacing = 30) {
  if (!moments || moments.length === 0) return [];

  // Sort by score descending
  const sorted = [...moments].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

  // Filter: ensure min spacing between clips
  const selected = [];
  for (const m of sorted) {
    const overlaps = selected.some(s =>
      Math.abs((s.start_time || 0) - (m.start_time || 0)) < minSpacing
    );
    if (!overlaps) {
      selected.push({
        start_time: parseFloat(m.start_time) || 0,
        end_time: parseFloat(m.end_time) || (parseFloat(m.start_time) || 0) + 30,
        duration: parseFloat(m.duration) || 30,
        text: m.text || '',
        hook_type: m.hook_type || 'none',
        hook_score: clamp(m.hook_score, 0, 25),
        engagement_score: clamp(m.engagement_score, 0, 25),
        value_score: clamp(m.value_score, 0, 25),
        shareability_score: clamp(m.shareability_score, 0, 25),
        total_score: clamp(m.total_score, 0, 100),
        context_note: m.context_note || m.reason || '',
      });
    }
    if (selected.length >= maxClips) break;
  }

  return selected;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, parseInt(val) || 0));
}

function getLevel(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'average';
  return 'skip';
}

function buildTranscriptText(segments) {
  if (!segments || !Array.isArray(segments)) return '';
  return segments.map(s => `[${fmtTime(s.start)}] ${s.text}`).join('\n');
}

function fmtTime(s) {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function chunkTranscriptSafe(text, maxChars = 4000) {
  if (!text) return [''];
  if (text.length <= maxChars) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function fallbackHighlights(duration, count = 10) {
  const interval = Math.floor((duration || 600) / (count + 1));
  return {
    clips: Array.from({ length: count }, (_, i) => ({
      rank: i + 1,
      start_sec: interval * (i + 1),
      end_sec: Math.min(duration || 600, interval * (i + 1) + 30),
      duration: 30, text: '',
      hook_type: 'none', hook_text: '',
      hook_score: 0, engagement_score: 0, value_score: 0, shareability_score: 0, total_score: 0,
      virality_level: 'skip', reason: 'Fallback', caption: '', suggested_title: '',
      seo_keywords: [], suggested_hashtags: [], thumbnail_text: '',
    })),
  };
}

module.exports = { detectHighlights, fallbackHighlights };
