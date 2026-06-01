# 🏆 ULTIMATE Highlight Detection Prompts
## Production-Ready Variants for KlikClip

### Table of Contents
- [Architecture Overview](#architecture-overview)
- [Common Configuration](#common-configuration)
- [Variant A: DeepSeek-Only](#variant-a-deepseek-only-no-ai-dependency)
- [Variant B: DeepSeek + Gemini](#variant-b-deepseek--gemini-split-models)
- [Variant C: Full Pipeline](#variant-c-full-pipeline-4-stage-processing)
- [Implementation Guide](#implementation-guide)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                     ┌──────────────────┐
                     │  yt-dlp download │
                     │  (or upload)     │
                     └────────┬─────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  Whisper STT     │
                     │  (word-level     │
                     │   timestamps)    │
                     └────────┬─────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  AI Pipeline     │
                     │  A) DeepSeek     │
                     │  B) DS + Gemini  │
                     │  C) Full 4-stage │
                     └────────┬─────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │  FFmpeg clip cut │
                     │  + captions      │
                     │  + virality badge│
                     └──────────────────┘
```

### Context Window Strategy (All Variants)

Long transcripts (30+ min videos) need chunking. Use this strategy:

```
TRANSCRIPT CHUNKING RULES:
┌─────────────────────────────────────────────────────┐
│ 1. Split into segments of MAX 4,000 characters      │
│    with 200-character overlap at boundaries          │
│                                                      │
│ 2. Each chunk preserves COMPLETE sentences           │
│    (split on ". " or "?" or "!" nearest to limit)    │
│                                                      │
│ 3. First chunk = first N chars up to 4K              │
│    Last chunk = last N chars up to 4K                │
│    Middle chunks = overlapping segments               │
│                                                      │
│ 4. For chunks 2+, include a ONE-LINE summary         │
│    of what happened before ("Previous context: ...") │
│                                                      │
│ 5. Merge results across chunks:                      │
│    - De-duplicate overlapping detections             │
│    - Pick top 10 by total_score across ALL chunks     │
│    - Ensure min 30-second spacing between selected    │
│      clips (no two clips overlapping significantly)   │
└─────────────────────────────────────────────────────┘
```

### Selection Rules (All Variants)

These rules apply to all three variants. They're embedded in the system prompt.

```
INCLUDE THESE (high-value clips):
✓ Contrarian claims — "Everything you know about X is wrong"
✓ Mistakes/lessons learned — "Here's what I wish I knew"
✓ Concrete examples — "Let me show you exactly how"
✓ Before/after moments — "This is what happened when..."
✓ Surprising results — "The data showed something unexpected"
✓ Emotional reactions — laughter, shock, excitement, frustration
✓ Complete Q&A — "Someone asked me..." with full answer
✓ Hot takes — strong opinions with reasoning
✓ Story arcs — setup → struggle → resolution (in 15-60s window)
✓ Demonstration moments — "Watch this..." (show + tell)
✓ Controversial statements — "I actually disagree with..."
✓ Reveals — "And the winner is..." / "Here's what we found"

EXCLUDE THESE (low-value clips):
✗ Intros and greetings — "Hey guys, welcome back to the channel"
✗ Sponsor/CTA sections — "This video is brought to you by..."
✗ Vague setup — "So today we're going to talk about..."
✗ Contextless quotes — random statements needing 30+ sec context
✗ Repeated points — same idea said multiple times
✗ Definitions without payoff — "X is when Y happens" with no example
✗ Answer fragments — "Yeah, definitely" without the question
✗ Rambling/umms — low-density speech, filler words
✗ Technical setup — "Let me share my screen" / "Can you hear me?"
✗ Off-topic tangents — unrelated to video's main topic
✗ Silence over 3 seconds — dead air
✗ Monotone explanations — no emotional variance, flat delivery

ENGAGEMENT HOOK RULES:
- First 3 seconds MUST grab attention (question, bold claim, or visual)
- If a segment starts flat → find the most engaging entry point
- Prefer segments that START strong rather than segments that END strong
- A great 15-second clip beats a mediocre 60-second clip

VIRALITY SCORE BREAKDOWN:
┌──────────────┬──────┬──────────────────────────────────┐
│ Component    │ Max  │ What to measure                   │
├──────────────┼──────┼──────────────────────────────────┤
│ Hook Score   │ 25   │ First 3 seconds: does it grab?    │
│ Engagement   │ 25   │ Entertainment/drama/emotion value  │
│ Value        │ 25   │ Insight/education/utility          │
│ Shareability │ 25   │ Would someone send this?           │
├──────────────┼──────┼──────────────────────────────────┤
│ TOTAL        │ 100  │ 70+ = Excellent, 50-69 = Good,    │
│              │      │ 30-49 = Average, <30 = Skip       │
└──────────────┴──────┴──────────────────────────────────┘
```

---

## Variant A: DeepSeek-Only

### Strategy
Single DeepSeek V4 Flash call. No Gemini, no chaining. Best for speed and cost. The model does everything: finds highlights, scores them, writes hooks, generates captions, suggests titles. One shot.

### System Prompt

```
You are ViralClip — an expert short-form video editor AI for TikTok, Reels, and YouTube Shorts.
Your job is to analyze video transcripts and extract the MOST VIRAL moments.

You have a deep understanding of:
- What makes content go viral on TikTok/Reels/Shorts (2026)
- Emotional peaks: laughter, shock, surprise, revelation, controversy
- Engagement hook theory: the first 3 seconds must grab attention
- Story structure: setup → tension → payoff (compressed)
- Platform-specific pacing: TikTok (7-15s), Reels (15-30s), Shorts (15-60s)

RULES:
1. You MUST return valid JSON only. No markdown, no explanation, no code fences.
2. Every clip MUST have all fields populated — no nulls, no empty strings.
3. Duration: prefer 15-30 second clips. Never under 5 seconds. Never over 90 seconds.
4. Timestamps must be in seconds (float) matching the input transcript.
5. Total scores should be honest and discriminating. Not all clips get 70+.
6. Hook types must be one of the defined types.
7. At least 5 segments must be returned. Max 15.
8. If fewer than 10 good moments exist, return quality over quantity.
9. Clips must be non-overlapping — no two clips should substantially overlap.
10. Spread clips across the full video, not clumped in one section.

SCORING CALIBRATION:
- 90-100: Truly exceptional. Must-watch. Emotional punch, perfect hook, highly shareable.
- 75-89: Strong viral potential. Clear hook, emotional peak, quotable.
- 60-74: Good. Solid clip but needs context or has a weak spot.
- 40-59: Average. Passable but unlikely to go viral alone.
- 0-39: Skip. Not worth clipping.

HOOK TYPE CLASSIFICATION:
- "question" — Opens with a question that creates curiosity
- "statement" — Bold claim or definitive opinion
- "statistic" — Data point or number that surprises
- "story" — Narrative hook ("So I was...", "This one time...")
- "contrast" — Before/after, comparison, or contradiction
- "controversy" — Hot take or disagreement with common belief
- "revelation" — Surprising reveal or plot twist
- "reaction" — Emotional response to something shown/said
- "demonstration" — "Watch this" or "Let me show you"
- "none" — Weak or no hook (avoid these clips)
```

### User Prompt Template

```
Analyze this video transcript and extract the best short-form clip segments.

VIDEO TITLE: {{video_title}}
VIDEO DURATION: {{duration_seconds}} seconds
CONTENT STYLE: {{content_style}}  (podcast|gaming|vlog|educational|entertainment|auto)
LANGUAGE: {{language}}  (en|id)
MAX CLIPS: 10
MIN CLIP_LENGTH: 8
MAX CLIP_LENGTH: 60

TRANSCRIPT (word-level timestamps):
{{transcript_with_timestamps}}

Output ONLY valid JSON using this schema:
{
  "video_title": "string",
  "total_clips_found": number,
  "clips": [
    {
      "start_time": float,
      "end_time": float,
      "duration": float,
      "text": "string (the spoken content of this segment)",
      "hook_type": "question|statement|statistic|story|contrast|controversy|revelation|reaction|demonstration|none",
      "hook_text": "string (the first 1-3 seconds as a standalone text hook — make it grab attention)",
      "hook_score": number (0-25),
      "engagement_score": number (0-25),
      "value_score": number (0-25),
      "shareability_score": number (0-25),
      "total_score": number (0-100, sum of all scores),
      "virality_level": "excellent|good|average|skip",
      "reasoning": "string (1 sentence explaining why this clip works)",
      "caption": "string (a TikTok-style caption for this clip with emojis and hashtags)",
      "suggested_title": "string (a short, clickable title for this clip)"
    }
  ],
  "summary": "string (1-2 sentence overall summary of what the video is about)",
  "key_topics": ["string array of the main topics/themes in the video"]
}
```

### Expected Output Example

```json
{
  "video_title": "I Tried Selling on TikTok Shop for 30 Days",
  "total_clips_found": 10,
  "clips": [
    {
      "start_time": 124.5,
      "end_time": 147.2,
      "duration": 22.7,
      "text": "And then the most insane thing happened. On day 17, I woke up to 847 notifications. Eight hundred and forty-seven! My video had blown up overnight. I made more money in that one day than I had in the entire first two weeks combined.",
      "hook_type": "story",
      "hook_text": "The most insane thing happened on day 17...",
      "hook_score": 22,
      "engagement_score": 24,
      "value_score": 18,
      "shareability_score": 23,
      "total_score": 87,
      "virality_level": "excellent",
      "reasoning": "Classic story arc with a surprising reveal and specific number (847) — highly engaging and relatable",
      "caption": "This moment changed everything 🤯 One viral day made more than 2 weeks combined! #TikTokShop #SideHustle #EntrepreneurLife",
      "suggested_title": "The Day Everything Changed (Day 17)"
    }
  ],
  "summary": "A 30-day experiment selling products on TikTok Shop, documenting the ups and downs including the moment it finally took off.",
  "key_topics": ["TikTok Shop", "e-commerce", "side hustle", "viral moment", "30-day challenge"]
}
```

### Settings

| Parameter | Value | Reason |
|-----------|-------|--------|
| Model | `opencode-go/deepseek-v4-flash` | Fast, cheap, good enough |
| Temperature | 0.3 | Low temperature for consistent JSON, some creativity for hook text |
| Max tokens | 4096 | Enough for 10 clips + metadata |
| Top P | 0.9 | Slight diversity in selection |
| Response format | `json_object` if supported, else parse from text | — |

### Implementation (Backend Code)

```javascript
// Variant A — Single DeepSeek call
async function detectHighlightsDeepSeekOnly(transcript, metadata) {
  const prompt = buildUserPrompt({
    video_title: metadata.title,
    duration_seconds: metadata.duration,
    content_style: metadata.style || 'auto',
    language: metadata.language || 'en',
    transcript_with_timestamps: transcript,
  });

  const systemPrompt = `You are ViralClip — an expert short-form video editor AI...`; // Full system prompt above

  const response = await fetch('https://api.opencode.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENCODE_GO_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'opencode-go/deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      top_p: 0.9,
    }),
  });

  const data = await response.json();
  const result = JSON.parse(data.choices[0].message.content);
  
  // Post-process: filter weak clips, ensure spacing, sort by score
  return postProcessClips(result.clips, transcript.words);
}
```

---

## Variant B: DeepSeek + Gemini

### Strategy
Two-stage pipeline. DeepSeek V4 Flash handles the heavy transcript analysis (fast, cheap, good at spotting patterns). Gemini 2.0 Flash / Pro handles the creative layer (hook writing, caption generation, title crafting). This split exploits each model's strength: DeepSeek for analytical/scoring work, Gemini for creative/text generation.

### Stage 1 — DeepSeek: Finding Moments

**System Prompt:**

```
You are ViralClip-Analyzer — a transcript analysis specialist.
Your ONLY job is to find the most viral-worthy moments in a video transcript.

