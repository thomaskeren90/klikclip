# 🎬 KlikClip — AI Clipper TikTok

YouTube → AI detects 10 best moments → cut → crop 9:16 → captions → TikTok-ready.

**Harga: Rp 50K/bln vs OpusClaw $29/bln (~Rp 460K)**

## Stack
- **Backend**: Node.js / Express
- **AI**: Claude claude-sonnet-4-20250514 (highlight detection)
- **Video**: yt-dlp (download) + FFmpeg (cut/crop/caption)
- **Auth**: JWT + bcrypt
- **DB**: SQLite (better-sqlite3)
- **Payment**: Midtrans (QRIS, GoPay, ShopeePay, VA)

## Setup Lokal (WSL2)

### Prerequisites
```bash
# Install yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Install ffmpeg
sudo apt update && sudo apt install -y ffmpeg fonts-dejavu-core
```

### Install & Run
```bash
cp .env.example .env
# Edit .env — isi ANTHROPIC_API_KEY, JWT_SECRET, MIDTRANS keys

npm install
npm run dev
# → http://localhost:3030
```

### Docker
```bash
cp .env.example .env  # edit values
docker compose up -d
```

## API Endpoints

| Method | Path | Auth | Deskripsi |
|--------|------|------|-----------|
| POST | `/api/auth/register` | — | Daftar akun |
| POST | `/api/auth/login` | — | Login |
| GET | `/api/auth/me` | Bearer | Info user + quota |
| POST | `/api/analyze` | Optional | Analisis YouTube URL → job |
| GET | `/api/job/:id` | Optional | Status job + daftar clip |
| POST | `/api/clip` | Required | Proses 1 clip (download+cut+crop) |
| GET | `/api/clip/:id` | Required | Status clip |
| GET | `/api/download/:id` | Required | Download file MP4 |
| POST | `/api/payment/create` | Required | Buat tagihan Midtrans |
| POST | `/api/payment/webhook` | — | Midtrans webhook |

## FFmpeg Pipeline

```
yt-dlp (download 1080p) 
  → FFmpeg -ss [start] -t [duration]
  → scale+crop to 9:16 (1080×1920)
  → drawbox + drawtext (caption overlay)
  → libx264 / aac output
```

## Pricing
| Plan | Harga | Klip/hari | Output |
|------|-------|-----------|--------|
| Free | Rp 0 | 5 | 720p |
| Pro Bulanan | Rp 50.000 | Unlimited | 1080p |
| Pro Tahunan | Rp 480.000 | Unlimited | 1080p + API |

## Env Variables
```
PORT=3030
BASE_URL=https://yourdomain.com
JWT_SECRET=...
ANTHROPIC_API_KEY=sk-ant-...
MIDTRANS_SERVER_KEY=Mid-server-...
MIDTRANS_CLIENT_KEY=Mid-client-...
MIDTRANS_IS_PRODUCTION=false
FREE_CLIPS_PER_DAY=5
```
