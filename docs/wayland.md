# Wayland 运行说明

Pet Ark 是原生 Wayland C 客户端，通过 `wl_shm` 提交透明像素。默认使用 `wlr-layer-shell-unstable-v1` 创建覆盖输出的透明 top-layer surface，角色在该 surface 内移动。

## Surface 与输入

Wayland 客户端不直接设置全局窗口坐标。运行时使用输出大小的透明 surface，并根据当前帧 alpha bounds 更新 pointer input region：

- 角色可见区域接收点击和拖动；
- 指针进入角色时使用系统 Wayland cursor theme，光标保持显示在桌宠之上；
- 透明区域交给桌面；
- click-through 开启时 input region 为空；
- 动画帧、位置、缩放、选择或输入区域变化时才提交新 buffer；
- `wl_surface_frame` callback 控制提交节奏。

运行时把角色几何、朝向和 surface 内指针坐标写入状态协议，行为服务再汇总为多桌宠空间快照。标准 Wayland 不允许普通客户端在其他应用 surface 上被动读取全局绝对指针，因此 Pet Ark 不读取 `/dev/input`，也不伪造系统级全局追踪；指针行为仅在进入桌宠命中区域时触发。

## Compositor

| 环境 | 路径 | 状态 |
|---|---|---|
| niri / wlroots / Smithay | layer-shell | 主支持路径 |
| KDE Plasma Wayland | layer-shell（由 compositor 支持情况决定） | 需要按版本检查 |
| GNOME Wayland | `--xdg-fullscreen-fallback` | 显式测试路径 |

没有 layer-shell 时，只有传入 `--xdg-fullscreen-fallback` 才创建 xdg fullscreen surface。

## 构建

Debian / Ubuntu：

```bash
sudo apt install build-essential pkg-config libwayland-dev libpng-dev
```

Fedora：

```bash
sudo dnf install gcc make pkgconf-pkg-config wayland-devel libpng-devel
```

```bash
npm run standalone:build
standalone/build/pet-ark --probe
```

## 启动参数

```bash
npm run standalone:dev -- --character amiya -- --scale 0.8 --speed 1.25
npm run standalone:dev -- --character amiya --skin skin-winter-1 -- --monitor 1
npm run standalone:dev -- --character amiya -- --no-auto-move --click-through
```

常用参数：

| 参数 | 用途 |
|---|---|
| `--character ID` | 角色 |
| `--skin ID` | 外观 |
| `--instance ID` | 实例 |
| `--scale N` | 显示比例 |
| `--speed N` | 移动速度 |
| `--monitor N` | Wayland output 编号 |
| `--no-auto-move` | 关闭巡游 |
| `--click-through` | 启动时点击穿透 |
| `--xdg-fullscreen-fallback` | 使用 xdg fullscreen 测试路径 |

鼠标和信号操作见根目录 [`README.md`](../README.md)。

## 状态机

idle 在等待后选择当前 output 内的目标；movement 到达目标后返回 idle；click、special、dropped 与 wake 播放完成后再切换状态；长时间无交互进入 rest/sleep。拖动释放会限制到输出边界，镜像由外观 `mirrorRules` 决定。

## 缩放与多显示器

`--monitor N` 按 output 枚举顺序选择显示器。运行时当前读取整数 `wl_output.scale` 计算逻辑边界；fractional-scale/viewporter 仍是后续清晰度工作项。多显示器调整后应检查 output 选择、边界、输入区域与主体像素密度。

## 桌面检查清单

- layer、工作区切换和多实例 surface；
- 透明区点击、角色点击与 click-through 恢复；
- 拖动阈值、落点和输出边界；
- idle、移动、互动、休息、睡眠与唤醒；
- 左右朝向、显示比例、速度和显示器切换；
- HiDPI / fractional scale 的实际清晰度。