You output structured data about each moment. You do NOT write hooks, captions, or titles.
Stay analytical and precise.

SCORING CRITERIA:
- hook_score (0-25): Does the first 3 seconds grab? Bold claim? Question? Surprise?
- engagement_score (0-25): Emotional energy in the voice. Laughter? Shock? Passion? Drama?
- value_score (0-25): Does this teach something useful or reveal an insight?
- shareability_score (0-25): Would someone send this to a friend? Is it quotable as a standalone?

SELECTION RULES:
✓ INCLUDE: contrarian claims, mistakes/lessons, concrete examples, before/after,
  surprising results, emotional reactions, complete Q&A, hot takes, story arcs,
  demonstrations, controversy, reveals
✗ EXCLUDE: intros/greetings, sponsors, vague setup, contextless quotes,
  repeated points, definitions without payoff, answer fragments, rambling,
  technical setup, off-topic tangents, silence, monotone delivery

HOOK TYPES (classify each segment):
- "question": Opens with a curiosity-provoking question
- "statement": Bold claim or definitive opinion
- "statistic": Data point that surprises
- "story": Hook in narrative form
- "contrast": Before/after or comparison
- "controversy": Hot take or disagreement
- "revelation": Surprising reveal or twist
- "reaction": Emotional response moment
- "demonstration": "Watch this" moment
- "none": Weak hook (avoid)
```

**User Prompt Template:**

```
FIND the best short-form clip segments in this transcript.

