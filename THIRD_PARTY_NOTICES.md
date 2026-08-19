# Third-party notices

根目录 `LICENSE` 适用于 Pet Ark 自有代码。角色、商标、游戏素材、第三方协议文件和依赖保持各自的权利与许可。

## 《明日方舟》与 PRTS 索引

Standalone 使用 [PRTS Wiki](https://prts.wiki/) 核对角色、中文名、外观名称和模型标识：

- [PRTS 干员一览](https://prts.wiki/w/干员一览)
- `https://torappu.prts.wiki/assets/char_spine/{game_key}/meta.json`
- 获取日期：2026-08-12
- 汇总记录：`shared/character-data/standalone-roster.json`、`standalone-sources.json`

PRTS 的[版权说明](https://prts.wiki/w/PRTS:版权)将站点文字内容置于 CC BY-NC-SA 条款下。Pet Ark 不再从 PRTS 获取或分发 Standalone skeleton、atlas、texture；PRTS `char_spine` 端点仅用于枚举外观标识。

《明日方舟》、角色设计、名称、标识和游戏素材的权利归其各自权利人所有。官方资料入口：

- [《明日方舟》官方网站](https://ak.hypergryph.com/)
- [干员动态集录](https://ak.hypergryph.com/archive/dynamicCompile)

Pet Ark 是非官方同人项目，与鹰角网络或 PRTS 无隶属或背书关系。

## Ark-Models 高清 Spine 来源

[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) 汇集从《明日方舟》PC 客户端提取的 Spine 3.8 `.atlas`、`.skel` 与 `.png`。Pet Ark 的按需获取器固定到提交 `3745e5c6e10b5252b2a5e1f1841ebef62b7ef15b`，记录位于 `shared/character-data/upstream-sources.json`，逐外观提交、URL、文件大小与 SHA-256 位于对应 `retrieval.json`。

全部可运行 Standalone 外观均使用该来源重建。固定提交当前映射 932 个外观；协律“悠然假日 HD91”未由该提交发布，因此明确下线，不保留 PRTS 回退。Ark-Models 仓库声明资源仅限非商业使用；其中游戏素材的权利仍归上海鹰角网络科技有限公司。Pet Ark 不向 Ark-Models 原仓库提交分支或补丁。

## 角色数据与视觉索引

- [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)：角色 ID、名称和 alter 分组核对；
- [Aceship/Arknight-Images](https://github.com/Aceship/Arknight-Images)：Codex renderer 的临时角色视觉索引核对；
- PRTS 的文本索引：角色中文名、可玩范围与外观名称核对。

Codex 输出由本项目的 SVG/vector renderer 绘制，不复制 Aceship 头像或官方立绘。来源快照与归一化记录位于 `shared/character-data/codex-sources.json`。

## Codex Pet 格式

Codex 产线的 8 × 9 atlas contract 参考 [OpenAI skills](https://github.com/openai/skills) 中的 Codex pet 格式说明。本仓库不分发 OpenAI 美术素材。

## Spine 数据处理

导出工具使用 [Esoteric Software Spine Runtimes](https://github.com/EsotericSoftware/spine-runtimes) 的官方 spine-ts `3.8.95` 解释 skeleton 与 atlas，固定提交为 `3e93e2daf1a651adf41415ed7919855d8a276f2d`。本地构建缓存仅加入 3.8 二进制字符串无符号 UTF-8 读取与 atlas 区域尾空格兼容；运行时代码受其 Spine Runtimes License Agreement 约束，缓存由 `.gitignore` 排除，不随仓库分发。

`standalone/assets/generated/` 记录由 FFmpeg optical-flow interpolation 产生的补间候选。manifest 会保留输入帧、工具、接受/拒绝结论和 runtime usage；生成结果不标记为上游原始帧。

## Wayland 协议

`standalone/runtime/protocol/` 包含协议 XML 与 `wayland-scanner` 生成文件：

- `xdg-shell`、`xdg-decoration-unstable-v1`：[wayland-protocols](https://gitlab.freedesktop.org/wayland/wayland-protocols)
- `wlr-layer-shell-unstable-v1`：[wlr-protocols](https://gitlab.freedesktop.org/wlroots/wlr-protocols)

版权与许可头保留在对应 XML 和生成文件中。

## 主要开源组件

- [Tauri](https://github.com/tauri-apps/tauri)
- [Svelte](https://github.com/sveltejs/svelte)
- [Wayland](https://gitlab.freedesktop.org/wayland/wayland)
- [libpng](https://github.com/pnggroup/libpng)
- [Sharp](https://github.com/lovell/sharp)

精确版本记录在 `package-lock.json`、`control-center/package-lock.json` 与 `control-center/src-tauri/Cargo.lock`；其许可由各上游项目提供。
