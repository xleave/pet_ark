#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DEFAULT_BEHAVIOR_CONFIG, normalizeBehaviorConfig } from './config.mjs';
import { normalizeIntent } from './intent.mjs';
import { MockAiProvider } from './mock-ai-provider.mjs';
import { BehaviorScheduler } from './scheduler.mjs';

const config = normalizeBehaviorConfig(DEFAULT_BEHAVIOR_CONFIG);
assert.equal(config.provider.kind, 'mock');
assert.equal(config.privacy.include_window_title, false);

const schedulerEvents = [];
const scheduler = new BehaviorScheduler({ onEvent: (event) => schedulerEvents.push(event) });
assert.equal(scheduler.submit({ target: 'default', action: 'rest', priority: 20, ttl_ms: 5000 }, 1000), true);
assert.equal(scheduler.submit({ target: 'default', action: 'wake', priority: 80, ttl_ms: 5000 }, 1000), true);
assert.equal(scheduler.drain(1000)[0].action, 'wake');
assert.equal(scheduler.drain(1500).length, 0, 'lower priority action waits for the active lease');
assert.equal(scheduler.drain(3000)[0].action, 'rest', 'deferred action runs after the active lease');
assert.ok(schedulerEvents.some((event) => event.type === 'queued'));

const equalPriority = new BehaviorScheduler();
equalPriority.submit({ target: 'default', action: 'flee', priority: 90, ttl_ms: 12000, cooldown_ms: 0 }, 1000);
assert.equal(equalPriority.drain(1000).length, 1);
equalPriority.submit({ target: 'default', action: 'flee', priority: 90, ttl_ms: 12000, cooldown_ms: 0 }, 1100);
assert.equal(equalPriority.drain(1100).length, 0, 'equal-priority intent does not churn an active lease');
assert.equal(equalPriority.drain(6100).length, 1);

assert.throws(() => normalizeIntent({ target: '../bad', action: 'sleep' }), /target/);
assert.throws(() => normalizeIntent({ target: 'default', action: 'shell' }), /unsupported/);

const mock = new MockAiProvider(config);
const fixtures = [
  [{ type: 'focus_changed', target: 'default', app_id: 'Alacritty' }, ['wake', 'look_at']],
  [{ type: 'workspace_changed', target: 'default' }, ['emote']],
  [{ type: 'window_opened', target: 'default' }, ['emote']],
  [{ type: 'window_closed', target: 'default' }, ['look_at']],
  [{ type: 'window_urgent', target: 'default' }, ['emote']],
  [{ type: 'overview_changed', target: 'default', open: true }, ['rest']],
  [{ type: 'pointer_enter', target: 'default' }, ['emote']],
  [{ type: 'collision', target: 'default', other: 'side' }, ['flee']],
  [{ type: 'focus_changed', target: 'default', app_id: 'mpv' }, ['wake', 'rest']],
  [{ type: 'focus_changed', target: 'default', app_id: 'firefox' }, ['wake', 'emote']],
  [{ type: 'social_tick', instances: [{ instance: 'default' }, { instance: 'side' }] }, ['follow', 'look_at']],
];
for (const [context, actions] of fixtures) {
  const result = await mock.decide(context);
  assert.deepEqual(result.map((entry) => entry.action), actions, context.type);
}

console.log(`OK: behavior scheduler, strict intent boundary, and ${fixtures.length} Mock AI replay fixtures`);
