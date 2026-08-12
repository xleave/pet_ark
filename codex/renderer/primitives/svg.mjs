export const n = (value) => Number(value.toFixed(2));

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function rotate(fragment, angle, x, y) {
  return `<g transform="rotate(${n(angle)} ${x} ${y})">${fragment}</g>`;
}

export function translate(fragment, x, y) {
  return `<g transform="translate(${n(x)} ${n(y)})">${fragment}</g>`;
}
