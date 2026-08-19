# Control Center 设计系统

Control Center 使用一套集中维护的现代工业视觉语言。

## 文件职责

| 文件 | 职责 |
|---|---|
| `control-center/src/design-tokens.css` | 色板、语义颜色、间距、控件高度、切角、字体与动效 |
| `control-center/src/styles.css` | 布局与可复用组件样式 |
| `control-center/src/behavior-definitions.ts` | AI、情境行为与时间线的统一标签 |
| `control-center/src/App.svelte` | 状态、语义化结构与交互 |

新界面先复用 token 和现有组件配方。原始颜色、动效时长、控件高度与新切角只在 `design-tokens.css` 定义。`npm run check:design` 检查这一约束。

## 视觉语言

- 深炭色表面与细钢色边框构成层级；
- 黄色表示主要动作和精确数值；
- 青色表示连接、启用和实时状态；
- 红色只用于错误和停止等危险动作；
- 方形、切角和机械栅格贯穿卡片、按钮与输入控件；
- 中文正文使用 Noto Sans SC，遥测标签使用 Barlow Condensed，日志与 ID 使用统一等宽字体。

## 控件规则

- 浏览器原生白色外观必须重置，保留键盘操作和清晰焦点；
- 数值滑块始终配套手动输入和微调按钮；
- 同一实体在总览、编队、设置和服务页使用一致的状态词汇；
- 标题栏实例选择器是全窗口上下文，不在各页面重复创建实例选择逻辑；
- 状态不能只依靠颜色表达；
- `prefers-reduced-motion` 使用 `--motion-reduced`。

## 常用配方

- `.primary`：主要提交动作；
- `.ghost`：次要动作；
- `.danger-soft`：停止等可恢复的危险动作；
- `.switch-row`：布尔设置；
- `.precision-stepper`：数值输入与 ± 微调；
- `.instance-card`：桌宠实例；
- `.card-title`：面板标题与紧凑状态标签。

增加组件时优先扩展这些配方；只有不同的语义或交互模型才新增组件。
