import { n } from './svg.mjs';

export function drawFace(definition, pose) {
  const { face, palette } = definition;
  const eyeX = n(pose.eyeX);
  const eyeY = n(pose.eyeY);
  const eyeGap = face.eye_gap;
  const leftX = 96 - eyeGap;
  const rightX = 96 + eyeGap;
  const eyeWidth = face.eye_width;
  const eyeHeight = face.eye_height;
  const eyeColor = palette.eye;
  const eyes = pose.blink
    ? `<path d="M${leftX - 5} 79 Q${leftX} 82 ${leftX + 5} 79" fill="none" stroke="${palette.line}" stroke-width="2.1" stroke-linecap="round"/><path d="M${rightX - 5} 79 Q${rightX} 82 ${rightX + 5} 79" fill="none" stroke="${palette.line}" stroke-width="2.1" stroke-linecap="round"/>`
    : `<ellipse cx="${leftX}" cy="79" rx="${eyeWidth}" ry="${eyeHeight}" fill="#fff"/><ellipse cx="${rightX}" cy="79" rx="${eyeWidth}" ry="${eyeHeight}" fill="#fff"/><ellipse cx="${n(leftX + eyeX)}" cy="${n(79 + eyeY)}" rx="${n(eyeWidth * 0.55)}" ry="${n(eyeHeight * 0.7)}" fill="${eyeColor}"/><ellipse cx="${n(rightX + eyeX)}" cy="${n(79 + eyeY)}" rx="${n(eyeWidth * 0.55)}" ry="${n(eyeHeight * 0.7)}" fill="${eyeColor}"/><circle cx="${n(leftX - 1 + eyeX)}" cy="${n(77.4 + eyeY)}" r="1.1" fill="#fff"/><circle cx="${n(rightX - 1 + eyeX)}" cy="${n(77.4 + eyeY)}" r="1.1" fill="#fff"/>`;

  const mouth = pose.smile >= 0
    ? `<path d="M91 92 Q96 ${n(94 + pose.smile * 1.5)} 101 92" fill="none" stroke="${palette.mouth}" stroke-width="1.7" stroke-linecap="round"/>`
    : `<path d="M91 95 Q96 ${n(91 + pose.smile)} 101 95" fill="none" stroke="${palette.mouth}" stroke-width="1.7" stroke-linecap="round"/>`;

  const markings = face.marking === 'scar'
    ? '<path d="M115 68 l-6 14" stroke="#7f5b61" stroke-width="1.4"/>'
    : face.marking === 'freckles'
      ? '<circle cx="69" cy="88" r="1" fill="#b77f78"/><circle cx="73" cy="89" r="0.8" fill="#b77f78"/><circle cx="119" cy="88" r="1" fill="#b77f78"/><circle cx="123" cy="89" r="0.8" fill="#b77f78"/>'
      : face.marking === 'tattoo'
        ? `<path d="M64 80 q5 -4 9 1 l-4 7" fill="none" stroke="${palette.accent}" stroke-width="2"/>`
        : '';

  return `${eyes}${mouth}${markings}`;
}
