import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MAP_PROJECTION, getProjectionSpecification } from '../src/components/Map/mapProjection.js';

test('map defaults to a globe projection', () => {
  assert.equal(DEFAULT_MAP_PROJECTION, 'globe');
});

test('projection choices map to MapLibre projection specifications', () => {
  assert.deepEqual(getProjectionSpecification('globe'), { type: 'globe' });
  assert.deepEqual(getProjectionSpecification('mercator'), { type: 'mercator' });
});
