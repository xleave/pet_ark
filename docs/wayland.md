# Standalone Wayland 运行说明

standalone 是原生 Wayland C 客户端，不经过 Electron、X11 或 XWayland。它通过 `wl_shm` 提交透明像素，依赖保持为 `wayland-client`、`libpng`、C 标准库和仓库内生成的协议绑定。

## 为什么窗口覆盖输出而角色在内部移动

Wayland 客户端不能像 X11 客户端一样任意设置顶层窗口的全局坐标。桌宠因此创建输出大小的透明 surface，再只在 surface 内更新角色坐标。它不使用窗口定位 hack。

每帧 spritesheet metadata 都有从 alpha 计算的可见 bounds。runtime 将 `wl_surface` pointer input region 更新为角色当前可见区域；角色之外的透明画布不接收桌面点击。启用 click-through 时 input region 为空。

## Compositor 路径

| 环境 | 使用路径 | 预期行为 | 已知限制 |
|---|---|---|---|
| niri / wlroots / Smithay compositor | `wlr-layer-shell-unstable-v1` | transparent top-layer surface，角色在选定输出内移动 | 仍需在真实 niri 会话人工检查 layer、缩放、输入和多显示器 |
| KDE Plasma Wayland | compositor 提供 wlr layer-shell 时使用同一路径 | transparent layer surface | 不同 Plasma 版本的协议暴露和层级策略需实机核对 |
| GNOME Wayland | `xdg-shell` fallback | 原生 Wayland fullscreen 透明面、无客户端边框、内部移动，输入仅覆盖当前角色 bbox | GNOME 不提供 wlr layer-shell；不能保证 always-on-top，compositor 也可能按全屏应用管理 surface |

应用启动时优先检测 layer-shell global；不存在时自动使用 xdg-shell fullscreen fallback，不会强制 X11 或 XWayland。xdg fallback 通过 xdg-decoration 请求 client-side decoration，因此应用自身不绘制边框；compositor 是否额外装饰或保持层级仍由 compositor 决定。

## 构建依赖

Debian / Ubuntu：

```bash
sudo apt install build-essential pkg-config libwayland-dev libpng-dev
```

Fedora：

```bash
sudo dnf install gcc make pkgconf-pkg-config wayland-devel libpng-devel
```

编译：

```bash
npm run standalone:build
```

仅检查当前 Wayland session 暴露的 shell capability：

```bash
standalone/build/pet-ark --probe
```

`--probe` 需要可连接的 `WAYLAND_DISPLAY`；没有 compositor 的构建容器只能完成编译和纯逻辑测试，不能代替桌面实机验收。

## 启动与控制

```bash
npm run standalone:dev -- --character amiya -- --verbose
```

启动时选择皮肤：

```bash
npm run standalone:dev -- --character amiya --skin skin-winter-1 -- --verbose
```

常用应用参数放在第二个 `--` 之后：

```bash
npm run standalone:dev -- --character amiya -- --scale 0.8 --speed 1.25
npm run standalone:dev -- --character amiya -- --no-auto-move
npm run standalone:dev -- --character amiya -- --monitor 1
npm run standalone:dev -- --character amiya -- --click-through
```

运行时控制：

- 左键：播放 click reaction；按住并移动可抓取/拖动，释放播放 dropped transition。
- 右键：播放角色 special 动作。
- 中键：开关自动移动。
- 滚轮：调整缩放。
- `SIGUSR1`：开关 click-through；这是完全 click-through 后恢复输入的控制路径。
- `SIGUSR2`：开关自动移动。
- `SIGHUP`：切换到 registry 中下一个角色。
- `SIGRTMIN`：切换当前角色的下一个可用皮肤。
- 前台 `Ctrl-C` / `SIGINT` / `SIGTERM`：退出；compositor close 也会结束应用。

当前没有托盘或可视配置面板。缩放、速度、自动移动、角色、皮肤、显示器和 click-through 由上述 CLI/鼠标/信号入口管理；完全 click-through 后由 `SIGUSR1` 恢复，这是当前明确保留的外部控制路径。

