# Third-party notices

根目录 `LICENSE` 适用于 Pet Ark 自有代码。角色、商标、游戏素材、第三方协议文件和依赖保持各自的权利与许可。

## 《明日方舟》与 PRTS 资源

Standalone 角色/皮肤索引和 `char_spine` 资源入口来自 [PRTS Wiki](https://prts.wiki/)：

- [PRTS 干员一览](https://prts.wiki/w/干员一览)
- `https://torappu.prts.wiki/assets/char_spine/{game_key}/meta.json`
- 获取日期：2026-08-12
- 逐外观记录：`standalone/assets/source/<character>/<variant>/retrieval.json`
- 汇总记录：`shared/character-data/standalone-roster.json`、`standalone-sources.json`

PRTS 的[版权说明](https://prts.wiki/w/PRTS:版权)将站点文字内容置于 CC BY-NC-SA 条款下；PRTS 页面同时说明，站内游戏图片、动画、音频和游戏原文的权利归上海鹰角网络科技有限公司及其关联公司。仓库中的 Spine skeleton、atlas、texture 及其 cleaned/runtime 派生物属于后一类游戏素材，不因 Pet Ark 的 MIT License 获得新的许可。

《明日方舟》、角色设计、名称、标识和游戏素材的权利归其各自权利人所有。官方资料入口：

- [《明日方舟》官方网站](https://ak.hypergryph.com/)
- [干员动态集录](https://ak.hypergryph.com/archive/dynamicCompile)

Pet Ark 是非官方同人项目，与鹰角网络或 PRTS 无隶属或背书关系。

## 角色数据与视觉索引

- [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)：角色 ID、名称和 alter 分组核对；
- [Aceship/Arknight-Images](https://github.com/Aceship/Arknight-Images)：Codex renderer 的临时角色视觉索引核对；
- PRTS 的文本索引：角色中文名、可玩范围与外观名称核对。

Codex 输出由本项目的 SVG/vector renderer 绘制，不复制 Aceship 头像或官方立绘。来源快照与归一化记录位于 `shared/character-data/codex-sources.json`。

## Codex Pet 格式

Codex 产线的 8 × 9 atlas contract 参考 [OpenAI skills](https://github.com/openai/skills) 中的 Codex pet 格式说明。本仓库不分发 OpenAI 美术素材。

## Spine 数据处理

导出工具在本地缓存中读取 PRTS Spine viewer source map 指向的运行时代码，以解释 Spine 3.8 数据。该缓存由 `.gitignore` 排除，不随仓库分发。

`standalone/assets/generated/` 记录由 FFmpeg optical-flow interpolation 产生的补间候选。manifest 会保留输入帧、工具、接受/拒绝结论和 runtime usage；生成结果不标记为 PRTS 或游戏原始帧。

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