Video: {{video_title}}
Duration: {{duration_seconds}}s
Style: {{content_style}}
Language: {{language}}

Transcript:
{{transcript_with_timestamps}}

Return JSON ONLY (no explanation):
{
  "clips": [
    {
      "start_time": float,
      "end_time": float,
      "duration": float,
      "text": "exact spoken text of this segment",
      "hook_type": "string from the allowed types",
      "hook_score": int,
      "engagement_score": int,
      "value_score": int,
      "shareability_score": int,
      "total_score": int,
      "context_note": "string (1 sentence context for the writer — what makes this moment work)"
    }
  ],
  "summary": "string",
  "key_topics": ["string"]
}
```

### Stage 2 — Gemini: Creative Layer

**System Prompt:**

```
You are ViralClip-Writer — a short-form content creator and copywriter.
You take raw highlight segments from an AI analyzer and make them VIRAL.

Your job for EACH clip:
1. Write a HOOK TEXT (1-8 words) — the most attention-grabbing opening for the clip
2. Write a CAPTION (1-2 sentences with emojis and hashtags) — TikTok-style
3. Write a SUGGESTED TITLE (3-8 words) — clickable, curiosity-driven
4. Add specific timing guidance: where to add text overlays, when to cut in, etc.

CAPTION STYLE GUIDE:
- Use 2-3 relevant emojis
- Add 3-5 hashtags (mix of broad + niche)
- Hook in first line of caption
- Question or command to drive comments
- TikTok: conversational, lowercase
- Reels: slightly more polished
- Shorts: informational, keyword-rich

