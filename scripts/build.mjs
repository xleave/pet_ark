import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const execFileAsync = promisify(execFile);

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const ROWS = 9;
const OUT_W = CELL_W * COLS;
const OUT_H = CELL_H * ROWS;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist', 'priestess-chibi');

const STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
];

const fmt = (v) => Number(v.toFixed(2));

function motion(state, frame) {
  const t = (frame / COLS) * Math.PI * 2;
  const m = {
    bodyY: 0, bodyX: 0, bob: 0, headTilt: 0, blink: false, smile: 0.2,
    eyeX: 0, eyeY: 0, armL: 0, armR: 0, handL: 0, handR: 0,
    legL: 0, legR: 0, coatSwing: 0, hairSwing: 0, tabletTilt: -6,
    mirror: false, slump: 0, crouch: 0,
  };

  if (state === 'idle') {
    m.bob = Math.sin(t) * 1.6;
    m.headTilt = Math.sin(t * 0.5) * 1.4;
    m.hairSwing = Math.sin(t + 0.7) * 2.2;
    m.coatSwing = Math.sin(t + 1.1) * 1.4;
    m.blink = frame === 3 || frame === 7;
    m.eyeX = Math.sin(t * 0.5) * 0.7;
  } else if (state === 'running-right' || state === 'running-left') {
    const stride = Math.sin(t);
    m.bob = Math.abs(Math.sin(t)) * -2.6;
    m.bodyX = 3;
    m.headTilt = -5;
    m.legL = stride * 13;
    m.legR = -stride * 13;
    m.armL = -stride * 10 - 8;
    m.armR = stride * 8 + 7;
    m.hairSwing = -8 + Math.sin(t + 0.5) * 4;
    m.coatSwing = -7 + Math.sin(t + 0.8) * 4;
    m.tabletTilt = -15;
    m.blink = frame === 6;
    m.mirror = state === 'running-left';
  } else if (state === 'waving') {
    m.armR = [-16, -31, -48, -28, -52, -31, -44, -18][frame];
    m.handR = Math.sin(t * 2) * 16;
    m.headTilt = -3 + Math.sin(t) * 2;
    m.bob = Math.sin(t) * 1.2;
    m.smile = 1;
    m.blink = frame === 5;
    m.tabletTilt = -9;
  } else if (state === 'jumping') {
    m.bodyY = [0, -7, -16, -24, -21, -13, -5, 0][frame];
    m.crouch = frame === 0 || frame === 7 ? 5 : frame === 1 || frame === 6 ? 2 : 0;
    m.legL = frame >= 2 && frame <= 5 ? -7 : 5;
    m.legR = frame >= 2 && frame <= 5 ? 7 : -5;
    m.armL = frame >= 2 && frame <= 5 ? -14 : 0;
    m.armR = frame >= 2 && frame <= 5 ? 16 : 0;
    m.hairSwing = frame >= 2 && frame <= 5 ? 5 : 0;
    m.coatSwing = frame >= 2 && frame <= 5 ? 7 : 0;
    m.smile = 0.7;
  } else if (state === 'failed') {
    m.slump = 7 + Math.sin(t) * 1.1;
    m.bodyY = 8;
    m.headTilt = 9 + Math.sin(t) * 1.5;
    m.blink = true;
    m.smile = -0.7;
    m.armL = 8;
    m.armR = -4;
    m.tabletTilt = 12;
    m.coatSwing = Math.sin(t) * 1.5;
  } else if (state === 'waiting') {
    m.bob = Math.sin(t) * 1.2;
    m.headTilt = 5 + Math.sin(t * 0.5) * 2.2;
    m.armL = -8;
    m.armR = 8;
    m.tabletTilt = 0;
    m.eyeY = -0.5;
    m.blink = frame === 4;
    m.smile = 0.45;
  } else if (state === 'running') {
    m.bob = Math.sin(t * 2) * 0.8;
    m.headTilt = -4 + Math.sin(t) * 1.2;
    m.eyeX = Math.sin(t * 2) * 1.4;
    m.armL = -15 + Math.sin(t * 2) * 4;
    m.armR = 13 - Math.sin(t * 2) * 4;
    m.handL = Math.sin(t * 2) * 6;
    m.handR = -Math.sin(t * 2) * 6;
    m.tabletTilt = -1 + Math.sin(t) * 3;
    m.blink = frame === 6;
    m.smile = 0.1;
  } else if (state === 'review') {
    m.bob = Math.sin(t) * 0.7;
    m.headTilt = [-4, -2, 1, 3, 4, 2, 0, -2][frame];
    m.eyeX = [-1.7, -1.2, -0.5, 0.6, 1.5, 1.0, 0.2, -0.8][frame];
    m.eyeY = [0, -0.3, -0.4, -0.2, 0, 0.2, 0.1, 0][frame];
    m.armL = -9;
    m.armR = 10;
    m.tabletTilt = [-5, -3, -1, 1, 3, 1, -2, -4][frame];
    m.blink = frame === 5;
    m.smile = 0.15;
  }
  return m;
}

