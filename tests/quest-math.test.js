import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, TOTAL_KM } from '../public/data/milestones.js';
import {
  formatDist,
  getQuestProgressData,
  haversineKm,
  toGmapsLatLng
} from '../public/app.js';

describe('Quest Math, Interpolation & Geodesic Calculations', () => {
  describe('formatDist()', () => {
    it('formats kilometer numbers with specified decimal places', () => {
      assert.equal(formatDist(0), '0.0 km');
      assert.equal(formatDist(11, 1), '11.0 km');
      assert.equal(formatDist(23.456, 2), '23.46 km');
      assert.equal(formatDist(2863, 0), '2863 km');
      assert.equal(formatDist('15.5', 1), '15.5 km');
    });
  });

  describe('getQuestProgressData()', () => {
    it('returns Day 1 Bag End state at 0 km', () => {
      const prog = getQuestProgressData(0);
      assert.equal(prog.clampedKm, 0);
      assert.equal(prog.totalPercent, 0);
      assert.equal(prog.currentIndex, 0);
      assert.equal(prog.currentMilestone.id, 'bag-end');
      assert.equal(prog.nextMilestone.id, 'three-farthing-stone');
      assert.equal(prog.legFraction, 0);
      assert.equal(prog.legPercent, 0);
      assert.equal(prog.kmToNext, 23);
      assert.deepEqual(prog.frodoCoords, MILESTONES[0].coords);
      assert.equal(prog.walkedCoords.length, 1);
      assert.equal(prog.remainingCoords.length, MILESTONES.length);
    });

    it('clamps negative distances to 0 km', () => {
      const prog = getQuestProgressData(-50);
      assert.equal(prog.clampedKm, 0);
      assert.equal(prog.currentIndex, 0);
      assert.equal(prog.totalPercent, 0);
    });

    it('interpolates exact position and polylines mid-leg (e.g. 11 km toward Three-Farthing Stone)', () => {
      const prog = getQuestProgressData(11);
      assert.equal(prog.clampedKm, 11);
      assert.equal(prog.currentIndex, 0);
      assert.equal(prog.currentMilestone.id, 'bag-end');
      assert.equal(prog.nextMilestone.id, 'three-farthing-stone');
      assert.equal(prog.kmToNext, 12);
      assert.equal(prog.legPercent, Math.round((11 / 23) * 100));

      const [y0, x0] = MILESTONES[0].coords;
      const [y1, x1] = MILESTONES[1].coords;
      const expectedY = y0 + (y1 - y0) * (11 / 23);
      const expectedX = x0 + (x1 - x0) * (11 / 23);
      assert.ok(Math.abs(prog.frodoCoords[0] - expectedY) < 1e-9);
      assert.ok(Math.abs(prog.frodoCoords[1] - expectedX) < 1e-9);

      // Walked polyline has Bag End + Frodo's current interpolated point
      assert.equal(prog.walkedCoords.length, 2);
      assert.deepEqual(prog.walkedCoords[0], MILESTONES[0].coords);
      assert.deepEqual(prog.walkedCoords[1], prog.frodoCoords);

      // Remaining polyline starts at Frodo's position and includes remaining 32 milestones
      assert.equal(prog.remainingCoords.length, 33);
      assert.deepEqual(prog.remainingCoords[0], prog.frodoCoords);
    });

    it('transitions cleanly when landing on an exact milestone distance (737 km — Rivendell)', () => {
      const rivendell = MILESTONES.find((m) => m.id === 'rivendell');
      assert.ok(rivendell);

      const prog = getQuestProgressData(rivendell.km);
      assert.equal(prog.currentMilestone.id, 'rivendell');
      assert.equal(prog.legFraction, 0);
      assert.equal(prog.legPercent, 0);
      assert.deepEqual(prog.frodoCoords, rivendell.coords);
    });

    it('clamps distances at or above 2,863 km to Mount Doom (100% quest complete)', () => {
      const prog = getQuestProgressData(3500);
      assert.equal(prog.clampedKm, TOTAL_KM);
      assert.equal(prog.totalPercent, 100);
      assert.equal(prog.currentIndex, MILESTONES.length - 1);
      assert.equal(prog.currentMilestone.id, 'mount-doom');
      assert.equal(prog.nextMilestone.id, 'mount-doom');
      assert.equal(prog.kmToNext, 0);
      assert.equal(prog.legPercent, 100);
      assert.deepEqual(prog.frodoCoords, MILESTONES[MILESTONES.length - 1].coords);
    });
  });

  describe('haversineKm() & toGmapsLatLng()', () => {
    it('returns 0 km for identical coordinates', () => {
      assert.equal(haversineKm([51.752, -1.2577], [51.752, -1.2577]), 0);
    });

    it('calculates ~111.19 km for 1 degree of latitude along a meridian', () => {
      const d = haversineKm([0, 0], [1, 0]);
      assert.ok(d > 111.0 && d < 111.4, `Expected ~111.19 km, got ${d}`);
    });

    it('is symmetric between two points', () => {
      const a = [51.752, -1.2577];
      const b = [51.5074, -0.1278];
      assert.ok(Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 1e-12);
    });

    it('projects Middle-earth [y, x] map coordinates into Google Maps LatLng space', () => {
      assert.deepEqual(toGmapsLatLng([500, 889]), { lat: 0, lng: 0 });
      const bagEndLatLng = toGmapsLatLng([812, 472]);
      assert.ok(Math.abs(bagEndLatLng.lat - (812 - 500) * 0.02) < 1e-9);
      assert.ok(Math.abs(bagEndLatLng.lng - (472 - 889) * 0.02) < 1e-9);
    });
  });
});