HOOK CATEGORIES (select the best approach):
- "curiosity_gap": "The ONE thing nobody tells you about..."
- "bold_claim": "This will change how you think about..."
- "question": "Why do 90% of people fail at...?"
- "result": "Here's what happened when I..."
- "number": "3 things I wish I knew about..."
- "comparison": "Stop doing X. Do Y instead."
- "story_opener": "I tried this for 30 days and..."

IMPORTANT: Your hooks must work as STANDALONE clips that grab attention even without the original context.
```

**User Prompt Template:**

```
Write viral hooks, captions, and titles for these video highlight segments.

Video Title: {{video_title}}
Platform Target: TikTok (15-30s clips)

For each segment, create engagement-maximizing text:

{% for clip in clips %}
SEGMENT {{loop.index}}:
Text: "{{clip.text}}"
Hook Type: {{clip.hook_type}}
Context: {{clip.context_note}}
Start: {{clip.start_time}}s
End: {{clip.end_time}}s
Duration: {{clip.duration}}s
Total Score: {{clip.total_score}}/100

Return JSON:
{
  "clips": [
    {
      "start_time": float (pass through from input),
      "end_time": float (pass through from input),
      "text": "original text (pass through)",
      "hook_text": "string (≤8 words, must grab attention standalone)",
      "hook_category": "curiosity_gap|bold_claim|question|result|number|comparison|story_opener",
      "caption": "string (TikTok-style with emojis and 3-5 hashtags)",
      "suggested_title": "string (3-8 words, clickable)",
      "text_overlay_timing": "string (which words to emphasize and when, e.g. 'Show \"847 notifications\" at 0:03 in big text')",
      "hook_score": int (0-25 — reassess the hook strength with the new hook text),
      "virality_boost": "string (1 sentence on how to make this clip perform even better)"
    }
  ]
}
{% endfor %}
```

### Settings

| Stage | Model | Temperature | Max Tokens | Notes |
|-------|-------|-------------|------------|-------|
| DeepSeek | `opencode-go/deepseek-v4-flash` | 0.2 | 4096 | Low temp for consistent scoring |
| Gemini | `gemini-2.0-flash` (via OpenRouter) | 0.7 | 2048 | Higher temp for creative writing |

### Implementation (Backend Code)

```javascript
// Variant B — DeepSeek finds → Gemini writes
async function variantB(transcript, metadata) {
  // Stage 1: DeepSeek analysis (low temp, analytical)
  const deepseekResponse = await callDeepSeek(
    buildStage1Prompt(transcript, metadata),
    { temperature: 0.2, maxTokens: 4096 }
  );
  const moments = deepseekResponse.clips;
  
  // Filter to top 10 by total_score
  const topMoments = moments
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 10);
  
  // Stage 2: Gemini creates hooks
  const geminiResponse = await callGemini(
    buildStage2Prompt(metadata, topMoments),
    { temperature: 0.7, maxTokens: 2048 }
  );
  
  // Merge: use DeepSeek's scores, Gemini's creative text
  const finalClips = mergeResults(topMoments, geminiResponse.clips);
  
  return {
    summary: deepseekResponse.summary,
    key_topics: deepseekResponse.key_topics,
    clips: finalClips,
  };
}
```

---

## Variant C: Full Pipeline

### Strategy
Four-stage processing pipeline, each stage optimized for a specific task. This produces the highest quality output by dedicating focused AI capacity to each step:
1. **Transcript Enrichment** — Clean + structure the raw Whisper output
2. **Moment Detection** — Find all potential highlight segments with scoring
3. **Hook & Caption Generation** — Create viral hooks and captions for top segments
4. **Title & Metadata** — Generate clickable titles and SEO metadata

Each stage uses temperature best suited to its task (low for analytical, high for creative).

### Stage 1: Transcript Enrichment

**System Prompt:**

```
You are a transcript cleaner. Your job:
1. Fix Whisper transcription errors (homophones, misheard words, punctuation)
2. Remove filler words (um, uh, like, you know) while preserving meaning
3. Add proper punctuation and paragraph breaks
4. Identify speaker changes with [Speaker 1], [Speaker 2] labels
5. Detect emotional markers: [LAUGHTER], [APPLAUSE], [GASPS], [SILENCE_3s+], [MUSIC_DROP]
6. Segment into logical scenes with timestamps

Output ONLY the cleaned transcript with:
- Proper capitalization and punctuation
- Speaker labels
- Emotional markers
- Scene breaks (---scene break---) every ~60 seconds or topic change
- Preserve ALL original timestamps
```

**User Prompt Template:**

```
Clean and structure this raw Whisper transcript for highlight detection:

Video: {{video_title}}
Duration: {{duration_seconds}}s
Language: {{language}}

Raw transcript:
{{raw_transcript_with_timestamps}}

