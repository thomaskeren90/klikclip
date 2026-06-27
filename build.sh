#!/bin/bash
# KlikClip build script — install system deps locally + Node packages
set -e

mkdir -p bin

echo "=== Installing ffmpeg (static build) ==="
if [ ! -f bin/ffmpeg ]; then
  curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz
  tar xf /tmp/ffmpeg.tar.xz -C /tmp
  cp /tmp/ffmpeg-*-static/ffmpeg bin/ffmpeg
  cp /tmp/ffmpeg-*-static/ffprobe bin/ffprobe
  chmod a+rx bin/ffmpeg bin/ffprobe
fi
bin/ffmpeg -version 2>&1 | head -1

echo "=== Installing yt-dlp ==="
curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod a+rx bin/yt-dlp
bin/yt-dlp --version

echo "=== Installing Node packages ==="
cd api && npm install

echo "=== Build complete ==="