例如：

```bash
pkill -USR1 -x pet-ark
pkill -HUP -x pet-ark
pkill -RTMIN -x pet-ark
pkill -TERM -x pet-ark
```

角色或皮肤切换只会选择 runtime assets 已存在的项。动画缺失时解析顺序为当前皮肤精确状态、当前皮肤显式兼容状态、同角色默认外观精确状态、默认外观显式兼容状态；不会跨角色回退。

## 状态机和移动

应用不是 GIF 循环。状态机明确包含 idle、movement、interaction、grabbed、dropped、resting、sleeping 和 transition：

- idle 完成随机等待后才选择新的水平目标，不会快速随机跳状态；
- movement 到达目标后回到 idle，少量移动使用角色 registry 允许的 run；
- click/special、dropped 和 wake 等一次性动作播放完成后才转换；
- 无用户活动达到角色阈值后进入 rest，再在过渡完成后 sleep；
- 点击睡眠角色先 wake；拖动结束后坐标限制在输出边界内并恢复状态机；
- 方向由目标位置决定，镜像只在角色 `mirrorRules` 允许时使用。

`--monitor N` 按 Wayland output 枚举顺序选择显示器。移动边界取自该 output 配置；新增/移除显示器后的动态重选仍应纳入人工验收。

## 自动验证边界

当前分支已有以下可复现检查路径：

- Codex 全量 validator：426 expected / 426 implemented / 426 validated / 0 missing；Priestess 单角色 regression 通过。
- Standalone 纯逻辑测试覆盖状态机、移动边界、睡眠点击唤醒、动画播放器、角色/皮肤选择和回退规则。
- Standalone coverage validator 分别核对 roster、默认形象、皮肤、动作、runtime manifest 与打包 registry；`validate-all` 要求 425 个角色和 933 个外观全部完成。
- image2 trace validator 检查路径、A/B 源帧、候选帧、accepted/rejected 字段和 accepted runtime usage；当前有 14 个 accepted 序列 / 14 帧进入 runtime，2 个 rejected 序列仅保留审计记录。
- 原生 standalone：在临时开发 sysroot 中完成真实编译和链接，严格 warnings 配置下为 0 warnings。

具体的当前实现数必须读取 `standalone/dist/coverage.json`；source roster 的 425 / 933 / 508 不应被误写成 runtime 验证结果。上述检查仍不等价于 compositor 中窗口呈现和交互通过；本环境没有实际 Wayland/niri 图形会话。

## 必须人工验证的项目

以下检查需要在真实桌面会话进行，不能由无 Wayland compositor 的 CI 声称通过：

- niri：layer-shell surface 位于预期层，工作区切换行为符合预期。
- KDE Wayland：实际版本是否公布 layer-shell，以及 top layer 是否稳定。
- GNOME Wayland：xdg fallback 能否接受当前 workflow；确认不承诺 always-on-top。
- 透明区域点击桌面，角色可见区域点击角色；动态帧不会留下过大的阻挡矩形。
- click-through 开启后 `SIGUSR1` 可以恢复输入。
- 点击与拖动阈值合理，拖动释放后不越界、不突跳。
- idle → walk/run → idle、rest → sleep、click → reaction、sleep → wake 的动作完整播放。
- 左右朝向正确，阿米娅默认模型镜像后没有文字或单侧标志错误。
- `--scale`、滚轮、`--speed`、中键自动移动开关可用。
- `--monitor 1` 在双显示器下选择正确 output，缩放比例和边界正确。
- `SIGHUP` 在多个已构建角色间切换；`SIGRTMIN` 在同角色多个已构建皮肤间切换，并确认帧、比例和 input region 同步刷新。

当前仓库环境只应报告原生编译/单元测试或 capability probe 的实际结果；在没有 niri 图形会话时，不得写成“niri 实机验证通过”。
