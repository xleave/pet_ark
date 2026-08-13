const DEFAULT_SAMPLE_GRID = 2;
const MIN_ALPHA = 1 / 510;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sampleBilinear(texture, sourceX, sourceY, result) {
  const fractionalX = sourceX - 0.5;
  const fractionalY = sourceY - 0.5;
  let x0 = Math.floor(fractionalX);
  let y0 = Math.floor(fractionalY);
  const xWeight = fractionalX - x0;
  const yWeight = fractionalY - y0;
  const x1 = clamp(x0 + 1, 0, texture.width - 1);
  const y1 = clamp(y0 + 1, 0, texture.height - 1);
  x0 = clamp(x0, 0, texture.width - 1);
  y0 = clamp(y0, 0, texture.height - 1);

  const topLeft = (y0 * texture.width + x0) * 4;
  const topRight = (y0 * texture.width + x1) * 4;
  const bottomLeft = (y1 * texture.width + x0) * 4;
  const bottomRight = (y1 * texture.width + x1) * 4;
  const topLeftWeight = (1 - xWeight) * (1 - yWeight);
  const topRightWeight = xWeight * (1 - yWeight);
  const bottomLeftWeight = (1 - xWeight) * yWeight;
  const bottomRightWeight = xWeight * yWeight;

  for (let channel = 0; channel < 4; channel++) {
    result[channel] = (
      texture.data[topLeft + channel] * topLeftWeight
      + texture.data[topRight + channel] * topRightWeight
      + texture.data[bottomLeft + channel] * bottomLeftWeight
      + texture.data[bottomRight + channel] * bottomRightWeight
    ) / 255;
  }
}

function validateTexture(texture) {
  if (!Number.isInteger(texture?.width) || texture.width < 1) {
    throw new Error('Triangle texture width must be a positive integer');
  }
  if (!Number.isInteger(texture?.height) || texture.height < 1) {
    throw new Error('Triangle texture height must be a positive integer');
  }
  if (!texture.data || texture.data.length !== texture.width * texture.height * 4) {
    throw new Error('Triangle texture must contain width × height × 4 RGBA bytes');
  }
}

function validateInput(width, height, layers, sampleGrid) {
  if (!Number.isInteger(width) || width < 1) throw new Error('Raster width must be a positive integer');
  if (!Number.isInteger(height) || height < 1) throw new Error('Raster height must be a positive integer');
  if (!Array.isArray(layers)) throw new Error('Raster layers must be an array');
  if (!Number.isInteger(sampleGrid) || sampleGrid < 1 || sampleGrid > 4) {
    throw new Error('Raster sampleGrid must be an integer from 1 to 4');
  }
  for (const layer of layers) validateTexture(layer.texture);
}

/**
 * Rasterizes draw-ordered Spine-style textured triangles to transparent RGBA.
 * Vertices are canvas pixels and UVs are normalized texture coordinates.
 */
