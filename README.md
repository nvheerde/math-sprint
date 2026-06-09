# Math Sprint

A Zetamac-style mental-math trainer that runs as an installable mobile web app (PWA). Fixed-time arithmetic sprints, a big custom keypad for fast entry, per-preset progress tracking, and automatic weak-spot analysis. All data is stored **locally in your browser** — no account, no backend.

## Features

- **Fixed-time sprints** with a 3-2-1 countdown (30s / 60s / 120s / 5min).
- **Auto-advance**: type the correct answer and the next question loads instantly — no Enter key.
- **Big phone-style keypad** (1–9, 0, backspace, clear) with large tap targets.
- **Four operations** — `+ − × ÷` — each toggleable with configurable operand ranges. Subtraction/division are generated as inverses so answers stay whole and non-negative.
- **Saved presets**, each with its own history and trend graph. Ships with the Zetamac **Default**.
- **Per-question logging** (operation, operands, solve time, fumbles) powering:
  - Score-over-time trend graph
  - Speed-by-operation bars
  - **Weak-spot tips**: slowest operation, toughest times tables / divisors, carry/borrow cost, fumble rate, and trend direction.
- **Dark theme** that follows your system appearance.
- **Offline-capable** once installed (service worker caches the app).

## Run locally

```sh
cd mental-math
python3 -m http.server 8765
```

- On this computer: <http://localhost:8765>
- On your phone (same WiFi): `http://<your-computer-ip>:8765`

> Note: the **service worker / install / offline** features only activate on `localhost` or over **HTTPS**. Over a plain `http://192.168.x.x` LAN address the game works fully, but you won't get the offline cache or home-screen install — that's expected. Use GitHub Pages (below) for the real installable experience.

## Deploy to GitHub Pages (free, HTTPS)

1. Create a repo and push these files:
   ```sh
   cd mental-math
   git init
   git add .
   git commit -m "Math Sprint PWA"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` / `/ (root)`, save.
3. Wait ~1 min, then open `https://<you>.github.io/<repo>/` on your iPhone in Safari.
4. Tap **Share → Add to Home Screen**. It launches fullscreen like a native app and works offline.

### Updating after a deploy
Edit files, then bump the `CACHE` version string in `sw.js` (e.g. `mathsprint-v2`) so phones pick up the new version, commit, and push.

## Data & privacy

Everything lives in `localStorage` on your device. Clearing Safari site data or deleting the home-screen app will erase your history (you chose local-only, no backup). The data model is export-friendly, so an export/import button is a small future addition if you want backups later.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup for all screens (home, play, results, stats, presets, editor) |
| `styles.css` | Dark/light theming, keypad, layout |
| `app.js` | Game engine, question generator, storage, stats & weak-spot analysis |
| `manifest.webmanifest` | PWA metadata for install |
| `sw.js` | Service worker for offline caching |
| `icons/` | App icons (SVG master + generated PNGs) |
