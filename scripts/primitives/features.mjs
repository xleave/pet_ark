import { n } from './svg.mjs';

const earShape = (kind, x, flip, definition, pose) => {
  const sign = flip ? -1 : 1;
  const color = definition.palette.hair;
  const inner = definition.palette.hair_highlight;
  if (kind === 'rabbit') return `<g transform="rotate(${n(sign * pose.earBounce)} ${x} 44)"><path d="M${x - 8} 49 Q${x - 11} 4 ${x + 1} 5 Q${x + 10} 20 ${x + 7} 51 Z" fill="${color}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x - 3} 43 Q${x - 5} 15 ${x + 1} 12 Q${x + 5} 24 ${x + 3} 44 Z" fill="${inner}"/></g>`;
  if (kind === 'cat' || kind === 'wolf' || kind === 'fox' || kind === 'bear') {
    const height = kind === 'wolf' ? 25 : kind === 'fox' ? 29 : kind === 'bear' ? 16 : 22;
    return `<g transform="rotate(${n(sign * pose.earBounce)} ${x} 48)"><path d="M${x - 13} 49 Q${x - 9} ${49 - height} ${x + 10} ${44 - height / 2} L${x + 9} 53 Z" fill="${color}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x - 7} 46 Q${x - 4} ${37 - height / 2} ${x + 5} ${39 - height / 2} L${x + 4} 48 Z" fill="${inner}"/></g>`;
  }
  if (kind === 'deer') return `<g transform="rotate(${n(sign * pose.earBounce)} ${x} 48)"><path d="M${x} 48 v-22 l${sign * 9} -9 m${sign * -9} 10 l${sign * -9} -7 m${sign * 9} 15 l${sign * 11} -7" fill="none" stroke="${definition.palette.horn}" stroke-width="4" stroke-linecap="round"/></g>`;
  return '';
};

export function drawBackFeatures(definition, pose) {
  const features = definition.species_features;
  let result = '';
  if (features.tail !== 'none') {
    const wide = features.tail === 'fluffy' ? 14 : 8;
    result += `<path d="M126 143 Q${154 + pose.tailSwing} 143 ${151 + pose.tailSwing} 174 Q${145 + pose.tailSwing} 188 ${134 + pose.tailSwing / 3} 173" fill="none" stroke="${definition.palette.hair}" stroke-width="${wide}" stroke-linecap="round"/>`;
  }
  if (features.wings !== 'none') {
    result += `<g opacity="0.92" transform="translate(0 ${n(pose.companionBob / 2)})"><path d="M68 111 Q42 99 46 139 Q57 126 74 134" fill="${definition.palette.secondary}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M124 111 Q150 99 146 139 Q135 126 118 134" fill="${definition.palette.secondary}" stroke="${definition.palette.line}" stroke-width="2"/></g>`;
  }
  return result;
}

export function drawHeadFeatures(definition, pose) {
  const features = definition.species_features;
  let result = '';
  if (features.ears !== 'none') {
    result += earShape(features.ears, 70, false, definition, pose);
    result += earShape(features.ears, 122, true, definition, pose);
  }
  if (features.horns !== 'none') {
    const curve = features.horns === 'ram' ? 14 : 5;
    result += `<path d="M70 54 Q${52 - curve} 38 63 22 Q70 15 78 39" fill="${definition.palette.horn}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M122 54 Q${140 + curve} 38 129 22 Q122 15 114 39" fill="${definition.palette.horn}" stroke="${definition.palette.line}" stroke-width="2"/>`;
  }
  if (features.halo !== 'none') {
    const haloY = n(30 + pose.haloLift);
    result += features.halo === 'fragmented'
      ? `<g fill="none" stroke="${definition.palette.halo}" stroke-width="4"><path d="M68 ${haloY} Q82 ${haloY - 10} 91 ${haloY - 9}"/><path d="M101 ${haloY - 9} Q116 ${haloY - 8} 124 ${haloY}"/></g>`
      : `<ellipse cx="96" cy="${haloY}" rx="31" ry="8" fill="none" stroke="${definition.palette.halo}" stroke-width="4"/>`;
  }
  return result;
}

