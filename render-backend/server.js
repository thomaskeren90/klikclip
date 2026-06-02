// KlikClip Render Backend — Video Clipping Server
// Deploy: paste this into a new Node.js project on Render.com
// Pick "Node" environment, set start command: node server.js

const express = require('express');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3030;
const CLIPS_DIR = path.join(__dirname, 'clips');
if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'KlikClip Render', version: '1.0.0' });
});

// Download and clip a section of a YouTube video
app.post('/api/clips/create', async (req, res) => {
  const { jobId, videoUrl, startTime, endTime } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  try {
    const jobDir = path.join(CLIPS_DIR, jobId || crypto.randomUUID());
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const clipFile = path.join(jobDir, 'clip.mp4');
    const tempFile = path.join(jobDir, 'source.mp4');

    // Step 1: Download video with yt-dlp (best quality, 30 seconds max)
    console.log(`Downloading: ${videoUrl}`);
    execSync(`yt-dlp -f "best[height<=720]" --download-sections "*${startTime || 0}-${endTime || 60}" --force-keyframes-at-cuts -o "${tempFile}" "${videoUrl}"`, {
      timeout: 120000, // 2 min timeout
      stdio: 'pipe'
    });

    // Step 2: If yt-dlp section download worked, the file is already clipped
    // If not, use FFmpeg to cut
    if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 1000) {
      fs.renameSync(tempFile, clipFile);
    } else {
      // Fallback: download full video then cut with FFmpeg
      execSync(`yt-dlp -f "best[height<=720]" -o "${tempFile}" "${videoUrl}"`, {
        timeout: 120000,
        stdio: 'pipe'
      });
      const dur = (endTime || 60) - (startTime || 0);
      execSync(`ffmpeg -y -ss ${startTime || 0} -i "${tempFile}" -t ${dur} -c copy "${clipFile}"`, {
        timeout: 60000,
        stdio: 'pipe'
      });
    }

    // Clean up temp file
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    const clipId = path.basename(jobDir);
    res.json({
      jobId: jobId || clipId,
      clipId: clipId,
      downloadUrl: `/api/clips/download/${clipId}`,
      status: 'completed'
    });

  } catch (err) {
    console.error('Clip error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download a clip
app.get('/api/clips/download/:clipId', (req, res) => {
  const clipPath = path.join(CLIPS_DIR, req.params.clipId, 'clip.mp4');
  if (!fs.existsSync(clipPath)) {
    return res.status(404).json({ error: 'Clip not found or expired' });
  }
  res.download(clipPath, `klikclip-${req.params.clipId}.mp4`);
});

// Get job status
app.get('/api/clips/:jobId', (req, res) => {
  const jobDir = path.join(CLIPS_DIR, req.params.jobId);
  const exists = fs.existsSync(jobDir);
  res.json({ jobId: req.params.jobId, status: exists ? 'completed' : 'not_found' });
});

app.listen(PORT, () => {
  console.log(`KlikClip Render running on port ${PORT}`);
});
