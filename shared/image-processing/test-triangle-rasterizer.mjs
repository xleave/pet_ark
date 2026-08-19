#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rasterizeTexturedTriangles } from './triangle-rasterizer.mjs';

const solidTexture = (red, green, blue) => ({
  width: 2,
  height: 2,
  data: Buffer.from(Array.from({ length: 4 }, () => [red, green, blue, 255]).flat()),
});
const geometry = {
  vertices: new Float64Array([0, 0, 3, 0, 0, 3]),
  uvs: new Float64Array([0, 0, 1, 0, 0, 1]),
  triangles: new Uint16Array([0, 1, 2]),
};
const red = { ...geometry, texture: solidTexture(255, 0, 0), opacity: 1 };
const halfBlue = { ...geometry, texture: solidTexture(0, 0, 255), opacity: 0.5 };

const result = rasterizeTexturedTriangles({
  width: 4,
  height: 4,
  layers: [red, halfBlue],
  sampleGrid: 1,
});
assert.equal(result.data.length, 4 * 4 * 4, 'output has RGBA dimensions');
assert.equal(result.renderedTriangles, 2, 'both draw-ordered triangles rendered');
assert.deepEqual([...result.data.subarray(0, 4)], [128, 0, 128, 255], 'opacity uses source-over');

const reversed = rasterizeTexturedTriangles({
  width: 4,
  height: 4,
  layers: [halfBlue, red],
  sampleGrid: 1,
});
assert.deepEqual([...reversed.data.subarray(0, 4)], [255, 0, 0, 255], 'layer order changes composition');

const transparent = result.data.subarray((3 * 4 + 3) * 4, (3 * 4 + 3) * 4 + 4);
assert.deepEqual([...transparent], [0, 0, 0, 0], 'transparent pixels have zero hidden RGB');

const opacityOnly = rasterizeTexturedTriangles({
  width: 4,
  height: 4,
  layers: [{ ...red, opacity: 0.5 }],
  sampleGrid: 1,
});
assert.deepEqual([...opacityOnly.data.subarray(0, 4)], [255, 0, 0, 128], 'layer opacity preserves color');

const tinted = rasterizeTexturedTriangles({
  width: 1,
  height: 1,
  layers: [{ ...red, tint: [0.5, 0.25, 1] }],
  sampleGrid: 1,
});
assert.deepEqual([...tinted.data.subarray(0, 4)], [128, 0, 0, 255], 'light tint multiplies texture RGB');

const twoColor = rasterizeTexturedTriangles({
  width: 1,
  height: 1,
  layers: [{ ...geometry, texture: solidTexture(128, 128, 128), darkTint: [0.25, 0, 0] }],
  sampleGrid: 1,
});
assert.deepEqual([...twoColor.data.subarray(0, 4)], [160, 128, 128, 255], 'dark tint colors dark texels');

console.log('Triangle rasterizer tests passed: dimensions, hidden RGB, draw order, opacity, tint');