export function drawHair(definition, pose) {
  const { hair, geometry, palette } = definition;
  const width = geometry.hair_volume;
  const left = 96 - width;
  const right = 96 + width;
  const length = hair.length;
  const backBottom = 84 + length;
  const back = hair.shape === 'twin-tails'
    ? `<g transform="rotate(${n(pose.hairLag)} 96 86)"><path d="M67 58 Q45 68 49 ${backBottom} Q61 ${backBottom + 15} 72 107" fill="${palette.hair}" stroke="${palette.line}" stroke-width="2"/><path d="M125 58 Q147 68 143 ${backBottom} Q131 ${backBottom + 15} 120 107" fill="${palette.hair}" stroke="${palette.line}" stroke-width="2"/></g>`
    : hair.shape === 'ponytail'
      ? `<g transform="rotate(${n(pose.hairLag)} 119 62)"><path d="M117 57 Q153 53 ${145 + geometry.ornament_code} ${backBottom} Q130 ${backBottom + 15} 118 91" fill="${palette.hair}" stroke="${palette.line}" stroke-width="2"/></g>`
      : hair.shape === 'braid'
        ? `<g transform="rotate(${n(pose.hairLag)} 121 74)"><path d="M121 68 Q139 80 127 94 Q142 105 128 118 Q142 130 127 ${backBottom}" fill="none" stroke="${palette.hair}" stroke-width="13" stroke-linecap="round"/></g>`
        : `<g transform="rotate(${n(pose.hairLag)} 96 88)"><path d="M${left} 70 Q${left + 3} 37 96 ${36 - geometry.top_height} Q${right - 3} 37 ${right} 70 L${right + geometry.side_lock} ${backBottom} Q${right - 8} ${backBottom + 13} ${right - 20} ${backBottom - 2} L112 84 L80 84 L${left + 20} ${backBottom - 2} Q${left + 8} ${backBottom + 13} ${left - geometry.side_lock} ${backBottom} Z" fill="${palette.hair}" stroke="${palette.line}" stroke-width="2.3"/></g>`;
  const spikes = Array.from({ length: hair.fringe_count }, (_, index) => {
    const center = 72 + index * (48 / Math.max(1, hair.fringe_count - 1));
    const drop = 58 + ((index + geometry.ornament_code) % 3) * 7;
    return `<path d="M${n(center - 12)} 48 Q${n(center)} 42 ${n(center + 10)} 49 L${n(center + 3)} ${drop} L${n(center - 3)} ${drop - 6} Z" fill="${palette.hair}"/>`;
  }).join('');
  const highlight = `<path d="M${left + 10} 56 Q96 ${37 - geometry.top_height} ${right - 12} 56" fill="none" stroke="${palette.hair_highlight}" stroke-width="${2 + geometry.highlight_width}" opacity="0.75"/>`;
  return { back, front: `${spikes}${highlight}` };
}

export function drawAccessory(definition, pose, fixedDirection = false) {
  const { accessories, palette, geometry } = definition;
  if (Boolean(accessories.direction_fixed) !== fixedDirection) return '';
  const side = accessories.side === 'left' ? -1 : 1;
  const x = 96 + side * (25 + geometry.ornament_code % 7);
  const color = palette.accent;
  if (accessories.headgear === 'hat') return `<path d="M${x - 21} 49 Q${x} 24 ${x + 20} 49 L${x + 14} 56 L${x - 17} 56 Z" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="2"/><path d="M${x - 27} 55 H${x + 27}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  if (accessories.headgear === 'crown') return `<path d="M${x - 18} 48 L${x - 14} 30 L${x - 3} 42 L${x + 5} 27 L${x + 17} 47 Z" fill="${color}" stroke="${palette.line}" stroke-width="2"/>`;
  if (accessories.headgear === 'goggles') return `<g fill="${palette.metal}" stroke="${palette.line}" stroke-width="2"><circle cx="80" cy="62" r="9"/><circle cx="112" cy="62" r="9"/><path d="M89 62 H103"/></g>`;
  if (accessories.headgear === 'mask') return `<path d="M69 80 Q96 99 123 80 L118 101 Q96 112 74 101 Z" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="2"/>`;
  if (accessories.headgear === 'glasses') return `<g fill="none" stroke="${palette.line}" stroke-width="2"><rect x="66" y="72" width="23" height="15" rx="7"/><rect x="103" y="72" width="23" height="15" rx="7"/><path d="M89 78 H103"/></g>`;
  if (accessories.headgear === 'eyepatch') return `<path d="M${x - 9} 72 Q${x} 67 ${x + 9} 72 L${x + 5} 86 Q${x} 91 ${x - 6} 85 Z" fill="${palette.line}"/><path d="M${x - 14} 68 L${x + 16} 86" stroke="${palette.line}" stroke-width="2"/>`;
  const code = geometry.ornament_code % 4;
  if (code === 0) return `<path d="M${x} 48 l8 8 -8 8 -8 -8z" fill="${color}" stroke="${palette.line}" stroke-width="1.5"/>`;
  if (code === 1) return `<circle cx="${x}" cy="53" r="8" fill="${color}" stroke="${palette.line}" stroke-width="1.5"/><path d="M${x - 6} 59 l-4 12 M${x + 6} 59 l4 12" stroke="${palette.secondary}" stroke-width="3"/>`;
  if (code === 2) return `<path d="M${x - 11} 51 Q${x} 41 ${x + 11} 51 Q${x} 61 ${x - 11} 51" fill="${color}" stroke="${palette.line}" stroke-width="1.5"/>`;
  return `<path d="M${x - 9} 45 L${x + 9} 61 M${x + 9} 45 L${x - 9} 61" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
}