function face(m) {
  const x = fmt(m.eyeX), y = fmt(m.eyeY);
  const eyes = m.blink
    ? `<path d="M72 79 Q77 82 82 79" fill="none" stroke="#3b3147" stroke-width="2.2" stroke-linecap="round"/><path d="M109 79 Q114 82 119 79" fill="none" stroke="#3b3147" stroke-width="2.2" stroke-linecap="round"/>`
    : `<ellipse cx="77" cy="79" rx="6.4" ry="7.2" fill="#f7f4ff"/><ellipse cx="114" cy="79" rx="6.4" ry="7.2" fill="#f7f4ff"/><ellipse cx="${77+x}" cy="${79+y}" rx="3.2" ry="4.4" fill="#76638e"/><ellipse cx="${114+x}" cy="${79+y}" rx="3.2" ry="4.4" fill="#76638e"/><circle cx="${76+x}" cy="${77.5+y}" r="1.15" fill="#fff"/><circle cx="${113+x}" cy="${77.5+y}" r="1.15" fill="#fff"/>`;
  const my = m.smile >= 0 ? 91 : 94;
  const mouth = m.smile >= 0
    ? `<path d="M91 ${my} Q96 ${my + 2.5 + m.smile*1.4} 101 ${my}" fill="none" stroke="#7a4d5e" stroke-width="1.8" stroke-linecap="round"/>`
    : `<path d="M91 ${my} Q96 ${my - 3.5} 101 ${my}" fill="none" stroke="#7a4d5e" stroke-width="1.8" stroke-linecap="round"/>`;
  return eyes + mouth;
}

function arm(side, angle, handAngle, state) {
  const left = side === 'L';
  const shoulderX = left ? 70 : 122;
  const foreX = left ? 62 : 130;
  const handX = left ? 59 : 133;
  const sign = left ? -1 : 1;
  const waveLift = state === 'waving' && !left ? -22 : 0;
  return `<g transform="rotate(${fmt(angle)} ${shoulderX} 120)"><rect x="${left ? 55 : 121}" y="111" width="17" height="42" rx="8" fill="#eef1f3" stroke="#41434d" stroke-width="2"/><rect x="${left ? 53 : 125}" y="137" width="15" height="28" rx="7" fill="#d7dce1" stroke="#41434d" stroke-width="2" transform="rotate(${fmt(handAngle)} ${foreX} 141)"/><circle cx="${handX + sign}" cy="${163 + waveLift}" r="6.4" fill="#f4d7d2" stroke="#6a5256" stroke-width="1.4"/></g>`;
}

function leg(side, angle, crouch) {
  const left = side === 'L';
  const x = left ? 80 : 103;
  const footX = left ? 74 : 100;
  const sign = left ? -1 : 1;
  return `<g transform="rotate(${fmt(angle)} ${x} ${157 + crouch})"><rect x="${x-5}" y="154" width="11" height="31" rx="5" fill="#26242d"/><path d="M${footX-4} 183 Q${footX+7*sign} 181 ${footX+13*sign} 188 Q${footX+5*sign} 194 ${footX-5} 190 Z" fill="#34333c" stroke="#16151a" stroke-width="1.5"/></g>`;
}

