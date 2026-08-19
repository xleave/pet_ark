import { intentJsonSchema } from './intent.mjs';
import { MockAiProvider } from './mock-ai-provider.mjs';

function prompt(context, config) {
  return [
    'You are the intent planner for a Wayland desktop pet.',
    'Choose only harmless allowlisted actions. Never request shell, keyboard, file, or network access.',
    `Personality: ${JSON.stringify(config.personality)}`,
    `Context: ${JSON.stringify(context)}`,
    'Return no more than 4 short-lived intents. Empty intents are valid.',
  ].join('\n');
}

function apiKey(config) {
  return config.provider.api_key_env ? process.env[config.provider.api_key_env] : '';
}

function headers(config) {
  const key = apiKey(config);
  return {
    'content-type': 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  };
}

function extractResponsesText(value) {
  if (typeof value.output_text === 'string') return value.output_text;
  for (const item of value.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('AI response has no structured text');
}

class OpenAiCompatibleProvider {
  constructor(config) { this.config = config; }
  async decide(context) {
    const base = this.config.provider.endpoint.replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(this.config.provider.timeout_ms),
      headers: headers(this.config),
      body: JSON.stringify({
        model: this.config.provider.model,
        messages: [{ role: 'user', content: prompt(context, this.config) }],
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'pet_ark_intents', strict: true, schema: intentJsonSchema() },
        },
      }),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const value = await response.json();
    const text = value.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('AI response has no message content');
    return JSON.parse(text).intents || [];
  }
}

class OpenAiResponsesProvider {
  constructor(config) { this.config = config; }
  async decide(context) {
    const base = this.config.provider.endpoint.replace(/\/$/, '').replace(/\/v1$/, '');
    const response = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      signal: AbortSignal.timeout(this.config.provider.timeout_ms),
      headers: headers(this.config),
      body: JSON.stringify({
        model: this.config.provider.model,
        input: prompt(context, this.config),
        text: { format: { type: 'json_schema', name: 'pet_ark_intents', strict: true, schema: intentJsonSchema() } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Responses HTTP ${response.status}`);
    return JSON.parse(extractResponsesText(await response.json())).intents || [];
  }
}

export function createProvider(config) {
  if (config.provider.kind === 'openai-compatible') return new OpenAiCompatibleProvider(config);
  if (config.provider.kind === 'openai-responses') return new OpenAiResponsesProvider(config);
  return new MockAiProvider(config);
}
