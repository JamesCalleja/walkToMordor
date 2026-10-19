import { MILESTONES, LANDMARKS, TOTAL_KM, DEFAULT_REAL_WORLD_START } from './data/milestones.js';

const STORAGE_KEY = 'walk_to_mordor_metric_v2';

// Application State (Pure Metric: Kilometers & Steps/km)
let state = {
  stepsPerKm: 1312,
  gmapsApiKey: '',
  customWallpaper: '',
  logs: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.logs)) {
        parsed.logs = parsed.logs.filter((item) => item.id !== 'starter-1');
      }
      state = { ...state, ...parsed };
    }
  } catch (err) {
    console.warn('Could not load saved state:', err);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save state:', err);
  }
}

// Compute total kilometers walked from logs
function getTotalKmWalked() {
  const sum = state.logs.reduce((acc, item) => acc + (Number(item.km) || 0), 0);
  return Math.max(0, Math.round(sum * 100) / 100);
}

// Format distance in kilometers
function formatDist(km, decimals = 1) {
  return `${Number(km).toFixed(decimals)} km`;
}

// Interpolate exact position along the 33-waypoint route for a given kilometer distance
function getQuestProgressData(kmInput) {
  const clampedKm = Math.max(0, Math.min(TOTAL_KM, kmInput));

  let currentMilestone = MILESTONES[0];
  let nextMilestone = MILESTONES[MILESTONES.length - 1];
  let currentIndex = 0;

  for (let i = 0; i < MILESTONES.length; i++) {
    if (clampedKm >= MILESTONES[i].km) {
      currentMilestone = MILESTONES[i];
      currentIndex = i;
      nextMilestone = MILESTONES[Math.min(i + 1, MILESTONES.length - 1)];
    } else {
      break;
    }
  }

  // Interpolate coordinates between currentMilestone and nextMilestone
  let legFraction = 1;
  if (nextMilestone.km > currentMilestone.km) {
    legFraction = (clampedKm - currentMilestone.km) / (nextMilestone.km - currentMilestone.km);
  }
  legFraction = Math.max(0, Math.min(1, legFraction));

  const frodoLat = currentMilestone.coords[0] + (nextMilestone.coords[0] - currentMilestone.coords[0]) * legFraction;
  const frodoLng = currentMilestone.coords[1] + (nextMilestone.coords[1] - currentMilestone.coords[1]) * legFraction;
  const frodoCoords = [frodoLat, frodoLng];

  // Build walked polyline coords & remaining polyline coords
  const walkedCoords = MILESTONES.slice(0, currentIndex + 1).map((m) => m.coords);
  if (legFraction > 0 && currentIndex < MILESTONES.length - 1) {
    walkedCoords.push(frodoCoords);
  }

  const remainingCoords = [frodoCoords, ...MILESTONES.slice(currentIndex + 1).map((m) => m.coords)];

  return {
    clampedKm,
    totalPercent: Math.min(100, (clampedKm / TOTAL_KM) * 100),
    currentMilestone,
    nextMilestone,
    currentIndex,
    legFraction,
    legPercent: Math.round(legFraction * 100),
    kmToNext: Math.max(0, nextMilestone.km - clampedKm),
    frodoCoords,
    walkedCoords,
    remainingCoords
  };
}

// ============================================================================
// 1. INTERACTIVE MIDDLE-EARTH MAP ENGINE (Leaflet CRS.Simple + Google Maps Overlay)
// ============================================================================
let meMap = null;
let walkedGlowLayer = null;
let walkedCoreLayer = null;
let remainingTrailLayer = null;
let frodoMarker = null;
let milestoneMarkers = [];
let landmarkMarkers = [];
let pinsVisible = true;

// Optional Google Maps Native instance for Middle-earth
let gmapsMeInstance = null;
let gmapsWalkedLine = null;
let gmapsRemainingLine = null;
let gmapsFrodoMarker = null;

const MAP_HEIGHT = 1000;
const MAP_WIDTH = 1778;
const MAP_BOUNDS = [[0, 0], [MAP_HEIGHT, MAP_WIDTH]];

