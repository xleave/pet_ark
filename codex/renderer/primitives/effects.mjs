import { n } from './svg.mjs';

export function drawSignature(definition, pose) {
  const { palette, visual_signature: signature, identifying_features: features } = definition;
  const code = definition.geometry.signature_code;
  const x = 96 + ((code % 3) - 1) * 8;
  const y = 128;
  const motif = features.motif;
  let mark = '';
  if (motif === 'cross') mark = `<path d="M${x - 8} ${y} H${x + 8} M${x} ${y - 8} V${y + 8}" stroke="${palette.accent}" stroke-width="5"/>`;
  else if (motif === 'diamond') mark = `<path d="M${x} ${y - 10} l10 10 -10 10 -10 -10z" fill="${palette.accent}" stroke="${palette.line}" stroke-width="1.4"/>`;
  else if (motif === 'stripe') mark = `<path d="M${x - 17} ${y - 7} l34 14 M${x - 17} ${y + 1} l25 10" stroke="${palette.accent}" stroke-width="4"/>`;
  else if (motif === 'ring') mark = `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${palette.accent}" stroke-width="4"/>`;
  else mark = `<path d="M${x - 10} ${y + 8} Q${x} ${y - 13} ${x + 10} ${y + 8} Q${x} ${y + 2} ${x - 10} ${y + 8}" fill="${palette.accent}" stroke="${palette.line}" stroke-width="1.4"/>`;

  const effect = features.effect === 'none' ? '' : `<g opacity="0.78" transform="translate(0 ${n(pose.companionBob)})"><circle cx="${150 + code % 9}" cy="${72 + code % 17}" r="${4 + code % 4}" fill="none" stroke="${palette.accent}" stroke-width="2"/><path d="M${146 + code % 9} ${72 + code % 17} h${8 + code % 5}" stroke="${palette.halo}" stroke-width="2"/></g>`;
  // Signature prose is intentionally consumed here as a renderer input: its
  // cardinality controls the small, character-specific chest fasteners.
  const fasteners = signature.slice(0, 3).map((_, index) => `<circle cx="${88 + index * 8}" cy="${143 + (code + index) % 3}" r="1.7" fill="${palette.metal}"/>`).join('');
  return `${mark}${fasteners}${effect}`;
}

export function drawCompanion(definition, pose) {
  const companion = definition.accessories.companion;
  if (companion === 'none') return '';
  const side = definition.accessories.side === 'left' ? -1 : 1;
  const x = 96 + side * 62;
  const y = 105 + pose.companionBob;
  if (companion === 'drone') return `<g transform="translate(0 ${n(pose.companionBob)})"><ellipse cx="${x}" cy="${y}" rx="19" ry="11" fill="${definition.palette.metal}" stroke="${definition.palette.line}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5" fill="${definition.palette.accent}"/><path d="M${x - 28} ${y - 7} H${x + 28}" stroke="${definition.palette.secondary}" stroke-width="4"/></g>`;
  if (companion === 'beast') return `<g transform="translate(0 ${n(pose.companionBob)})"><ellipse cx="${x}" cy="${y + 24}" rx="21" ry="17" fill="${definition.palette.secondary}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x - 15} ${y + 13} l5 -14 9 13 M${x + 4} ${y + 12} l7 -13 8 17" fill="${definition.palette.secondary}" stroke="${definition.palette.line}" stroke-width="2"/><circle cx="${x - 7}" cy="${y + 22}" r="2" fill="${definition.palette.eye}"/><circle cx="${x + 7}" cy="${y + 22}" r="2" fill="${definition.palette.eye}"/></g>`;
  return `<g transform="translate(0 ${n(pose.companionBob)})"><rect x="${x - 16}" y="${y}" width="32" height="31" rx="7" fill="${definition.palette.secondary}" stroke="${definition.palette.line}" stroke-width="2"/><circle cx="${x}" cy="${y + 14}" r="6" fill="${definition.palette.accent}"/><path d="M${x - 8} ${y + 25} H${x + 8}" stroke="${definition.palette.metal}" stroke-width="3"/></g>`;
}