export function drawWeapon(definition, pose, fixedDirection = false) {
  const weapon = definition.weapon;
  if (Boolean(weapon.direction_fixed) !== fixedDirection || weapon.type === 'none') return '';
  const side = weapon.side === 'left' ? -1 : 1;
  const x = 96 + side * 44;
  const angle = n(side * (weapon.angle + pose.weaponLag));
  const stroke = definition.palette.weapon;
  const accent = definition.palette.accent;
  let fragment = '';
  if (weapon.type === 'sword') fragment = `<rect x="${x - 3}" y="84" width="6" height="84" rx="3" fill="${stroke}"/><path d="M${x - 12} 145 H${x + 12}" stroke="${accent}" stroke-width="5"/><path d="M${x} 75 l7 12 h-14z" fill="${definition.palette.metal}"/>`;
  else if (weapon.type === 'spear') fragment = `<path d="M${x} 51 V183" stroke="${stroke}" stroke-width="5"/><path d="M${x} 39 l10 22 -10 -5 -10 5z" fill="${definition.palette.metal}"/>`;
  else if (weapon.type === 'shield') fragment = `<path d="M${x - 21} 105 Q${x} 91 ${x + 21} 105 L${x + 15} 159 Q${x} 175 ${x - 15} 159 Z" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="3"/><path d="M${x} 105 V162 M${x - 17} 126 H${x + 17}" stroke="${accent}" stroke-width="4"/>`;
  else if (weapon.type === 'gun') fragment = `<path d="M${x - 24} 113 H${x + 20} L${x + 27} 121 L${x + 5} 127 L${x - 22} 124 Z" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="2"/><rect x="${x - 4}" y="124" width="10" height="22" rx="3" fill="${accent}"/>`;
  else if (weapon.type === 'bow') fragment = `<path d="M${x} 64 Q${x + side * 30} 112 ${x} 170 Q${x + side * -13} 112 ${x} 64" fill="none" stroke="${stroke}" stroke-width="5"/><path d="M${x} 64 V170" stroke="${accent}" stroke-width="1.7"/>`;
  else if (weapon.type === 'staff') fragment = `<path d="M${x} 72 V180" stroke="${stroke}" stroke-width="6"/><circle cx="${x}" cy="61" r="15" fill="${accent}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x - 8} 61 H${x + 8} M${x} 53 V69" stroke="#fff" stroke-width="2"/>`;
  else if (weapon.type === 'medical') fragment = `<rect x="${x - 19}" y="102" width="38" height="48" rx="8" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x - 9} 126 H${x + 9} M${x} 117 V135" stroke="${accent}" stroke-width="6"/>`;
  else if (weapon.type === 'hammer') fragment = `<path d="M${x} 93 V181" stroke="${stroke}" stroke-width="7"/><rect x="${x - 25}" y="70" width="50" height="31" rx="6" fill="${definition.palette.metal}" stroke="${definition.palette.line}" stroke-width="3"/>`;
  else if (weapon.type === 'book') fragment = `<path d="M${x - 29} 112 Q${x - 10} 104 ${x} 115 Q${x + 10} 104 ${x + 29} 112 V151 Q${x + 9} 143 ${x} 153 Q${x - 9} 143 ${x - 29} 151 Z" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="2"/><path d="M${x} 115 V153" stroke="${accent}" stroke-width="2"/>`;
  else if (weapon.type === 'instrument') fragment = `<ellipse cx="${x}" cy="132" rx="23" ry="31" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="2"/><circle cx="${x}" cy="132" r="8" fill="${accent}"/><path d="M${x + 12} 108 L${x + 24} 68" stroke="${definition.palette.metal}" stroke-width="6"/>`;
  else if (weapon.type === 'drone') fragment = `<g transform="translate(0 ${n(pose.companionBob)})"><rect x="${x - 20}" y="86" width="40" height="21" rx="9" fill="${stroke}" stroke="${definition.palette.line}" stroke-width="2"/><circle cx="${x}" cy="96" r="5" fill="${accent}"/><path d="M${x - 30} 85 H${x + 30}" stroke="${definition.palette.metal}" stroke-width="4"/></g>`;
  else fragment = `<path d="M${x} 91 V178" stroke="${stroke}" stroke-width="6"/><path d="M${x - 17} 90 H${x + 17} L${x + 10} 112 H${x - 10} Z" fill="${accent}" stroke="${definition.palette.line}" stroke-width="2"/>`;
  return `<g transform="rotate(${angle} ${x} 132)">${fragment}</g>`;
}
