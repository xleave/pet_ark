# Standalone 角色素材流程

standalone 素材不会覆盖原始文件，也不会把 AI/image2 补帧伪装成游戏来源。角色、动作和每一层处理产物都通过路径与 manifest 关联，不使用 hash 或 digest。

## 目录含义

```text
standalone/assets/
├── source/       # 从公开来源获取的原始 meta / Spine skeleton / atlas / texture
├── cleaned/      # 确定性导出的透明 RGBA 逐帧 PNG，保持统一画布与落地点
├── generated/    # image2 补帧候选及 accepted/rejected 追踪
├── animations/   # 运行时状态到原始动作和帧顺序的映射
└── runtime/      # 应用直接加载的逐动作 spritesheet、hitbox 与 metadata
```

`source/` 永远不由后续步骤原地修改。`cleaned/` 可以从 `source/` 重建，`runtime/` 可以从 `cleaned/` 和角色 registry 重建。

## 第一阶段角色：阿米娅

来源获取日期为 2026-08-12。统一记录在 `shared/character-data/sources.json`，单次获取记录在 `standalone/assets/source/amiya/retrieval.json`。

- 角色页：<https://prts.wiki/w/阿米娅>
- 公开 meta：<https://torappu.prts.wiki/assets/char_spine/char_002_amiya/meta.json>
- 模型：`defaultskin/build/build_char_002_amiya`
- 原始动作：`Default`、`Interact`、`Move`、`Relax`、`Sit`、`Sleep`
- 处理后状态：`idle`、`walk-left/right`、`run-left/right`、`clicked`、`picked-up`、`dragging`、`dropped`、`rest`、`sleep`、`wake`、`special`

当前运行时所有接受帧均来自确定性 Spine 导出；没有 AI 生成帧进入 runtime。

## 获取、导出与整理

获取阿米娅原始公开资源：

```bash
node shared/asset-tools/acquire-prts-spine.mjs --character amiya
```

先只检查 skeleton 版本和动作列表：

```bash
node shared/asset-tools/export-prts-spine.mjs --character amiya --inspect
```

确定性导出透明逐帧 PNG：

```bash
node shared/asset-tools/export-prts-spine.mjs --character amiya
```

整理 per-animation spritesheet、逐帧 alpha bounds、动作 metadata，并重新生成 C registry：

```bash
npm run standalone:assets -- --character amiya
```

导出器使用 PRTS 页面所用 Spine 3.8 runtime 数据解释 skeleton，将每个 mesh triangle 确定性合成到 384 × 448 透明画布，并清除 alpha=0 像素中的 hidden RGB。runtime 每个 source animation 单独打包，不经过 Codex atlas。

## image2 补帧追踪

只有原始动作之间确实缺少自然过渡时才生成候选。生成后必须：

1. 放入 `standalone/assets/generated/<character>/<transition>/`，不得写入 `source/` 或 `cleaned/`。
2. 在 `standalone/assets/generated/manifest.json` 记录角色、动作、source frame A、source frame B、所有生成帧、生成方式、日期和 `accepted`。
3. 检查画布尺寸、透明度、落地点、比例、发型、服装、武器/配饰、线条和相邻帧连续性。
4. 只有 `accepted: true` 且人工验收通过的候选才能被动作 manifest 引用。
5. 执行 `npm run standalone:validate`，确保记录中的源帧和候选路径可解析。

当前示例 `amiya/idle-to-rest/001-rejected.png` 明确被拒绝。它改变了线条与比例、生成了伪文字、输出不透明棋盘背景，而且没有保持 384 × 448 地面配准。`Sit` 原始序列本身已提供连续过渡，因此 runtime 继续使用原始 Spine 帧；该 rejected 文件仅保留为可审计反例。

## 新增角色检查点

- 先更新 `shared/character-data/sources.json`，不要凭记忆补名单或来源。
- 在 `standalone/characters/registry.json` 声明 assets、animations、defaultScale、availableStates、specialStates、movement 和 mirrorRules。
- 方向性文字、单侧武器、眼罩或配饰不能盲目镜像；必要时提供独立左右动作。
- 只声明角色实际拥有的 special 状态；基础状态缺失时应给出可解释映射。
- 人工查看至少 idle、移动、点击、拖动、休息/睡眠、左右朝向和边缘裁切。
- 保持来源素材与项目 MIT 代码的许可边界，详见 `THIRD_PARTY_NOTICES.md`。
