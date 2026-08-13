import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

export const REQUIRED_GROUPS = Object.freeze({
  idle: ['idle'],
  movement: ['walk-left', 'walk-right'],
  interaction: ['clicked'],
  drag: ['picked-up', 'dragging', 'dropped'],
  rest: ['rest'],
  sleep: ['sleep'],
  wake: ['wake'],
  special: ['special'],
});

export const STATE_THRESHOLDS = Object.freeze({
  idle: { frames: 3, uniqueFrames: 2 },
  'walk-left': { frames: 4, uniqueFrames: 3 },
  'walk-right': { frames: 4, uniqueFrames: 3 },
  clicked: { frames: 4, uniqueFrames: 3 },
  'picked-up': { frames: 4, uniqueFrames: 3 },
  dragging: { frames: 3, uniqueFrames: 2 },
  dropped: { frames: 4, uniqueFrames: 3 },
  rest: { frames: 4, uniqueFrames: 2 },
  sleep: { frames: 4, uniqueFrames: 3 },
  wake: { frames: 4, uniqueFrames: 3 },
  special: { frames: 4, uniqueFrames: 3 },
});

export const TRANSITION_THRESHOLDS = Object.freeze({
  warning: {
    ground_anchor_delta_px: 18,
    bbox_center_distance_px: 32,
    alpha_iou_min: 0.25,
    mean_abs_rgba_max: 0.22,
  },
  severe: {
    ground_anchor_delta_px: 36,
    bbox_center_distance_px: 64,
    alpha_iou_min: 0.05,
    mean_abs_rgba_max: 0.35,
  },
  combined_severe: {
    minimum_violations: 2,
    ground_anchor_delta_px: 28,
    bbox_center_distance_px: 48,
    alpha_iou_min: 0.12,
    mean_abs_rgba_max: 0.28,
  },
});

const SEMANTIC_SOURCES = Object.freeze({
  idle: ['relax', 'default', 'zf_idle', 'relax_idle', 'idle'],
  movement: ['move', 'move2', 'walk', 'run'],
  interaction: ['interact', 'clicked', 'click'],
  drag: ['sit', 'pickup', 'picked-up', 'grab', 'grabbed', 'drag', 'dragging', 'drop', 'dropped', 'landing'],
  rest: ['sit', 'rest', 'standby', 'power-down', 'power_down', 'docked', 'folded', 'hover-low'],
  sleep: ['sleep', 'standby', 'power-down', 'power_down', 'docked', 'folded', 'hover-low'],
  wake: ['sleep', 'wake', 'standby', 'power-down', 'power_down', 'docked', 'folded', 'hover-low'],
  special: ['special', 'skill', 'attack', 'cast', 'celebrate'],
});

function stateGroup(state) {
  if (typeof state !== 'string') return null;
  for (const [group, states] of Object.entries(REQUIRED_GROUPS)) {
    if (states.includes(state)) return group;
  }
  if (state === 'walk' || state === 'run' || state.startsWith('walk-') || state.startsWith('run-') || state === 'move-alt') return 'movement';
  if (state === 'idle-alt') return 'idle';
  return null;
}

function normalizedSource(source) {
  return String(source || '').toLowerCase().replace(/^derived[-_]/, '');
}

export function semanticFallback(state, source, explicitFallback = false, provenance = null) {
  if (explicitFallback) return { used: true, reason: 'explicit state or variant fallback' };
  const group = stateGroup(state);
  if (!group) return { used: false, reason: null };
  const allowed = SEMANTIC_SOURCES[group] || [];
  const matchesGroup = (value) => {
    const candidate = normalizedSource(value);
    return allowed.some((name) => candidate === name || candidate.startsWith(`${name}-`) || candidate.startsWith(`${name}_`));
  };
  if (provenance && (provenance.state === state || provenance.intent === state || provenance.states?.includes(state) ||
      stateGroup(provenance.intent) === group || matchesGroup(provenance.intent) || matchesGroup(provenance.state))) {
    return { used: false, reason: null };
  }
  const candidate = normalizedSource(source);
  if (allowed.some((name) => candidate === name || candidate.startsWith(`${name}-`) || candidate.startsWith(`${name}_`))) {
    return { used: false, reason: null };
  }
  return {
    used: true,
    reason: `${state} reuses semantically different source '${source}'`,
  };
}

function frameOrderIsNatural(order) {
  return order.every((frame, index) => frame === index);
}

function frameOrderIsReverse(order) {
  return order.length > 1 && order.every((frame, index) => index === 0 || frame < order[index - 1]);
}

export function animationOrigin({ state, animation, source, derivedProvenance = [], generatedProvenance = [] }) {
  const declared = String(animation.origin || source.origin || '').toLowerCase();
  const provenanceId = animation.provenanceId || animation.provenance_id;
  const isGenerated = declared.includes('image2') || declared.includes('generated') ||
    (animation.generatedFrames || []).length > 0 ||
    generatedProvenance.some((entry) => entry.state === state || entry.provenance_id === provenanceId || entry.id === provenanceId);
  if (isGenerated) return 'generated';
  const isDerived = declared.includes('derived') || animation.mirror || frameOrderIsReverse(animation.frameOrder || []) ||
    !frameOrderIsNatural(animation.frameOrder || []) ||
    derivedProvenance.some((entry) => entry.state === state || entry.provenance_id === provenanceId || entry.id === provenanceId) ||
    ['picked-up', 'dragging', 'dropped', 'wake'].includes(state) || state.startsWith('run-');
  return isDerived ? 'derived' : 'direct';
}

