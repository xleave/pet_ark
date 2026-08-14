import { n } from './svg.mjs';

export function drawLeg(side, angle, definition, pose) {
  const left = side === 'left';
  const x = left ? 81 - definition.geometry.leg_spacing : 101 + definition.geometry.leg_spacing;
  const boot = definition.outfit.boot_style;
  const bootColor = definition.palette.boot;
  const legColor = definition.palette.leg;
  const toe = left ? -1 : 1;
  const bootPath = boot === 'tall'
    ? `<rect x="${x - 6}" y="169" width="13" height="19" rx="4" fill="${bootColor}"/><path d="M${x - 6} 184 q${toe * 10} -2 ${toe * 15} 5 q${toe * -8} 7 ${toe * -17} 1z" fill="${bootColor}" stroke="${definition.palette.line}" stroke-width="1.4"/>`
    : boot === 'heeled'
      ? `<path d="M${x - 5} 181 q${toe * 8} 0 ${toe * 14} 7 q${toe * -6} 4 ${toe * -16} 1z" fill="${bootColor}" stroke="${definition.palette.line}" stroke-width="1.4"/><path d="M${x + toe * 2} 188 v5" stroke="${definition.palette.line}" stroke-width="2"/>`
      : `<path d="M${x - 5} 181 q${toe * 9} -1 ${toe * 15} 7 q${toe * -8} 6 ${toe * -17} 1z" fill="${bootColor}" stroke="${definition.palette.line}" stroke-width="1.4"/>`;
  return `<g transform="rotate(${n(angle)} ${x} ${158 + pose.crouch})"><rect x="${x - 5}" y="154" width="11" height="31" rx="5" fill="${legColor}"/>${bootPath}</g>`;
}

export function drawArm(side, angle, forearmAngle, definition, state) {
  const left = side === 'left';
  const shoulderX = left ? 70 : 122;
  const upperX = left ? 55 : 121;
  const foreX = left ? 54 : 125;
  const handX = left ? 59 : 133;
  const sleeve = definition.outfit.sleeve_style;
  const sleeveWidth = sleeve === 'wide' ? 21 : sleeve === 'bare' ? 11 : 17;
  const sleeveColor = sleeve === 'bare' ? definition.palette.skin : definition.palette.primary;
  const cuffColor = definition.palette.secondary;
  const waveLift = state === 'waving' && !left ? -21 : 0;
  return `<g transform="rotate(${n(angle)} ${shoulderX} 119)"><rect x="${left ? upperX - (sleeveWidth - 17) : upperX}" y="110" width="${sleeveWidth}" height="42" rx="${sleeve === 'wide' ? 10 : 7}" fill="${sleeveColor}" stroke="${definition.palette.line}" stroke-width="2"/><rect x="${foreX}" y="137" width="15" height="28" rx="7" fill="${cuffColor}" stroke="${definition.palette.line}" stroke-width="1.8" transform="rotate(${n(forearmAngle)} ${left ? 62 : 130} 141)"/><circle cx="${handX}" cy="${163 + waveLift}" r="6.2" fill="${definition.palette.skin}" stroke="${definition.palette.skin_line}" stroke-width="1.3"/></g>`;
}

export function drawOutfit(definition, pose) {
  const { outfit, palette, geometry } = definition;
  const w = geometry.body_width;
  const left = 96 - w / 2;
  const right = 96 + w / 2;
  const hem = outfit.type === 'dress' || outfit.type === 'robe' ? 178 : 158;
  const torso = outfit.type === 'armor'
    ? `<path d="M${left} 105 L${right} 105 L${right + 5} 150 Q96 160 ${left - 5} 150 Z" fill="${palette.primary}" stroke="${palette.line}" stroke-width="2.3"/><path d="M${left + 5} 113 L96 104 L${right - 5} 113 L${right - 9} 141 L96 149 L${left + 9} 141 Z" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="1.7"/><path d="M76 126 H116" stroke="${palette.accent}" stroke-width="4"/>`
    : outfit.type === 'robe' || outfit.type === 'dress'
      ? `<path d="M${left + 4} 103 Q96 96 ${right - 4} 103 L${right + geometry.coat_width} ${hem} Q96 ${hem + 9} ${left - geometry.coat_width} ${hem} Z" fill="${palette.primary}" stroke="${palette.line}" stroke-width="2.3"/><path d="M96 103 V${hem - 2}" stroke="${palette.secondary}" stroke-width="4"/><path d="M${left - 2} 151 Q96 163 ${right + 2} 151" fill="none" stroke="${palette.accent}" stroke-width="3"/>`
      : outfit.type === 'mechanical'
        ? `<path d="M${left} 105 L${right} 105 L${right + 4} 151 L96 158 L${left - 4} 151 Z" fill="${palette.primary}" stroke="${palette.line}" stroke-width="2.3"/><rect x="78" y="112" width="36" height="29" rx="6" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="2"/><circle cx="96" cy="126" r="8" fill="${palette.accent}"/><path d="M72 145 H120" stroke="${palette.metal}" stroke-width="4"/>`
        : `<path d="M${left} 104 Q96 97 ${right} 104 L${right + 4} 149 Q96 159 ${left - 4} 149 Z" fill="${palette.primary}" stroke="${palette.line}" stroke-width="2.3"/><path d="M${left + 7} 107 L96 120 L${right - 7} 107" fill="none" stroke="${palette.secondary}" stroke-width="4"/><path d="M73 145 Q96 154 119 145" fill="none" stroke="${palette.accent}" stroke-width="4"/>`;
  const coat = outfit.type === 'coat' || outfit.type === 'uniform' || geometry.coat_width > 6
    ? `<g transform="rotate(${n(pose.coatLag)} 96 133)"><path d="M${left + 3} 126 L${left - geometry.coat_width} 178 Q${left + 9} 189 88 169 L91 135 Z" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="1.8"/><path d="M${right - 3} 126 L${right + geometry.coat_width} 178 Q${right - 9} 189 104 169 L101 135 Z" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="1.8"/></g>`
    : '';
  return `${coat}${torso}`;
}