function spriteSvg(state, frame) {
  const m = motion(state, frame);
  const mirror = m.mirror ? 'translate(192 0) scale(-1 1)' : '';
  const y = fmt(m.bodyY + m.bob + m.slump);
  const crouch = fmt(m.crouch);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="192" height="208" viewBox="0 0 192 208"><g transform="${mirror}"><g transform="translate(${fmt(m.bodyX)} ${y})"><g transform="rotate(${fmt(m.hairSwing)} 96 92)"><path d="M58 70 Q61 38 95 34 Q131 38 134 72 L139 139 Q125 151 113 139 L110 84 L82 84 L79 139 Q64 151 52 136 Z" fill="#23232b" stroke="#101116" stroke-width="2.4"/><path d="M64 72 Q58 102 61 138" fill="none" stroke="#45434f" stroke-width="3" opacity="0.7"/><path d="M127 72 Q134 101 131 138" fill="none" stroke="#45434f" stroke-width="3" opacity="0.65"/></g>${leg('L',m.legL,crouch)}${leg('R',m.legR,crouch)}<g transform="rotate(${fmt(m.coatSwing)} 96 131)"><path d="M68 126 L63 180 Q73 187 85 174 L91 135 Z" fill="#dfe4e7" stroke="#4b4d55" stroke-width="2"/><path d="M123 126 L130 178 Q119 187 107 174 L101 135 Z" fill="#e8ecee" stroke="#4b4d55" stroke-width="2"/><path d="M65 165 L79 160" stroke="#8a8d95" stroke-width="2"/><path d="M113 160 L128 166" stroke="#8a8d95" stroke-width="2"/></g><path d="M75 ${103+crouch} Q96 96 117 ${103+crouch} L124 148 Q96 160 68 148 Z" fill="#f3f4f4" stroke="#44464f" stroke-width="2.3"/><path d="M84 107 L96 118 L108 107" fill="none" stroke="#b7bbc1" stroke-width="2"/><path d="M88 108 L96 120 L104 108" fill="#25252d"/><path d="M72 145 Q96 154 120 145 L116 157 L77 157 Z" fill="#292831"/><path d="M79 151 L113 151" stroke="#765398" stroke-width="3.6" stroke-linecap="round"/>${arm('L',m.armL,m.handL,state)}${arm('R',m.armR,m.handR,state)}<g transform="rotate(${fmt(m.tabletTilt)} 96 143)"><rect x="85" y="130" width="27" height="35" rx="3" fill="#59606a" stroke="#262830" stroke-width="2"/><rect x="88" y="133" width="21" height="27" rx="2" fill="#cbd4d8"/><path d="M91 139 H106 M91 144 H104 M91 149 H106" stroke="#7a838b" stroke-width="1.4" stroke-linecap="round"/><rect x="87" y="158" width="5" height="4" rx="1" fill="#d8be70"/></g><rect x="91" y="93" width="10" height="15" rx="5" fill="#f1d2ce"/><g transform="rotate(${fmt(m.headTilt)} 96 78)"><ellipse cx="96" cy="76" rx="34" ry="31" fill="#f4d8d3" stroke="#3f3b42" stroke-width="2.2"/><path d="M63 69 Q61 43 92 39 Q126 40 129 68 Q119 59 110 55 Q106 66 98 70 Q96 57 88 53 Q80 66 64 75 Z" fill="#272730"/><path d="M70 53 Q81 42 95 42" fill="none" stroke="#55525e" stroke-width="2.4" opacity="0.8"/><path d="M104 43 Q118 48 123 59" fill="none" stroke="#55525e" stroke-width="2.2" opacity="0.75"/>${face(m)}<path d="M64 67 Q58 84 67 104 L77 93 Q71 81 74 68 Z" fill="#24242c"/><path d="M128 66 Q135 84 125 104 L116 94 Q122 81 118 67 Z" fill="#24242c"/><rect x="118" y="55" width="9" height="2.5" rx="1.2" fill="#a7a5b0" transform="rotate(-18 118 55)"/></g><path d="M91 104 L96 110 L101 104 L96 101 Z" fill="#22232a"/><rect x="70" y="113" width="13" height="9" rx="1.5" fill="#e9eef0" stroke="#6d7279" stroke-width="1.3"/><rect x="72" y="115" width="3" height="3" fill="#78629a"/><path d="M76 116 H81 M76 119 H80" stroke="#838991" stroke-width="1"/></g></g></svg>`;
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  const composites = [];
  const frameDir = path.join(OUT_DIR, 'frames');
  await fs.mkdir(frameDir, { recursive: true });

  for (let row = 0; row < STATES.length; row++) {
    for (let col = 0; col < COLS; col++) {
      const state = STATES[row];
      const png = await sharp(Buffer.from(spriteSvg(state, col))).png().toBuffer();
      await fs.writeFile(path.join(frameDir, `${String(row).padStart(2,'0')}-${state}-${col}.png`), png);
      composites.push({ input: png, left: col * CELL_W, top: row * CELL_H });
    }
  }

  const composed = await sharp({ create: { width: OUT_W, height: OUT_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < composed.data.length; i += composed.info.channels) {
    if (composed.data[i + 3] === 0) composed.data[i] = composed.data[i + 1] = composed.data[i + 2] = 0;
  }

  const pngAtlas = path.join(OUT_DIR, 'spritesheet.png');
  await sharp(composed.data, { raw: { width: OUT_W, height: OUT_H, channels: 4 } }).png().toFile(pngAtlas);
  await execFileAsync('python3', [path.join(ROOT, 'scripts', 'encode-webp-exact.py'), pngAtlas, path.join(OUT_DIR, 'spritesheet.webp')]);
  await fs.rm(pngAtlas, { force: true });

  const pet = { id: 'priestess-chibi', displayName: '普瑞赛斯·Q版', description: '以《明日方舟》普瑞赛斯为灵感设计的 Q 版 Codex 桌宠，包含 9 个状态、每状态 8 帧。', spritesheetPath: 'spritesheet.webp' };
  await fs.writeFile(path.join(OUT_DIR, 'pet.json'), JSON.stringify(pet, null, 2) + '\n');
  const manifest = { atlas: { columns: COLS, rows: ROWS, cellWidth: CELL_W, cellHeight: CELL_H, width: OUT_W, height: OUT_H }, states: STATES.map((id,row)=>({id,row,frames:COLS})), style: 'hand-authored chibi vector, rendered to lossless WebP' };
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built ${OUT_W}x${OUT_H} Priestess atlas (${STATES.length * COLS} frames)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
