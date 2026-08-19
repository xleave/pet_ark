export interface RuntimeStatus {
  ok: boolean;
  instance?: string;
  pid: number;
  character: string;
  variant: string;
  scale: number;
  speed: number;
  auto_move: boolean;
  click_through: boolean;
  monitor: number;
  outputs: number;
  shell: string;
  behavior: string;
  animation: string;
  x: number;
  y: number;
  width: number;
  height: number;
  surface_width: number;
  surface_height: number;
  direction: number;
  pointer_inside: boolean;
  pointer_x: number;
  pointer_y: number;
}

export interface PetInstance {
  id: string;
  character: string;
  variant: string;
  active: boolean;
  pid: number;
  autostart: boolean;
}

export interface ServiceStatus {
  installed: boolean;
  active: boolean;
  state: string;
  sub_state: string;
  pid: number;
  restarts: number;
  autostart: boolean;
}

export interface RuntimeConfig {
  character: string;
  variant: string;
  scale: number;
  speed: number;
  auto_move: boolean;
  click_through: boolean;
  monitor: number;
  verbose: boolean;
}

export interface VariantSummary {
  id: string;
  name: string;
  localized_name: string;
}

export interface CharacterSummary {
  id: string;
  name: string;
  localized_name: string;
  default_variant_id: string;
  variants: VariantSummary[];
}

export interface LogEntry {
  cursor: string;
  timestamp: string;
  priority: number;
  message: string;
}

export interface PreviewAsset {
  data_url: string;
  frame_width: number;
  frame_height: number;
  columns: number;
  rows: number;
  frames: number[];
  fps: number;
}

export type AiProviderKind = 'mock' | 'openai-compatible' | 'openai-responses';

export interface BehaviorConfig {
  schema_version: number;
  enabled: boolean;
  provider: {
    kind: AiProviderKind;
    endpoint: string;
    model: string;
    api_key_env: string;
    timeout_ms: number;
  };
  interaction_intensity: number;
  personality: {
    archetype: string;
    sociability: number;
    curiosity: number;
    energy: number;
  };
  privacy: {
    include_app_id: boolean;
    include_window_title: boolean;
    include_workspace_name: boolean;
    persist_timeline: boolean;
  };
  behaviors: Record<string, boolean>;
  per_instance: Record<string, unknown>;
}

export interface BehaviorEvent {
  timestamp: number;
  type: string;
  target?: string;
  action?: string;
  source?: string;
  reason?: string;
  speech?: string;
  provider?: string;
}

export interface BehaviorWorld {
  schema_version: number;
  timestamp: number;
  provider: { state: string; message: string; checked_at: number };
  interaction_intensity: number;
  instances: RuntimeStatus[];
  scheduler: { queued: unknown[]; active: unknown[]; cooldowns: Record<string, number> };
}
