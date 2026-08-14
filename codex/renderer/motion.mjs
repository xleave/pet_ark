import { STATES } from '../build/config.mjs';

const stateFrames = new Map(STATES.map((state) => [state.id, state.frames]));

export function createPose(state, frame, dynamics = {}) {
  const frames = stateFrames.get(state);
  if (!frames || frame < 0 || frame >= frames) throw new Error(`Invalid frame ${state}:${frame}`);
  const t = (frame / frames) * Math.PI * 2;
  const pose = {
    bodyX: 0,
    bodyY: 0,
    bob: 0,
    crouch: 0,
    headTilt: 0,
    blink: false,
    smile: 0.2,
    eyeX: 0,
    eyeY: 0,
    armL: 0,
    armR: 0,
    forearmL: 0,
    forearmR: 0,
    legL: 0,
    legR: 0,
    mirror: state === 'running-left',
    slump: 0,
    hairLag: 0,
    coatLag: 0,
    earBounce: 0,
    tailSwing: 0,
    haloLift: 0,
    weaponLag: 0,
    companionBob: 0,
  };

  if (state === 'idle') {
    pose.bob = Math.sin(t) * 1.5;
    pose.headTilt = Math.sin(t * 0.5) * 1.5;
    pose.blink = frame === Math.floor(frames / 2);
    pose.eyeX = Math.sin(t * 0.5) * 0.7;
  } else if (state === 'running-right' || state === 'running-left') {
    const stride = Math.sin(t);
    pose.bodyX = 3;
    pose.bob = -Math.abs(stride) * 2.7;
    pose.headTilt = -5;
    pose.legL = stride * 14;
    pose.legR = -stride * 14;
    pose.armL = -stride * 11 - 7;
    pose.armR = stride * 10 + 7;
    pose.hairLag = -8 + Math.sin(t + 0.45) * 4;
    pose.coatLag = -7 + Math.sin(t + 0.75) * 4;
    pose.weaponLag = -5 + Math.sin(t + 0.25) * 3;
    pose.blink = frame === 6;
  } else if (state === 'waving') {
    pose.armR = [-18, -48, -30, -52][frame];
    pose.forearmR = Math.sin(t) * 18;
    pose.headTilt = -3 + Math.sin(t) * 2;
    pose.bob = Math.sin(t) * 1.2;
    pose.smile = 1;
  } else if (state === 'jumping') {
    pose.bodyY = [0, -11, -24, -18, -5][frame];
    pose.crouch = [5, 1, 0, 0, 3][frame];
    pose.legL = [6, -4, -8, -5, 5][frame];
    pose.legR = [-6, 5, 8, 5, -5][frame];
    pose.armL = [0, -10, -15, -12, 0][frame];
    pose.armR = [0, 12, 17, 13, 0][frame];
    pose.hairLag = [0, 2, 7, 5, 0][frame];
    pose.coatLag = [0, 3, 8, 5, 0][frame];
    pose.smile = 0.65;
  } else if (state === 'failed') {
    pose.slump = 7 + Math.sin(t) * 1.1;
    pose.bodyY = 7;
    pose.headTilt = 9 + Math.sin(t) * 1.5;
    pose.blink = true;
    pose.smile = -0.75;
    pose.armL = 7;
    pose.armR = -4;
  } else if (state === 'waiting') {
    pose.bob = Math.sin(t) * 1.1;
    pose.headTilt = 5 + Math.sin(t * 0.5) * 2;
    pose.armL = -8;
    pose.armR = 8;
    pose.eyeY = -0.5;
    pose.blink = frame === 4;
    pose.smile = 0.4;
  } else if (state === 'running') {
    pose.bob = Math.sin(t * 2) * 0.8;
    pose.headTilt = -4 + Math.sin(t) * 1.2;
    pose.eyeX = Math.sin(t * 2) * 1.3;
    pose.armL = -15 + Math.sin(t * 2) * 4;
    pose.armR = 13 - Math.sin(t * 2) * 4;
    pose.forearmL = Math.sin(t * 2) * 6;
    pose.forearmR = -Math.sin(t * 2) * 6;
    pose.blink = frame === 4;
  } else if (state === 'review') {
    const tilts = [-4, -1, 2, 4, 1, -2];
    const eyes = [-1.7, -0.9, 0.1, 1.5, 0.8, -0.7];
    pose.bob = Math.sin(t) * 0.7;
    pose.headTilt = tilts[frame];
    pose.eyeX = eyes[frame];
    pose.armL = -9;
    pose.armR = 10;
    pose.blink = frame === 4;
  }

  const hairWeight = dynamics.hair_weight ?? 1;
  const coatWeight = dynamics.coat_weight ?? 1;
  const tailWeight = dynamics.tail_weight ?? 1;
  pose.hairLag += Math.sin(t + 0.7) * 2.2 * hairWeight;
  pose.coatLag += Math.sin(t + 1.05) * 1.6 * coatWeight;
  pose.earBounce = Math.sin(t * 2) * (state.startsWith('running') ? 2.4 : 0.8);
  pose.tailSwing = Math.sin(t + 0.4) * (state.startsWith('running') ? 13 : 5) * tailWeight;
  pose.haloLift = -pose.bob * 0.45;
  pose.companionBob = Math.sin(t + 1.4) * 2.4;
  return pose;
}