function sameFrame(left, right) {
  return left.length === right.length && left.equals(right);
}

export function uniqueFrameCount(frames) {
  const unique = [];
  for (const frame of frames) {
    if (!unique.some((candidate) => sameFrame(frame.pixels, candidate.pixels))) unique.push(frame);
  }
  return unique.length;
}

function sequenceEquals(left, right, reverse = false) {
  if (left.frames.length !== right.frames.length) return false;
  for (let index = 0; index < left.frames.length; index++) {
    const rightIndex = reverse ? right.frames.length - index - 1 : index;
    if (!sameFrame(left.frames[index].pixels, right.frames[rightIndex].pixels)) return false;
  }
  return true;
}

function uniquePixels(sequence) {
  const result = [];
  for (const frame of sequence.frames) {
    if (!result.some((pixels) => sameFrame(frame.pixels, pixels))) result.push(frame.pixels);
  }
  return result;
}

function frameOverlap(left, right) {
  const leftUnique = uniquePixels(left);
  const rightUnique = uniquePixels(right);
  if (!leftUnique.length || !rightUnique.length) return 0;
  const matched = leftUnique.filter((pixels) => rightUnique.some((candidate) => sameFrame(pixels, candidate))).length;
  return matched / Math.max(leftUnique.length, rightUnique.length);
}

function pairClassification(left, right, kind) {
  const states = new Set([left.state, right.state]);
  const bothMovement = stateGroup(left.state) === 'movement' && stateGroup(right.state) === 'movement';
  if (kind === 'exact' && bothMovement && Boolean(left.mirror) !== Boolean(right.mirror)) return 'directional-mirror';
  if (kind === 'exact' && bothMovement && left.fps !== right.fps) return 'timing-variation';
  if (kind === 'reverse' && (states.has('sleep') && states.has('wake'))) return 'sleep-wake-transition';
  if (kind === 'reverse' && (states.has('rest') && states.has('wake'))) return 'rest-wake-transition';
  if (kind === 'reverse' && (states.has('picked-up') && states.has('dropped'))) return 'grab-drop-transition';
  if (kind === 'static') return 'static-reused-state';
  if (kind === 'overlap' && (states.has('sleep') && states.has('wake'))) return 'sleep-wake-shared-generated-frames';
  if (kind === 'overlap' && (states.has('rest') && states.has('wake'))) return 'rest-wake-shared-transition-frames';
  if (kind === 'overlap' && left.source === right.source) return 'shared-derived-source';
  return kind === 'exact' ? 'semantic-duplicate' : kind === 'reverse' ? 'reverse-sequence' : 'suspicious-overlap';
}

export function compareAnimationSequences(sequences) {
  const duplicates = [];
  for (let leftIndex = 0; leftIndex < sequences.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < sequences.length; rightIndex++) {
      const left = sequences[leftIndex];
      const right = sequences[rightIndex];
      let kind = null;
      let overlap = null;
      const leftUnique = uniqueFrameCount(left.frames);
      const rightUnique = uniqueFrameCount(right.frames);
      const sameStaticFrame = leftUnique === 1 && rightUnique === 1 && sameFrame(left.frames[0].pixels, right.frames[0].pixels);
      if (sequenceEquals(left, right)) kind = 'exact';
      else if (sequenceEquals(left, right, true)) kind = 'reverse';
      else {
        if (sameStaticFrame) kind = 'static';
        else {
          overlap = frameOverlap(left, right);
          if (overlap >= 0.8) kind = 'overlap';
        }
      }
      if (!kind) continue;
      const classification = pairClassification(left, right, kind);
      const primarySignal = kind === 'exact' ? 'exact_duplicate_animation' :
        kind === 'reverse' ? 'reverse_sequence' :
          kind === 'static' ? 'static_reused_state' : 'suspicious_duplicate_sequence';
      duplicates.push({
        states: [left.state, right.state],
        kind: primarySignal,
        signals: [...new Set([primarySignal, ...(sameStaticFrame ? ['static_reused_state'] : [])])],
        classification,
        source: left.source === right.source ? left.source : null,
        overlap: overlap === null ? (kind === 'exact' || kind === 'reverse' ? 1 : null) : Number(overlap.toFixed(4)),
        intentional: ['directional-mirror', 'timing-variation', 'sleep-wake-transition', 'sleep-wake-shared-generated-frames', 'rest-wake-transition', 'rest-wake-shared-transition-frames', 'grab-drop-transition', 'shared-derived-source'].includes(classification),
      });
    }
  }
  return duplicates;
}

function frameVisible(pixels) {
  for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]) return true;
  return false;
}

function alphaBounds(pixels, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    min_x: minX,
    min_y: minY,
    max_x: maxX,
    max_y: maxY,
    center_x: (minX + maxX) / 2,
    center_y: (minY + maxY) / 2,
    ground_anchor_y: maxY,
  };
}