function initMiddleEarthMap() {
  meMap = L.map('middle-earth-map', {
    crs: L.CRS.Simple,
    minZoom: -1.4,
    maxZoom: 2.5,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    attributionControl: false,
    zoomControl: false
  });

  // Add the custom Middle-earth cartographic map image
  L.imageOverlay('./assets/middle-earth-map.jpg', MAP_BOUNDS).addTo(meMap);
  meMap.setMaxBounds([[-180, -180], [MAP_HEIGHT + 180, MAP_WIDTH + 180]]);

  // Fit bounds initially
  meMap.fitBounds([[180, 350], [860, 1580]]);

  // Create polyline layers
  remainingTrailLayer = L.polyline([], {
    color: '#5c1912',
    weight: 3.5,
    opacity: 0.78,
    dashArray: '7, 8',
    lineCap: 'round'
  }).addTo(meMap);

  walkedGlowLayer = L.polyline([], {
    color: '#d99f2b',
    weight: 10,
    opacity: 0.42,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(meMap);

  walkedCoreLayer = L.polyline([], {
    color: '#ffe07d',
    weight: 4.5,
    opacity: 0.98,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(meMap);

  // Decorative Middle-earth Landmarks
  LANDMARKS.forEach((lm) => {
    const icon = L.divIcon({
      className: 'landmark-div-icon',
      html: `<div class="wp-pin" title="${lm.name}" style="width:22px;height:22px;font-size:11px;opacity:0.8;">${lm.icon}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    const marker = L.marker(lm.coords, { icon }).addTo(meMap);
    marker.bindPopup(`
      <div class="map-popup-box">
        <div class="map-popup-region">Landmark of Middle-earth</div>
        <div class="map-popup-title">${lm.icon} ${lm.name}</div>
        <div class="map-popup-desc">${lm.desc}</div>
      </div>
    `);
    landmarkMarkers.push(marker);
  });

  renderMiddleEarthProgress(getTotalKmWalked(), true);
}

function renderMiddleEarthProgress(kmValue, centerOnFrodo = false) {
  const prog = getQuestProgressData(kmValue);

  if (meMap) {
    walkedGlowLayer.setLatLngs(prog.walkedCoords);
    walkedCoreLayer.setLatLngs(prog.walkedCoords);
    remainingTrailLayer.setLatLngs(prog.remainingCoords);

    // Clear and rebuild milestone markers so their status class updates cleanly
    milestoneMarkers.forEach((m) => meMap.removeLayer(m));
    milestoneMarkers = [];

    if (pinsVisible) {
      MILESTONES.forEach((ms, idx) => {
        const isReached = prog.clampedKm >= ms.km;
        const isNext = idx === prog.currentIndex + 1;
        const isDoom = ms.id === 'mount-doom';

        let stateClass = '';
        if (isReached) stateClass = 'reached';
        else if (isNext) stateClass = 'next-target';
        else if (isDoom) stateClass = 'mount-doom';

        const pinIcon = L.divIcon({
          className: 'custom-wp-icon',
          html: `<div class="wp-pin ${stateClass}">${isReached ? '✓' : ms.badge}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker(ms.coords, { icon: pinIcon }).addTo(meMap);
        marker.bindPopup(`
          <div class="map-popup-box">
            <div class="map-popup-region">${ms.region} • Waypoint #${ms.index}</div>
            <div class="map-popup-title">${ms.badge} ${ms.name}</div>
            <div class="map-popup-meta">
              <strong>${formatDist(ms.km, 0)}</strong> from Bag End • ${ms.shireDate}
            </div>
            <blockquote class="map-popup-quote">"${ms.quote}"</blockquote>
            <div class="map-popup-desc">${ms.description}</div>
          </div>
        `);
        milestoneMarkers.push(marker);
      });
    }

    // Update or create Frodo & Sam's live marker
    const frodoHtml = `
      <div class="frodo-marker-wrap">
        <div class="frodo-ring-aura"></div>
        <div class="frodo-pin-label">Frodo & Sam • ${formatDist(prog.clampedKm, 1)}</div>
        <div class="frodo-avatar-pin">💍</div>
      </div>
    `;
    const frodoIcon = L.divIcon({
      className: 'frodo-custom-icon',
      html: frodoHtml,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    if (!frodoMarker) {
      frodoMarker = L.marker(prog.frodoCoords, { icon: frodoIcon, zIndexOffset: 1000 }).addTo(meMap);
    } else {
      frodoMarker.setLatLng(prog.frodoCoords);
      frodoMarker.setIcon(frodoIcon);
    }

    frodoMarker.bindPopup(`
      <div class="map-popup-box">
        <div class="map-popup-region">Ring-bearer's Current Position</div>
        <div class="map-popup-title">💍 ${formatDist(prog.clampedKm, 1)} Walked (${prog.totalPercent.toFixed(1)}%)</div>
        <div class="map-popup-meta">
          Last passed: <strong>${prog.currentMilestone.name}</strong><br/>
          Next up: <strong>${prog.nextMilestone.name}</strong> (${formatDist(prog.kmToNext, 1)} ahead)
        </div>
        <blockquote class="map-popup-quote">"${prog.currentMilestone.quote}"</blockquote>
      </div>
    `);

    if (centerOnFrodo) {
      meMap.flyTo(prog.frodoCoords, 0.2, { duration: 0.9 });
    }
  }

  // Also update Google Maps native GroundOverlay instance if active
  if (gmapsMeInstance && window.google?.maps) {
    updateNativeGoogleMapOverlay(prog);
  }

  updateHudAndCards(prog);
}

// Update Top HUD, Bottom Map Card, Waypoints List, and Journal
function updateHudAndCards(prog) {
  document.getElementById('hud-region-label').textContent = `${prog.currentMilestone.region.toUpperCase()} • ${prog.currentMilestone.shireDate.toUpperCase()}`;
  document.getElementById('hud-distance-val').textContent = formatDist(prog.clampedKm, 1);
  document.getElementById('hud-percent-val').textContent = `${prog.totalPercent.toFixed(1)}%`;

  document.getElementById('current-stage-badge').textContent = prog.currentMilestone.badge;
  document.getElementById('stage-shire-date').textContent = prog.currentMilestone.shireDate;
  document.getElementById('current-stage-name').textContent = prog.currentMilestone.name;

  if (prog.clampedKm >= TOTAL_KM) {
    document.getElementById('next-stage-summary').textContent = '🎉 Quest Complete! The One Ring is Destroyed!';
    document.getElementById('leg-progress-label').textContent = 'Reached Sammath Naur (Mount Doom)';
  } else {
    document.getElementById('next-stage-summary').textContent = `Next: ${prog.nextMilestone.name} in ${formatDist(prog.kmToNext, 1)}`;
    document.getElementById('leg-progress-label').textContent = `To ${prog.nextMilestone.name}`;
  }

  document.getElementById('leg-progress-pct').textContent = `${prog.legPercent}%`;
  document.getElementById('leg-progress-bar').style.width = `${prog.legPercent}%`;

  document.getElementById('total-progress-readout').textContent = `${formatDist(prog.clampedKm, 1)} / 2,863 km`;
  document.getElementById('total-progress-bar').style.width = `${prog.totalPercent}%`;

  document.getElementById('current-stage-quote').textContent = `"${prog.currentMilestone.quote}"`;
  document.getElementById('current-stage-desc').textContent = prog.currentMilestone.description;
}

// ============================================================================
// 2. REAL-WORLD GOOGLE MAPS & LIVE GPS WALK TRACKER (TAB 2 - METRIC)
// ============================================================================
let realMap = null;
let realRouteLayer = null;
let realPointMarkers = [];
let plottedCoords = [];
let gpsWatchId = null;
let gpsTimerInterval = null;
let gpsStartTime = null;
let wakeLockSentinel = null;
let motionStepCount = 0;
let lastStepTimestamp = 0;
let motionHandler = null;

// Haversine formula to compute kilometers between two [lat, lng] coordinates
function haversineKm(coord1, coord2) {
  const R = 6371.0; // Earth radius in kilometers
  const dLat = ((coord2[0] - coord1[0]) * Math.PI) / 180;
  const dLng = ((coord2[1] - coord1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1[0] * Math.PI) / 180) *
      Math.cos((coord2[0] * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPlottedKm() {
  let gpsKm = 0;
  for (let i = 1; i < plottedCoords.length; i++) {
    gpsKm += haversineKm(plottedCoords[i - 1], plottedCoords[i]);
  }
  const stepKm = motionStepCount / state.stepsPerKm;
  return Math.max(gpsKm, stepKm);
}

function initRealWorldMap() {
  if (realMap) return;

  realMap = L.map('real-world-map', {
    center: [DEFAULT_REAL_WORLD_START.lat, DEFAULT_REAL_WORLD_START.lng],
    zoom: 14,
    attributionControl: false
  });

  // High-contrast street tiles for outdoor visibility on OnePlus Nord
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(realMap);

  realRouteLayer = L.polyline([], {
    color: '#1a73e8',
    weight: 5,
    opacity: 0.9
  }).addTo(realMap);

  // Try to center on user's actual location silently if permission already granted
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (plottedCoords.length === 0) {
          realMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
        }
      },
      () => {}
    );
  }

  // Allow tapping on the map to plot a walking route and calculate distance in km
  realMap.on('click', (e) => {
    const pt = [e.latlng.lat, e.latlng.lng];
    addRoutePoint(pt);
  });
}

function addRoutePoint(pt) {
  plottedCoords.push(pt);
  realRouteLayer.setLatLngs(plottedCoords);

  const dot = L.circleMarker(pt, {
    radius: 6,
    color: '#ffffff',
    weight: 2,
    fillColor: plottedCoords.length === 1 ? '#439a56' : '#1a73e8',
    fillOpacity: 1
  }).addTo(realMap);
  realPointMarkers.push(dot);

  updateLiveWalkTelemetry();
}

function updateLiveWalkTelemetry() {
  const km = getPlottedKm();
  const estSteps = Math.max(motionStepCount, Math.round(km * state.stepsPerKm));

  document.getElementById('live-walk-dist').textContent = formatDist(km, 2);
  document.getElementById('live-walk-steps').textContent = estSteps.toLocaleString();
  document.getElementById('btn-save-map-walk').disabled = km < 0.01;

  if (plottedCoords.length > 0 || motionStepCount > 0) {
    document.getElementById('gps-status-pill').textContent = `${plottedCoords.length} GPS pts • ${estSteps} steps • ${formatDist(km, 2)}`;
    // Live-advance Frodo & Sam on the Middle-earth map as you walk!
    renderMiddleEarthProgress(getTotalKmWalked() + km, false);
  }
}

function clearPlottedRoute() {
  plottedCoords = [];
  motionStepCount = 0;
  if (realRouteLayer) realRouteLayer.setLatLngs([]);
  realPointMarkers.forEach((m) => realMap && realMap.removeLayer(m));
  realPointMarkers = [];
  updateLiveWalkTelemetry();
  renderMiddleEarthProgress(getTotalKmWalked(), false);
  document.getElementById('gps-status-pill').textContent = 'Tap map to plot route or start GPS';
}

async function requestScreenWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    // Wake lock optional if browser denies
  }
}

function releaseScreenWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

function startMotionStepDetector() {
  if (!('DeviceMotionEvent' in window)) return;
  motionHandler = (event) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;
    const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    const now = Date.now();
    // Peak detection above gravity (9.8m/s^2) with 320ms debounce between steps
    if (mag > 12.6 && now - lastStepTimestamp > 320) {
      lastStepTimestamp = now;
      motionStepCount += 1;
      updateLiveWalkTelemetry();
    }
  };
  window.addEventListener('devicemotion', motionHandler);
}

function stopMotionStepDetector() {
  if (motionHandler) {
    window.removeEventListener('devicemotion', motionHandler);
    motionHandler = null;
  }
}

function toggleLiveGpsWalk() {
  const btn = document.getElementById('btn-start-gps');
  const statusPill = document.getElementById('gps-status-pill');

  if (gpsWatchId !== null) {
    // Stop tracking
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    clearInterval(gpsTimerInterval);
    stopMotionStepDetector();
    releaseScreenWakeLock();
    btn.textContent = '▶ Start Auto-Track (GPS + Steps)';
    statusPill.textContent = 'Auto-Track Paused — Tap ✓ Log Walk to save';
    return;
  }

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  btn.textContent = '⏹ Stop Auto-Track';
  statusPill.textContent = 'Wake Lock Active • Tracking GPS & Steps...';
  gpsStartTime = Date.now();
  requestScreenWakeLock();
  startMotionStepDetector();

  gpsTimerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - gpsStartTime) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    document.getElementById('live-walk-time').textContent = `${mm}:${ss}`;
  }, 1000);

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const pt = [pos.coords.latitude, pos.coords.longitude];
      if (plottedCoords.length > 0) {
        const last = plottedCoords[plottedCoords.length - 1];
        const deltaKm = haversineKm(last, pt);
        // Filter out tiny GPS jitter (< 10 meters / 0.01 km)
        if (deltaKm < 0.01) return;
      }
      addRoutePoint(pt);
      realMap.panTo(pt);
      statusPill.textContent = `GPS Active (±${Math.round(pos.coords.accuracy)}m) • ${formatDist(getPlottedKm(), 2)}`;
    },
    (err) => {
      statusPill.textContent = `Motion Steps Active (GPS: ${err.message})`;
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

// Open current plotted route or location directly in Google Maps on OnePlus Nord
function openInNativeGoogleMaps() {
  if (plottedCoords.length >= 2) {
    const origin = `${plottedCoords[0][0]},${plottedCoords[0][1]}`;
    const dest = `${plottedCoords[plottedCoords.length - 1][0]},${plottedCoords[plottedCoords.length - 1][1]}`;
    const waypoints = plottedCoords
      .slice(1, -1)
      .slice(0, 8)
      .map((c) => `${c[0]},${c[1]}`)
      .join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=walking`;
    window.open(url, '_blank');
  } else {
    window.open('https://www.google.com/maps/dir/?api=1&travelmode=walking', '_blank');
  }
}

// Parse a pasted Google Maps URL to extract coordinates and plot the route in km
function parseGoogleMapsUrl(urlStr) {
  const feedback = document.getElementById('gmaps-parse-feedback');
  feedback.classList.remove('hidden');

  const coordsFound = [];
  const dirRegex = /(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/g;
  let match;
  while ((match = dirRegex.exec(urlStr)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      coordsFound.push([lat, lng]);
    }
  }

  if (coordsFound.length >= 2) {
    document.querySelector('[data-walk-mode="gps"]').click();
    clearPlottedRoute();
    coordsFound.forEach((pt) => addRoutePoint(pt));
    realMap.fitBounds(plottedCoords, { padding: [30, 30] });
    const dist = getPlottedKm();
    feedback.textContent = `✓ Extracted ${coordsFound.length} Google Maps waypoints (${formatDist(dist, 2)})!`;
  } else {
    feedback.textContent =
      'Tip: Copy the full URL from Google Maps with coordinates (e.g. google.com/maps/dir/51.75,-1.25/51.76,-1.24) or tap points directly on the Live Map tab.';
  }
}

// Optional Native Google Maps JS API Engine for Middle-earth
function activateNativeGoogleMapsEngine(apiKey) {
  const leafContainer = document.getElementById('middle-earth-map');
  const gmapsContainer = document.getElementById('gmaps-middle-earth');

  if (!apiKey) {
    gmapsContainer.classList.add('hidden');
    leafContainer.classList.remove('hidden');
    if (meMap) meMap.invalidateSize();
    return;
  }

  const initGMap = () => {
    leafContainer.classList.add('hidden');
    gmapsContainer.classList.remove('hidden');

    const toLatLng = (c) => ({ lat: (c[0] - 500) * 0.02, lng: (c[1] - 889) * 0.02 });

    gmapsMeInstance = new window.google.maps.Map(gmapsContainer, {
      center: toLatLng([550, 900]),
      zoom: 6,
      mapTypeId: 'terrain',
      disableDefaultUI: true,
      zoomControl: true,
      backgroundColor: '#17120c'
    });

    const imageBounds = {
      south: -500 * 0.02,
      north: 500 * 0.02,
      west: -889 * 0.02,
      east: 889 * 0.02
    };

    new window.google.maps.GroundOverlay('/assets/middle-earth-map.jpg', imageBounds).setMap(gmapsMeInstance);
    updateNativeGoogleMapOverlay(getQuestProgressData(getTotalKmWalked()));
  };

  if (window.google?.maps) {
    initGMap();
  } else {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = initGMap;
    script.onerror = () => alert('Could not load Google Maps JS SDK. Check your API key.');
    document.head.appendChild(script);
  }
}

function updateNativeGoogleMapOverlay(prog) {
  if (!gmapsMeInstance || !window.google?.maps) return;
  const toLatLng = (c) => ({ lat: (c[0] - 500) * 0.02, lng: (c[1] - 889) * 0.02 });

  if (gmapsWalkedLine) gmapsWalkedLine.setMap(null);
  if (gmapsRemainingLine) gmapsRemainingLine.setMap(null);
  if (gmapsFrodoMarker) gmapsFrodoMarker.setMap(null);

  gmapsWalkedLine = new window.google.maps.Polyline({
    path: prog.walkedCoords.map(toLatLng),
    geodesic: false,
    strokeColor: '#ffe07d',
    strokeOpacity: 1.0,
    strokeWeight: 5,
    map: gmapsMeInstance
  });

  gmapsRemainingLine = new window.google.maps.Polyline({
    path: prog.remainingCoords.map(toLatLng),
    geodesic: false,
    strokeColor: '#7a2015',
    strokeOpacity: 0.8,
    strokeWeight: 3,
    map: gmapsMeInstance
  });

  gmapsFrodoMarker = new window.google.maps.Marker({
    position: toLatLng(prog.frodoCoords),
    map: gmapsMeInstance,
    title: `Frodo & Sam (${formatDist(prog.clampedKm, 1)})`,
    label: '💍'
  });
}

// ============================================================================
// 3. LOGGING WALKS, CELEBRATING MILESTONES, TIMELINE & JOURNAL (METRIC)
// ============================================================================
function addWalkLog(kmToAdd, dateStr, noteStr) {
  const prevKm = getTotalKmWalked();
  const prevProg = getQuestProgressData(prevKm);

  const cleanKm = Math.round(Number(kmToAdd) * 100) / 100;
  if (!cleanKm || cleanKm <= 0) return;

  state.logs.unshift({
    id: `walk-${Date.now()}`,
    date: dateStr || new Date().toISOString().slice(0, 10),
    km: cleanKm,
    note: noteStr || 'Walk toward Mordor'
  });

  saveState();

  const newKm = getTotalKmWalked();
  const newProg = getQuestProgressData(newKm);

  renderAllViews(true);

  // Check if a new milestone was unlocked!
  if (newProg.currentIndex > prevProg.currentIndex) {
    showMilestoneUnlockedModal(newProg.currentMilestone);
  }
}

function showMilestoneUnlockedModal(ms) {
  document.getElementById('modal-badge').textContent = ms.badge;
  document.getElementById('modal-eyebrow').textContent = `WAYPOINT #${ms.index} REACHED!`;
  document.getElementById('modal-title').textContent = ms.name;
  document.getElementById('modal-meta').textContent = `${formatDist(ms.km, 0)} from Bag End • ${ms.shireDate}`;
  document.getElementById('modal-quote').textContent = `"${ms.quote}"`;
  document.getElementById('modal-desc').textContent = ms.description;
  document.getElementById('milestone-modal').classList.remove('hidden');
}

function renderWaypointsTimeline(filter = 'all') {
  const container = document.getElementById('waypoints-timeline');
  const totalKm = getTotalKmWalked();
  const prog = getQuestProgressData(totalKm);

  const filtered = MILESTONES.filter((ms) => {
    const reached = totalKm >= ms.km;
    if (filter === 'unlocked') return reached;
    if (filter === 'upcoming') return !reached;
    return true;
  });

  container.innerHTML = filtered
    .map((ms) => {
      const reached = totalKm >= ms.km;
      const isNext = ms.index === prog.currentMilestone.index + 1;
      const statusBadge = reached
        ? '✓ Reached'
        : isNext
        ? `⚡ Next (${formatDist(ms.km - totalKm, 1)} away)`
        : `🔒 ${formatDist(ms.km - totalKm, 1)} to go`;

      return `
        <div class="waypoint-card ${reached ? 'reached' : ''} ${isNext ? 'next-up' : ''}" data-wp-id="${ms.id}">
          <div class="wp-card-icon">${ms.badge}</div>
          <div class="wp-card-body">
            <div class="wp-card-top">
              <span class="wp-card-title">#${ms.index}. ${ms.name}</span>
              <span class="wp-card-dist">${formatDist(ms.km, 0)}</span>
            </div>
            <div class="wp-card-sub">${ms.region} • ${ms.shireDate} • <strong>${statusBadge}</strong></div>
            <div class="wp-card-quote">"${ms.quote}"</div>
            <div class="wp-card-desc">${ms.description}</div>
          </div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.waypoint-card').forEach((card) => {
    card.addEventListener('click', () => {
      const wpId = card.getAttribute('data-wp-id');
      const idx = MILESTONES.findIndex((m) => m.id === wpId);
      if (idx !== -1) {
        switchTab('tab-map');
        const ms = MILESTONES[idx];
        meMap.flyTo(ms.coords, 0.7, { duration: 0.9 });
        if (milestoneMarkers[idx]) {
          setTimeout(() => milestoneMarkers[idx].openPopup(), 450);
        }
      }
    });
  });
}

function renderJournalAndStats() {
  const totalKm = getTotalKmWalked();
  const remKm = Math.max(0, TOTAL_KM - totalKm);
  const prog = getQuestProgressData(totalKm);

  document.getElementById('stat-total-dist').textContent = formatDist(totalKm, 1);
  document.getElementById('stat-rem-dist').textContent = formatDist(remKm, 1);
  document.getElementById('stat-waypoints-count').textContent = `${prog.currentIndex + 1} / ${MILESTONES.length}`;
  document.getElementById('stat-sessions-count').textContent = String(state.logs.length);
  document.getElementById('input-steps-per-km').value = state.stepsPerKm;

  const listEl = document.getElementById('journal-entries-list');
  if (state.logs.length === 0) {
    listEl.innerHTML = `<p class="card-sub">No walks logged yet. Tap "+ Walk" or use the Log / GMaps tab to begin your quest from Bag End!</p>`;
    return;
  }

  listEl.innerHTML = state.logs
    .map((item) => {
      const stepsEst = Math.round(item.km * state.stepsPerKm).toLocaleString();
      return `
        <div class="journal-row">
          <div class="journal-row-left">
            <strong>+${formatDist(item.km, 2)}</strong> <span style="font-size:11.5px;color:#bba98b;">(~${stepsEst} steps)</span>
            <div class="journal-row-meta">${item.date} • ${item.note}</div>
          </div>
          <button class="btn-delete-entry" data-del-id="${item.id}">Delete</button>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('.btn-delete-entry').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-id');
      state.logs = state.logs.filter((l) => l.id !== id);
      saveState();
      renderAllViews(false);
    });
  });
}

