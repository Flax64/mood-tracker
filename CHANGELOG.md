# Historial de Versiones / Changelog

> Estándar aplicado: **SemVer 2.0.0 + Conventional Commits** · Versión actual desplegada: **v1.10.5**
>
> Reglas automáticas en cada despliegue a `main`:
> - **MAJOR (`+1.0.0`)**: Cambios incompatibles (`BREAKING CHANGE:` o `<tipo>!:`).
> - **MINOR (`+0.1.0`)**: Nuevas funcionalidades compatibles (`feat:` / `feat(alcance):`).
> - **PATCH (`+0.0.1`)**: Corrección de errores (`fix:`), seguridad, documentación o mantenimiento.

## [v1.10.5] - 2026-11-17 (PATCH) · `81ccc0a`
**chore: track local Python sync scripts in repo while keeping logs ignored and excluded from Docker/EC2**

### 🔧 Maintenance & Docs
- chore: track local Python sync scripts in repo while keeping logs ignored and excluded from Docker/EC2 (81ccc0a)

## [v1.10.4] - 2026-11-16 (PATCH) · `0d8eefa`
**fix: strip RCLONE_* env vars before invoking rclone CLI inside container**

### 🐛 Bug Fixes / Correcciones
- fix: strip RCLONE_* env vars before invoking rclone CLI inside container (ed8841b)

## [v1.10.3] - 2026-11-16 (PATCH) · `2ff44ac`
**fix: verify Study Word upload size on Google Drive via rclone lsjson**

### 🐛 Bug Fixes / Correcciones
- fix: verify Study Word upload size on Google Drive via rclone lsjson (63a2af2)

## [v1.10.2] - 2026-11-16 (PATCH) · `2a44971`
**fix: respect [hidden] attribute on music lyrics textarea and allow vertical scroll**

### 🐛 Bug Fixes / Correcciones
- fix: respect [hidden] attribute on music lyrics textarea and allow vertical scroll (9adf1f4)

## [v1.10.1] - 2026-11-16 (PATCH) · `681cd9f`
**fix: add MusicaAlbumes fecha_lanzamiento auto-migration and Drive catalog recovery**

### 🐛 Bug Fixes / Correcciones
- fix: add MusicaAlbumes fecha_lanzamiento auto-migration and Drive catalog recovery (9e575d6)

## [v1.10.0] - 2026-11-16 (MINOR) · `55a0dbc`
**feat: integral refactor for mobile UX, music explorer, Word-first lyrics, language studio, Caddy HTTPS, and transparent 1-month Drive RAM archive**

### ✨ Features / Nuevas Funciones
- feat: integral refactor for mobile UX, music explorer, Word-first lyrics, language studio, Caddy HTTPS, and transparent 1-month Drive RAM archive (e7275a6)

### 🐛 Bug Fixes / Correcciones
- fix: test corregido (5d4ef9c)

## [v1.9.1] - 2026-11-16 (PATCH) · `7779ec7`
**fix(ytdlp): remove server-side youtube fetch fallback to prevent IP bot blocks**

### 🐛 Bug Fixes / Correcciones
- fix(ytdlp): remove server-side youtube fetch fallback to prevent IP bot blocks (7779ec7)

## [v1.9.0] - 2026-11-16 (MINOR) · `3fab9d0`
**feat(session): single-tab guard & ntfy tab reuse**

### ✨ Features / Nuevas Funciones
- feat(session): single-tab guard & ntfy tab reuse (5ae94a5)

### 🐛 Bug Fixes / Correcciones
- fix(ai,ui): robust Gemini JSON parser and fix sidebar footer overlap (3fab9d0)

## [v1.8.0] - 2026-11-16 (MINOR) · `1fe94aa`
**feat(session): single-tab guard & ntfy tab reuse**

### ✨ Features / Nuevas Funciones
- feat(session): single-tab guard & ntfy tab reuse (5ae94a5)

## [v1.7.1] - 2026-11-16 (PATCH) · `a8f0730`
**docs(manual): concise user guide local & in-app**

### 🔧 Maintenance & Docs
- docs(manual): concise user guide local & in-app (a8f0730)

## [v1.1.0] - 2026-11-15 (MINOR) · `61335e8`
**feat(ui,i18n,docs): enforce dark mode, complete EN/ES translation, visual guide, and Windows sync lifecycle docs**

### ✨ Features / Nuevas Funciones
- feat(ui,i18n,docs): enforce dark mode, complete EN/ES translation, visual guide, and Windows sync lifecycle docs (4fcc3ea)
- feat(music,ai,translator,sync): add popout translator, yt-dlp player, encrypted PC Word lyrics bridge, and AI auto-sync (f76fd0b)

### 🐛 Bug Fixes / Correcciones
- fix: verificacion de logica (61335e8)

## [v1.0.0] - 2026-11-15 (INITIAL) · `baseline`
**Initial production release of Personal Daily Hub (E2EE, Mood/Sleep/Crisis, ITS Schedule & Agenda, Music & Multilingual AI)**

### ✨ Features / Nuevas Funciones
- Mood, Sleep (including Late Night / Desvelos) and Spanish Crisis clinical read-only tracker
- X25519 + AES-256-CTR + HMAC-SHA256 transport tunnel + 32-char E2EE Word vault bridge
- Weekly Agenda (Jira To Do / In Progress / Done) linked to ITS classes, croquis & GPS commute
- Learn with Music (YT Music + local/EC2 yt-dlp lyrics & progressive streaming) + AI Studio (EN/KR/K-Pop)
- Permanent Dark Mode, full EN <-> ES bilingual engine & interactive Visual User Guide
- Automated CI/CD SemVer 2.0.0 release & version history tracking per deployment
