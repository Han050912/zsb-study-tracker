<div align="center" style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:40px 20px 24px 20px;margin:16px 0;">

<img src="./public/logo.png" alt="Logo" width="120" style="margin-bottom:8px;" />

# [zsb-study-tracker](https://zsb-study-tracker.sryze.cc/)

**zsb-study-tracker** · A study management toolkit for exam preparation (Web + Desktop)

<span style="color:#8b949e;">Learning Records · Pomodoro Timer · Gamification · Community & Study Buddies · Cloud Sync</span>

<br/>

[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Pinia](https://img.shields.io/badge/Pinia-2-FFD859?style=flat-square&logo=vuedotjs&logoColor=black)](https://pinia.vuejs.org/)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://router.vuejs.org/)
[![ECharts](https://img.shields.io/badge/ECharts-5-AA344D?style=flat-square&logo=apacheecharts&logoColor=white)](https://echarts.apache.org/)
[![KaTeX](https://img.shields.io/badge/KaTeX-0.16-222222?style=flat-square&logo=katex&logoColor=white)](https://katex.org/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1](https://img.shields.io/badge/D1-Database-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

<br/>

[![Pages Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml)
[![Worker Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml)

<br/>

> [:arrow_right: 中文版](./README.md)

</div>

---

## Table of Contents

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

<table align="center">
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-project-overview" style="text-decoration:none;color:#58a6ff;">✨ Overview</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-features" style="text-decoration:none;color:#58a6ff;">🧩 Features</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-screenshots" style="text-decoration:none;color:#58a6ff;">📸 Screenshots</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-tech-stack" style="text-decoration:none;color:#58a6ff;">🏗️ Tech Stack</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-quick-start" style="text-decoration:none;color:#58a6ff;">🚀 Quick Start</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-project-structure" style="text-decoration:none;color:#58a6ff;">📁 Project Structure</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-deployment" style="text-decoration:none;color:#58a6ff;">🌐 Deployment</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-contributing" style="text-decoration:none;color:#58a6ff;">🤝 Contributing</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-license" style="text-decoration:none;color:#58a6ff;">📜 License</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-about-me" style="text-decoration:none;color:#58a6ff;">👤 About Me</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-buy-me-a-coffee" style="text-decoration:none;color:#58a6ff;">☕ Buy Me a Coffee</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"></td>
  </tr>
</table>

</div>

---

## ✨ Project Overview

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #f78166;border-radius:4px;padding:20px 24px;margin:16px 0;">

**zsb-study-tracker** is a study tracking and management application built for exam candidates. It ships as a **Web app (installable PWA)** and a native **Windows / macOS desktop client**, backed by **Cloudflare Workers + D1 database + R2 storage** for accounts and data sync. Sign in once and your study records follow you across Web and desktop.

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #58a6ff;border-radius:4px;padding:16px 24px;margin:16px 0;">

> **Core philosophy**: Connect "Track → Focus → Motivate → Reflect" into a complete learning loop.

</div>

### Why This Project

<table align="center">
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🔗 All-in-One Learning Workflow</strong><br/>
      <span style="color:#8b949e;">Daily tracking, Pomodoro focus, practice sessions with error notes, and evening reflections — your entire study routine in one tool. No more switching between 5 different apps.</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">☁️ Synced Across Devices</strong><br/>
      <span style="color:#8b949e;">After sign-in, data syncs to the cloud (Cloudflare D1) so Web and desktop stay in step; the PWA caches data so you can still review the last snapshot offline.</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🎮 Gamification That Works</strong><br/>
      <span style="color:#8b949e;">Bronze → Silver → Gold → Platinum → Diamond → King rank progression, badge wall, points ledger, and streak tracking — turns months of preparation into a game you want to keep playing.</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">📐 Advanced Math & English Focus</strong><br/>
      <span style="color:#8b949e;">Syllabus chapter trees, Markdown + LaTeX formula notes, "MoMo" vocabulary app integration, cloze/reading/listening/writing templates.</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🍅 Pomodoro With Task Notes</strong><br/>
      <span style="color:#8b949e;">Count-up and countdown modes, optional task description before each session, a dedicated "Recently Completed" board with time/duration per Pomodoro (double-click to rename), and interruption logs.</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">👥 Community & Study Buddies</strong><br/>
      <span style="color:#8b949e;">Posts, comments, likes, topic circles, direct messages and notifications; find a study buddy for co-study rooms, team challenges, shared plans, reviews, and a weekly report pushed every Monday.</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">📊 Visual Analytics</strong><br/>
      <span style="color:#8b949e;">ECharts-powered study-duration breakdown, per-subject accuracy trends, and focus analysis — click a bar to drill into that day's per-subject time.</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🖥️ Desktop App + PWA</strong><br/>
      <span style="color:#8b949e;">Native Windows & macOS client with system tray, native notifications, and automatic updates; the Web app installs as a PWA with offline caching.</span>
    </td>
  </tr>
</table>

---

## 🧩 Features

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

<table align="center">
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📚 Study Records</strong><br/>
      <span style="color:#8b949e;">Subject/chapter trees with mastery levels, study-duration logs, practice sessions, error notebook, mock exam records, daily to-dos</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📝 Notes & Materials</strong><br/>
      <span style="color:#8b949e;">Markdown + KaTeX notes, material library, PDF upload with chunked reading</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📖 English Practice</strong><br/>
      <span style="color:#8b949e;">Vocabulary check-ins (MoMo app integration), cloze, reading, listening, essay templates, and daily goals</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🍅 Focus Timer</strong><br/>
      <span style="color:#8b949e;">Count-up / countdown, task description, recently-completed details, interruption reasons, focus wallpapers</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">✅ Habits & Reflection</strong><br/>
      <span style="color:#8b949e;">Habit tracking with stats, daily summary (mood + three-part reflection + tomorrow's plan), shareable cards</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🏆 Achievements</strong><br/>
      <span style="color:#8b949e;">Points and ledger, six-tier rank system, badge wall, study streaks</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">💬 Community</strong><br/>
      <span style="color:#8b949e;">Posts and comments, likes, topic circles, knowledge-point discussions, DMs, follows and notification center, reports with admin moderation</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🤝 Collaboration</strong><br/>
      <span style="color:#8b949e;">Team challenges with progress, study buddies, co-study rooms, shared study plans, review invites, buddy shares, and weekly reports</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🔐 Accounts & Safety</strong><br/>
      <span style="color:#8b949e;">Sign-up / sign-in (bcrypt passwords + JWT in HttpOnly cookies), Cloudflare Turnstile, rate limiting, local profanity lexicon plus Workers AI moderation</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">⚙️ Personalization</strong><br/>
      <span style="color:#8b949e;">Exam countdown, themes with dark mode, reminders and do-not-disturb, avatar cropping, guest browsing mode, feedback straight to GitHub Issues</span>
    </td>
  </tr>
</table>

</div>

---

## 📸 Screenshots

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📊 Dashboard

<span style="color:#8b949e;">Today's overview, to-do list, study heatmap, subject mastery rings, and daily quote — all on one screen.</span>

<br/><br/>

<img src="./public/screenshots/Home.png" alt="Dashboard" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📝 Notes (Markdown + LaTeX)

<span style="color:#8b949e;">KaTeX-powered math formula rendering with full Markdown syntax and note search.</span>

<br/><br/>

<img src="./public/screenshots/Notes.png" alt="Notes" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📖 English Practice (with "MoMo" App)

<span style="color:#8b949e;">Sync with the MoMo vocabulary app, custom daily goals, cloze/reading/listening/writing templates, auto points.</span>

<br/><br/>

<img src="./public/screenshots/English.png" alt="English Practice" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📅 Daily Summary

<span style="color:#8b949e;">Auto-aggregated daily study data with mood journal, three-part reflection, tomorrow's plan, and a shareable card.</span>

<br/><br/>

<img src="./public/screenshots/Summary.png" alt="Daily Summary" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 🏆 Achievements

<span style="color:#8b949e;">Bronze → King rank system, badge wall, points ledger and streaks — make persistence visible and rewarding.</span>

<br/><br/>

<img src="./public/screenshots/Rewards.png" alt="Achievements" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

---

## 🏗️ Tech Stack

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| Layer | Stack |
| :--- | :--- |
| Frontend | Vue 3 (`<script setup>`), TypeScript, Vite 5, Vue Router 4 (hash mode), Pinia 2, Tailwind CSS 3 |
| Rich content | ECharts 5, KaTeX 0.16, markdown-it, pdfjs-dist, Lucide icons (SVG components, no emoji icons) |
| Desktop | Electron 43, electron-builder, electron-updater (Windows auto-update), system tray and native notifications |
| PWA | vite-plugin-pwa (installable + Service Worker offline cache, NetworkFirst for API calls) |
| Backend | Cloudflare Workers (TypeScript), in-house router and middleware, bcryptjs password hashing, jose for JWT |
| Data | Cloudflare D1 (50+ tables, see `worker/schema.sql`), R2 (community images), D1 cron trigger (weekly report every Monday) |
| Tooling | `tsc --noEmit` type checks, Worker smoke tests (`node test/smoke.mjs`), two GitHub Actions pipelines |

</div>

---

## 🚀 Quick Start

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

> Prerequisites: **Node.js 18+** (CI and Worker deployment use Node 22) — download from [nodejs.org](https://nodejs.org).

</div>

### Run in Browser

```bash
# Clone the repo
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker

# Install dependencies
npm install

# Start dev server (opens browser automatically)
npm run dev
```

The API base comes from `VITE_API_BASE`: dev mode targets the local Worker at `http://localhost:8787` (`.env.development`), while production builds point to the hosted Worker at `https://cn.zsbservice.de5.net` (`.env`). In practice `npm run dev` also needs the local Worker for accounts and data, so start it as shown below.

### Run the Worker Backend (required for local development)

```bash
cd worker
npm install

# Initialize the local D1 database (first run only; creates SQLite under .wrangler)
npm run init:local

# Start the Worker locally (default http://localhost:8787)
npx wrangler dev
```

Backend secrets live in `worker/.dev.vars` (git-ignored). For local development you need at least:

| Variable | Purpose |
| :--- | :--- |
| `JWT_SECRET` | JWT signing key |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret (the official test key works locally) |
| `DESKTOP_TOKEN` | Shared desktop client token used to skip the captcha (must match the build-time injected value) |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Workers AI moderation (optional; falls back to the local lexicon when unset) |

In production, set them with `npx wrangler secret put <NAME>` — never commit plaintext secrets.

Verify backend changes with the smoke test:

```bash
cd worker
npm run smoke     # runs an API self-test against http://localhost:8787
```

### Run Desktop App

```bash
# Start browser and Electron together, both hot-reload on changes
npm run electron:dev
```

### Build Installers

```bash
npm run dist:win    # Build Windows .exe installer → release/
npm run dist:mac    # Build macOS .dmg installer (requires Mac)
npm run dist        # Auto-detect platform
```

The packaged Windows client checks GitHub Releases for new versions and prompts to update (electron-updater).

---

## 📁 Project Structure

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

```
zsb-study-tracker/
├── src/                     # Vue 3 frontend source
│   ├── pages/               # Page components (30+ routes)
│   ├── components/          # Shared and feature components
│   ├── stores/              # Pinia stores (app / studyTimer / community…)
│   ├── services/            # Auth, notifications, reminders
│   ├── api/                 # API wrappers (client / sync / community)
│   ├── data/                # Default state and built-in data
│   ├── utils/               # Utility functions
│   ├── types/               # Global type definitions
│   └── router/              # Routes and access guards
├── electron/                # Electron main process, preload, packaging icons
├── worker/                  # Cloudflare Worker backend
│   ├── schema.sql           # D1 schema (single source of truth)
│   ├── src/api/             # Feature API modules
│   ├── src/proxy/           # Third-party proxies (MoMo, wallpapers…)
│   ├── src/middleware/      # Auth, rate limiting, etc.
│   └── test/smoke.mjs       # API smoke tests
├── public/                  # Static assets (PWA icons, screenshots, donate QR codes)
├── docs/                    # Design docs (local only, not published)
├── vite.config.ts           # Vite + PWA config
├── tailwind.config.js       # Tailwind theme
└── package.json             # Dependencies and scripts
```

</div>

---

## 🌐 Deployment

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

Two GitHub Actions pipelines, both watching the **`master`** branch:

| Workflow | Trigger | What it does |
| :--- | :--- | :--- |
| `deploy-pages.yml` | Push to `master` | `npm ci` → `npm run build` → deploy `dist/` to GitHub Pages |
| `deploy-worker.yml` | Push to `master` with `worker/**` changes | `npm ci` inside `worker/` → `npx wrangler deploy` |

Required repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. At runtime the Worker also needs `JWT_SECRET`, `TURNSTILE_SECRET`, `DESKTOP_TOKEN`, plus a D1 database (`zsb-study-db`) and an R2 bucket (`zsb-study-images`).

</div>

---

## 🤝 Contributing

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

Contributions are welcome! Standard workflow:

<br/>

<table align="center">
  <tr>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">1</span>
      <br/><strong>Fork</strong><br/>
      <span style="color:#8b949e;font-size:13px;">this repo</span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">2</span>
      <br/><strong>Branch</strong><br/>
      <span style="color:#8b949e;font-size:13px;"><code>feat/xxx</code> or <code>fix/xxx</code></span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">3</span>
      <br/><strong>Code</strong><br/>
      <span style="color:#8b949e;font-size:13px;">verify locally</span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">4</span>
      <br/><strong>PR</strong><br/>
      <span style="color:#8b949e;font-size:13px;">to <code>development</code></span>
    </td>
  </tr>
</table>

</div>

### Code Style

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;">

- **TypeScript** with Vue 3 `<script setup>` style
- **Tailwind CSS** for all styling, mobile-first responsive
- Use **SVG icon components (Lucide)** — never emoji as functional icons
- Follow existing directory structure and naming conventions

</div>

### Commit Convention

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;">

- Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:` / `fix:` / `docs:` / `refactor:` etc.
- Example: `feat: add vocabulary stats chart`
- Branching strategy and review process are documented in [CONTRIBUTING.md](./CONTRIBUTING.md)

</div>

### Feedback

- **Bugs**: [Open an Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)
- **Feature Requests**: Open an Issue with the `enhancement` label
- **Security**: See [SECURITY.md](./SECURITY.md)

---

## 📜 License

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;text-align:center;">

Licensed under <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" /></a>.

</div>

---

## 👤 About Me

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">

**Han050912** · A developer preparing for exams and passionate about building tools.

<br/>

<a href="https://blog.csdn.net/hajai?spm=1000.2115.3001.5343">
  <img src="https://img.shields.io/badge/Blog-CSDN-fc5531?style=for-the-badge&logo=rss&logoColor=white" alt="CSDN Blog" />
</a>
<a href="https://x.com/hanhaoyi888">
  <img src="https://img.shields.io/badge/X-@hanhaoyi888-000000?style=for-the-badge&logo=x&logoColor=white" alt="X (Twitter)" />
</a>
<a href="https://discord.gg/49C9ZGqX4">
  <img src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
</a>
<a href="https://t.me/hanhaoyi888">
  <img src="https://img.shields.io/badge/Telegram-@hanhaoyi888-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
</a>

</div>

---

## ☕ Buy Me a Coffee

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">

If this project helps you, feel free to buy me a coffee and keep the tool improving ☕

<br/>

| WeChat Pay | Alipay |
| :---: | :---: |
| <img src="./public/donate/wechat.jpg" alt="WeChat Pay" width="220" style="border-radius:8px;" /> | <img src="./public/donate/alipay.jpg" alt="Alipay" width="220" style="border-radius:8px;" /> |

</div>
