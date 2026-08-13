# Standalone 角色与皮肤素材流程

Standalone 素材不会覆盖原始文件，也不会把 image2/补帧产物伪装成游戏来源。角色、皮肤、动作和每一层处理产物都通过普通路径与 manifest 关联，不使用 hash 或 digest。

## Source of truth 与覆盖口径

获取日期为 **2026-08-12**。机器 roster 位于 `shared/character-data/standalone-roster.json`，来源与统计位于 `shared/character-data/standalone-sources.json`：

- 正式可玩角色：425；
- 默认形象：425；
- 公开 `char_spine` 皮肤：508；
- 外观变体总数：933；
- 缺少 PRTS `基建` asset set 的已索引外观：0。

正式 playable alter 保持独立角色条目。默认形象的 `variant_type` 为 `base_form`，皮肤的 `variant_type` 为 `skin`；皮肤有独立 `variant_id`、`skin_id`、名称和 asset set，绝不混成动作状态。

这些数字描述期望范围和可访问来源，不自动等于运行时实现完成。`standalone/dist/coverage.json` 独立统计 expected、implemented、missing、blocked 和 unaccounted 的角色、外观与皮肤；只有 `npm run standalone:validate-all` 的完整性门禁通过后，才可以把全量 runtime 报告为完成。

当前仓库产物已经通过该门禁：425 / 425 角色、933 / 933 外观、508 / 508 皮肤，missing、blocked 和 unaccounted 均为 0。933 份 runtime manifest 全部提供基础桌宠动作；502 个外观使用物理 `Special`，并额外保留 3 个 `exit`、2 个 `idle-alt` 和 1 个 `move-alt` 来源动作。

## 来源

- PRTS 干员一览：可玩 roster 和本地化身份索引；
- PRTS 公开 `char_spine/{game_key}/meta.json`：枚举默认形象、命名皮肤和每个 `基建` Spine asset set；
- Kengxxiao/ArknightsGameData `char_meta_table.json`：审计正式独立 alter 的分组关系，不合并这些 roster 条目。

每个外观的获取记录写入：

```text
standalone/assets/source/<character>/<variant>/retrieval.json
```

记录包括 character/variant/skin 身份、来源页、meta、model、`.skel`、`.atlas`、texture、获取日期和处理状态。来源信息不会散落到实现注释中。

## 资产分层

```text
standalone/assets/
├── source/       # 原始公开 meta / Spine skeleton / atlas / texture
├── cleaned/      # 确定性导出的透明 RGBA 逐帧 PNG
├── generated/    # image2/等效补帧及 accepted/rejected 追踪
├── animations/   # runtime 状态、source animation 与帧顺序映射
└── runtime/      # 应用直接加载的逐动作 spritesheet、hitbox 与 metadata

standalone/dist/
├── app/          # 可搬运应用目录
├── characters/   # 按 character/variant 分开的 runtime 资源
├── registry/     # 打包可读的角色/皮肤 registry
├── manifests/    # roster、registry 与逐选择 coverage
└── coverage.json
```

`source/` 永远不由后续步骤原地修改。`cleaned/` 可以从 `source/` 重建，`runtime/` 可以从 `cleaned/`、`generated/` 和动作映射重建。生成帧只保存在 `generated/`；被 runtime 采纳时，runtime manifest 仍保留其生成来源路径。

## 单角色与单皮肤

构建默认形象：

```bash
npm run standalone:build -- --character amiya --skin default
```

构建指定皮肤。`--skin` 可使用稳定 `variant_id` 或 `skin_id`：

```bash
npm run standalone:build -- --character amiya --skin skin-winter-1
```

只刷新和整理素材：

```bash
npm run standalone:assets -- --character amiya --skin skin-winter-1 --refresh-source
```

也可以分步执行获取、检查和导出：

```bash
node shared/asset-tools/acquire-prts-spine.mjs --character amiya --variant skin-winter-1
node shared/asset-tools/export-prts-spine.mjs --character amiya --variant skin-winter-1 --inspect
node shared/asset-tools/export-prts-spine.mjs --character amiya --variant skin-winter-1
```

导出器使用 PRTS 页面所用 Spine 3.8 runtime 数据解释 skeleton，将 mesh triangle 确定性合成到透明画布，进行地面对齐并清除 alpha=0 像素中的 hidden RGB。画布、FPS、最大采样帧数和 source bounds 写入每个 cleaned manifest；runtime 每个 source animation 单独打包，不经过 Codex atlas。

选择非默认皮肤时，会同时准备同角色默认外观。这样 manifest 声明的默认外观回退始终可解析，不会跨角色取错资源。

## 全量构建

```bash
npm run standalone:build-all -- --concurrency 4
npm run standalone:validate-all
```

全量流程按 roster 获取并导出 933 个外观，再以有界 worker 数整理 runtime，避免无上限子进程和所有 raster 同时驻留内存。随后重建 JSON/C registry、同步 `standalone/dist/characters/` 与 manifest，并执行 complete coverage gate。

若只需检查当前已构建范围，不要求全 roster 完成：

```bash
npm run standalone:validate
```

## 角色、皮肤与状态回退

生成的 `standalone/characters/registry.json` 使用 `character → variants` 结构。每个外观至少记录：

- `variant_type`、`skin_id`、名称与来源；
- runtime asset 目录和 default scale；
- 可用 animation、frame order、FPS、loop/mirror 规则；
- 显式 `stateFallbacks`；
- 非默认皮肤允许使用的 `fallbackVariantId`。

动作解析顺序固定为：

1. 当前外观的精确状态；
2. 当前外观显式声明的兼容状态；
3. 同角色默认外观的精确状态；
4. 同角色默认外观显式声明的兼容状态。

未声明回退就验证失败；永不跨角色回退。方向性文字、单侧武器、眼罩或饰品不能盲目镜像，必须在外观 manifest 中禁止镜像或提供独立左右资源。

## image2/补帧追踪

只有原始动作之间确实缺少自然过渡时才生成候选。每个序列必须在 `standalone/assets/generated/manifest.json` 记录：

- character、variant、skin 和 animation；
- source frame A / B；
- 所有 generated frame；
- generator 与生成日期；
- `accepted` 或 `rejected` 及具体原因；
- accepted 序列的 runtime manifest、state 和插入位置。

进入 runtime 前必须检查画布尺寸、透明度、hidden RGB、落地点、比例、脸型、发型、服装、种族特征、武器/配饰、线条和相邻帧连续性。不得生成伪文字、额外肢体、错误遮挡或身份变化。

当前有两个可审计序列：

- `amiya/default/sleep/000-001-midpoint.png`：在两个连续源帧间使用双向光流产生 50% midpoint；人工视觉检查和像素 QA 通过，作为第 1 个 accepted 序列实际插入 runtime `sleep`。
- `amiya/idle-to-rest/001-rejected.png`：改变线条和比例、产生伪文字、返回不透明棋盘背景且地面配准错误，明确 rejected，不进入 runtime。

验证命令会检查 source/generated 路径、PNG 格式、alpha、hidden RGB、accepted runtime usage，以及 runtime state 是否实际列出生成帧。

## 人工验收

批量机器验证不能替代视觉检查。每个角色/皮肤至少抽查 idle、移动、点击、拖动、休息/睡眠、左右朝向、配饰完整性和边缘裁切。特别检查单侧武器、文字、眼罩、光环、长发、尾巴、衣摆和大型装置的方向与 secondary motion。

来源素材与项目 MIT 代码的许可边界见 `THIRD_PARTY_NOTICES.md`。
