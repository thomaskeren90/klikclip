/* ============================================
   KlikClip — Content Script
   Injects the Summarize button on YouTube
   ============================================ */

(function () {
  'use strict';

  const API_BASE = 'https://api.KlikClip.ai'; // Change to your backend
  let panelInjected = false;
  let currentVideoId = null;

  // ── Get YouTube video ID ──
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('v');
  }

  // ── Get video title ──
  function getVideoTitle() {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string');
    return el ? el.textContent.trim() : document.title;
  }

  // ── Get video duration ──
  function getVideoDuration() {
    const video = document.querySelector('video');
    return video ? Math.floor(video.duration) : 0;
  }

  // ── Extract transcript directly from YouTube page ──
  async function extractTranscript() {
    try {
      // Method 1: Click the transcript button and read it
      const transcriptBtn = document.querySelector('button[aria-label="Show transcript"]');
      if (transcriptBtn) {
        transcriptBtn.click();
        await sleep(1500);

        const segments = [];
        const transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
        transcriptSegments.forEach(seg => {
          const timeEl = seg.querySelector('.segment-timestamp');
          const textEl = seg.querySelector('.segment-text');
          if (timeEl && textEl) {
            const timeStr = timeEl.textContent.trim();
            const text = textEl.textContent.trim();
            const seconds = parseTimeString(timeStr);
            segments.push({ start: seconds, duration: 5, end: seconds + 5, text });
          }
        });

        // Close transcript panel
        const closeBtn = document.querySelector('button[aria-label="Close transcript"]');
        if (closeBtn) closeBtn.click();

        if (segments.length) return { source: 'extension', language: 'auto', segments };
      }

      // Method 2: Get caption tracks from ytInitialPlayerResponse
      const playerResponse = window.ytInitialPlayerResponse ||
        (document.querySelector('script:not([src])')?.textContent?.match(/ytInitialPlayerResponse\s*=\s*({.*?});/)?.[1] && JSON.parse(RegExp.$1));

      if (playerResponse?.captions?.captionTracks) {
        const tracks = playerResponse.captions.captionTracks;
        const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
        if (track?.baseUrl) {
          const resp = await fetch(track.baseUrl);
          const xml = await resp.text();
          const segments = parseCaptionXmlLocal(xml);
          if (segments.length) return { source: 'extension-captions', language: track.languageCode, segments };
        }
      }

    } catch (err) {
      console.log('[KlikClip] Extension transcript extraction failed:', err.message);
    }
    return null;
  }

  function parseCaptionXmlLocal(xml) {
    const segments = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const texts = doc.querySelectorAll('text');
    texts.forEach(el => {
      const start = parseFloat(el.getAttribute('start') || 0);
      const duration = parseFloat(el.getAttribute('dur') || 5);
      segments.push({
        start,
        duration,
        end: start + duration,
        text: el.textContent?.trim() || ''
      });
    });
    return segments;
  }

  function parseTimeString(str) {
    const parts = str.split(':').reverse();
    let seconds = 0;
    if (parts[0]) seconds += parseInt(parts[0]) || 0;
    if (parts[1]) seconds += (parseInt(parts[1]) || 0) * 60;
    if (parts[2]) seconds += (parseInt(parts[2]) || 0) * 3600;
    return seconds;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Inject the Summarize button ──
  function injectButton() {
    const videoId = getVideoId();
    if (!videoId || videoId === currentVideoId) return;
    currentVideoId = videoId;

    // Remove old button
    const oldBtn = document.getElementById('KlikClip-btn');
    if (oldBtn) oldBtn.remove();

    // Find insertion point (below video title)
    const target = document.querySelector('#above-the-fold #top-row');
    if (!target) return;

    const btn = document.createElement('button');
    btn.id = 'KlikClip-btn';
    btn.innerHTML = `
      <svg class="vl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
      </svg>
      <span>Summarize with KlikClip</span>
      <span class="vl-free-badge">FREE</span>
    `;

    btn.addEventListener('click', () => openPanel(videoId));
    target.appendChild(btn);
  }

  // ── Build and show the side panel ──
  function openPanel(videoId) {
    if (!panelInjected) {
      injectPanelDOM();
      panelInjected = true;
    }

    const panel = document.getElementById('KlikClip-panel');
    const backdrop = document.getElementById('KlikClip-backdrop');
    panel.classList.add('open');
    backdrop.classList.add('open');

    // Show loading
    showLoading();

    // Fetch summary
    fetchSummary(videoId);
  }

  // ── Close panel ──
  function closePanel() {
    const panel = document.getElementById('KlikClip-panel');
    const backdrop = document.getElementById('KlikClip-backdrop');
    panel.classList.remove('open');
    backdrop.classList.remove('open');
  }

  // ── Inject panel HTML ──
  function injectPanelDOM() {
    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'KlikClip-backdrop';
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'KlikClip-panel';
    panel.innerHTML = `
      <div class="vl-panel-header">
        <h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6C5CE7" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="10 8 16 12 10 16 10 8" fill="#6C5CE7" stroke="none"/>
          </svg>
          KlikClip
        </h2>
        <button class="vl-close-btn" onclick="document.getElementById('KlikClip-panel').classList.remove('open');document.getElementById('KlikClip-backdrop').classList.remove('open');">✕</button>
      </div>
      <div class="vl-panel-body" id="vl-body">
        <!-- Dynamic content goes here -->
      </div>
    `;
    document.body.appendChild(panel);
  }

  // ── Show loading state ──
  function showLoading() {
    document.getElementById('vl-body').innerHTML = `
      <div class="vl-loading">
        <div class="vl-spinner"></div>
        <p>Analyzing video...</p>
        <p style="font-size:12px; color:#555;">Extracting transcript, keywords & storyline</p>
      </div>
    `;
  }

  // ── Fetch summary from API ──
  async function fetchSummary(videoId) {
    try {
      // Check usage first
      const usage = await getUsage();

      if (usage.remaining <= 0) {
        showUpgradePrompt(usage);
        return;
      }

      // Extract transcript from the page first
      const transcript = await extractTranscript();

      // Call summary API
      const response = await fetch(`${API_BASE}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          videoUrl: window.location.href,
          title: getVideoTitle(),
          transcript: transcript, // Send extracted transcript to API
          options: {
            includeKeywords: true,
            includeStoryline: true,
            includeTimestamps: true,
            language: navigator.language || 'en'
          }
        })
      });

      if (!response.ok) throw new Error('API error');
      const data = await response.json();

      renderSummary(data, usage);

    } catch (err) {
      showError(err.message);
    }
  }

  // ── Get usage count ──
  async function getUsage() {
    try {
      const stored = await chrome.storage.local.get(['vl_usage', 'vl_usage_date']);
      const today = new Date().toDateString();

      if (stored.vl_usage_date !== today) {
        await chrome.storage.local.set({ vl_usage: 0, vl_usage_date: today });
        return { used: 0, remaining: 5, total: 5 };
      }

      const used = stored.vl_usage || 0;
      return { used, remaining: Math.max(0, 5 - used), total: 5 };
    } catch {
      return { used: 0, remaining: 5, total: 5 };
    }
  }

  // ── Increment usage ──
  async function incrementUsage() {
    const stored = await chrome.storage.local.get(['vl_usage']);
    const used = (stored.vl_usage || 0) + 1;
    await chrome.storage.local.set({ vl_usage: used, vl_usage_date: new Date().toDateString() });
  }

  // ── Render summary results ──
  function renderSummary(data, usage) {
    incrementUsage();

    const { summary, keywords, storyline, timestamps } = data;

    let html = '';

    // Usage bar
    html += `
      <div class="vl-usage-bar">
        <span class="vl-usage-text">📹 ${usage.remaining - 1}/5 free summaries today</span>
        <div class="vl-usage-dots">
          ${Array.from({ length: 5 }, (_, i) =>
            `<div class="vl-usage-dot ${i >= usage.remaining - 1 ? 'used' : ''}"></div>`
          ).join('')}
        </div>
      </div>
    `;

    // Summary
    html += `
      <div class="vl-section">
        <div class="vl-section-title">📝 Summary</div>
        <p style="font-size:14px; line-height:1.7; color:#d4d4d4; margin:0;">${escapeHtml(summary)}</p>
      </div>
    `;

    // Key Points
    if (timestamps && timestamps.length) {
      html += `<div class="vl-section">
        <div class="vl-section-title">🎯 Key Points</div>
        <ul class="vl-keypoints">`;
      timestamps.forEach(t => {
        html += `<li>
          <span class="vl-timestamp-link" data-time="${t.seconds}">${t.time}</span>
          ${escapeHtml(t.text)}
        </li>`;
      });
      html += `</ul></div>`;
    }

    // Keywords
    if (keywords && keywords.length) {
      html += `
        <div class="vl-section">
          <div class="vl-section-title">🔑 Keywords</div>
          <div class="vl-keywords">
            ${keywords.map(k => `<span class="vl-keyword">${escapeHtml(k)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Storyline
    if (storyline && storyline.length) {
      html += `
        <div class="vl-section">
          <div class="vl-section-title">📖 Storyline</div>
          <div class="vl-storyline">
            ${storyline.map(ch => `
              <div class="vl-storyline-chapter">
                <div class="vl-chapter-time">${escapeHtml(ch.time)}</div>
                <div class="vl-chapter-title">${escapeHtml(ch.title)}</div>
                <div class="vl-chapter-desc">${escapeHtml(ch.description)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Q&A
    html += `
      <div class="vl-section">
        <div class="vl-section-title">💬 Ask About This Video</div>
        <div class="vl-qa-input-wrap">
          <input class="vl-qa-input" id="vl-qa-input" placeholder="What did they say about...?" />
          <button class="vl-qa-btn" id="vl-qa-btn">Ask</button>
        </div>
        <div id="vl-qa-answer"></div>
      </div>
    `;

    // Export
    html += `
      <div class="vl-section">
        <div class="vl-section-title">📤 Export</div>
        <div class="vl-export-row">
          <button class="vl-export-btn" data-format="markdown">Markdown</button>
          <button class="vl-export-btn" data-format="notion">Notion</button>
          <button class="vl-export-btn" data-format="pdf">PDF</button>
          <button class="vl-export-btn" data-format="copy">Copy All</button>
        </div>
      </div>
    `;

    // Upgrade CTA
    if (usage.remaining - 1 <= 2) {
      html += `
        <div class="vl-upgrade-cta">
          <p>⚡ Running low on summaries!</p>
          <span>Unlimited summaries for $4.99/mo</span>
          <button class="vl-upgrade-btn" onclick="window.open('https://klikclip.ai/upgrade', '_blank')">Upgrade →</button>
        </div>
      `;
    }

    document.getElementById('vl-body').innerHTML = html;

    // Bind timestamp clicks
    document.querySelectorAll('.vl-timestamp-link').forEach(el => {
      el.addEventListener('click', () => {
        const seconds = el.dataset.time;
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = parseInt(seconds);
          video.play();
        }
      });
    });

    // Bind Q&A
    document.getElementById('vl-qa-btn').addEventListener('click', () => askQuestion(data.videoId));

    // Bind exports
    document.querySelectorAll('.vl-export-btn').forEach(btn => {
      btn.addEventListener('click', () => exportSummary(btn.dataset.format, data));
    });
  }

  // ── Ask question about video ──
  async function askQuestion() {
    const input = document.getElementById('vl-qa-input');
    const question = input.value.trim();
    if (!question) return;

    const answerEl = document.getElementById('vl-qa-answer');
    answerEl.innerHTML = '<div class="vl-loading" style="padding:20px"><div class="vl-spinner" style="width:24px;height:24px;"></div></div>';

    try {
      const response = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: getVideoId(),
          question
        })
      });
      const data = await response.json();

      answerEl.innerHTML = `
        <div class="vl-qa-answer">
          ${escapeHtml(data.answer)}
          ${data.timestamp ? `<div class="vl-qa-source">📍 Found at <span class="vl-timestamp-link" data-time="${data.timestampSeconds}">${data.timestamp}</span></div>` : ''}
        </div>
      `;

      // Bind timestamp in answer
      answerEl.querySelectorAll('.vl-timestamp-link').forEach(el => {
        el.addEventListener('click', () => {
          document.querySelector('video').currentTime = parseInt(el.dataset.time);
          document.querySelector('video').play();
        });
      });

    } catch {
      answerEl.innerHTML = '<div class="vl-error">Failed to get answer. Try again.</div>';
    }
  }

  // ── Export summary ──
  function exportSummary(format, data) {
    const text = buildExportText(data, format);

    if (format === 'copy') {
      navigator.clipboard.writeText(text);
      // Show brief "Copied!" feedback
      const btn = document.querySelector('[data-format="copy"]');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = orig, 2000);
      return;
    }

    if (format === 'markdown') {
      const blob = new Blob([text], { type: 'text/markdown' });
      downloadBlob(blob, `KlikClip-${getVideoId()}.md`);
    }
  }

  function buildExportText(data, format) {
    let text = `# ${data.title || getVideoTitle()}\n\n`;
    text += `## Summary\n${data.summary}\n\n`;

    if (data.keywords?.length) {
      text += `## Keywords\n${data.keywords.join(', ')}\n\n`;
    }

    if (data.storyline?.length) {
      text += `## Storyline\n`;
      data.storyline.forEach(ch => {
        text += `### ${ch.time} — ${ch.title}\n${ch.description}\n\n`;
      });
    }

    if (data.timestamps?.length) {
      text += `## Key Points\n`;
      data.timestamps.forEach(t => {
        text += `- [${t.time}] ${t.text}\n`;
      });
    }

    text += `\n---\n*Summarized by KlikClip — KlikClip.ai*`;
    return text;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Show upgrade prompt ──
  function showUpgradePrompt(usage) {
    document.getElementById('vl-body').innerHTML = `
      <div class="vl-upgrade-cta" style="margin-top:40px;">
        <p style="font-size:18px;">📹 Daily limit reached!</p>
        <span>You've used all 5 free summaries today.</span>
        <br><span>Come back tomorrow or upgrade for unlimited.</span>
        <br>
        <button class="vl-upgrade-btn" onclick="window.open('https://klikclip.ai/upgrade', '_blank')">
          Get Unlimited — $4.99/mo
        </button>
        <p style="font-size:11px; color:rgba(255,255,255,0.5); margin-top:12px;">
          Or wait — your free summaries reset at midnight.
        </p>
      </div>
    `;
  }

  // ── Show error ──
  function showError(msg) {
    document.getElementById('vl-body').innerHTML = `
      <div class="vl-error">
        <p>Something went wrong</p>
        <p style="font-size:12px; color:#888; margin-top:8px;">${escapeHtml(msg)}</p>
        <button onclick="document.getElementById('KlikClip-btn').click()">Try Again</button>
      </div>
    `;
  }

  // ── Utility ──
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Initialize ──
  // Watch for YouTube SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.pathname === '/watch') {
        setTimeout(injectButton, 1000);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial injection
  if (location.pathname === '/watch') {
    setTimeout(injectButton, 1500);
  }

  console.log('[KlikClip] Extension loaded ✓');
})();