export function alphaGeometry(pixels, width, height) {
  const bounds = alphaBounds(pixels, width, height);
  let alphaPixels = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) alphaPixels += Number(pixels[offset] !== 0);
  return {
    alpha_pixels: alphaPixels,
    bbox_area: bounds ? (bounds.max_x - bounds.min_x + 1) * (bounds.max_y - bounds.min_y + 1) : 0,
  };
}

export function bridgeDoubleExposure(frame, from, to, width, height) {
  const geometry = alphaGeometry(frame, width, height);
  const endpointGeometry = [from, to].map((pixels) => alphaGeometry(pixels, width, height));
  const alphaAreaRatio = geometry.alpha_pixels / Math.max(1, ...endpointGeometry.map((entry) => entry.alpha_pixels));
  const bboxAreaRatio = geometry.bbox_area / Math.max(1, ...endpointGeometry.map((entry) => entry.bbox_area));
  return {
    candidate: alphaAreaRatio > 1.45 && bboxAreaRatio > 1.2,
    alpha_area_ratio: Number(alphaAreaRatio.toFixed(4)),
    bbox_area_ratio: Number(bboxAreaRatio.toFixed(4)),
  };
}

export function compareTransitionFrames(left, right, width, height) {
  const leftBounds = alphaBounds(left, width, height);
  const rightBounds = alphaBounds(right, width, height);
  if (!leftBounds || !rightBounds) {
    return {
      ground_anchor_delta_px: null,
      bbox_center_distance_px: null,
      alpha_iou: 0,
      mean_abs_rgba: 1,
      blank_endpoint: true,
    };
  }
  let intersection = 0;
  let union = 0;
  let absoluteDifference = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    const leftAlpha = left[offset + 3] > 0;
    const rightAlpha = right[offset + 3] > 0;
    if (leftAlpha && rightAlpha) intersection++;
    if (leftAlpha || rightAlpha) union++;
    for (let channel = 0; channel < 4; channel++) {
      absoluteDifference += Math.abs(left[offset + channel] - right[offset + channel]);
    }
  }
  return {
    ground_anchor_delta_px: Math.abs(leftBounds.ground_anchor_y - rightBounds.ground_anchor_y),
    bbox_center_distance_px: Number(Math.hypot(
      leftBounds.center_x - rightBounds.center_x,
      leftBounds.center_y - rightBounds.center_y,
    ).toFixed(4)),
    alpha_iou: Number((union ? intersection / union : 1).toFixed(4)),
    mean_abs_rgba: Number((absoluteDifference / (left.length * 255)).toFixed(4)),
    blank_endpoint: false,
  };
}

function transitionViolation(metrics, thresholds) {
  return {
    ground_anchor: metrics.ground_anchor_delta_px === null || metrics.ground_anchor_delta_px > thresholds.ground_anchor_delta_px,
    bbox_center: metrics.bbox_center_distance_px === null || metrics.bbox_center_distance_px > thresholds.bbox_center_distance_px,
    alpha_iou: metrics.alpha_iou < thresholds.alpha_iou_min,
    mean_abs_rgba: metrics.mean_abs_rgba > thresholds.mean_abs_rgba_max,
  };
}

export function classifyTransition(metrics) {
  const warning = transitionViolation(metrics, TRANSITION_THRESHOLDS.warning);
  const severe = transitionViolation(metrics, TRANSITION_THRESHOLDS.severe);
  const combined = transitionViolation(metrics, TRANSITION_THRESHOLDS.combined_severe);
  const warningCount = Object.values(warning).filter(Boolean).length;
  const severeCount = Object.values(severe).filter(Boolean).length;
  const combinedCount = Object.values(combined).filter(Boolean).length;
  return {
    level: metrics.blank_endpoint || severeCount > 0 ||
      combinedCount >= TRANSITION_THRESHOLDS.combined_severe.minimum_violations
      ? 'severe'
      : warningCount > 0 ? 'warning' : 'pass',
    violations: Object.entries(warning).filter(([, value]) => value).map(([key]) => key),
  };
}

function declaredTransitionPolicy(manifest, state, animation, target) {
  const key = `${state}->${target}`;
  const candidates = [
    animation.transitionToNext,
    animation.transition_to_next,
    manifest.transitionBoundaries?.[key],
    manifest.transition_boundaries?.[key],
    ...(manifest.provenance?.transitions || []).filter((entry) =>
      entry.id === key || (entry.from === state && entry.to === target)),
  ].filter(Boolean);
  const marked = candidates.find((candidate) =>
    candidate.intentionalCut === true || candidate.intentional_cut === true || candidate.teleport === true);
  const declaration = marked && typeof marked.reason === 'string' && marked.reason.trim() ? marked : null;
  return declaration ? {
    intentional: true,
    kind: declaration.teleport === true ? 'teleport' : 'intentional-cut',
    reason: declaration.reason,
    invalid_declaration: false,
  } : {
    intentional: false,
    kind: null,
    reason: null,
    invalid_declaration: Boolean(marked),
  };
}

