/**
 * YouTubeAPI.js — Fetch video metadata + captions via YouTube Data API v3
 * Falls back gracefully if YOUTUBE_API_KEY is not set.
 */
const axios = require('axios');

const API_KEY = process.env.YOUTUBE_API_KEY || '';

async function getVideoInfo(youtubeUrl) {
  // Extract video ID from URL
  let videoId = '';
  const match = youtubeUrl.match(/(?:v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (match) videoId = match[1];
  if (!videoId) throw new Error('Invalid YouTube URL');

  if (!API_KEY) {
    throw new Error('YOUTUBE_API_KEY not set');
  }

  // Fetch video details
  const videoResp = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'snippet,contentDetails',
      id: videoId,
      key: API_KEY,
    },
    timeout: 10000,
  });

  const video = videoResp.data?.items?.[0];
  if (!video) throw new Error('Video not found');

  const snippet = video.snippet || {};
  const duration = parseISO8601Duration(video.contentDetails?.duration || 'PT0S');

  // Try to fetch captions from free public sources (no auth needed)
  let transcript = null;
  try {
    const subResp = await axios.get(`https://youtubetranscript.com/?v=${videoId}&format=txt`, { timeout: 5000 });
    if (subResp.data && typeof subResp.data === 'string') {
      transcript = subResp.data.replace(/<[^>]+>/g, '').slice(0, 4000);
    }
  } catch {
    // Transcript not available (many videos don't have them)
  }

  if (!transcript && snippet.description) {
    transcript = snippet.description.slice(0, 4000);
  }

  // Build chapters from description timestamps (basic)
  const chapters = extractChapters(snippet.description || '');

  return {
    id: videoId,
    title: snippet.title || 'YouTube Video',
    description: snippet.description || '',
    duration: duration,
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    uploader: snippet.channelTitle || '',
    chapters,
    transcript,
  };
}

function parseISO8601Duration(duration) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 600;
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function extractChapters(description) {
  const chapters = [];
  const lines = description.split('\n');
  const timeRegex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—]?\s*(.+)/;

  for (const line of lines) {
    const m = line.match(timeRegex);
    if (m) {
      const h = parseInt(m[3]) || 0;
      const min = parseInt(m[1]);
      const sec = parseInt(m[2]);
      const totalSec = h * 3600 + min * 60 + sec;
      chapters.push({ time: totalSec, title: m[4].trim() });
    }
  }

  return chapters;
}

module.exports = { getVideoInfo };
