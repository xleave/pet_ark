import { createPose } from '../motion/index.mjs';
import { drawFace } from '../primitives/face.mjs';
import { drawAccessory, drawBackFeatures, drawHair, drawHeadFeatures, drawWeapon } from '../primitives/features.mjs';
import { drawArm, drawLeg, drawOutfit } from '../primitives/figure.mjs';
import { drawCompanion, drawSignature } from '../primitives/effects.mjs';
import { n } from '../primitives/svg.mjs';

function robotBody(definition, pose, state) {
  const { palette, geometry, face } = definition;
  const antennaSide = geometry.signature_code % 2 ? 1 : -1;
  const eyes = pose.blink
    ? `<path d="M73 80 h12 M107 80 h12" stroke="${palette.eye}" stroke-width="3"/>`
    : `<circle cx="79" cy="80" r="${face.eye_width}" fill="${palette.eye}"/><circle cx="113" cy="80" r="${face.eye_width}" fill="${palette.eye}"/>`;
  return `<g transform="translate(${n(pose.bodyX)} ${n(pose.bodyY + pose.bob + pose.slump)})">
    <path d="M${96 + antennaSide * 18} 49 L${96 + antennaSide * 27} 27" stroke="${palette.metal}" stroke-width="4"/><circle cx="${96 + antennaSide * 28}" cy="25" r="6" fill="${palette.accent}"/>
    <rect x="57" y="48" width="78" height="59" rx="${9 + geometry.ornament_code % 13}" fill="${palette.primary}" stroke="${palette.line}" stroke-width="3"/>
    <rect x="65" y="62" width="62" height="31" rx="8" fill="${palette.secondary}" stroke="${palette.line}" stroke-width="2"/>${eyes}
    <path d="M86 97 Q96 ${100 + pose.smile * 3} 106 97" fill="none" stroke="${palette.mouth}" stroke-width="2"/>
    <rect x="68" y="105" width="56" height="59" rx="${8 + geometry.signature_code % 8}" fill="${palette.primary}" stroke="${palette.line}" stroke-width="3"/>
    <path d="M76 119 H116 M76 146 H116" stroke="${palette.secondary}" stroke-width="5"/>${drawSignature(definition, pose)}
    <g transform="rotate(${n(pose.armL)} 68 119)"><rect x="46" y="114" width="24" height="17" rx="8" fill="${palette.metal}" stroke="${palette.line}" stroke-width="2"/><circle cx="44" cy="123" r="7" fill="${palette.accent}"/></g>
    <g transform="rotate(${n(pose.armR)} 124 119)"><rect x="122" y="114" width="24" height="17" rx="8" fill="${palette.metal}" stroke="${palette.line}" stroke-width="2"/><circle cx="148" cy="123" r="7" fill="${palette.accent}"/></g>
    <g transform="rotate(${n(pose.legL)} 82 161)"><rect x="75" y="157" width="15" height="30" rx="6" fill="${palette.metal}"/><rect x="68" y="181" width="24" height="10" rx="5" fill="${palette.boot}"/></g>
    <g transform="rotate(${n(pose.legR)} 110 161)"><rect x="102" y="157" width="15" height="30" rx="6" fill="${palette.metal}"/><rect x="100" y="181" width="24" height="10" rx="5" fill="${palette.boot}"/></g>
    ${drawWeapon(definition, pose, false)}${drawAccessory(definition, pose, false)}
  </g>`;
}

function humanoidBody(definition, pose, state) {
  const hair = drawHair(definition, pose);
  const y = n(pose.bodyY + pose.bob + pose.slump);
  return `<g transform="translate(${n(pose.bodyX)} ${y})">
    ${drawBackFeatures(definition, pose)}${hair.back}
    ${drawLeg('left', pose.legL, definition, pose)}${drawLeg('right', pose.legR, definition, pose)}
    ${drawOutfit(definition, pose)}
    ${drawArm('left', pose.armL, pose.forearmL, definition, state)}${drawArm('right', pose.armR, pose.forearmR, definition, state)}
    ${drawWeapon(definition, pose, false)}${drawCompanion(definition, pose)}
    <rect x="91" y="93" width="10" height="15" rx="5" fill="${definition.palette.skin}"/>
    <g transform="rotate(${n(pose.headTilt)} 96 78)">
      ${drawHeadFeatures(definition, pose)}
      <ellipse cx="96" cy="76" rx="${definition.face.width}" ry="${definition.face.height}" fill="${definition.palette.skin}" stroke="${definition.palette.skin_line}" stroke-width="2.1"/>
      ${hair.front}${drawFace(definition, pose)}${drawAccessory(definition, pose, false)}
    </g>
    ${drawSignature(definition, pose)}
  </g>`;
}

export function renderGenericFrame(definition, state, frame) {
  const pose = createPose(state, frame, definition.dynamics);
  const mirror = pose.mirror ? 'translate(192 0) scale(-1 1)' : '';
  const body = definition.species_features.body_kind === 'robot'
    ? robotBody(definition, pose, state)
    : humanoidBody(definition, pose, state);
  // Direction-fixed details live outside the mirrored group. Character data
  // can therefore preserve text-like insignia, eyepatches, and one-sided gear.
  const fixedPose = { ...pose, mirror: false };
  const fixed = `${drawWeapon(definition, fixedPose, true)}${drawAccessory(definition, fixedPose, true)}`;
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="192" height="208" viewBox="0 0 192 208"><g transform="${mirror}">${body}</g>${fixed}</svg>`;
}