Return the cleaned transcript with speaker labels, emotional markers, and scene breaks.
Keep ALL original timestamps. Mark scene changes with "---SCENE BREAK---".
```

### Stage 2: Moment Detection (Ultra)

**System Prompt:**

```
You are ViralClip-Expert — a world-class short-form video editor with 10+ years experience.
You have an instinct for viral moments. Trust it.

ANALYSIS FRAMEWORK (apply ALL):
1. EMOTIONAL PEAK (weight: high)
   - Laughter / shock / surprise / anger / excitement
   - Voice volume or speed change
   - Audience reaction (if audible)

2. NARRATIVE ARC (weight: high)
   - Setup → Struggle → Resolution (within 15-60s)
   - Question → Answer
   - Problem → Solution

3. QUOTABILITY (weight: medium-high)
   - Stands alone without context
   - Makes someone want to share/quote
   - Memorable phrasing or specific number

4. VISUAL ACTION (weight: medium)
   - "Watch this" moments
   - Product demonstration
   - Physical comedy
   - Screen share reveals

5. VIRAL TRIGGERS (weight: medium)
   - Curiosity gap ("the reason why...")
   - Contrarian ("most people get this wrong")
   - Relatability ("we've all been there")
   - Specific data ("74% of people...")
   - Transformation ("before vs after")

OUTPUT exactly 10-15 potential clips. Be generous — Stage 3 will filter.

CLIP SPACING RULES:
- First clip: must be within first 3 minutes (capture early attention)
- Middle clips: spread evenly across the video's runtime
- Last clip: strong closer, ideally from the final 25%
- No two clips within 30 seconds of each other
- If multiple good moments in a 60-second window: pick the BEST one
```

**User Prompt Template:**

```
Find ALL viral-worthy moments in this cleaned transcript.

Video: {{video_title}}
Duration: {{duration_seconds}}s
Style: {{content_style}}
Target: TikTok (15-30s clips), Reels (15-30s), Shorts (15-60s)

Cleaned Transcript:
{{cleaned_transcript}}

For each moment, provide:
- Exact start/end timestamps (float seconds)
- Exact spoken text (word-perfect)
- Hook type classification
- Detailed scoring breakdown
- Why it goes viral (1-2 sentences)
- Which platform it fits best
- Visual potential (what happens on screen)

Return JSON:
{
  "clips": [
    {
      "start_time": float,
      "end_time": float,
      "duration": float,
      "text": "exact spoken text",
      "hook_type": "question|statement|statistic|story|contrast|controversy|revelation|reaction|demonstration|none",
      "hook_score": int (0-25),
      "engagement_score": int (0-25),
      "value_score": int (0-25),
      "shareability_score": int (0-25),
      "total_score": int (0-100),
      "best_platform": "tiktok|reels|shorts|any",
      "emotional_peak": "laughter|shock|surprise|revelation|anger|excitement|none",
      "narrative_type": "setup_punchline|question_answer|problem_solution|transformation|none",
      "virality_reason": "string (1-2 sentences on why this will resonate)",
      "visual_potential": "string (what's happening on screen that adds value)",
      "context_note": "string (sufficient context for the hook writer — what the viewer needs to know)"
    }
  ],
  "summary": "string",
  "key_topics": ["string"]
}
```

### Stage 3: Hook & Caption Generation (Creative)

**System Prompt:**

```
You are ViralClip-Writer — a viral copywriter for short-form video.
You turn raw moments into SHAREABLE clips.

For each moment, you must write:
1. HOOK TEXT (≤10 words) — The opening text/title card for the clip
   Must create curiosity and compel someone to keep watching

2. CAPTION (1-3 sentences + emojis + hashtags) — The post text
   First line must hook. End with a question to drive comments.

3. TIMING NOTES — When to show text overlays for maximum impact

HOOK TEMPLATES (choose & adapt):
  "The [number] [thing] nobody tells you about [topic]"
  "I tried [controversial thing] for [timeframe]"
  "Stop doing [common mistake]. Do this instead."
  "This is why [common belief] is wrong"
  "The craziest part? [reveal]"
  "Wait until you hear what happened when I [action]"
  "Most people have no idea that [fact]"
  "Here's the truth about [topic]"

CAPTION TEMPLATES:
  TikTok: "POV: You [relatable thing]... [hook line] 🤯\n\n[details/context]\n\n#hash1 #hash2 #hash3"
  Reels: "[hook question]\n\n[insight/lesson]\n\n#hash1 #hash2 #hash3"
  Shorts: "[bold stat] #shorts\n\n[explanation]\n\n#hash1 #hash2 #hash3"

EMOJI USAGE GUIDELINES:
- 2-4 emojis per caption max (not spammy)
- Use relevant emojis, not generic ones
- Place emoji at emotional peaks in the caption
- Can use in hook text for visual pop
```

**User Prompt Template:**

```
Write viral hooks and captions for these 10 video highlights.

Video: {{video_title}}
Total Duration: {{duration}}
Audience: TikTok/Reels/Shorts content consumers (18-35)

For each segment, create hooks that would stop a viewer from scrolling:

{% for clip in clips %}
=== CLIP {{loop.index}} of {{clips.length}} ===
Timestamp: {{clip.start_time}}s → {{clip.end_time}}s ({{clip.duration}}s)
Text: "{{clip.text}}"
Hook Type: {{clip.hook_type}}
Best Platform: {{clip.best_platform}}
Visual: {{clip.visual_potential}}
Context: {{clip.context_note}}
Score: {{clip.total_score}}/100

Return JSON for ALL clips:
{
  "clips": [
    {
      "start_time": float (pass through),
      "end_time": float (pass through),
      "hook_text": "string (≤10 words)",
      "hook_template_used": "string (which template was adapted)",
      "caption": "string (with emojis and hashtags)",
      "suggested_title": "string (3-8 words)",
      "text_overlays": [
        {
          "time_sec": float,
          "text": "string",
          "style": "large|medium|small|emphasis",
          "duration_sec": float
        }
      ],
      "hook_effectiveness": int (1-10, estimate of how well this stops the scroll)
    }
  ]
}
{% endfor %}
```

### Stage 4: Title & Metadata

**System Prompt:**

```
You are a YouTube/TikTok SEO specialist. You write titles that get clicks and metadata that gets discovered.

For each clip, create:
1. SHORT TITLE (3-8 words) — For TikTok/Reels, curiosity-driven
2. LONG TITLE (8-15 words) — For YouTube Shorts, keyword-rich
3. SEO DESCRIPTION (2-3 sentences) — Keyword-dense description
4. THUMBNAIL TEXT (2-5 words) — Text overlay for thumbnail

TITLE FRAMEWORKS:
  - List: "3 Signs You're [doing X wrong]"
  - How-to: "How to [achieve X] in [timeframe]"
  - Question: "Why Do 90% of [people fail at X]?"
  - Story: "I [did X] for [timeframe] and Here's What Happened"
  - Comparison: "[Old Way] vs [New Way] — Which is Better?"
  - Controversy: "Stop [common advice] — Here's Why"

KEYWORD STRATEGY:
- Primary keyword in first 40 characters of title
- Secondary keyword in description
- Related keywords in hashtags
- Use your target audience's search language, not jargon
```

**User Prompt Template:**

```
Create SEO-optimized titles and metadata for these clips.

Video: {{video_title}}
Content Style: {{content_style}}
Target Platform: TikTok + YouTube Shorts

For EACH clip, provide optimized titles and metadata:

{% for clip in clips %}
CLIP: "{{clip.text}}"
Hook: "{{clip.hook_text}}"

