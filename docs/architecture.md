# 架构

Pet Ark 由桌面运行时、图形控制中心、两条资产产线和共享数据层组成。

```text
Control Center ── systemd / journald / Unix socket ─────────┐
Behavior Core ── niri events / spatial bus / AI intents ───┤
                                                           ▼
                                               Wayland pet instances
                                                           │
                                 standalone runtime atlas ─┘

shared character data ─┬─ standalone asset pipeline
                       └─ Codex atlas pipeline
```

## 运行时

`standalone/` 是原生 C / Wayland 应用。一个实例对应一个进程和一个 transparent layer surface，内部包含：

- 角色/外观 registry；
- idle、移动、互动、拖动、休息、睡眠、唤醒与 special 状态机；
- 输出边界、移动目标、朝向和输入区域；
- spritesheet 播放、`wl_shm` buffer 与 `wl_surface_frame` 节流；
- JSON Unix socket 控制协议。

默认实例由 `pet-ark.service` 管理；其他实例由 `pet-ark@.service` 模板管理。实例之间的进程、配置和 socket 相互独立。

## 控制中心

`control-center/` 使用 Svelte 5 + Tauri 2。标题栏的实例选择器是整个窗口的编辑上下文，总览、设置、日志和服务操作都指向同一个实例。

Rust backend 提供固定命令：

- 查询/控制 user systemd unit；
- 读取对应 unit 的 journald；
- 原子读写实例配置；
- 发送角色选择、参数更新与互动事件；
- 读取 registry 和 runtime atlas 生成预览。
- 管理 AI、性格、互动强度、隐私、行为开关、空间快照和事件时间线。

界面视觉规范由 `control-center/src/design-tokens.css` 统一定义，组合样式位于 `styles.css`。

## 行为核心

`scripts/pet-ark-context-broker.mjs` 订阅 niri JSON event stream，轮询各实例状态并维护空间总线。上下文先经过隐私裁剪，再交给 Mock、本地兼容接口或 Responses provider 生成 intent；调度器负责优先级、延迟、TTL、冷却、抢占和逐实例执行租约。运行时只接受白名单动作，不接收 shell、键盘、文件或任意网络能力。

## Standalone 资产产线

```text
Ark-Models PC-client Spine source
  → source/<character>/<variant>
  → cleaned frames
  → animation mapping / generated transitions
  → runtime atlases
  → coverage / quality index / contact sheets
```

运行时 registry 采用 `character → variants`。当前 source-of-truth 索引 425 个可玩角色、508 个皮肤、933 个外观，其中 932 个具有 Ark-Models 运行资产。动作 coverage 与清晰度/构图质量是两套独立报告：

- `standalone/dist/coverage.json`
- `standalone/dist/animation-coverage.json`
- `standalone/dist/asset-quality.json`

## Codex atlas 产线

`codex/` 生成固定 8 × 9、单格 192 × 208 的 Codex Pet atlas。renderer 使用代码绘制的 SVG/vector primitives，输出 `pet.json`、spritesheet、逐帧图和 coverage/contact sheets。

Codex 与 Standalone 只共享角色 ID、名称、来源记录和通用图像工具。两者的 atlas、状态、窗口和运行时格式互不依赖。

## 目录

```text
codex/                    Codex atlas 构建、renderer 与验证
standalone/app/           桌宠入口
standalone/runtime/       Wayland、状态机、移动和动画
standalone/assets/        source、cleaned、generated、runtime
control-center/           UI 与 Tauri backend
shared/character-data/    roster 与来源记录
shared/asset-tools/       获取、导出、修复与 registry 工具
shared/image-processing/  图像 QA、coverage 与 contact sheets
shared/behavior/          intent、调度器、AI provider 与回放夹具
scripts/                  部署、实例、控制与行为服务
```