function splitAtlas(data, atlasWidth, frameWidth, frameHeight, columns, frameCount) {
  const frameBytes = frameWidth * frameHeight * 4;
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const frame = Buffer.allocUnsafe(frameBytes);
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    for (let y = 0; y < frameHeight; y++) {
      const sourceOffset = ((row * frameHeight + y) * atlasWidth + column * frameWidth) * 4;
      const targetOffset = y * frameWidth * 4;
      data.copy(frame, targetOffset, sourceOffset, sourceOffset + frameWidth * 4);
    }
    frames.push(frame);
  }
  return frames;
}

async function readSources(manifest, manifestFile) {
  const frameWidth = manifest.frameSize?.width || manifest.frame_size?.width;
  const frameHeight = manifest.frameSize?.height || manifest.frame_size?.height;
  const result = new Map();
  const manifestDirectory = path.resolve(path.dirname(manifestFile));
  for (const [sourceId, source] of Object.entries(manifest.sources || {})) {
    if (typeof source.sheet !== 'string' || !source.sheet || path.isAbsolute(source.sheet)) {
      throw new Error(`${manifestFile}:${sourceId}: source sheet must be a relative filename`);
    }
    const sheetFile = path.resolve(manifestDirectory, source.sheet);
    if (sheetFile !== manifestDirectory && !sheetFile.startsWith(`${manifestDirectory}${path.sep}`)) {
      throw new Error(`${manifestFile}:${sourceId}: source sheet leaves the variant runtime directory`);
    }
    const { data, info } = await sharp(sheetFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== source.columns * frameWidth || info.height !== source.rows * frameHeight) {
      throw new Error(`${manifestFile}:${sourceId}: atlas dimensions do not match frame grid`);
    }
    result.set(sourceId, {
      metadata: source,
      frames: splitAtlas(data, info.width, frameWidth, frameHeight, source.columns, source.frames),
    });
  }
  return result;
}

function explicitFallbacks(manifest) {
  return manifest.stateFallbacks || manifest.state_fallbacks || manifest.fallbacks || {};
}

function impairingDuplicates(state, duplicates, stateAuditByName) {
  return duplicates.filter((duplicate) => duplicate.states.includes(state)).filter((duplicate) => {
    if (duplicate.intentional) return false;
    const [left, right] = duplicate.states.map((candidate) => stateAuditByName.get(candidate));
    if (!left || !right) return false;
    if (left.fallback.used !== right.fallback.used) {
      const current = stateAuditByName.get(state);
      return current.fallback.used;
    }
    return true;
  });
}

function runtimeBlankDeclarations(source) {
  const declarations = Array.isArray(source.metadata.intentionalBlankFrames)
    ? source.metadata.intentionalBlankFrames
    : [];
  const byFrame = new Map();
  const invalid = [];
  for (const declaration of declarations) {
    const reason = typeof declaration.reason === 'string' ? declaration.reason.trim() : '';
    if (!Number.isInteger(declaration.frame) || declaration.frame < 0 || declaration.frame >= source.frames.length || reason.length < 20) {
      invalid.push({ ...declaration, issue: 'runtime intentional blank declaration requires an in-range frame and concrete reason' });
      continue;
    }
    if (byFrame.has(declaration.frame)) {
      invalid.push({ ...declaration, issue: 'runtime intentional blank frame is declared more than once' });
      continue;
    }
    byFrame.set(declaration.frame, { ...declaration, reason });
  }
  return { byFrame, invalid };
}

function cleanedBlankDeclarations(cleanedManifest, sourceId) {
  const declarations = cleanedManifest?.processed_states?.[sourceId]?.intentional_blank_frames || [];
  return new Map(declarations
    .filter((entry) => Number.isInteger(entry.frame) && typeof entry.reason === 'string')
    .map((entry) => [entry.frame, entry.reason.trim()]));
}

function auditBlankFrames(sources, cleanedManifest) {
  const details = [];
  const intentional = new Map();
  let transparent = 0;
  let unexpected = 0;
  let invalidDeclarations = 0;
  for (const [sourceId, source] of sources) {
    const runtime = runtimeBlankDeclarations(source);
    const canonical = cleanedBlankDeclarations(cleanedManifest, sourceId);
    invalidDeclarations += runtime.invalid.length;
    details.push(...runtime.invalid.map((entry) => ({ source: sourceId, classification: 'invalid-declaration', ...entry })));
    for (const [frame, declaration] of runtime.byFrame) {
      const canonicalReason = canonical.get(declaration.sourceFrame);
      if (!Number.isInteger(declaration.sourceFrame) || canonicalReason !== declaration.reason) {
        invalidDeclarations++;
        details.push({
          source: sourceId,
          frame,
          source_frame: declaration.sourceFrame ?? null,
          classification: 'invalid-declaration',
          reason: declaration.reason,
          issue: 'runtime declaration is not backed by the canonical cleaned manifest with the same concrete reason',
        });
      }
    }
    for (let frame = 0; frame < source.frames.length; frame++) {
      const visible = frameVisible(source.frames[frame]);
      const declaration = runtime.byFrame.get(frame);
      if (!visible) {
        transparent++;
        const canonicalReason = declaration && canonical.get(declaration.sourceFrame);
        const valid = Boolean(declaration && canonicalReason === declaration.reason);
        if (valid) {
          intentional.set(`${sourceId}:${frame}`, declaration);
          details.push({
            source: sourceId,
            frame,
            source_frame: declaration.sourceFrame,
            classification: 'intentional-source-authored-blank',
            reason: declaration.reason,
            declaration: declaration.declaration || null,
          });
        } else {
          unexpected++;
          details.push({
            source: sourceId,
            frame,
            source_frame: declaration?.sourceFrame ?? null,
            classification: 'unexpected-transparent-frame',
            reason: declaration?.reason || null,
          });
        }
      } else if (declaration) {
        invalidDeclarations++;
        details.push({
          source: sourceId,
          frame,
          source_frame: declaration.sourceFrame ?? null,
          classification: 'invalid-declaration',
          reason: declaration.reason,
          issue: 'intentional blank declaration points to a visible runtime frame',
        });
      }
    }
    for (const [sourceFrame, reason] of canonical) {
      if (![...runtime.byFrame.values()].some((entry) => entry.sourceFrame === sourceFrame && entry.reason === reason)) {
        invalidDeclarations++;
        details.push({
          source: sourceId,
          source_frame: sourceFrame,
          classification: 'invalid-declaration',
          reason,
          issue: 'canonical cleaned declaration was not propagated into the runtime source manifest',
        });
      }
    }
  }
  return {
    transparent,
    intentional: intentional.size,
    unexpected,
    invalid_declarations: invalidDeclarations,
    details,
    intentionalByFrame: intentional,
  };
}

