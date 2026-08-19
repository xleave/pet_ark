import { behaviorEnabled } from './config.mjs';

function target(context) {
  return context.target || context.instances?.[0]?.instance || 'default';
}

function intent(context, action, options = {}) {
  return {
    target: options.target || target(context),
    action,
    params: options.params || {},
    priority: options.priority ?? 50,
    delay_ms: options.delay_ms || 0,
    ttl_ms: options.ttl_ms || 10000,
    cooldown_key: options.cooldown_key || `${context.type}:${target(context)}:${action}`,
    cooldown_ms: options.cooldown_ms ?? 5000,
    speech: options.speech || '',
    reason: options.reason || context.type,
    source: 'mock-ai',
  };
}

export class MockAiProvider {
  constructor(config) { this.config = config; }

  async decide(context) {
    const enabled = (key) => behaviorEnabled(this.config, key);
    const app = String(context.app_id || '').toLocaleLowerCase();
    const result = [];
    if (context.type === 'focus_changed' && enabled('focus_greeting')) {
      result.push(intent(context, 'wake', { priority: 55, cooldown_ms: 8000, speech: '欢迎回来。' }));
    }
    if (context.type === 'focus_changed' && enabled('terminal_companion') && /terminal|alacritty|kitty|wezterm|foot|code/.test(app)) {
      result.push(intent(context, 'look_at', { params: { direction: context.focus_direction || 1 }, priority: 42, delay_ms: 350 }));
    }
    if (context.type === 'focus_changed' && enabled('browser_curiosity') && /firefox|chrome|chromium|browser/.test(app)) {
      result.push(intent(context, 'emote', { params: { event: 'attention' }, priority: 38, delay_ms: 500, cooldown_ms: 18000 }));
    }
    if (context.type === 'focus_changed' && enabled('media_quiet') && /mpv|vlc|video|gamescope/.test(app)) {
      result.push(intent(context, 'rest', { priority: 70, cooldown_ms: 30000, speech: '' }));
    }
    if (context.type === 'workspace_changed' && enabled('workspace_hop')) {
      result.push(intent(context, 'emote', { params: { event: 'celebrate' }, priority: 46, cooldown_ms: 20000 }));
    }
    if (context.type === 'window_opened' && enabled('window_opened')) {
      result.push(intent(context, 'emote', { params: { event: 'attention' }, priority: 36, cooldown_ms: 10000 }));
    }
    if (context.type === 'window_closed' && enabled('window_closed')) {
      result.push(intent(context, 'look_at', { params: { direction: -1 }, priority: 30, cooldown_ms: 5000 }));
    }
    if (context.type === 'window_urgent' && enabled('window_urgent')) {
      result.push(intent(context, 'emote', { params: { event: 'celebrate' }, priority: 82, cooldown_ms: 6000, speech: '有新的动静。' }));
    }
    if (context.type === 'overview_changed' && enabled('overview_quiet')) {
      result.push(intent(context, context.open ? 'rest' : 'wake', { priority: 72, cooldown_ms: 3000 }));
    }
    if (context.type === 'pointer_enter' && enabled('pointer_greeting')) {
      result.push(intent(context, 'emote', { params: { event: 'attention' }, priority: 76, cooldown_ms: 12000 }));
    }
    if (context.type === 'social_tick' && enabled('social_meeting') && context.instances?.length >= 2) {
      const [first, second] = context.instances;
      result.push(intent(context, 'follow', {
        target: first.instance,
        params: { target_instance: second.instance, gap: 88 },
        priority: 34,
        cooldown_ms: 45000,
        speech: '过去看看。',
      }));
      result.push(intent(context, 'look_at', {
        target: second.instance,
        params: { target_instance: first.instance },
        priority: 32,
        delay_ms: 900,
        cooldown_ms: 45000,
      }));
    }
    if (context.type === 'collision' && enabled('collision_avoidance')) {
      result.push(intent(context, 'flee', {
        target: context.target,
        params: { target_instance: context.other },
        priority: 90,
        cooldown_ms: 8000,
      }));
    }
    return result;
  }
}
