export const ACTIONS = Object.freeze([
  'emote',
  'move_to',
  'follow',
  'flee',
  'look_at',
  'rest',
  'sleep',
  'wake',
  'sequence',
  'cancel',
]);

const SAFE_ID = /^[a-z0-9._-]+$/i;

function finite(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cleanParams(value) {
  const params = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  if (Number.isFinite(Number(params.x))) result.x = finite(params.x, 0, 0, 32768);
  if (params.direction === -1 || params.direction === 1) result.direction = params.direction;
  if (typeof params.target_instance === 'string' && SAFE_ID.test(params.target_instance)) {
    result.target_instance = params.target_instance;
  }
  if (typeof params.event === 'string' && ['attention', 'celebrate', 'wake'].includes(params.event)) {
    result.event = params.event;
  }
  if (typeof params.gap === 'number') result.gap = finite(params.gap, 72, 24, 480);
  return result;
}

export function normalizeIntent(value, now = Date.now()) {
  if (!value || typeof value !== 'object') throw new Error('intent must be an object');
  const target = String(value.target || 'default');
  if (!SAFE_ID.test(target)) throw new Error('intent target is invalid');
  const action = String(value.action || '');
  if (!ACTIONS.includes(action)) throw new Error(`unsupported intent action: ${action}`);
  const createdAt = Math.round(finite(value.created_at, now, 0, Number.MAX_SAFE_INTEGER));
  const ttlMs = Math.round(finite(value.ttl_ms, 10000, 250, 60000));
  const delayMs = Math.round(finite(value.delay_ms, 0, 0, 60000));
  const id = typeof value.id === 'string' && SAFE_ID.test(value.id)
    ? value.id
    : `intent-${createdAt}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    target,
    action,
    params: cleanParams(value.params),
    priority: Math.round(finite(value.priority, 50, 0, 100)),
    created_at: createdAt,
    not_before: createdAt + delayMs,
    expires_at: createdAt + delayMs + ttlMs,
    cooldown_key: typeof value.cooldown_key === 'string'
      ? value.cooldown_key.replace(/[^a-z0-9._:-]+/gi, '-').slice(0, 120)
      : `${target}:${action}`,
    cooldown_ms: Math.round(finite(value.cooldown_ms, 3000, 0, 300000)),
    speech: typeof value.speech === 'string' ? value.speech.trim().slice(0, 160) : '',
    reason: typeof value.reason === 'string' ? value.reason.trim().slice(0, 240) : '',
    source: typeof value.source === 'string' ? value.source.slice(0, 64) : 'unknown',
  };
}

export function intentJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      intents: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target: { type: 'string' },
            action: { type: 'string', enum: ACTIONS },
            params: {
              type: 'object',
              additionalProperties: false,
              properties: {
                x: { type: 'number' },
                direction: { type: 'integer', enum: [-1, 1] },
                target_instance: { type: 'string' },
                event: { type: 'string', enum: ['attention', 'celebrate', 'wake'] },
                gap: { type: 'number' },
              },
            },
            priority: { type: 'integer', minimum: 0, maximum: 100 },
            delay_ms: { type: 'integer', minimum: 0, maximum: 60000 },
            ttl_ms: { type: 'integer', minimum: 250, maximum: 60000 },
            cooldown_key: { type: 'string' },
            cooldown_ms: { type: 'integer', minimum: 0, maximum: 300000 },
            speech: { type: 'string', maxLength: 160 },
            reason: { type: 'string', maxLength: 240 },
          },
          required: ['target', 'action', 'params', 'priority', 'ttl_ms', 'reason'],
        },
      },
    },
    required: ['intents'],
  };
}
