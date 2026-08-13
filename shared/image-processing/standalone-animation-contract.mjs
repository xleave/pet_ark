export function sourceName(available, ...preferred) {
  for (const candidate of preferred) {
    const match = available.find((entry) => entry.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

export function deriveStandaloneAnimations(available) {
  const idle = sourceName(available, 'relax', 'default');
  const move = sourceName(available, 'move', 'walk', 'run');
  const interact = sourceName(available, 'interact', 'special', 'default', 'relax');
  const special = sourceName(available, 'special', 'interact', 'default', 'relax');
  const sit = sourceName(available, 'sit', 'relax', 'default');
  const sleep = sourceName(available, 'sleep', 'sit', 'relax', 'default');
  if (!idle || !move || !interact || !special || !sit || !sleep) {
    throw new Error(`source animations cannot satisfy desktop states (available: ${available.join(', ')})`);
  }
  const animations = {
    idle: { source: idle, fps: 12, loop: true },
    'walk-left': { source: move, fps: 12, loop: true, mirror: true },
    'walk-right': { source: move, fps: 12, loop: true },
    'run-left': { source: move, fps: 18, loop: true, mirror: true },
    'run-right': { source: move, fps: 18, loop: true },
    clicked: { source: interact, fps: 12, loop: false, next: 'idle' },
    'picked-up': { source: sit, fps: 12, loop: false, range: [0, 5], next: 'dragging' },
    dragging: { source: sit, fps: 6, loop: true, range: [5, 10] },
    dropped: { source: sit, fps: 12, loop: false, range: [5, 0], next: 'idle' },
    rest: { source: sit, fps: 8, loop: false, holdLast: true, next: 'sleep' },
    sleep: { source: sleep, fps: 10, loop: true },
    wake: { source: sleep, fps: 12, loop: false, reverse: true, next: 'idle' },
    special: { source: special, fps: 12, loop: false, next: 'idle' },
  };
  const exit = sourceName(available, 'exit');
  const idleAlt = sourceName(available, 'zf_idle', 'relax_idle');
  const moveAlt = sourceName(available, 'move2');
  if (exit) animations.exit = { source: exit, fps: 12, loop: false, next: 'idle' };
  if (idleAlt) animations['idle-alt'] = { source: idleAlt, fps: 12, loop: true };
  if (moveAlt) animations['move-alt'] = { source: moveAlt, fps: 12, loop: true };
  return animations;
}

export function selectStandaloneAnimations({
  available,
  variantAnimations = null,
  legacyAnimations = null,
  legacySchemaVersion = null,
}) {
  if (variantAnimations) return variantAnimations;
  if (legacyAnimations && legacySchemaVersion !== 2) return legacyAnimations;
  return deriveStandaloneAnimations(available);
}

export function validateStandaloneAnimationContract(animations, available, context = 'standalone animation') {
  const special = sourceName(available, 'special', 'interact', 'default', 'relax');
  if (special && animations.special?.source !== special) {
    throw new Error(`${context}: special must use ${special}`);
  }
  const expectations = [
    { state: 'exit', source: sourceName(available, 'exit'), loop: false, next: 'idle' },
    { state: 'idle-alt', source: sourceName(available, 'zf_idle', 'relax_idle'), loop: true, next: null },
    { state: 'move-alt', source: sourceName(available, 'move2'), loop: true, next: null },
  ];
  for (const expected of expectations) {
    if (!expected.source) continue;
    const animation = animations[expected.state];
    if (!animation) throw new Error(`${context}: ${expected.source} must be exposed as ${expected.state}`);
    if (animation.source !== expected.source) {
      throw new Error(`${context}: ${expected.state} must use ${expected.source}`);
    }
    if (animation.loop !== expected.loop) {
      throw new Error(`${context}: ${expected.state} loop must be ${expected.loop}`);
    }
    if ((animation.next || null) !== expected.next) {
      throw new Error(`${context}: ${expected.state} next must be ${expected.next || 'null'}`);
    }
  }
}
