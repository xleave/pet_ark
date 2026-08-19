export const BEHAVIOR_KEYS = Object.freeze([
  'focus_greeting',
  'terminal_companion',
  'browser_curiosity',
  'media_quiet',
  'workspace_hop',
  'window_opened',
  'window_closed',
  'window_urgent',
  'overview_quiet',
  'pointer_greeting',
  'social_meeting',
  'collision_avoidance',
]);

export const DEFAULT_BEHAVIOR_CONFIG = Object.freeze({
  schema_version: 1,
  enabled: true,
  provider: {
    kind: 'mock',
    endpoint: 'http://127.0.0.1:11434/v1',
    model: '',
    api_key_env: 'OPENAI_API_KEY',
    timeout_ms: 8000,
  },
  interaction_intensity: 0.65,
  personality: {
    archetype: 'companion',
    sociability: 0.72,
    curiosity: 0.68,
    energy: 0.58,
  },
  privacy: {
    include_app_id: true,
    include_window_title: false,
    include_workspace_name: false,
    persist_timeline: true,
  },
  behaviors: Object.fromEntries(BEHAVIOR_KEYS.map((key) => [key, true])),
  per_instance: {},
});

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function text(value, fallback, maximum = 160) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

export function normalizeBehaviorConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = source.provider && typeof source.provider === 'object' ? source.provider : {};
  const personality = source.personality && typeof source.personality === 'object' ? source.personality : {};
  const privacy = source.privacy && typeof source.privacy === 'object' ? source.privacy : {};
  const behaviors = source.behaviors && typeof source.behaviors === 'object' ? source.behaviors : {};
  const kind = ['mock', 'openai-compatible', 'openai-responses'].includes(provider.kind)
    ? provider.kind
    : DEFAULT_BEHAVIOR_CONFIG.provider.kind;
  return {
    schema_version: 1,
    enabled: source.enabled !== false,
    provider: {
      kind,
      endpoint: text(provider.endpoint, DEFAULT_BEHAVIOR_CONFIG.provider.endpoint, 512),
      model: typeof provider.model === 'string' ? provider.model.trim().slice(0, 160) : '',
      api_key_env: text(provider.api_key_env, DEFAULT_BEHAVIOR_CONFIG.provider.api_key_env, 96),
      timeout_ms: Math.round(number(provider.timeout_ms, 8000, 1000, 60000)),
    },
    interaction_intensity: number(source.interaction_intensity, 0.65, 0, 1),
    personality: {
      archetype: text(personality.archetype, 'companion', 64),
      sociability: number(personality.sociability, 0.72, 0, 1),
      curiosity: number(personality.curiosity, 0.68, 0, 1),
      energy: number(personality.energy, 0.58, 0, 1),
    },
    privacy: {
      include_app_id: privacy.include_app_id !== false,
      include_window_title: privacy.include_window_title === true,
      include_workspace_name: privacy.include_workspace_name === true,
      persist_timeline: privacy.persist_timeline !== false,
    },
    behaviors: Object.fromEntries(BEHAVIOR_KEYS.map((key) => [key, behaviors[key] !== false])),
    per_instance: source.per_instance && typeof source.per_instance === 'object' ? source.per_instance : {},
  };
}

export function behaviorEnabled(config, key) {
  return config.enabled && config.behaviors[key] !== false && config.interaction_intensity > 0;
}
