# 💍 Walk to Mordor — Middle-earth Quest Tracker (PWA)

A mobile-first **Progressive Web App (PWA)** designed for the **OnePlus Nord** (and any modern mobile/desktop browser) that tracks your real-world walking progress in **pure Metric (`km`)** along Frodo Baggins and Samwise Gamgee's **2,863 km** quest from **Bag End (Hobbiton)** to **Sammath Naur (Mount Doom)** in Mordor.

---

## ✨ Features

- **🗺️ Interactive Pan & Zoom Middle-earth Map**:
  - High-resolution hand-drawn Tolkien-style parchment cartography map (`L.CRS.Simple` slippy-map engine + optional native `google.maps.Map` GroundOverlay engine).
  - **Dynamic Trail Rendering**: Completed distance glows gold from Bag End up to Frodo & Sam's exact interpolated position; remaining distance to Mount Doom is rendered as a shadowed crimson trail.
  - **Interactive Quest Scrubber (`0 – 2,863 km`)**: Preview the entire route from the Shire to Mordor in real time.
- **🧭 Google Maps & Live Walk Tracking**:
  - **Live Auto-Track (`GPS + Motion Step Sensor + Screen Wake Lock`)**: Uses `navigator.geolocation.watchPosition`, `DeviceMotionEvent` accelerometer step detection, and `navigator.wakeLock` so Frodo & Sam advance in kilometers automatically while you walk.
  - **Tap-to-Plot Route**: Tap waypoints along streets/trails on the real-world map to measure a walk in kilometers, or open the route directly in the native **Google Maps** app.
  - **Google Maps URL Importer & Quick Metric Logger**: Import coordinates from a Google Maps directions link, or log kilometers (`+1 km`, `+3 km`, `+5 km`, `+10 km`) and pedometer steps (`steps/km`).
- **🏔️ 33 Canonical Waypoints**:
  - Based on Barbara Strachey's *Journeys of Frodo* converted to metric (`2,863 km`), complete with Shire Reckoning dates, quotes, danger ratings, and milestone unlock celebrations.
- **👁️ Eye of Sauron Backdrop & Offline PWA Support**:
  - Features the **Eye of Sauron** (`public/assets/eyeOfSauron.jpg`) full-bleed backdrop with frosted-glass UI cards, custom wallpaper upload/URL support, Service Worker offline caching (`public/sw.js`), and JSON backup/restore.

---

## 🚀 Quick Start

### Run Locally

```bash
python3 serve.py
```

Then open:
- **Local browser**: `http://localhost:8080`
- **OnePlus Nord (same Wi-Fi)**: `http://<your-lan-ip>:8080`

### Install on OnePlus Nord (Android Chrome)
1. Open the app URL in **Chrome** on your OnePlus Nord.
2. Go to **Journal (📖) → Install App** (or tap Chrome's **⋮** menu → **Add to Home screen / Install app**).
3. Launch **Walk to Mordor** fullscreen from your home screen with offline support.

---

## 📁 Project Structure

```text
walk-to-mordor/
├── public/
│   ├── index.html            # Main mobile-first PWA shell
│   ├── styles.css            # Obsidian/gold theme, Eye of Sauron backdrop & frosted glass UI
│   ├── app.js                # Map engine, GPS/step tracking, Google Maps integration & state
│   ├── manifest.json         # Web App Manifest for Android home screen installation
│   ├── sw.js                 # Service Worker for offline caching
│   ├── data/
│   │   └── milestones.js     # 33 canonical Middle-earth waypoints (0 – 2,863 km)
│   └── assets/
│       ├── middle-earth-map.jpg
│       ├── eyeOfSauron.jpg
│       ├── middle-earth-backdrop.jpg
│       └── app-icon.jpg
├── .github/
│   └── CODEOWNERS            # Restricts main branch ownership/review to @JamesCalleja
└── serve.py                  # Zero-dependency Python static server (localhost + LAN IP)
```

---

## 🤝 Contributing & Branch Policy

- Anyone is welcome to **fork** this repository or push feature branches and open Pull Requests.
- Merging into `main` is restricted to **[@JamesCalleja](https://github.com/JamesCalleja)** via branch protection / rulesets and `CODEOWNERS`.
