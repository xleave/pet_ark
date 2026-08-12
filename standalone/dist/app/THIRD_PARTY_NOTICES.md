# Third-party notices

本文件说明仓库实际引用或随仓库分发的第三方资料。根目录 `LICENSE` 只适用于本项目自有代码；不改变下列素材、角色或协议文件原有的权利状态。

## OpenAI Codex pet atlas documentation

Codex 产线的 8 × 9 atlas、单格尺寸、状态顺序、帧数、透明度与 hidden-RGB 约束来自 OpenAI skills 中公开的 Codex pet 格式说明。

- Repository: <https://github.com/openai/skills>
- Referenced skill: `skills/.curated/hatch-pet/SKILL.md`

仓库不分发 OpenAI 美术素材。

## Arknights roster indexes and visual references

Codex registry 的公开来源于 2026-08-12 获取：

- 鹰角网络官方“干员动态集录”：<https://ak.hypergryph.com/archive/dynamicCompile>
- PRTS 干员一览：<https://prts.wiki/w/干员一览>
- Kengxxiao/ArknightsGameData `character_table.json`：<https://github.com/Kengxxiao/ArknightsGameData/blob/master/zh_CN/gamedata/excel/character_table.json>
- Aceship/Arknight-Images avatar index：<https://github.com/Aceship/Arknight-Images/tree/master/avatars>

后三者用于官方页面不足以直接形成机器列表时的索引、ID 对齐或临时视觉核对。Codex 产物由本项目 SVG/vector 代码重新绘制，不包含这些来源中的头像、立绘或 spritesheet。详情见 `shared/character-data/codex-sources.json`。

## PRTS / Arknights Spine assets used by standalone

standalone 第一阶段包含阿米娅公开基建 Q 版 Spine 资源及由其确定性导出的帧和运行时 spritesheet：

- PRTS 角色页：<https://prts.wiki/w/阿米娅>
- PRTS 公开资源入口：<https://torappu.prts.wiki/assets/char_spine/char_002_amiya/meta.json>
- 获取日期：2026-08-12
- 逐文件来源与处理状态：`shared/character-data/sources.json`

`standalone/assets/source/amiya/` 中的 `.skel`、`.atlas`、纹理和元数据是来源素材；`cleaned/`、`animations/` 与 `runtime/` 是它们的处理产物。它们不是本项目 MIT 代码的一部分，不得因仓库的 MIT License 被理解为获得额外的游戏素材授权。

导出工具会在本地缓存中读取 PRTS Spine viewer source map 内的运行时代码来解释 Spine 3.8 数据；缓存被 `.gitignore` 排除，不随仓库分发。

`standalone/assets/generated/` 单独保存 image2 补帧候选。当前唯一候选被明确标记为 rejected，不进入运行时资源。

## Wayland protocols

`standalone/runtime/protocol/` 包含 Wayland 协议 XML 及由 `wayland-scanner` 生成的 C/header 文件：

- `xdg-shell` 与 `xdg-decoration-unstable-v1` 来自 wayland-protocols：<https://gitlab.freedesktop.org/wayland/wayland-protocols>
- `wlr-layer-shell-unstable-v1` 来自 wlr-protocols：<https://gitlab.freedesktop.org/wlroots/wlr-protocols>

版权与许可全文保留在相应 XML 和生成文件头部。

## Arknights characters

《明日方舟》、角色设计和游戏素材的权利归其各自权利人所有。本项目是非官方同人项目，与鹰角网络、PRTS 或 OpenAI 均无隶属或背书关系。分发、展示或再利用 standalone 来源素材前，请自行确认适用地区、使用场景及来源站点的条款。
