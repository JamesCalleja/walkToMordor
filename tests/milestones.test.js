import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_KM,
  DEFAULT_REAL_WORLD_START,
  MILESTONES,
  LANDMARKS
} from '../public/data/milestones.js';

describe('Canonical Middle-earth Waypoints & Landmarks Data', () => {
  it('defines canonical total distance of 2,863 km from Bag End to Mount Doom', () => {
    assert.equal(TOTAL_KM, 2863);
  });

  it('contains all 33 canonical waypoints in sequential order', () => {
    assert.equal(MILESTONES.length, 33);
    MILESTONES.forEach((ms, i) => {
      assert.equal(ms.index, i + 1, `Expected waypoint at array index ${i} to have index=${i + 1}`);
    });
  });

  it('starts at Bag End (0 km) and ends at Mount Doom / Sammath Naur (2,863 km)', () => {
    const start = MILESTONES[0];
    const finish = MILESTONES[MILESTONES.length - 1];

    assert.equal(start.id, 'bag-end');
    assert.equal(start.km, 0);
    assert.match(start.name, /Bag End/);

    assert.equal(finish.id, 'mount-doom');
    assert.equal(finish.km, TOTAL_KM);
    assert.match(finish.name, /Mount Doom/);
  });

  it('has strictly increasing kilometer distances across all 33 waypoints', () => {
    for (let i = 1; i < MILESTONES.length; i++) {
      assert.ok(
        MILESTONES[i].km > MILESTONES[i - 1].km,
        `Waypoint #${MILESTONES[i].index} (${MILESTONES[i].km} km) must be greater than Waypoint #${MILESTONES[i - 1].index} (${MILESTONES[i - 1].km} km)`
      );
    }
  });

  it('has unique IDs, complete lore metadata, and valid map bounds [0..1000, 0..1778] for every waypoint', () => {
    const ids = new Set();
    for (const ms of MILESTONES) {
      assert.ok(ms.id && typeof ms.id === 'string');
      assert.ok(!ids.has(ms.id), `Duplicate waypoint id: ${ms.id}`);
      ids.add(ms.id);

      assert.ok(ms.name && ms.name.length > 0);
      assert.ok(ms.region && ms.region.length > 0);
      assert.ok(ms.shireDate && ms.shireDate.length > 0);
      assert.ok(ms.badge && ms.badge.length > 0);
      assert.ok(ms.quote && ms.quote.length > 0);
      assert.ok(ms.description && ms.description.length > 0);

      assert.ok(Array.isArray(ms.coords) && ms.coords.length === 2);
      const [y, x] = ms.coords;
      assert.ok(y >= 0 && y <= 1000, `Waypoint ${ms.id} Y coord ${y} out of bounds [0, 1000]`);
      assert.ok(x >= 0 && x <= 1778, `Waypoint ${ms.id} X coord ${x} out of bounds [0, 1778]`);
    }
  });

  it('defines valid Middle-earth decorative landmarks and default real-world start coordinates', () => {
    assert.ok(Array.isArray(LANDMARKS) && LANDMARKS.length > 0);
    for (const lm of LANDMARKS) {
      assert.ok(lm.name && lm.icon && lm.desc);
      assert.ok(Array.isArray(lm.coords) && lm.coords.length === 2);
      assert.ok(lm.coords[0] >= 0 && lm.coords[0] <= 1000);
      assert.ok(lm.coords[1] >= 0 && lm.coords[1] <= 1778);
    }

    assert.equal(typeof DEFAULT_REAL_WORLD_START.lat, 'number');
    assert.equal(typeof DEFAULT_REAL_WORLD_START.lng, 'number');
    assert.ok(Math.abs(DEFAULT_REAL_WORLD_START.lat) <= 90);
    assert.ok(Math.abs(DEFAULT_REAL_WORLD_START.lng) <= 180);
  });
});
