import { normalizeIntent } from './intent.mjs';

const ACTION_LEASE_MS = Object.freeze({
  look_at: 700,
  emote: 1800,
  wake: 1800,
  cancel: 500,
  rest: 2600,
  sleep: 2600,
  move_to: 5000,
  follow: 5000,
  flee: 5000,
  sequence: 5000,
});

function activeIntent(intent, now) {
  return {
    ...intent,
    active_until: Math.min(intent.expires_at, now + (ACTION_LEASE_MS[intent.action] || 1800)),
  };
}

export class BehaviorScheduler {
  constructor({ onEvent = () => {} } = {}) {
    this.queue = [];
    this.cooldowns = new Map();
    this.active = new Map();
    this.onEvent = onEvent;
  }

  submit(candidate, now = Date.now()) {
    let intent;
    try { intent = normalizeIntent(candidate, now); }
    catch (error) {
      this.onEvent({ type: 'rejected', reason: error.message, candidate, timestamp: now });
      return false;
    }
    if ((this.cooldowns.get(intent.cooldown_key) || 0) > now) {
      this.onEvent({ type: 'suppressed', reason: 'cooldown', intent, timestamp: now });
      return false;
    }
    this.queue.push(intent);
    this.queue.sort((left, right) => right.priority - left.priority || left.not_before - right.not_before);
    this.onEvent({ type: 'queued', intent, timestamp: now });
    return true;
  }

  cancel(target, reason = 'cancelled', now = Date.now()) {
    this.queue = this.queue.filter((intent) => intent.target !== target);
    const active = this.active.get(target);
    this.active.delete(target);
    this.onEvent({ type: 'cancelled', target, active, reason, timestamp: now });
  }

  drain(now = Date.now()) {
    for (const [target, active] of this.active) {
      if (active.active_until <= now) this.active.delete(target);
    }
    const ready = [];
    const deferred = [];
    for (const intent of this.queue) {
      if (intent.expires_at <= now) {
        this.onEvent({ type: 'expired', intent, timestamp: now });
        continue;
      }
      if (intent.not_before > now) {
        deferred.push(intent);
        continue;
      }
      const active = this.active.get(intent.target);
      if (active && active.priority >= intent.priority && active.active_until > now) {
        deferred.push(intent);
        continue;
      }
      if (ready.some((entry) => entry.target === intent.target)) {
        deferred.push(intent);
        continue;
      }
      if (active && active.id !== intent.id) {
        this.onEvent({ type: 'preempted', intent: active, by: intent.id, timestamp: now });
      }
      ready.push(intent);
      this.active.set(intent.target, activeIntent(intent, now));
      this.cooldowns.set(intent.cooldown_key, now + intent.cooldown_ms);
    }
    this.queue = deferred;
    return ready;
  }

  snapshot(now = Date.now()) {
    return {
      queued: this.queue.filter((intent) => intent.expires_at > now),
      active: [...this.active.values()].filter((intent) => intent.active_until > now),
      cooldowns: Object.fromEntries([...this.cooldowns].filter(([, until]) => until > now)),
    };
  }
}