export async function auditVariant({ manifest, manifestFile, cleanedManifest = null }) {
  const relativeIdentity = path.relative(
    path.resolve(path.dirname(manifestFile), '../..'),
    path.dirname(manifestFile),
  ).split(path.sep);
  const manifestCharacter = manifest.character?.id || manifest.character_id;
  const manifestVariant = manifest.variant?.id || manifest.variant_id || 'default';
  if (relativeIdentity.length !== 2 || relativeIdentity[0] !== manifestCharacter || relativeIdentity[1] !== manifestVariant) {
    throw new Error(`${manifestFile}: runtime path identity does not match ${manifestCharacter}/${manifestVariant}`);
  }
  const frameWidth = manifest.frameSize?.width || manifest.frame_size?.width;
  const frameHeight = manifest.frameSize?.height || manifest.frame_size?.height;
  const sources = await readSources(manifest, manifestFile);
  const animations = manifest.animations || manifest.states || {};
  const derivedProvenance = manifest.provenance?.derivedAnimations || [];
  const generatedProvenance = [
    ...(manifest.provenance?.generatedAnimations || []),
    ...(manifest.provenance?.generatedSequences || []),
    ...(manifest.provenance?.generatedFrames || []),
  ];
  const fallbacks = explicitFallbacks(manifest);
  const blankFrames = auditBlankFrames(sources, cleanedManifest);
  const sequences = [];
  const runtimeSequences = [];
  const stateAudits = [];
  for (const [state, animation] of Object.entries(animations)) {
    const sourceRecord = sources.get(animation.source);
    if (!sourceRecord || !Array.isArray(animation.frameOrder) || animation.frameOrder.length === 0) continue;
    const displayedFrames = animation.frameOrder.map((index) => ({
      index,
      pixels: sourceRecord.frames[index],
      intentionalBlank: blankFrames.intentionalByFrame.has(`${animation.source}:${index}`),
    }));
    const bridgeId = animation.transitionBridge || animation.transition_bridge;
    const bridgeProvenance = bridgeId
      ? derivedProvenance.find((entry) => entry.id === bridgeId || entry.provenance_id === bridgeId)
      : null;
    const bridgeIndexes = bridgeProvenance?.atlas_frames;
    const hasBridgeSuffix = Array.isArray(bridgeIndexes) && bridgeIndexes.length > 0 &&
      animation.frameOrder.length > bridgeIndexes.length &&
      JSON.stringify(animation.frameOrder.slice(-bridgeIndexes.length)) === JSON.stringify(bridgeIndexes);
    const runtimeProvenanceId = animation.provenanceId || animation.provenance_id;
    const coreProvenanceId = hasBridgeSuffix
      ? animation.transitionFromProvenanceId || animation.transition_from_provenance_id || runtimeProvenanceId
      : runtimeProvenanceId;
    const coreFrames = hasBridgeSuffix
      ? displayedFrames.slice(0, -bridgeIndexes.length)
      : displayedFrames;
    const sequence = {
      state,
      source: animation.source,
      sheet: sourceRecord.metadata.sheet,
      frames: coreFrames,
      fps: animation.fps,
      mirror: Boolean(animation.mirror),
    };
    sequences.push(sequence);
    runtimeSequences.push({ ...sequence, frames: displayedFrames });
    const matchedDerived = derivedProvenance.find((entry) => entry.id === coreProvenanceId || entry.provenance_id === coreProvenanceId) ||
      derivedProvenance.find((entry) => entry.state === state) || null;
    const matchedGenerated = generatedProvenance.find((entry) => entry.id === coreProvenanceId || entry.provenance_id === coreProvenanceId || entry.state === state || entry.states?.includes(state)) || null;
    const matchedProvenance = matchedGenerated || matchedDerived;
    const fallback = semanticFallback(
      state,
      animation.source,
      Boolean(animation.fallback || fallbacks[state]),
      matchedProvenance,
    );
    const origin = animationOrigin({
      state,
      animation,
      source: sourceRecord.metadata,
      derivedProvenance,
      generatedProvenance,
    });
    const sourceAnimation = cleanedManifest?.processed_states?.[animation.source]?.source_animation || null;
    const visibleCoreFrames = coreFrames.filter((frame) => frameVisible(frame.pixels));
    const uniqueFrames = uniqueFrameCount(visibleCoreFrames);
    const visibleFrames = visibleCoreFrames.length;
    const intentionalBlankFrames = coreFrames.filter((frame) => !frameVisible(frame.pixels) && frame.intentionalBlank).length;
    const unexpectedBlankFrames = coreFrames.length - visibleFrames - intentionalBlankFrames;
    stateAudits.push({
      state,
      source: animation.source,
      source_animation: sourceAnimation,
      provenance: origin,
      provenance_id: coreProvenanceId || null,
      transition_bridge_provenance_id: hasBridgeSuffix ? bridgeId : null,
      provenance_intent: matchedProvenance?.intent || matchedProvenance?.state || null,
      derivation_operation: matchedProvenance?.operation || null,
      frame_count: coreFrames.length,
      core_frame_count: coreFrames.length,
      displayed_frame_count: displayedFrames.length,
      transition_bridge_frame_count: displayedFrames.length - coreFrames.length,
      unique_frame_count: uniqueFrames,
      visible_frame_count: visibleFrames,
      intentional_blank_frame_count: intentionalBlankFrames,
      unexpected_blank_frame_count: unexpectedBlankFrames,
      source_frame_count: sourceRecord.metadata.sourceFrames ?? sourceRecord.metadata.frames,
      generated_frame_count: (animation.generatedFrames || []).length,
      duration_seconds: Number((coreFrames.length / animation.fps).toFixed(4)),
      fps: animation.fps,
      loop_mode: animation.loop ? 'loop' : animation.holdLast ? 'once-hold-last' : 'once',
      mirror: Boolean(animation.mirror),
      next: animation.next || null,
      fallback,
      visual_uniqueness: null,
      complete: null,
      issues: [],
    });
  }
  const duplicates = compareAnimationSequences(sequences);
  const byName = new Map(stateAudits.map((audit) => [audit.state, audit]));
  for (const audit of stateAudits) {
    const threshold = STATE_THRESHOLDS[audit.state] || { frames: 1, uniqueFrames: 1 };
    const impairing = impairingDuplicates(audit.state, duplicates, byName);
    audit.visual_uniqueness = {
      unique: impairing.length === 0,
      conflicts: impairing.map((duplicate) => ({
        state: duplicate.states.find((state) => state !== audit.state),
        kind: duplicate.kind,
        classification: duplicate.classification,
      })),
    };
    if (audit.frame_count < threshold.frames) audit.issues.push(`requires at least ${threshold.frames} core frames (transition bridge excluded)`);
    if (audit.visible_frame_count < threshold.frames) audit.issues.push(`requires at least ${threshold.frames} visible core frames`);
    if (audit.unique_frame_count < threshold.uniqueFrames) audit.issues.push(`requires at least ${threshold.uniqueFrames} visually unique frames`);
    if (audit.unexpected_blank_frame_count) audit.issues.push(`${audit.unexpected_blank_frame_count} displayed frame(s) are unexpectedly transparent`);
    if (audit.fallback.used) audit.issues.push(audit.fallback.reason);
    if (!audit.visual_uniqueness.unique) audit.issues.push('visually duplicates another semantic state');
    audit.complete = audit.issues.length === 0;
  }
  const derivedReferencedFrames = new Set(Object.values(animations)
    .filter((animation) => animation.source === 'derived-motion')
    .flatMap((animation) => animation.frameOrder || []));
  const derivedFrameRecords = derivedProvenance.flatMap((entry) =>
    (entry.atlas_frames || []).map((frame) => ({ frame, provenance_id: entry.id || null, state: entry.state || null, intent: entry.intent || null })));
  const derivedSourceFrames = sources.get('derived-motion')?.frames.length || 0;
  const provenanceFrames = new Set(derivedFrameRecords.map((entry) => entry.frame));
  const invalidProvenanceFrames = derivedFrameRecords.filter((entry) =>
    !Number.isInteger(entry.frame) || entry.frame < 0 || entry.frame >= derivedSourceFrames);
  const unreferencedDerivedFrames = derivedFrameRecords.filter((entry) =>
    Number.isInteger(entry.frame) && !derivedReferencedFrames.has(entry.frame));
  const missingProvenanceFrames = [...derivedReferencedFrames]
    .filter((frame) => !provenanceFrames.has(frame))
    .map((frame) => ({ frame }));
  const untrackedAtlasFrames = Array.from({ length: derivedSourceFrames }, (_, frame) => frame)
    .filter((frame) => !derivedReferencedFrames.has(frame) || !provenanceFrames.has(frame));
  const stateForDerivedEntry = (entry) => {
    const label = `${entry.state || ''} ${entry.intent || ''}`.toLowerCase();
    if (label.includes('wake')) return 'wake';
    if (label.includes('sleep') || label.includes('standby')) return 'sleep';
    if (label.includes('rest') || label.includes('power-down')) return 'rest';
    if (label.includes('drop') || label.includes('landing')) return 'dropped';
    if (label.includes('drag')) return 'dragging';
    if (label.includes('grab') || label.includes('pick')) return 'picked-up';
    if (label.includes('special')) return 'special';
    if (label.includes('run')) return 'run-right';
    if (label.includes('walk')) return 'walk-right';
    if (label.includes('exit')) return 'exit';
    return null;
  };
  for (const entry of unreferencedDerivedFrames) {
    const state = stateForDerivedEntry(entry);
    if (state && byName.has(state)) {
      const issue = `derived provenance frame ${entry.frame} (${entry.provenance_id || 'unknown'}) is not used by runtime`;
      if (!byName.get(state).issues.includes(issue)) byName.get(state).issues.push(issue);
    }
  }
  for (const entry of missingProvenanceFrames) {
    for (const [state, animation] of Object.entries(animations)) {
      if (animation.source !== 'derived-motion' || !animation.frameOrder?.includes(entry.frame) || !byName.has(state)) continue;
      const issue = `runtime derived frame ${entry.frame} has no derived provenance`;
      if (!byName.get(state).issues.includes(issue)) byName.get(state).issues.push(issue);
    }
  }
  const coveredDerivedFrames = Array.from({ length: derivedSourceFrames }, (_, frame) => frame)
    .filter((frame) => derivedReferencedFrames.has(frame) && provenanceFrames.has(frame)).length;
  const derivedFrames = {
    total: derivedSourceFrames,
    referenced: coveredDerivedFrames,
    unreferenced: derivedSourceFrames - coveredDerivedFrames,
    runtime_referenced: derivedReferencedFrames.size,
    provenance_declared: provenanceFrames.size,
    provenance_unreferenced: unreferencedDerivedFrames.length,
    missing_provenance: missingProvenanceFrames.length,
    invalid_provenance: invalidProvenanceFrames.length,
    untracked_atlas_frames: untrackedAtlasFrames.length,
    unreferenced_details: unreferencedDerivedFrames,
    missing_provenance_details: missingProvenanceFrames,
    invalid_provenance_details: invalidProvenanceFrames,
    untracked_atlas_frame_details: untrackedAtlasFrames,
  };
  const sequenceByName = new Map(runtimeSequences.map((sequence) => [sequence.state, sequence]));
  const transitionDetails = [];
  const bridgeDetails = [];
  for (const [state, animation] of Object.entries(animations)) {
    if (!animation.next) continue;
    const sourceSequence = sequenceByName.get(state);
    const targetSequence = sequenceByName.get(animation.next);
    if (!sourceSequence || !targetSequence) continue;
    const sourceFrame = sourceSequence.frames[sourceSequence.frames.length - 1];
    const targetFrame = targetSequence.frames[0];
    const metrics = compareTransitionFrames(sourceFrame.pixels, targetFrame.pixels, frameWidth, frameHeight);
    const severity = classifyTransition(metrics);
    const policy = declaredTransitionPolicy(manifest, state, animation, animation.next);
    const effectiveLevel = policy.intentional && severity.level !== 'pass' ? 'intentional' : severity.level;
    const detail = {
      transition: `${state}->${animation.next}`,
      from_state: state,
      to_state: animation.next,
      source: sourceSequence.source,
      target_source: targetSequence.source,
      source_frame: sourceFrame.index,
      target_frame: targetFrame.index,
      source_provenance: byName.get(state)?.provenance || null,
      target_provenance: byName.get(animation.next)?.provenance || null,
      metrics,
      severity: effectiveLevel,
      detected_severity: severity.level,
      violations: severity.violations,
      policy,
    };
    transitionDetails.push(detail);

    const bridgeId = animation.transitionBridge || animation.transition_bridge;
    if (bridgeId) {
      const provenance = derivedProvenance.find((entry) => entry.id === bridgeId || entry.provenance_id === bridgeId);
      const bridgeIndexes = provenance?.atlas_frames;
      const order = animation.frameOrder || [];
      const suffix = Array.isArray(bridgeIndexes) ? order.slice(-bridgeIndexes.length) : [];
      const structurallyValid = Array.isArray(bridgeIndexes) && bridgeIndexes.length > 0 &&
        order.length > bridgeIndexes.length && JSON.stringify(suffix) === JSON.stringify(bridgeIndexes);
      const bridge = {
        state,
        target_state: animation.next,
        provenance_id: bridgeId,
        frame_count: Array.isArray(bridgeIndexes) ? bridgeIndexes.length : 0,
        structurally_valid: structurallyValid,
        endpoint_exact: false,
        double_exposure_candidates: [],
      };
      if (structurallyValid) {
        const predecessor = sourceSequence.frames[order.length - bridgeIndexes.length - 1];
        const bridgeFrames = sourceSequence.frames.slice(-bridgeIndexes.length);
        for (const frame of bridgeFrames.slice(0, -1)) {
          const exposure = bridgeDoubleExposure(
            frame.pixels,
            predecessor.pixels,
            targetFrame.pixels,
            frameWidth,
            frameHeight,
          );
          if (exposure.candidate) {
            bridge.double_exposure_candidates.push({
              frame: frame.index,
              alpha_area_ratio: exposure.alpha_area_ratio,
              bbox_area_ratio: exposure.bbox_area_ratio,
            });
          }
        }
        bridge.endpoint_exact = bridgeFrames.at(-1).pixels.equals(targetFrame.pixels);
      }
      bridgeDetails.push(bridge);
      if (!bridge.structurally_valid) byName.get(state)?.issues.push('transition bridge provenance/frame suffix is invalid');
      if (!bridge.endpoint_exact) byName.get(state)?.issues.push(`transition bridge endpoint does not equal ${animation.next}`);
      if (bridge.double_exposure_candidates.length) {
        byName.get(state)?.issues.push(`${bridge.double_exposure_candidates.length} transition bridge frame(s) have double-exposure geometry`);
      }
    }
    if (policy.invalid_declaration) {
      byName.get(state)?.issues.push('intentional transition declaration requires a concrete reason');
    }
    if (severity.level === 'severe' && !policy.intentional) {
      byName.get(state)?.issues.push(`severe unexplained transition boundary to ${animation.next}`);
    }
  }
  for (const audit of stateAudits) audit.complete = audit.issues.length === 0;
  const transitionBoundaries = {
    total: transitionDetails.length,
    warnings: transitionDetails.filter((transition) =>
      !transition.policy.intentional && ['warning', 'severe'].includes(transition.detected_severity)).length,
    warning_only: transitionDetails.filter((transition) =>
      !transition.policy.intentional && transition.detected_severity === 'warning').length,
    severe: transitionDetails.filter((transition) =>
      !transition.policy.intentional && transition.detected_severity === 'severe').length,
    intentional: transitionDetails.filter((transition) => transition.policy.intentional).length,
    invalid_intentional_declarations: transitionDetails.filter((transition) => transition.policy.invalid_declaration).length,
    details: transitionDetails,
  };
  const transitionBridges = {
    total: bridgeDetails.length,
    invalid_structure: bridgeDetails.filter((bridge) => !bridge.structurally_valid).length,
    endpoint_mismatches: bridgeDetails.filter((bridge) => !bridge.endpoint_exact).length,
    double_exposure_candidates: bridgeDetails.reduce((total, bridge) => total + bridge.double_exposure_candidates.length, 0),
    details: bridgeDetails,
  };
  const groups = {};
  for (const [group, states] of Object.entries(REQUIRED_GROUPS)) {
    const stateResults = states.map((state) => byName.get(state) || null);
    groups[group] = {
      complete: stateResults.every((audit) => audit?.complete),
      states,
      missing_states: states.filter((state) => !byName.has(state)),
      incomplete_states: stateResults.filter((audit) => audit && !audit.complete).map((audit) => audit.state),
    };
  }
  const requiredAudits = Object.values(REQUIRED_GROUPS).flat().map((state) => byName.get(state)).filter(Boolean);
  const allStatic = requiredAudits.length > 0 && requiredAudits.every((audit) => audit.unique_frame_count <= 1);
  const allGroupsComplete = Object.values(groups).every((group) => group.complete);
  const transitionComplete = transitionBoundaries.severe === 0 && transitionBoundaries.invalid_intentional_declarations === 0;
  const derivedFramesComplete = derivedFrames.unreferenced === 0 && derivedFrames.provenance_unreferenced === 0 &&
    derivedFrames.missing_provenance === 0 && derivedFrames.invalid_provenance === 0 && derivedFrames.untracked_atlas_frames === 0;
  const blankFramesComplete = blankFrames.unexpected === 0 && blankFrames.invalid_declarations === 0;
  const variantIssues = [];
  if (!blankFramesComplete) variantIssues.push(`${blankFrames.unexpected} unexpected transparent frame(s), ${blankFrames.invalid_declarations} invalid intentional-blank declaration(s)`);
  if (!derivedFramesComplete) variantIssues.push('derived runtime/provenance frame coverage is not bidirectional');
  return {
    status: allStatic ? 'static-only' : allGroupsComplete && transitionComplete && derivedFramesComplete && blankFramesComplete ? 'animation-complete' : 'animation-partial',
    issues: variantIssues,
    groups,
    states: Object.fromEntries(stateAudits.map((audit) => [audit.state, audit])),
    duplicates,
    transition_boundaries: transitionBoundaries,
    transition_bridges: transitionBridges,
    derived_frames: derivedFrames,
    blank_frames: {
      transparent: blankFrames.transparent,
      intentional: blankFrames.intentional,
      unexpected: blankFrames.unexpected,
      invalid_declarations: blankFrames.invalid_declarations,
      details: blankFrames.details,
    },
    counts: {
      source_animation_sets: [...sources.values()].filter((source) => !String(source.metadata.origin || '').toLowerCase().includes('derived') &&
        !String(source.metadata.origin || '').toLowerCase().includes('generated')).length,
      derived_animation_sets: [...sources.values()].filter((source) => String(source.metadata.origin || '').toLowerCase().includes('derived')).length,
      direct: stateAudits.filter((audit) => audit.provenance === 'direct').length,
      derived: stateAudits.filter((audit) => audit.provenance === 'derived').length,
      generated: stateAudits.filter((audit) => audit.provenance === 'generated').length,
      fallback: stateAudits.filter((audit) => audit.fallback.used).length,
    },
  };
}

export async function readJson(file, required = true) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null;
    throw error;
  }
}
