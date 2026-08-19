import type { AiProviderKind } from './types';

export const AI_PROVIDER_OPTIONS: { value: AiProviderKind; label: string }[] = [
  { value: 'mock', label: '内置模拟' },
  { value: 'openai-compatible', label: '本地兼容接口' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
];

export const BEHAVIOR_OPTIONS = [
  ['focus_greeting', '焦点问候'],
  ['terminal_companion', '终端陪伴'],
  ['browser_curiosity', '浏览器好奇'],
  ['media_quiet', '媒体安静'],
  ['workspace_hop', '工作区切换'],
  ['window_opened', '新窗口响应'],
  ['window_closed', '窗口关闭响应'],
  ['window_urgent', '紧急窗口响应'],
  ['overview_quiet', '总览安静模式'],
  ['pointer_greeting', '指针悬停问候'],
  ['social_meeting', '桌宠相遇'],
  ['collision_avoidance', '重叠避让'],
] as const;

export const TIMELINE_LABELS: Record<string, string> = {
  queued: '已排队',
  executed: '已执行',
  suppressed: '已抑制',
  rejected: '已拒绝',
  expired: '已过期',
  cancelled: '已取消',
  preempted: '被抢占',
  failed: '执行失败',
};
