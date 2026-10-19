import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  state,
  loadState,
  saveState,
  getTotalKmWalked,
  addWalkLog,
  extractTimelineWalksForDate,
  importTimelineWalksToQuest,
  pollGoogleDailyWalks,
  parseGoogleMapsUrl,
  getPlottedKm,
  clearPlottedRoute,
  switchTab,
  initApp
} from '../public/app.js';

/**
 * Lightweight DOM + Leaflet + localStorage test harness that faithfully models
 * index.html elements and throws Leaflet's exact NaN error if flyTo/flyToBounds
 * is ever called when the map container is hidden or 0x0.
 */
function setupDomAndMocks() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  const elementsById = new Map();
  const allElements = [];

  function createElement(tag, id = '', classes = [], attrs = {}) {
    const classSet = new Set(classes);
    const attrMap = new Map(Object.entries(attrs));
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      id,
      textContent: '',
      value: attrs.value ?? '',
      step: id === 'input-walk-amount' ? '0.01' : (attrs.step ?? ''),
      min: id === 'input-walk-amount' ? '0.01' : (attrs.min ?? ''),
      max: id === 'input-walk-amount' ? '1000' : (attrs.max ?? ''),
      placeholder: attrs.placeholder ?? '',
      disabled: false,
      style: {
        width: '',
        backgroundImage: '',
        setProperty: () => {}
      },
      // Default visible size for #middle-earth-map when #tab-map is active
      clientWidth: id === 'middle-earth-map' ? 400 : 360,
      clientHeight: id === 'middle-earth-map' ? 700 : 640,
      classList: {
        add: (...cls) => {
          cls.forEach((c) => classSet.add(c));
          syncVisibility();
        },
        remove: (...cls) => {
          cls.forEach((c) => classSet.delete(c));
          syncVisibility();
        },
        toggle: (c, force) => {
          const next = force !== undefined ? Boolean(force) : !classSet.has(c);
          if (next) classSet.add(c);
          else classSet.delete(c);
          syncVisibility();
          return next;
        },
        contains: (c) => classSet.has(c)
      },
      getAttribute: (name) => attrMap.get(name) ?? null,
      setAttribute: (name, val) => attrMap.set(name, String(val)),
      hasAttribute: (name) => attrMap.has(name),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent: (event) => {
        const list = listeners.get(event.type) || [];
        for (const fn of list) {
          fn({
            ...event,
            currentTarget: el,
            target: event.target || el,
            preventDefault: event.preventDefault || (() => {})
          });
        }
      },
      click: () => {
        el.dispatchEvent({ type: 'click', preventDefault: () => {} });
      },
      querySelectorAll: (selector) => queryList(el._children || [], selector),
      _children: []
    };

    let _innerHTML = '';
    Object.defineProperty(el, 'innerHTML', {
      get: () => _innerHTML,
      set: (html) => {
        _innerHTML = String(html);
        el._children = parseDynamicChildren(_innerHTML);
      }
    });

    if (id) elementsById.set(id, el);
    allElements.push(el);
    return el;
  }

  function parseDynamicChildren(html) {
    const children = [];
    const wpRegex = /class="waypoint-card([^"]*)"\s+data-wp-id="([^"]+)"/g;
    let m;
    while ((m = wpRegex.exec(html)) !== null) {
      const classes = ['waypoint-card', ...m[1].trim().split(/\s+/).filter(Boolean)];
      children.push(createElement('div', '', classes, { 'data-wp-id': m[2] }));
    }
    const delRegex = /class="btn-delete-entry"\s+data-del-id="([^"]+)"/g;
    while ((m = delRegex.exec(html)) !== null) {
      children.push(createElement('button', '', ['btn-delete-entry'], { 'data-del-id': m[1] }));
    }
    return children;
  }

  function matchesSelector(el, selector) {
    if (selector.startsWith('#')) {
      return el.id === selector.slice(1);
    }
    if (selector === '.filter-chip.active') {
      return el.classList.contains('filter-chip') && el.classList.contains('active');
    }
    const navTabMatch = selector.match(/^\.nav-item\[data-tab="([^"]+)"\]$/);
    if (navTabMatch) {
      return el.classList.contains('nav-item') && el.getAttribute('data-tab') === navTabMatch[1];
    }
    const attrOnlyMatch = selector.match(/^\[([a-z-]+)="([^"]+)"\]$/);
    if (attrOnlyMatch) {
      return el.getAttribute(attrOnlyMatch[1]) === attrOnlyMatch[2];
    }
    if (selector.startsWith('.')) {
      return el.classList.contains(selector.slice(1));
    }
    return false;
  }

  function queryList(list, selector) {
    return list.filter((el) => matchesSelector(el, selector));
  }

  // Create all DOM elements required by public/app.js
  const tabMap = createElement('section', 'tab-map', ['tab-panel', 'active']);
  const tabWalk = createElement('section', 'tab-walk', ['tab-panel']);
  const tabWaypoints = createElement('section', 'tab-waypoints', ['tab-panel']);
  const tabJournal = createElement('section', 'tab-journal', ['tab-panel']);

  const meMapCanvas = createElement('div', 'middle-earth-map', ['map-canvas']);
  const gmapsCanvas = createElement('div', 'gmaps-middle-earth', ['map-canvas', 'hidden']);

  function syncVisibility() {
    // When #tab-map is not active or #middle-earth-map has .hidden, its layout dimensions are 0x0
    const mapVisible = tabMap.classList.contains('active') && !meMapCanvas.classList.contains('hidden');
    meMapCanvas.clientWidth = mapVisible ? 400 : 0;
    meMapCanvas.clientHeight = mapVisible ? 700 : 0;
  }

  [
    'hud-region-label',
    'hud-distance-val',
    'hud-percent-val',
    'hud-quick-stats',
    'btn-locate-frodo',
    'btn-fit-quest',
    'btn-toggle-labels',
    'btn-preview-scrubber',
    'scrubber-bar',
    'btn-close-scrubber',
    'quest-scrubber-input',
    'scrubber-live-label',
    'quest-bottom-card',
    'quest-card-toggle',
    'current-stage-badge',
    'stage-status-tag',
    'stage-shire-date',
    'current-stage-name',
    'next-stage-summary',
    'btn-quick-log-open',
    'leg-progress-label',
    'leg-progress-pct',
    'leg-progress-bar',
    'total-progress-readout',
    'total-progress-bar',
    'stage-lore-drawer',
    'current-stage-quote',
    'current-stage-desc',
    'real-world-map',
    'gps-status-pill',
    'btn-open-native-gmaps',
    'live-walk-dist',
    'live-walk-steps',
    'live-walk-time',
    'btn-start-gps',
    'btn-clear-route',
    'btn-save-map-walk',
    'form-manual-walk',
    'label-walk-amount',
    'input-walk-amount',
    'conversion-preview',
    'input-walk-date',
    'input-walk-note',
    'input-timeline-date',
    'input-google-client-id',
    'btn-poll-google-timeline',
    'input-timeline-file',
    'input-gmaps-url',
    'btn-launch-gmaps-directions',
    'btn-parse-gmaps-url',
    'gmaps-parse-feedback',
    'input-gmaps-api-key',
    'btn-save-gmaps-key',
    'btn-clear-gmaps-key',
    'waypoints-timeline',
    'stat-total-dist',
    'stat-rem-dist',
    'stat-waypoints-count',
    'stat-sessions-count',
    'input-steps-per-km',
    'btn-install-pwa',
    'input-wallpaper-file',
    'btn-wallpaper-url',
    'btn-wallpaper-reset',
    'btn-export-data',
    'input-import-data',
    'btn-reset-demo',
    'journal-entries-list',
    'milestone-modal',
    'modal-badge',
    'modal-eyebrow',
    'modal-title',
    'modal-meta',
    'modal-quote',
    'modal-desc',
    'btn-modal-view-map',
    'btn-modal-close'
  ].forEach((id) => createElement('div', id, id === 'milestone-modal' || id === 'scrubber-bar' || id === 'gmaps-parse-feedback' ? ['hidden'] : []));

  createElement('div', '', ['current-stage-info']);

  // Bottom nav items
  ['tab-map', 'tab-walk', 'tab-waypoints', 'tab-journal'].forEach((t, i) =>
    createElement('button', '', i === 0 ? ['nav-item', 'active'] : ['nav-item'], { 'data-tab': t })
  );

  // Walk mode segmented buttons & boxes
  ['gps', 'manual', 'gmaps'].forEach((mode, i) => {
    createElement('button', '', i === 0 ? ['seg-btn', 'active'] : ['seg-btn'], { 'data-walk-mode': mode });
    createElement('div', `walk-mode-${mode}`, i === 0 ? ['walk-mode-box', 'active'] : ['walk-mode-box']);
  });

  // Unit pills
  createElement('button', '', ['unit-pill', 'active'], { 'data-entry-type': 'km' });
  createElement('button', '', ['unit-pill'], { 'data-entry-type': 'steps' });

  // Preset chips
  ['1', '3', '5', '10'].forEach((km) => createElement('button', '', ['chip-btn'], { 'data-add-km': km }));
  ['5000', '10000'].forEach((steps) => createElement('button', '', ['chip-btn'], { 'data-add-steps': steps }));

  // Waypoint filter chips
  ['all', 'unlocked', 'upcoming'].forEach((f, i) =>
    createElement('button', '', i === 0 ? ['filter-chip', 'active'] : ['filter-chip'], { 'data-filter': f })
  );

  // Track Leaflet map calls & simulate Leaflet's exact 0x0 size NaN crash in flyTo
  const mapCalls = {
    flyTo: [],
    flyToBounds: [],
    invalidateSize: 0
  };

  globalThis.L = {
    CRS: { Simple: {} },
    map: (containerId) => {
      const containerEl = elementsById.get(containerId);
      let cachedSize = {
        x: containerEl?.clientWidth || 0,
        y: containerEl?.clientHeight || 0
      };
      return {
        setMaxBounds: () => {},
        fitBounds: () => {},
        removeLayer: () => {},
        setView: () => {},
        panTo: () => {},
        on: () => {},
        invalidateSize: () => {
          mapCalls.invalidateSize += 1;
          cachedSize = {
            x: containerEl?.clientWidth || 0,
            y: containerEl?.clientHeight || 0
          };
        },
        flyTo: (coords, zoom, opts) => {
          const w = containerEl?.clientWidth ?? cachedSize.x;
          const h = containerEl?.clientHeight ?? cachedSize.y;
          if (w === 0 || h === 0) {
            throw new Error('Invalid LatLng object: (NaN, NaN)');
          }
          mapCalls.flyTo.push({ coords, zoom, opts });
        },
        flyToBounds: (bounds, opts) => {
          const w = containerEl?.clientWidth ?? cachedSize.x;
          const h = containerEl?.clientHeight ?? cachedSize.y;
          if (w === 0 || h === 0) {
            throw new Error('Invalid LatLng object: (NaN, NaN)');
          }
          mapCalls.flyToBounds.push({ bounds, opts });
        }
      };
    },
    imageOverlay: () => ({ addTo: () => ({}) }),
    tileLayer: () => ({ addTo: () => ({}) }),
    polyline: () => ({
      addTo: function () {
        return this;
      },
      setLatLngs: () => {}
    }),
    divIcon: (opts) => opts,
    marker: (coords) => ({
      coords,
      addTo: function () {
        return this;
      },
      bindPopup: function () {
        return this;
      },
      setLatLng: function (c) {
        this.coords = c;
      },
      setIcon: () => {},
      openPopup: () => {}
    }),
    circleMarker: () => ({ addTo: () => ({}) })
  };

  globalThis.document = {
    getElementById: (id) => elementsById.get(id) ?? null,
    querySelector: (sel) => queryList(allElements, sel)[0] ?? null,
    querySelectorAll: (sel) => queryList(allElements, sel),
    documentElement: { style: { setProperty: () => {} } },
    body: { style: { backgroundImage: '' } },
    head: { appendChild: () => {} },
    createElement: (tag) => createElement(tag)
  };

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    open: () => {}
  };

  globalThis.confirm = () => true;
  globalThis.alert = () => {};

  return { elementsById, mapCalls, storage };
}

