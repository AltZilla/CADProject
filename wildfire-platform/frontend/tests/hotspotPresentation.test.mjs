import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDetectionCount,
  getHotspotDisplayKind,
  getHotspotFrp,
} from '../src/utils/hotspotPresentation.js';

test('individual detections are distinguished from pre-aggregated API features', () => {
  assert.equal(getHotspotDisplayKind({ hotspot_id: 'fire-1' }), 'detection');
  assert.equal(getHotspotDisplayKind({ clustered: true, count: 23 }), 'aggregate');
});

test('aggregate detection count is used as the density weight', () => {
  assert.equal(getDetectionCount({ count: 23 }), 23);
  assert.equal(getDetectionCount({ detection_count: 8 }), 8);
  assert.equal(getDetectionCount({ point_count: 6 }), 6);
  assert.equal(getDetectionCount({ clustered: true }), 1);
  assert.equal(getDetectionCount({ count: -4 }), 1);
  assert.equal(getDetectionCount({ count: 'invalid' }), 1);
});

test('FRP summary prefers total aggregate FRP and otherwise uses point FRP', () => {
  assert.equal(getHotspotFrp({ clustered: true, total_frp: 42, frp: 99 }), 42);
  assert.equal(getHotspotFrp({ frp: 7.5 }), 7.5);
  assert.equal(getHotspotFrp({}), 0);
});