export function rasterizeTexturedTriangles({
  width,
  height,
  layers,
  sampleGrid = DEFAULT_SAMPLE_GRID,
}) {
  validateInput(width, height, layers, sampleGrid);
  const samplesPerPixel = sampleGrid * sampleGrid;
  const sampleOffsets = Array.from(
    { length: sampleGrid },
    (_, index) => (index + 0.5) / sampleGrid,
  );
  const premultiplied = new Float32Array(width * height * samplesPerPixel * 4);
  const texel = new Float64Array(4);
  let renderedTriangles = 0;

  for (const layer of layers) {
    const { vertices, uvs, triangles, texture } = layer;
    const opacity = clamp(Number.isFinite(layer.opacity) ? layer.opacity : 1, 0, 1);
    if (!vertices || !uvs || !triangles || opacity === 0) continue;

    for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 3) {
      const vertex0 = triangles[triangleIndex];
      const vertex1 = triangles[triangleIndex + 1];
      const vertex2 = triangles[triangleIndex + 2];
      if (![vertex0, vertex1, vertex2].every(Number.isInteger)) continue;

      const x0 = vertices[vertex0 * 2];
      const y0 = vertices[vertex0 * 2 + 1];
      const x1 = vertices[vertex1 * 2];
      const y1 = vertices[vertex1 * 2 + 1];
      const x2 = vertices[vertex2 * 2];
      const y2 = vertices[vertex2 * 2 + 1];
      if (![x0, y0, x1, y1, x2, y2].every(Number.isFinite)) continue;

      const denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 0.0000001) continue;
      const inverseDenominator = 1 / denominator;
      const minimumX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1));
      const maximumX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
      const minimumY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1));
      const maximumY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
      if (minimumX > maximumX || minimumY > maximumY) continue;

      const sourceU0 = uvs[vertex0 * 2] * texture.width;
      const sourceV0 = uvs[vertex0 * 2 + 1] * texture.height;
      const sourceU1 = uvs[vertex1 * 2] * texture.width;
      const sourceV1 = uvs[vertex1 * 2 + 1] * texture.height;
      const sourceU2 = uvs[vertex2 * 2] * texture.width;
      const sourceV2 = uvs[vertex2 * 2 + 1] * texture.height;
      if (![sourceU0, sourceV0, sourceU1, sourceV1, sourceU2, sourceV2].every(Number.isFinite)) continue;
      renderedTriangles++;

      for (let destinationY = minimumY; destinationY <= maximumY; destinationY++) {
        for (let destinationX = minimumX; destinationX <= maximumX; destinationX++) {
          for (let sampleY = 0; sampleY < sampleGrid; sampleY++) {
            const pixelY = destinationY + sampleOffsets[sampleY];
            for (let sampleX = 0; sampleX < sampleGrid; sampleX++) {
              const pixelX = destinationX + sampleOffsets[sampleX];
              const weight0 = (
                (y1 - y2) * (pixelX - x2) + (x2 - x1) * (pixelY - y2)
              ) * inverseDenominator;
              const weight1 = (
                (y2 - y0) * (pixelX - x2) + (x0 - x2) * (pixelY - y2)
              ) * inverseDenominator;
              const weight2 = 1 - weight0 - weight1;
              if (weight0 < -0.0000001 || weight1 < -0.0000001 || weight2 < -0.0000001) continue;

              sampleBilinear(
                texture,
                weight0 * sourceU0 + weight1 * sourceU1 + weight2 * sourceU2,
                weight0 * sourceV0 + weight1 * sourceV1 + weight2 * sourceV2,
                texel,
              );
              const sourceAlpha = texel[3] * opacity;
              if (sourceAlpha <= 0) continue;

              const sample = sampleY * sampleGrid + sampleX;
              const destination = (
                (destinationY * width + destinationX) * samplesPerPixel + sample
              ) * 4;
              const remainingAlpha = 1 - sourceAlpha;
              premultiplied[destination] = (
                texel[0] * sourceAlpha + premultiplied[destination] * remainingAlpha
              );
              premultiplied[destination + 1] = (
                texel[1] * sourceAlpha + premultiplied[destination + 1] * remainingAlpha
              );
              premultiplied[destination + 2] = (
                texel[2] * sourceAlpha + premultiplied[destination + 2] * remainingAlpha
              );
              premultiplied[destination + 3] = (
                sourceAlpha + premultiplied[destination + 3] * remainingAlpha
              );
            }
          }
        }
      }
    }
  }

  const data = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let sample = 0; sample < samplesPerPixel; sample++) {
      const source = (pixel * samplesPerPixel + sample) * 4;
      red += premultiplied[source];
      green += premultiplied[source + 1];
      blue += premultiplied[source + 2];
      alpha += premultiplied[source + 3];
    }
    red /= samplesPerPixel;
    green /= samplesPerPixel;
    blue /= samplesPerPixel;
    alpha /= samplesPerPixel;

    const destination = pixel * 4;
    data[destination + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    if (alpha >= MIN_ALPHA) {
      data[destination] = Math.round(clamp(red / alpha, 0, 1) * 255);
      data[destination + 1] = Math.round(clamp(green / alpha, 0, 1) * 255);
      data[destination + 2] = Math.round(clamp(blue / alpha, 0, 1) * 255);
    }
  }

  return { data, renderedTriangles };
}
