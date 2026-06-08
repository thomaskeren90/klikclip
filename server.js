// KlikClip Backend — simple, no database, just video clipping
const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3030;
const CLIPS_DIR = path.join(__dirname, 'clips');
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Check tools
try { console.log('ffmpeg:', execSync('ffmpeg -version 2>&1 | head -1').toString().trim()); } catch(e) { console.error('ffmpeg missing!'); }
try { console.log('yt-dlp:', execSync('yt-dlp --version 2>&1').toString().trim()); } catch(e) { console.error('yt-dlp missing!'); }

app.get('/health', (req, res) => res.json({ ok: true }));

// Analyze a video (returns highlights)
app.post('/api/analyze', async (req, res) => {
  const { url, count } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  
  const jobId = crypto.randomUUID();
  const jobDir = path.join(CLIPS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  res.json({ jobId, status: 'analyzing' });

  try {
    // Get video info
    const info = JSON.parse(execSync(`yt-dlp --dump-json --no-warnings "${url}" 2>/dev/null | head -1`).toString());
    
    // Split into clips (simple: divide duration into equal parts)
    const duration = info.duration || 600;
    const clipCount = Math.min(parseInt(count) || 10, 10);
    const segDuration = Math.min(duration / clipCount, 60);
    const clips = [];
    for (let i = 0; i < clipCount; i++) {
      const start = i * segDuration;
      const end = Math.min((i + 1) * segDuration, duration);
      clips.push({
        id: 'clip_' + (i + 1),
        title: 'Clip ' + (i + 1),
        start_sec: start,
        end_sec: end,
        score: 50,
        reason: 'Auto-detected segment',
      });
    }

    // Save job result
    const result = {
      id: jobId, status: 'done', video_title: info.title || '',
      video_thumb: info.thumbnail || '', video_duration: duration,
      clips: clips, error: null,
    };
    fs.writeFileSync(path.join(jobDir, 'result.json'), JSON.stringify(result));
  } catch (err) {
    const result = { id: jobId, status: 'error', error: err.message };
    fs.writeFileSync(path.join(jobDir, 'result.json'), JSON.stringify(result));
  }
});

// Get job status
app.get('/api/job/:jobId', (req, res) => {
  const resultFile = path.join(CLIPS_DIR, req.params.jobId, 'result.json');
  if (!fs.existsSync(resultFile)) return res.status(404).json({ error: 'Job not found' });
  res.json(JSON.parse(fs.readFileSync(resultFile, 'utf8')));
});

// Process a clip (download + cut)
app.post('/api/clip', async (req, res) => {
  const { jobId, clipId } = req.body;
  if (!jobId || !clipId) return res.status(400).json({ error: 'jobId and clipId required' });

  const resultFile = path.join(CLIPS_DIR, jobId, 'result.json');
  if (!fs.existsSync(resultFile)) return res.status(404).json({ error: 'Job not found' });

  const job = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  const clip = job.clips.find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  res.json({ clipId, status: 'processing' });

  try {
    const clipFile = path.join(CLIPS_DIR, jobId, clipId + '.mp4');
    const sourceFile = path.join(CLIPS_DIR, jobId, 'source.mp4');

    // Download video
    execSync(`yt-dlp -f "best[height<=720]" -o "${sourceFile}" "${job.video_url || job.youtube_url}" 2>/dev/null`, {
      timeout: 180000, stdio: 'pipe'
    });

    // Cut clip
    const dur = clip.end_sec - clip.start_sec;
    execSync(`ffmpeg -y -ss ${clip.start_sec} -i "${sourceFile}" -t ${dur} -c copy "${clipFile}" 2>/dev/null`, {
      timeout: 60000, stdio: 'pipe'
    });

    // Store result
    const size = fs.existsSync(clipFile) ? fs.statSync(clipFile).size : 0;
    clip.status = 'done';
    clip.file_path = clipFile;
    clip.file_size = size;
    clip.download_url = `/api/download/${clipId}?job=${jobId}`;
    fs.writeFileSync(resultFile, JSON.stringify(job, null, 2));

    // Cleanup source
    try { fs.unlinkSync(sourceFile); } catch(e) {}
  } catch (err) {
    clip.status = 'error';
    clip.error = err.message;
    fs.writeFileSync(resultFile, JSON.stringify(job, null, 2));
  }
});

// Download a clip
app.get('/api/download/:clipId', (req, res) => {
  const jobId = req.query.job;
  if (!jobId) return res.status(400).json({ error: 'job parameter required' });
  const clipFile = path.join(CLIPS_DIR, jobId, req.params.clipId + '.mp4');
  if (!fs.existsSync(clipFile)) return res.status(404).json({ error: 'Clip not found' });
  res.download(clipFile, 'klikclip-' + req.params.clipId + '.mp4');
});

app.listen(PORT, () => console.log(`KlikClip backend on port ${PORT}`));