function renderAllViews(centerFrodo = false) {
  const totalKm = getTotalKmWalked();
  renderMiddleEarthProgress(totalKm, centerFrodo);
  const activeFilter = document.querySelector('.filter-chip.active')?.getAttribute('data-filter') || 'all';
  renderWaypointsTimeline(activeFilter);
  renderJournalAndStats();
  document.getElementById('quest-scrubber-input').value = Math.min(TOTAL_KM, Math.round(totalKm));
}

// ============================================================================
// 4. UI EVENT LISTENERS & PWA INSTALLATION
// ============================================================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));

  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add('active');

  if (tabId === 'tab-map' && meMap) {
    setTimeout(() => meMap.invalidateSize(), 60);
  }
  if (tabId === 'tab-walk') {
    setTimeout(() => {
      initRealWorldMap();
      realMap?.invalidateSize();
    }, 60);
  }
}

function setupEventListeners() {
  // Bottom Navigation Tabs
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  // Top HUD pill centers on Frodo
  document.getElementById('hud-quick-stats').addEventListener('click', () => {
    switchTab('tab-map');
    const prog = getQuestProgressData(getTotalKmWalked());
    meMap.flyTo(prog.frodoCoords, 0.6, { duration: 0.8 });
  });

  // Map Floating Buttons
  document.getElementById('btn-locate-frodo').addEventListener('click', () => {
    const prog = getQuestProgressData(getTotalKmWalked());
    meMap.flyTo(prog.frodoCoords, 0.6, { duration: 0.8 });
    frodoMarker?.openPopup();
  });

  document.getElementById('btn-fit-quest').addEventListener('click', () => {
    meMap.flyToBounds([[180, 350], [860, 1580]], { duration: 0.8 });
  });

  document.getElementById('btn-toggle-labels').addEventListener('click', (e) => {
    pinsVisible = !pinsVisible;
    e.currentTarget.classList.toggle('active', pinsVisible);
    renderMiddleEarthProgress(getTotalKmWalked(), false);
  });

  // Interactive Scrubber Bar for previewing the whole Bag End -> Mordor route (0 - 2,863 km)
  const scrubberBar = document.getElementById('scrubber-bar');
  const scrubberInput = document.getElementById('quest-scrubber-input');
  const scrubberLabel = document.getElementById('scrubber-live-label');

  document.getElementById('btn-preview-scrubber').addEventListener('click', () => {
    scrubberBar.classList.toggle('hidden');
    if (!scrubberBar.classList.contains('hidden')) {
      scrubberInput.value = Math.round(getTotalKmWalked());
      scrubberLabel.textContent = `Saved: ${formatDist(getTotalKmWalked(), 1)}`;
    } else {
      renderMiddleEarthProgress(getTotalKmWalked(), false);
    }
  });

  document.getElementById('btn-close-scrubber').addEventListener('click', () => {
    scrubberBar.classList.add('hidden');
    renderMiddleEarthProgress(getTotalKmWalked(), true);
  });

  scrubberInput.addEventListener('input', () => {
    const val = Number(scrubberInput.value);
    scrubberLabel.textContent = `Preview: ${formatDist(val, 0)}`;
    renderMiddleEarthProgress(val, false);
  });

  // Expandable bottom quest card on map
  const questCard = document.getElementById('quest-bottom-card');
  document.getElementById('quest-card-toggle').addEventListener('click', () => {
    questCard.classList.toggle('expanded');
  });
  document.querySelector('.current-stage-info').addEventListener('click', () => {
    questCard.classList.toggle('expanded');
  });

  // Quick "+ Walk" CTA on Map Card
  document.getElementById('btn-quick-log-open').addEventListener('click', () => {
    switchTab('tab-walk');
    document.querySelector('[data-walk-mode="manual"]').click();
  });

  // Tab 2 Segmented Control (Live GPS vs Quick Log vs Google Maps Sync)
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.walk-mode-box').forEach((box) => box.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-walk-mode');
      document.getElementById(`walk-mode-${mode}`)?.classList.add('active');
      if (mode === 'gps' && realMap) {
        setTimeout(() => realMap.invalidateSize(), 60);
      }
    });
  });

  // Live GPS & Real-World Map Controls
  document.getElementById('btn-start-gps').addEventListener('click', toggleLiveGpsWalk);
  document.getElementById('btn-clear-route').addEventListener('click', clearPlottedRoute);
  document.getElementById('btn-open-native-gmaps').addEventListener('click', openInNativeGoogleMaps);

  document.getElementById('btn-save-map-walk').addEventListener('click', () => {
    const km = getPlottedKm();
    if (km >= 0.01) {
      addWalkLog(km, new Date().toISOString().slice(0, 10), 'GPS / Mapped Route Walk');
      clearPlottedRoute();
      switchTab('tab-map');
    }
  });

  // Manual Walk Entry Form (Kilometers or Steps)
  let activeEntryType = 'km';
  const amountInput = document.getElementById('input-walk-amount');
  const amountLabel = document.getElementById('label-walk-amount');
  const convPreview = document.getElementById('conversion-preview');
  document.getElementById('input-walk-date').value = new Date().toISOString().slice(0, 10);

  const updateConversionPreview = () => {
    const raw = parseFloat(amountInput.value) || 0;
    const km = activeEntryType === 'steps' ? raw / state.stepsPerKm : raw;
    const steps = Math.round(km * state.stepsPerKm);
    convPreview.textContent = `= ${km.toFixed(2)} km (~${steps.toLocaleString()} steps)`;
  };

  document.querySelectorAll('.unit-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.unit-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeEntryType = pill.getAttribute('data-entry-type');
      if (activeEntryType === 'km') {
        amountLabel.textContent = 'Distance Walked (Kilometers)';
        amountInput.step = '0.01';
        amountInput.placeholder = 'e.g. 5.0';
      } else {
        amountLabel.textContent = 'Pedometer Step Count';
        amountInput.step = '1';
        amountInput.placeholder = 'e.g. 8500';
      }
      updateConversionPreview();
    });
  });

  amountInput.addEventListener('input', updateConversionPreview);

  // Metric Preset Chips
  document.querySelectorAll('.chip-btn').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.hasAttribute('data-add-km')) {
        document.querySelector('[data-entry-type="km"]').click();
        amountInput.value = chip.getAttribute('data-add-km');
      } else if (chip.hasAttribute('data-add-steps')) {
        document.querySelector('[data-entry-type="steps"]').click();
        amountInput.value = chip.getAttribute('data-add-steps');
      }
      updateConversionPreview();
    });
  });

  document.getElementById('form-manual-walk').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = parseFloat(amountInput.value) || 0;
    const km = activeEntryType === 'steps' ? raw / state.stepsPerKm : raw;

    const dateVal = document.getElementById('input-walk-date').value;
    const noteVal = document.getElementById('input-walk-note').value.trim() || 'Daily Walk';

    addWalkLog(km, dateVal, noteVal);
    amountInput.value = '';
    document.getElementById('input-walk-note').value = '';
    updateConversionPreview();
    switchTab('tab-map');
  });

  // Google Maps Sync & API Key
  document.getElementById('btn-launch-gmaps-directions').addEventListener('click', openInNativeGoogleMaps);
  document.getElementById('btn-parse-gmaps-url').addEventListener('click', () => {
    const val = document.getElementById('input-gmaps-url').value.trim();
    parseGoogleMapsUrl(val);
  });

  document.getElementById('btn-save-gmaps-key').addEventListener('click', () => {
    const key = document.getElementById('input-gmaps-api-key').value.trim();
    state.gmapsApiKey = key;
    saveState();
    activateNativeGoogleMapsEngine(key);
    switchTab('tab-map');
  });

  document.getElementById('btn-clear-gmaps-key').addEventListener('click', () => {
    state.gmapsApiKey = '';
    document.getElementById('input-gmaps-api-key').value = '';
    saveState();
    activateNativeGoogleMapsEngine('');
    switchTab('tab-map');
  });

  // Waypoints Filter Chips
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      renderWaypointsTimeline(chip.getAttribute('data-filter'));
    });
  });

  // Settings & Journal Controls
  document.getElementById('input-steps-per-km').addEventListener('change', (e) => {
    state.stepsPerKm = Math.max(500, Math.min(3500, parseInt(e.target.value, 10) || 1312));
    saveState();
    renderAllViews(false);
  });

  // Backdrop Wallpaper Controls
  document.getElementById('input-wallpaper-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.customWallpaper = reader.result;
      saveState();
      applyWallpaper();
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-wallpaper-url')?.addEventListener('click', () => {
    const url = prompt('Paste a direct image URL (.jpg, .png, .webp) for your backdrop wallpaper:', state.customWallpaper || '');
    if (url !== null && url.trim() !== '') {
      state.customWallpaper = url.trim();
      saveState();
      applyWallpaper();
    }
  });

  document.getElementById('btn-wallpaper-reset')?.addEventListener('click', () => {
    state.customWallpaper = '';
    saveState();
    applyWallpaper();
  });

  document.getElementById('btn-export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `walk-to-mordor-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('input-import-data').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (Array.isArray(imported.logs)) {
          state = { ...state, ...imported };
          saveState();
          applyWallpaper();
          renderAllViews(true);
        }
      } catch (err) {
        alert('Invalid backup file format.');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-reset-demo').addEventListener('click', () => {
    if (confirm('Reset all recorded walks back to Bag End (0 km)?')) {
      state.logs = [];
      saveState();
      renderAllViews(true);
    }
  });

  // Milestone Celebration Modal
  document.getElementById('btn-modal-close').addEventListener('click', () => {
    document.getElementById('milestone-modal').classList.add('hidden');
  });
  document.getElementById('btn-modal-view-map').addEventListener('click', () => {
    document.getElementById('milestone-modal').classList.add('hidden');
    switchTab('tab-map');
    const prog = getQuestProgressData(getTotalKmWalked());
    meMap.flyTo(prog.frodoCoords, 0.7, { duration: 0.9 });
  });

  // PWA Install Prompt Handling for OnePlus Nord Chrome
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  document.getElementById('btn-install-pwa').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    } else {
      alert(
        'To install on your OnePlus Nord:\n1. Tap the Chrome menu (⋮) in the top-right corner.\n2. Select "Add to Home screen" or "Install app".'
      );
    }
  });
}

function applyWallpaper() {
  const wpUrl = state.customWallpaper
    ? `url("${state.customWallpaper.replace(/"/g, '\\"')}")`
    : `url('./assets/eyeOfSauron.jpg')`;
  document.documentElement.style.setProperty('--custom-wallpaper', wpUrl);
  document.body.style.backgroundImage = `radial-gradient(circle at 50% 25%, rgba(20, 10, 6, 0.25) 0%, rgba(10, 6, 4, 0.7) 100%), ${wpUrl}`;
}

// Register Service Worker & Initialize App
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  applyWallpaper();
  initMiddleEarthMap();
  setupEventListeners();
  renderAllViews(false);

  if (state.gmapsApiKey) {
    document.getElementById('input-gmaps-api-key').value = state.gmapsApiKey;
    activateNativeGoogleMapsEngine(state.gmapsApiKey);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./pwa-sw.js').catch(() => {});
  }
});
