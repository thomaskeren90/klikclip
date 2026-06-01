# 🎬 CLAUDE PROMPT — Build KlikClip Web App

## The Product

A web app called **"KlikClip"** — paste a YouTube link or upload video → AI detects the 10 best moments → cuts them into TikTok-ready clips → user downloads.

## Design Intelligence (UI/UX Pro Max)

Before building, apply these professional UI/UX design rules:

### Reasoning Rules
1. **Every component needs 4 states**: default, hover, active/focus, disabled. Define colors and shadows for each.
2. **Spacing scale**: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px — use consistently.
3. **Typography hierarchy**: 3 levels max per page. Headings bold (700), body regular (400), small medium (500).
4. **Touch targets**: minimum 44×44px on mobile. Buttons, links, inputs.
5. **Loading states**: every async action shows skeleton, spinner, or progress bar. Never blank.
6. **Error states**: every input shows inline error message + red border. Toast for system errors.
7. **Empty states**: every list/table shows illustration + message when no data.
8. **Color contrast**: text on colored backgrounds meets WCAG AA (4.5:1 ratio). Use a contrast checker.
9. **Card design**: white bg, subtle border (#E5E7EB), 12-16px border-radius, hover lift with shadow.
10. **Mobile first**: design for 375px first, then tablet 768px, then desktop 1280px.

### Component Specs
- **Buttons**: 48px min height, 14-16px font, pill radius (100px), icon + text gap 8px
- **Cards**: 16px padding, 12px radius, white bg, border 1px #E5E7EB
- **Inputs**: 48px height, 12px padding, 12px radius, focus ring 2px primary
- **Modals**: centered, 90% width mobile / 480px desktop, backdrop blur, close X top right
- **Bottom nav**: 64px height, 5 items max, active icon + label, safe area padding
- **Sidebar**: 240px width, icons 24px, labels 14px, active state with left border

### Accessibility
- All interactive elements keyboard-navigable (Tab order)
- aria-labels on icon-only buttons
- Form inputs paired with labels, not placeholders only
- Focus visible ring on all interactive elements
- Touch-friendly: no hover-only interactions on mobile

# 🎬 CLAUDE PROMPT — Build KlikClip Web App

## The Product

A web app called **"KlikClip"** — paste a YouTube link or upload video → AI detects the 10 best moments → cuts them into TikTok-ready clips → user downloads.

## Design Intelligence (UI/UX Pro Max)

Before building, apply these professional UI/UX design rules:

### Reasoning Rules
1. **Every component needs 4 states**: default, hover, active/focus, disabled. Define colors and shadows for each.
2. **Spacing scale**: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px — use consistently.
3. **Typography hierarchy**: 3 levels max per page. Headings bold (700), body regular (400), small medium (500).
4. **Touch targets**: minimum 44×44px on mobile. Buttons, links, inputs.
5. **Loading states**: every async action shows skeleton, spinner, or progress bar. Never blank.
6. **Error states**: every input shows inline error message + red border. Toast for system errors.
7. **Empty states**: every list/table shows illustration + message when no data.
8. **Color contrast**: text on colored backgrounds meets WCAG AA (4.5:1 ratio). Use a contrast checker.
9. **Card design**: white bg, subtle border (#E5E7EB), 12-16px border-radius, hover lift with shadow.
10. **Mobile first**: design for 375px first, then tablet 768px, then desktop 1280px.

### Component Specs
- **Buttons**: 48px min height, 14-16px font, pill radius (100px), icon + text gap 8px
- **Cards**: 16px padding, 12px radius, white bg, border 1px #E5E7EB
- **Inputs**: 48px height, 12px padding, 12px radius, focus ring 2px primary
- **Modals**: centered, 90% width mobile / 480px desktop, backdrop blur, close X top right
- **Bottom nav**: 64px height, 5 items max, active icon + label, safe area padding
- **Sidebar**: 240px width, icons 24px, labels 14px, active state with left border

### Accessibility
- All interactive elements keyboard-navigable (Tab order)
- aria-labels on icon-only buttons
- Form inputs paired with labels, not placeholders only
- Focus visible ring on all interactive elements
- Touch-friendly: no hover-only interactions on mobile

## Design Language

### Color Palette (Gojek-Inspired)
```
Primary:       #00AA13     (Gojek green — trust, growth, Indonesia)
Primary Dark:  #00690C     (hover states)
Primary Light: #E8F5E9     (backgrounds)
Success:       #10B981     (positive actions)
Warning:       #F59E0B     (attention)
Error:         #EF4444     (errors)

Background:    #FFFFFF     (clean white)
Card BG:       #F5F7FA     (light gray cards)
Card Border:   #E5E7EB     (borders)
Text Primary:  #1F2937     (headings)
Text Secondary:#6B7280     (body text)
Text Muted:    #9CA3AF     (captions, labels)
```

### Typography
```
Font: Inter (Google Fonts) — clean, modern, great for UI

Headings: 28-36px Bold       → "Generate 10 Viral Clips Today"
Subhead:  18-20px SemiBold   → "Paste your YouTube link below"
Body:     14-16px Regular    → paragraph text
Small:    12-13px Medium     → captions, labels
Button:   15-16px SemiBold   → CTA buttons
```

### Icon Style (3D Gojek-like)
Use **Tabler Icons** (free, open source) with CSS 3D effects:
```css
.icon-3d {
  width: 56px; height: 56px;
  background: linear-gradient(145deg, #00AA13, #00690C);
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(0,170,19,0.35),
              inset 0 -3px 0 rgba(0,0,0,0.15),
              inset 0 2px 0 rgba(255,255,255,0.2);
  transform: perspective(400px) rotateX(5deg);
  transition: transform 0.2s;
}
```

### Button Style (Gojek Pill Buttons)
```css
.btn-primary {
  background: linear-gradient(180deg, #00C416, #00AA13);
  border-radius: 100px;  /* pill shape */
  padding: 14px 28px;
  color: white;
  font-weight: 600;
  font-size: 15px;
  box-shadow: 0 4px 14px rgba(0,170,19,0.3);
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,170,19,0.4); }
.btn-primary:active { transform: scale(0.97); }
```

### Card Style (OpusClip-Inspired)
```css
.card {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: all 0.2s;
}
.card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}
```

---

## Pages & Layout

### Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS
- **Icons:** Tabler Icons (react) or Lucide
- **Database:** PostgreSQL (Supabase) via Prisma
- **Auth:** NextAuth.js (email/password + Google OAuth)
- **Payment:** Stripe (USA) + Midtrans (Indonesia)
- **Language:** i18n with next-intl (English default, Indonesian toggle)

### Navigation Structure

**Mobile (bottom nav bar, 64px height):**
```
┌──────────────────────────┐
│  🏠     📁     ➕     📊     👤     │
│ Home  Projects  New  Stats  Account │
│                                     │
│ Active icon: #00AA13, inactive: gray│
│ Icons: 24px × 24px, font: 11px     │
└──────────────────────────┘
```

**Desktop (left sidebar, 240px width):**
```
┌──────────────┬────────────────────────┐
│  [Logo]      │                        │
│  Video       │   (Main Content)       │
│  Summerizer  │                        │
│──────────────│                        │
│  🏠 Home     │                        │
│  📁 Projects │                        │
│  ➕ New Clip │                        │
│  📊 Stats    │                        │
│  🎓 Learn    │                        │
│  ⚙️ Settings │                        │
│──────────────│                        │
│  👤 Account  │                        │
│  ⚡ 45/50 cr │                        │
└──────────────┴────────────────────────┘
```

---

## Page 1: Home / New Clip (Main Page)

```
┌─────────────────────────────────────────────────────────┐
│  ☰ KlikClip                    🌐 ⚡ 45/50 👤          │
│                                   EN/ID                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─── Hero Section ─────────────────────────────────┐   │
│  │                                                   │   │
│  │  🎬  Generate 10 Viral Clips Today                │   │  ← 36px Bold
│  │       Paste a YouTube link or upload your video    │   │  ← 17px
│  │                                                   │   │
│  │  ┌─────────────────────────────────────────────┐  │   │
│  │  │  📎  https://youtube.com/watch?v=...       │  │   │  ← 52px height
│  │  └─────────────────────────────────────────────┘  │   │  radius 12px
│  │                                                   │   │
│  │           ── or ──                                 │   │
│  │                                                   │   │
│  │  ┌─────────────────────────────────────────────┐  │   │
│  │  │  📁  Click to upload video                  │  │   │  ← 120px height
│  │  │       MP4, MOV, AVI (max 1GB)              │  │   │  dashed border
│  │  └─────────────────────────────────────────────┘  │   │
│  │                                                   │   │
│  │     Style: [🎙️ Podcast] [🎮 Gaming] [💬 Vlog]   │   │  ← pill toggles
│  │     Language: [English ▼]  Clips: [10]           │   │
│  │                                                   │   │
│  │  [ 🔥 Generate 10 Clips ]                        │   │  ← 50px pill btn
│  │                                                   │   │
│  │  💡 Need help? Visit the Learning Center           │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌── Recent Projects ──────────────────────────────┐    │
│  │  ┌──────┐ ┌──────┐ ┌──────┐                     │    │
│  │  │🎬 92%│ │ 78%  │ │ 85%  │                     │    │
│  │  │0:32  │ │ 0:45 │ │ 0:28 │                     │    │
│  │  │[DL]  │ │[DL]  │ │[DL]  │                     │    │
│  │  └──────┘ └──────┘ └──────┘                     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  🏠  📁  ➕  📊  👤   (mobile bottom nav)               │
└─────────────────────────────────────────────────────────┘
```

---

## Page 2: Learning Center

```
┌─────────────────────────────────────────────────────────┐
│  ☰  🎓 Learning Center                  🌐 ⚡ 👤         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐              │
│  │ 📖   │  │ 🎬   │  │ 💡   │  │ ❓   │              │
│  │Getting│  │Video  │  │Tips &│  │ FAQ  │              │
│  │Started│  │Tutoria│  │Tricks│  │      │              │
│  │       │  │ls     │  │      │  │      │              │
│  └──────┘  └──────┘  └──────┘  └──────┘              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  🔍  Search articles...                         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Popular Articles:                                      │
│  ├─ How to Get 1 Million Views on TikTok                │
│  ├─ 5 Secrets of Professional Clippers                  │
│  ├─ Best Posting Schedule for TikTok Indonesia          │
│  └─ How to Use AI to Find Viral Moments                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  🏠  📁  ➕  📊  👤                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Page 3: Projects (My Clips)

```
┌─────────────────────────────────────────────────────────┐
│  ☰  📁 My Projects                    🌐 ⚡ 👤           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  🔍  Search projects...                        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  │🎬 92%  │ │ 78%    │ │ 85%    │ │ 63%    │         │
│  │0:32    │ │ 0:45   │ │ 0:28   │ │ 0:55   │         │
│  │Download│ │Download│ │Download│ │Download│         │
│  └────────┘ └────────┘ └────────┘ └────────┘         │
│                                                         │
│  Grid: 2-col mobile, 3-col tablet, 4-col desktop       │
│  Each card: thumbnail, duration, virality score badge,  │
│  download button                                        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  🏠  📁  ➕  📊  👤                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Page 4: Pricing

```
┌─────────────────────────────────────────────────────────┐
│  ☰  💰 Pricing                        🌐 ⚡ 👤           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐         │
│  │ 📦       │  │ ⭐ Popular   │  │ 🚀       │         │
│  │          │  │              │  │          │         │
│  │ Free     │  │ Starter      │  │ Pro      │         │
│  │ $0       │  │ Rp 29K/mo    │  │ Rp 79K   │         │
│  │          │  │              │  │   /mo    │         │
│  │ 1 clip/  │  │ 50 clips/mo  │  │ 200 clips│         │
│  │ day      │  │ 1080p        │  │ /mo      │         │
│  │ 720p     │  │ No watermark │  │ Priority │         │
│  │ Watermark│  │              │  │ API access│         │
│  │          │  │              │  │          │         │
│  │ [Start]  │  │ [Subscribe]  │  │ [Subscri │         │
│  │          │  │              │  │ be]      │         │
│  └──────────┘  └──────────────┘  └──────────┘         │
│                                                         │
│  ┌─ Comparison Table ─────────────────────────────┐    │
│  │ Feature          Free   Starter   Pro          │    │
│  │───────────────────────────────────────────────│    │
│  │ Clips/month      30     50        200          │    │
│  │ Resolution       720p   1080p     1080p        │    │
│  │ Watermark        Yes    No        No           │    │
│  │ AI Captions      No     Yes       Yes          │    │
│  │ Priority Queue   No     No        Yes          │    │
│  │ API Access       No     No        Yes          │    │
│  └────────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  🏠  📁  ➕  📊  👤                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Page 5: Settings

```
┌─────────────────────────────────────────────────────────┐
│  ☰  ⚙️ Settings                       🌐 ⚡ 👤           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  👤  Account                           → Edit           │
│     Email: thomas@example.com                           │
│     Name: Thomas                                        │
│                                                         │
│  💳  Billing                            → Manage        │
│     Plan: Free (1 clip/day)                             │
│                                                         │
│  ⚡  Credits                                             │
│     Used: 5/50 today                                    │
│     Reset: in 12 hours                                  │
│                                                         │
│  🎛  Preferences                                         │
│     Default language: [English ▼]                       │
│     Default style: [Auto ▼]                             │
│     Default clip count: [10 ▼]                          │
│                                                         │
│  🔑  API Key                                             │
│     Generate an API key for programmatic access          │
│     [Generate]     sk-••••••••••••••••                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  🏠  📁  ➕  📊  👤                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Responsive Breakpoints

```
Mobile:  0-640px     → Single column, bottom nav, full-width inputs
Tablet:  641-1024px  → 2 columns, collapsible sidebar
Desktop: 1025px+     → Sidebar (240px) + 3-column grid
```

## Language / i18n

Use **next-intl** or simple React Context:

```javascript
// i18n.js
const translations = {
  en: {
    hero_title: "Generate 10 Viral Clips Today",
    hero_sub: "Paste a YouTube link or upload your video",
    input_placeholder: "https://youtube.com/watch?v=...",
    upload_text: "Click to upload video",
    cta: "🔥 Generate 10 Clips",
    learning: "Need help? Visit the Learning Center",
    nav_home: "Home",
    nav_projects: "Projects",
    nav_new: "New",
    nav_stats: "Stats",
    nav_account: "Account",
  },
  id: {
    hero_title: "Hasilkan 10 Klip Viral Hari Ini",
    hero_sub: "Tempel link YouTube atau unggah video Anda",
    input_placeholder: "https://youtube.com/watch?v=...",
    upload_text: "Klik untuk unggah video",
    cta: "🔥 Buat 10 Klip",
    learning: "Butuh bantuan? Kunjungi Pusat Belajar",
    nav_home: "Beranda",
    nav_projects: "Proyek",
    nav_new: "Baru",
    nav_stats: "Statistik",
    nav_account: "Akun",
  },
};
```

Toggle in top bar: 🌐 EN/ID button → switches all text. Persist in localStorage.

---

## What to Build

1. **Next.js project** with App Router + Tailwind CSS
2. **All pages:** Home, Projects, Learning Center, Pricing, Settings
3. **Mobile-first responsive** (bottom nav on mobile, sidebar on desktop)
4. **Gojek-inspired design** (green #00AA13, white background, pill buttons, 3D icons)
5. **Language toggle** (English default, Indonesian)
6. **Hero section** with URL input + upload zone + generate button
7. **Card grid** for clip results
8. **Bottom navigation bar** for mobile (5 tabs)
9. **Learning Center** with article cards + search
10. **Pricing page** with 3 tiers + comparison table
11. **Settings page** with account, billing, credits, API key sections

## What NOT to Do

❌ Don't use paid icon libraries — use Tabler Icons or Lucide (free)
❌ Don't add animations that slow down mobile — keep it fast
❌ Don't make the landing page separate — everything is part of the same SPA
❌ Don't use MUI/Chakra — Tailwind only
❌ Don't forget the language toggle — it's a key feature
❌ Don't use dark theme — Gojek is light/white (except for the video player area)

## Success Criteria

A user can:
1. Open the app on their phone
2. Paste a YouTube link
3. Press "Generate 10 Clips"
4. See progress
5. Download ready-to-post clips
6. Switch language to Indonesian
7. Visit Learning Center for help
8. View pricing and upgrade
