# Standalone 角色与外观资产

## 范围

2026-08-12 的 source-of-truth 位于：

- `shared/character-data/standalone-roster.json`
- `shared/character-data/standalone-sources.json`

当前范围为 425 个可玩角色、425 个默认形象、508 个皮肤，共 933 个外观。正式 playable alter 保持独立角色；皮肤作为所属角色的 variant。

资源 coverage、动作 coverage 与构图质量分别记录在：

- `standalone/dist/coverage.json`
- `standalone/dist/animation-coverage.json`
- `standalone/dist/asset-quality.json`

## 来源与分层

角色/皮肤索引来自 PRTS 干员页面和公开 `char_spine/{game_key}/meta.json`；ArknightsGameData 用于 ID 与 alter 分组核对。每次获取写入：

```text
standalone/assets/source/<character>/<variant>/retrieval.json
```

资产目录：

```text
standalone/assets/
├── source/       原始 meta、Spine skeleton、atlas 与 texture
├── cleaned/      确定性导出的透明 RGBA 帧
├── generated/    补间候选、接受/拒绝记录
├── animations/   runtime 状态与源动作映射
└── runtime/      应用直接加载的 spritesheet 与 metadata
```

`source/` 保持原样。`cleaned/` 可从 source 重建，`runtime/` 可从 cleaned、generated 与动作映射重建。

## 单外观工作流

```bash
npm run standalone:assets -- --character amiya --skin skin-winter-1 --refresh-source
npm run standalone:build -- --character amiya --skin skin-winter-1
npm run standalone:validate
```

分步获取与导出：

```bash
node shared/asset-tools/acquire-prts-spine.mjs --character amiya --variant skin-winter-1
node shared/asset-tools/export-prts-spine.mjs --character amiya --variant skin-winter-1 --inspect
node shared/asset-tools/export-prts-spine.mjs --character amiya --variant skin-winter-1
```

导出器动态读取页面当前的 SpineViewer source map，确定性合成 mesh、对齐地面并清理透明像素的 hidden RGB。每个 cleaned manifest 记录画布、采样率、边界、placement 和 render revision。

## 增量清晰度修复

```bash
npm run standalone:quality
npm run standalone:quality:plan
npm run standalone:quality:repair
```

质量索引当前为 703 pass、230 review、0 critical、0 high。详细策略见 [`asset-quality-pipeline.md`](asset-quality-pipeline.md)。

## 全量构建

```bash
npm run standalone:build-all -- --concurrency 4
npm run standalone:validate-all
npm run standalone:animation-coverage
npm run standalone:contact-sheets
```

全量流程使用有界 worker，随后更新 JSON/C registry、coverage、动作审计与 contact sheets。

## 动作规则

每个外观覆盖八组能力：idle、movement、interaction、drag、rest、sleep、wake、special。核心动作帧、视觉唯一帧、持续时间、loop、provenance、fallback 与 transition bridge 分开审计。

运行时解析顺序：

1. 当前外观精确状态；
2. 当前外观显式兼容状态；
3. 同角色默认外观精确状态；
4. 默认外观显式兼容状态。

方向性文字、单侧武器、眼罩和饰品需要独立方向资源或明确的 mirror rule。

## Generated motion

`standalone/assets/generated/manifest.json` 记录源帧 A/B、生成器、候选、接受状态和 runtime usage。当前有 14 个 accepted 帧用于 27 个 runtime 状态，2 个 rejected 候选只保留审计记录。

## 人工验收

- `standalone/dist/contact-sheets/coverage/`：每个外观的代表状态；
- `standalone/dist/contact-sheets/animation-strips/`：逐状态动画 strip。

重点检查主体比例、落地点、边缘裁切、左右朝向、武器、光环、长发、尾巴、大型装置和 companion。第三方素材的权利与来源见 [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
