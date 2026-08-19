export interface RuntimeStatus {
  ok: boolean;
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