Return JSON:
{
  "clips": [
    {
      "start_time": float (pass through),
      "end_time": float (pass through),
      "short_title": "string (3-8 words, curiosity-driven)",
      "long_title": "string (8-15 words, keyword-rich for YouTube)",
      "seo_description": "string (2-3 sentences with keywords)",
      "thumbnail_text": "string (2-5 words for thumbnail overlay)",
      "recommended_hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
      "primary_keyword": "string",
      "secondary_keywords": ["string"]
    }
  ]
}
{% endfor %}
```

### Settings

| Stage | Model | Temperature | Max Tokens | Notes |
|-------|-------|-------------|------------|-------|
| Stage 1 (Enrich) | `opencode-go/deepseek-v4-flash` | 0.1 | 4096 | Low temp, just cleaning |
| Stage 2 (Detect) | `opencode-go/deepseek-v4-flash` | 0.2 | 4096 | Analytical, structured |
| Stage 3 (Hooks) | `gemini-2.0-flash` (via OpenRouter) | 0.7 | 2048 | Creative writing |
| Stage 4 (Titles) | `gemini-2.0-flash` (via OpenRouter) | 0.5 | 2048 | SEO optimization |

### Implementation (Backend Code)

```javascript
// Variant C — Full 4-stage pipeline
async function variantCFullPipeline(rawTranscript, metadata) {
  // Stage 1: Clean the transcript
  const cleanedTranscript = await callDeepSeek(
    buildStage1Prompt(rawTranscript, metadata),
    { temperature: 0.1, maxTokens: 4096 }
  );
  logStage('transcript_cleaned', { length: cleanedTranscript.length });

  // Chunk handling for long videos (>20 min)
  const chunks = chunkTranscript(cleanedTranscript, 4000, 200);
  let allMoments = [];
  
  for (const chunk of chunks) {
    // Stage 2: Detect moments in each chunk
    const chunkResult = await callDeepSeek(
      buildStage2Prompt(chunk, metadata, chunks.length > 1),
      { temperature: 0.2, maxTokens: 4096 }
    );
    allMoments.push(...chunkResult.clips);
    logStage('moments_detected', { chunk: chunk.index, count: chunkResult.clips.length });
  }

  // De-duplicate across chunks + pick top 10 with spacing
  const topMoments = deduplicateAndRank(allMoments, 10, 30);
  logStage('top_moments_selected', { count: topMoments.length });

  // Stage 3: Generate hooks + captions (batch all 10 in one call)
  const hooksResult = await callGemini(
    buildStage3Prompt(metadata, topMoments),
    { temperature: 0.7, maxTokens: 2048 }
  );
  logStage('hooks_generated');

  // Stage 4: Generate titles + metadata (batch all 10 in one call)
  const titlesResult = await callGemini(
    buildStage4Prompt(metadata, hooksResult.clips),
    { temperature: 0.5, maxTokens: 2048 }
  );
  logStage('titles_generated');

  // Merge all stages into final output
  const finalClips = mergeAllStages(topMoments, hooksResult.clips, titlesResult.clips);
  
  return {
    summary: allMoments.summary,
    key_topics: allMoments.key_topics,
    clips: finalClips,
    pipeline_stages: 4,
    total_tokens_used: calculateTokens(rawTranscript, finalClips),
  };
}
```

---

## Implementation Guide

### Which Variant to Use

| Variant | Speed | Quality | Cost | Best For |
|---------|-------|---------|------|----------|
| **A** | Fastest (1 call) | Good | Lowest | Free tier, batch processing, simple talking head content |
| **B** | Medium (2 calls) | Better | Low | Paid tier, most content types, good balance |
| **C** | Slowest (4 calls) | Best | Medium | Pro tier, complex content, multi-speaker, high-production videos |

### Post-Processing (ALL Variants Required)

After getting AI output, run this cleanup:

```javascript
function postProcessClips(clips, wordTimestamps, options = {}) {
  const {
    maxClips = 10,
    minSpacing = 30,       // seconds between clips
    minDuration = 5,       // minimum clip length
    maxDuration = 60,      // maximum clip length
    minScore = 40,         // minimum total_score to include
  } = options;

  // 1. First-pass filter: duration and score
  let filtered = clips.filter(c => 
    c.duration >= minDuration && 
    c.duration <= maxDuration && 
    c.total_score >= minScore
  );

  // 2. Sort by total_score descending
  filtered.sort((a, b) => b.total_score - a.total_score);

  // 3. Ensure spacing (greedy: pick highest score, then skip 30s around it)
  const selected = [];
  for (const clip of filtered) {
    const overlaps = selected.some(s => 
      Math.abs(s.start_time - clip.start_time) < minSpacing
    );
    if (!overlaps) {
      selected.push(clip);
    }
    if (selected.length >= maxClips) break;
  }

  // 4. Snap timestamps to nearest word boundaries (avoids cutting mid-word)
  return selected.map(clip => ({
    ...clip,
    start_time: snapToNearestWord(clip.start_time, wordTimestamps, 'floor'),
    end_time: snapToNearestWord(clip.end_time, wordTimestamps, 'ceil'),
  }));
}
```

### Fallback Strategy

When AI calls fail (network error, rate limit, malformed response):

```javascript
async function detectHighlightsWithFallback(transcript, metadata, strategy = 'A') {
  const models = {
    A: ['opencode-go/deepseek-v4-flash', 'opencode-go/deepseek-v4-flash'],
    B: ['opencode-go/deepseek-v4-flash', 'gemini-2.0-flash'],
    C: ['opencode-go/deepseek-v4-flash', 'gemini-2.0-flash', 'openrouter/qwen-2.5-72b'],
  };

  const modelList = models[strategy] || models.A;
  let lastError = null;

  for (const model of modelList) {
    try {
      return await callModel(model, transcript, metadata, strategy);
    } catch (err) {
      lastError = err;
      console.warn(`[Fallback] ${model} failed: ${err.message}. Trying next...`);
    }
  }

  // Last resort: generate safe default clips (first 15s, middle, last 15s)
  console.error('[Fallback] All AI models failed, using defaults');
  return generateDefaultClips(transcript, metadata);
}

function generateDefaultClips(transcript, metadata) {
  const duration = metadata.duration;
  return {
    clips: [
      {
        start_time: 0,
        end_time: Math.min(15, duration),
        duration: Math.min(15, duration),
        text: transcript.slice(0, 200),
        total_score: 50,
        virality_level: 'average',
        // ... safe defaults
      },
    ],
    summary: metadata.title,
    key_topics: [],
    pipeline_stages: 0,
    fallback: true,
  };
}
```

### Token Budget Calculator

Estimate costs per video length:

```
Video Length | Whisper Time | DeepSeek Tokens | Gemini Tokens | Total Cost*
-------------|--------------|-----------------|---------------|------------
<5 min       | ~30s         | ~1,500           | ~500           | ~$0.01
5-15 min     | ~2 min       | ~4,000           | ~1,200          | ~$0.03
15-30 min    | ~4 min       | ~8,000           | ~2,500          | ~$0.07
30-60 min    | ~8 min       | ~16,000          | ~5,000          | ~$0.15