describe('Walk to Mordor App Integration & Issue #3 Regression Suite', () => {
  let env;

  beforeEach(() => {
    env = setupDomAndMocks();
    state.stepsPerKm = 1312;
    state.gmapsApiKey = '';
    state.googleAuthToken = '';
    state.customWallpaper = '';
    state.syncedTimelineIds = [];
    state.logs = [];
    initApp();
  });

  it('starts at Day 1 (0.0 km, Bag End) by default and filters out legacy starter-1 logs', () => {
    assert.equal(getTotalKmWalked(), 0);
    assert.equal(env.elementsById.get('hud-distance-val').textContent, '0.0 km');
    assert.equal(env.elementsById.get('current-stage-name').textContent, 'Bag End, Hobbiton');

    // Simulate legacy starter-1 log in localStorage
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        logs: [
          { id: 'starter-1', date: '2026-10-19', km: 23.5, note: 'Legacy starter' },
          { id: 'walk-100', date: '2026-10-19', km: 5.5, note: 'Real walk' }
        ]
      })
    );
    loadState();
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].id, 'walk-100');
    assert.equal(getTotalKmWalked(), 5.5);
  });

  it('Regression #3: submitting Quick Log (11 km) from #tab-walk immediately updates distance, HUD, and Journal without throwing', () => {
    // 1. Navigate to Log / GMaps tab (#tab-walk) -> Quick Log mode
    switchTab('tab-walk');
    document.querySelector('[data-walk-mode="manual"]').click();

    // Verify #tab-map is hidden (0x0 dimensions on #middle-earth-map)
    const meCanvas = env.elementsById.get('middle-earth-map');
    assert.equal(meCanvas.clientWidth, 0);
    assert.equal(meCanvas.clientHeight, 0);

    // 2. Enter 11 km and submit #form-manual-walk
    const amountInput = env.elementsById.get('input-walk-amount');
    const noteInput = env.elementsById.get('input-walk-note');
    amountInput.value = '11';
    amountInput.dispatchEvent({ type: 'input' });
    assert.match(env.elementsById.get('conversion-preview').textContent, /11\.00 km/);

    noteInput.value = 'Morning Shire walk';
    env.elementsById.get('form-manual-walk').dispatchEvent({
      type: 'submit',
      preventDefault: () => {}
    });

    // 3. Verify 11 km is immediately added to total distance, HUD, quest card, and Journal
    assert.equal(getTotalKmWalked(), 11);
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].km, 11);
    assert.equal(state.logs[0].note, 'Morning Shire walk');

    assert.equal(env.elementsById.get('hud-distance-val').textContent, '11.0 km');
    assert.equal(env.elementsById.get('total-progress-readout').textContent, '11.0 km / 2,863 km');
    assert.equal(env.elementsById.get('stat-total-dist').textContent, '11.0 km');
    assert.equal(env.elementsById.get('stat-sessions-count').textContent, '1');
    assert.match(env.elementsById.get('journal-entries-list').innerHTML, /\+11\.00 km/);

    // 4. Verify form inputs were cleared and tab switched back to #tab-map
    assert.equal(amountInput.value, '');
    assert.equal(noteInput.value, '');
    assert.ok(env.elementsById.get('tab-map').classList.contains('active'));
  });

  it('Regression #3: addWalkLog does not throw even when #middle-earth-map is .hidden (Google Maps engine active)', () => {
    const meCanvas = env.elementsById.get('middle-earth-map');
    meCanvas.classList.add('hidden');
    assert.equal(meCanvas.clientWidth, 0);

    assert.doesNotThrow(() => {
      addWalkLog(11, '2026-10-19', 'Walk with native GMaps active');
    });

    assert.equal(getTotalKmWalked(), 11);
    assert.equal(env.elementsById.get('hud-distance-val').textContent, '11.0 km');
    assert.equal(env.elementsById.get('stat-total-dist').textContent, '11.0 km');
  });

  it('converts Pedometer Steps to kilometers using stepsPerKm and supports preset chips', () => {
    switchTab('tab-walk');
    document.querySelector('[data-walk-mode="manual"]').click();

    // Click the "10,000 steps" preset chip
    const stepsChip = document.querySelector('[data-add-steps="10000"]');
    stepsChip.click();

    const amountInput = env.elementsById.get('input-walk-amount');
    assert.equal(amountInput.value, '10000');

    env.elementsById.get('form-manual-walk').dispatchEvent({
      type: 'submit',
      preventDefault: () => {}
    });

    const expectedKm = Math.round((10000 / 1312) * 100) / 100;
    assert.equal(getTotalKmWalked(), expectedKm);
    assert.equal(state.logs.length, 1);
  });

  it('Regression #10: Pedometer Step Count updates min=1, max=30000, step=1 so integers 1..30000 pass HTML5 validation and log cleanly', () => {
    switchTab('tab-walk');
    document.querySelector('[data-walk-mode="manual"]').click();

    const amountInput = env.elementsById.get('input-walk-amount');
    // Initially in Kilometers mode
    assert.equal(amountInput.min, '0.01');
    assert.equal(amountInput.max, '1000');
    assert.equal(amountInput.step, '0.01');

    // Switch to Pedometer Step Count mode
    document.querySelector('[data-entry-type="steps"]').click();
    assert.equal(amountInput.min, '1');
    assert.equal(amountInput.max, '30000');
    assert.equal(amountInput.step, '1');

    // Verify HTML5 number input step/range constraints for standard integer step counts (1, 500, 8500, 30000)
    for (const testSteps of [1, 500, 8500, 30000]) {
      const minNum = Number(amountInput.min);
      const maxNum = Number(amountInput.max);
      const stepNum = Number(amountInput.step);
      assert.ok(testSteps >= minNum && testSteps <= maxNum, `${testSteps} should be within [${minNum}, ${maxNum}]`);
      assert.equal((testSteps - minNum) % stepNum, 0, `${testSteps} should not trigger HTML5 stepMismatch`);
    }

    // Verify logging 1 step (minimum boundary) records a positive distance
    amountInput.value = '1';
    env.elementsById.get('form-manual-walk').dispatchEvent({
      type: 'submit',
      preventDefault: () => {}
    });
    assert.equal(state.logs.length, 1);
    assert.ok(getTotalKmWalked() > 0);

    // Verify logging 30,000 steps (maximum boundary) records ~22.87 km
    switchTab('tab-walk');
    amountInput.value = '30000';
    env.elementsById.get('form-manual-walk').dispatchEvent({
      type: 'submit',
      preventDefault: () => {}
    });
    assert.equal(state.logs.length, 2);
    assert.ok(getTotalKmWalked() > 22.8);

    // Switching back to Kilometers mode restores km constraints
    document.querySelector('[data-entry-type="km"]').click();
    assert.equal(amountInput.min, '0.01');
    assert.equal(amountInput.max, '1000');
    assert.equal(amountInput.step, '0.01');
  });

  it('triggers the Milestone Unlocked modal when a logged walk crosses a new waypoint', () => {
    const modal = env.elementsById.get('milestone-modal');
    assert.ok(modal.classList.contains('hidden'));

    // Log 25 km (crosses Waypoint #2: Three-Farthing Stone at 23 km)
    addWalkLog(25, '2026-10-19', 'Crossed Three-Farthing Stone');

    assert.ok(!modal.classList.contains('hidden'));
    assert.equal(env.elementsById.get('modal-title').textContent, 'Three-Farthing Stone');
  });

  it('deletes individual journal entries and resets all walks cleanly', () => {
    addWalkLog(10, '2026-10-19', 'Walk 1');
    addWalkLog(15, '2026-10-19', 'Walk 2');
    assert.equal(getTotalKmWalked(), 25);
    assert.equal(state.logs.length, 2);

    // Delete the first entry via its rendered Delete button
    const deleteBtns = env.elementsById.get('journal-entries-list').querySelectorAll('.btn-delete-entry');
    assert.equal(deleteBtns.length, 2);
    deleteBtns[0].click();

    assert.equal(state.logs.length, 1);
    assert.equal(getTotalKmWalked(), 10);
    assert.equal(env.elementsById.get('hud-distance-val').textContent, '10.0 km');

    // Reset all walks
    env.elementsById.get('btn-reset-demo').click();
    assert.equal(state.logs.length, 0);
    assert.equal(getTotalKmWalked(), 0);
    assert.equal(env.elementsById.get('hud-distance-val').textContent, '0.0 km');
  });

  it('parses Google Maps direction URLs into plotted route coordinates and logs mapped walks', () => {
    clearPlottedRoute();
    assert.equal(getPlottedKm(), 0);

    parseGoogleMapsUrl('https://www.google.com/maps/dir/51.7520,-1.2577/51.7620,-1.2577');
    const plottedKm = getPlottedKm();
    assert.ok(plottedKm > 1.0 && plottedKm < 1.2, `Expected ~1.11 km, got ${plottedKm}`);

    // Save the plotted map walk to the quest
    env.elementsById.get('btn-save-map-walk').click();
    assert.equal(state.logs.length, 1);
    assert.ok(getTotalKmWalked() > 1.0);
    assert.equal(getPlottedKm(), 0);
    assert.ok(env.elementsById.get('tab-map').classList.contains('active'));
  });

  it('Issue #7: extracts daily walking travel from Google Maps Timeline (semanticSegments & timelineObjects), logs to Fellowship Quest, and deduplicates repeat imports', () => {
    const timelineJson = {
      semanticSegments: [
        {
          startTime: '2026-10-19T08:15:00.000Z',
          endTime: '2026-10-19T08:50:00.000Z',
          activity: {
            topCandidate: { type: 'WALKING' },
            distanceMeters: 3250
          },
          timelinePath: [
            { point: '51.7520°, -1.2577°' },
            { point: '51.7620°, -1.2577°' }
          ]
        },
        {
          startTime: '2026-10-19T12:00:00.000Z',
          endTime: '2026-10-19T12:30:00.000Z',
          activity: {
            topCandidate: { type: 'IN_PASSENGER_VEHICLE' },
            distanceMeters: 15000
          }
        },
        {
          startTime: '2026-10-19T17:10:00.000Z',
          endTime: '2026-10-19T17:45:00.000Z',
          activity: {
            topCandidate: { type: 'HIKING' },
            distanceMeters: 2750
          }
        },
        {
          startTime: '2026-10-18T09:00:00.000Z',
          endTime: '2026-10-18T09:30:00.000Z',
          activity: {
            topCandidate: { type: 'WALKING' },
            distanceMeters: 4000
          }
        }
      ],
      timelineObjects: [
        {
          activitySegment: {
            duration: {
              startTimestamp: '2026-10-19T19:00:00.000Z',
              endTimestamp: '2026-10-19T19:20:00.000Z'
            },
            activityType: 'ON_FOOT',
            distance: 1500
          }
        }
      ]
    };

    const extracted = extractTimelineWalksForDate(timelineJson, '2026-10-19');
    assert.equal(extracted.segments.length, 3);
    assert.equal(extracted.totalKm, 7.5);

    // Import into Fellowship Quest log
    const res1 = importTimelineWalksToQuest(timelineJson, '2026-10-19');
    assert.equal(res1.addedKm, 7.5);
    assert.equal(res1.segmentsCount, 3);
    assert.equal(res1.skippedCount, 0);
    assert.equal(getTotalKmWalked(), 7.5);
    assert.equal(state.logs.length, 1);
    assert.match(state.logs[0].note, /Google Maps Timeline \(3 walks\)/);

    // Re-importing the exact same day's Timeline data skips already-synced walks
    const res2 = importTimelineWalksToQuest(timelineJson, '2026-10-19');
    assert.equal(res2.addedKm, 0);
    assert.equal(res2.segmentsCount, 0);
    assert.equal(res2.skippedCount, 3);
    assert.equal(getTotalKmWalked(), 7.5);
    assert.equal(state.logs.length, 1);
  });

  it('Issue #7: polls daily walking segments from Google Cloud Fitness API, ignores driving, logs walks, and deduplicates', async () => {
    const mockAggregatePayload = {
      bucket: [
        {
          startTimeMillis: '1792396800000',
          endTimeMillis: '1792398600000',
          activity: 7, // Walking
          dataset: [
            { point: [{ value: [{ fpVal: 2400 }] }] },
            { point: [{ value: [{ intVal: 3100 }] }] }
          ]
        },
        {
          startTimeMillis: '1792400000000',
          endTimeMillis: '1792403600000',
          activity: 1, // In vehicle (should be ignored)
          dataset: [{ point: [{ value: [{ fpVal: 25000 }] }] }]
        },
        {
          startTimeMillis: '1792410000000',
          endTimeMillis: '1792413600000',
          activity: 35, // Hiking
          dataset: [{ point: [{ value: [{ fpVal: 3600 }] }] }]
        }
      ]
    };

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockAggregatePayload
    });

    const poll1 = await pollGoogleDailyWalks({
      accessToken: 'ya29.mock-token',
      targetDateStr: '2026-10-19',
      fetchImpl: mockFetch
    });

    assert.equal(poll1.segmentsCount, 2);
    assert.equal(poll1.addedKm, 6);
    assert.equal(poll1.skippedCount, 0);
    assert.equal(getTotalKmWalked(), 6);
    assert.equal(state.logs.length, 1);
    assert.match(state.logs[0].note, /Google Timeline Poll \(2 walks\)/);

    // Polling again on the same day skips already-logged segments
    const poll2 = await pollGoogleDailyWalks({
      accessToken: 'ya29.mock-token',
      targetDateStr: '2026-10-19',
      fetchImpl: mockFetch
    });
    assert.equal(poll2.addedKm, 0);
    assert.equal(poll2.segmentsCount, 0);
    assert.equal(poll2.skippedCount, 2);
    assert.equal(getTotalKmWalked(), 6);
  });

  it('Issue #7: automatically triggers 1-tap Google Sign-In via app GOOGLE_CLIENT_ID without requiring end-user token setup', async () => {
    state.googleAuthToken = '';
    state.googleTokenExpiry = 0;

    // Simulate Google Identity Services (`window.google.accounts.oauth2.initTokenClient`)
    let requestedClientId = null;
    globalThis.window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => {
            requestedClientId = cfg.client_id;
            return {
              requestAccessToken: () => {
                cfg.callback({ access_token: 'ya29.auto-popup-token', expires_in: 3600 });
              }
            };
          }
        }
      }
    };

    const mockFetch = async (_url, opts) => {
      assert.equal(opts.headers.Authorization, 'Bearer ya29.auto-popup-token');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          bucket: [
            {
              startTimeMillis: '1792450000000',
              endTimeMillis: '1792453600000',
              activity: 7,
              dataset: [{ point: [{ value: [{ fpVal: 4200 }] }] }]
            }
          ]
        })
      };
    };

    const res = await pollGoogleDailyWalks({
      clientId: '123456789-fellowship.apps.googleusercontent.com',
      targetDateStr: '2026-10-19',
      fetchImpl: mockFetch
    });

    assert.equal(requestedClientId, '123456789-fellowship.apps.googleusercontent.com');
    assert.equal(res.addedKm, 4.2);
    assert.equal(res.segmentsCount, 1);
    assert.equal(getTotalKmWalked(), 4.2);
  });
});