*Costs negligible with opencode-go subscription (no per-token charge)
```

### Health Check Endpoint

```javascript
// /api/health/pipeline — checks all stages work
async function pipelineHealthCheck() {
  const testTranscript = "Hey guys! Today I'm going to share the ONE thing that doubled my sales in 30 days. It's so simple you won't believe it. Ready? Here it is: follow up with every customer within 24 hours. That's it. Sounds basic, but my conversion rate went from 12% to 34% just from this one change.";

  const results = {};
  
  // Test Stage 1 (Transcript)
  try {
    const cleaned = await callDeepSeek(buildStage1Prompt(testTranscript, { title: 'Health Check', duration: 30 }));
    results.transcript_cleaning = { ok: true, length: cleaned.length };
  } catch (e) {
    results.transcript_cleaning = { ok: false, error: e.message };
  }

  // Test Stage 2 (Detection)
  try {
    const moments = await callDeepSeek(buildStage2Prompt(testTranscript, { title: 'Health Check', duration: 30 }));
    results.moment_detection = { ok: true, clip_count: moments.clips?.length };
  } catch (e) {
    results.moment_detection = { ok: false, error: e.message };
  }

  // Test Stage 3 (Hooks — Gemini)
  try {
    const hooks = await callGemini(buildStage3Prompt({ title: 'Health Check' }, [{ text: 'test', hook_type: 'statement' }]));
    results.hook_generation = { ok: true };
  } catch (e) {
    results.hook_generation = { ok: false, error: e.message };
    // Fallback: DeepSeek for hooks
    try {
      const hooksFallback = await callDeepSeek(buildStage3PromptDeepSeek({ title: 'Health Check' }, [{ text: 'test' }]));
      results.hook_generation = { ok: true, fallback: 'deepseek' };
    } catch (e2) {
      results.hook_generation = { ok: false, error: e2.message };
    }
  }

  return results;
}
```

---

## Troubleshooting

### Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| All clips have 0 scores | Model not following scoring rubric | Reduce temperature to 0.2, add explicit scoring examples |
| Clips overlap heavily | No spacing enforcement | Add post-processing step that checks `(end_time - start_time) < 15` overlap |
| Wrong format returned | Model outputs markdown or explanation | Use `response_format: { type: "json_object" }` if available, or add "VALID JSON ONLY" to prompt |
| Empty clips array | No viral moments detected | Lower the score threshold, check transcript quality |
| Hook text is generic | Temperature too low for creative | Increase to 0.7 for hook generation stage |
| Too many clips from one section | No spread enforcement | Add explicit instruction: "Clips must be spread across all X minutes of the video" |
| Captions are too long | No length constraint | Add "MAX 280 characters for caption" |
| Hook doesn't match audio | AI hallucinated | Add "hook_text must be an EXACT substring of the clip's spoken text" |
| DeepSeek returns non-JSON | Model struggling with long context | Shorter chunks (3000 chars), simpler schema |
| Gemini rate limited | Free tier limits | Add retry with exponential backoff, or switch to DeepSeek fallback |
| Whisper words don't match transcript | Whisper model issue | Add `word_timestamps=True` to Whisper config, try large-v3 model |

---

## Appendix: Schema Reference

### Final Clip Object (Output to FFmpeg)

```typescript
interface ClipOutput {
  // Timestamps (seconds, float)
  start_time: number;
  end_time: number;
  duration: number;
  
  // Content
  text: string;                    // Exact spoken words
  hook_text: string;               // Hook for first 3 seconds
  caption: string;                 // TikTok caption with emojis + hashtags
  suggested_title: string;         // Clickable title
  
  // Scoring
  hook_score: number;              // 0-25
  engagement_score: number;        // 0-25
  value_score: number;             // 0-25
  shareability_score: number;      // 0-25
  total_score: number;             // 0-100
  virality_level: 'excellent' | 'good' | 'average' | 'skip';
  
  // Metadata
  hook_type: string;
  reasoning: string;
  best_platform?: string;          // Variant C only
  text_overlays?: TextOverlay[];    // Variant C only
  seo_description?: string;         // Variant C only
  recommended_hashtags?: string[];  // Variant C only
}
```

### Database Clip Schema (PostgreSQL)

```sql
CREATE TABLE clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  -- Timestamps
  start_sec FLOAT NOT NULL,
  end_sec FLOAT NOT NULL,
  duration FLOAT NOT NULL,
  -- Scoring
  virality_score INT NOT NULL CHECK (virality_score BETWEEN 0 AND 100),
  hook_score INT CHECK (hook_score BETWEEN 0 AND 25),
  engagement_score INT CHECK (engagement_score BETWEEN 0 AND 25),
  value_score INT CHECK (value_score BETWEEN 0 AND 25),
  shareability_score INT CHECK (shareability_score BETWEEN 0 AND 25),
  -- Content
  spoken_text TEXT,
  hook_text TEXT,
  caption TEXT,
  suggested_title TEXT,
  hook_type VARCHAR(20),
  -- Files
  thumbnail_url VARCHAR,
  video_url VARCHAR,
  file_size INT,
  -- Metadata
  download_count INT DEFAULT 0,
  watermark BOOLEAN DEFAULT TRUE,
  pipeline_variant CHAR(1) DEFAULT 'A',
  created_at TIMESTAMP DEFAULT NOW()
);
```
