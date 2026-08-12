# pet_ark — 全角色《明日方舟》Codex Pets

本项目以代码绘制的 Q 版 vector primitives 生成《明日方舟》角色 Codex Pets。它保留原有 Priestess 实现作为像素级回归基线，并以统一 roster、共享动作骨架、可组合角色特征和全量 validator 扩展到执行时可核验的完整可玩角色集合。

项目不包含或打包游戏 spritesheet、立绘、Live2D、客户端解包资源或其他 pet 项目的角色图片。公开视觉资料只用于离线分析角色的色块、轮廓和识别特征，最终输出由仓库代码重新绘制。

## 当前 coverage

来源获取日期：**2026-08-12**。

- PRTS 可玩干员索引原始条目：427
- 合并 Amiya 职业转换后可玩角色：425
- Priestess 回归基线：1
- expected / implemented / validated / missing：**426 / 426 / 426 / 0**

覆盖范围、来源、去重规则和获取日期记录在 `characters/registry/sources.json`。每个可玩角色的统一定义位于 `characters/registry/operators.json`，包含稳定 ID、显示名、原始名、实现状态、renderer、可审计 `visual_signature`，以及 renderer 实际使用的 hair、face、outfit、palette、species、equipment、accessory、motion 与 directional 数据。

精英阶段、皮肤、Live2D 和活动服装不作为独立条目；正式独立可玩 alter 保留为独立角色。

## Codex atlas contract

- 8 × 9 atlas，1536 × 1872
- 单格 192 × 208
- 状态顺序：`idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`
- 有效帧：6 / 8 / 8 / 4 / 5 / 8 / 6 / 6 / 6，共 57 帧
- 透明背景、lossless WebP
- unused cells 完全透明，alpha=0 时 hidden RGB 清零

这仍是 Codex pet 的既有格式，没有引入新的 atlas 变体。

## 生成架构

```text
characters/registry/        sourced roster and visual definitions
scripts/characters/         Priestess regression renderer
scripts/motion/             shared nine-state poses and secondary motion
scripts/primitives/         face/body/hair/species/equipment/effect primitives
scripts/renderer/           compositional generic vector renderer
scripts/atlas/              bounded frame rendering, atlas composition, finalization
scripts/contact-sheet/      batched human-review sheets
scripts/registry/           registry loader and reproducible roster compiler
scripts/build.mjs            single/all-character CLI
scripts/validate.mjs         single/all-character validator and coverage writer
```

共用动作骨架不会消除角色差异：长发、尾巴、耳朵、外套、光环、武器与 companion 都有 secondary motion。`running-left` 可镜像基础步态，但 eyepatch、单侧饰品等方向固定结构由外层 override 绘制。

## 安装依赖

```bash
npm install
python3 -m pip install -r requirements.txt
```

## 构建与验证

默认命令继续构建并验证 Priestess：

```bash
npm run rebuild
```

构建或验证单个角色（可使用 slug、英文名、中文名、source ID 或 game key）：

```bash
npm run build -- --character amiya
npm run validate -- --character amiya
```

无人工步骤的全量流程：

```bash
npm run build:all
npm run validate:all
```

快速检查 registry 与全部 renderer 的九状态入口：

```bash
npm test
```

全量构建采用有界角色并发和有界帧并发；依赖只初始化一次，单个角色完成后即释放 atlas 中间缓冲，不会把完整 roster 的 raster 数据同时驻留内存。

## 输出

```text
dist/
  index.json
  coverage-manifest.json
  contact-sheets/
    001.webp
    ...
    009.webp
  priestess-chibi/
  amiya-chibi/
  exusiai-chibi/
  ...
```

每个角色目录包含：

```text
pet.json
spritesheet.webp
manifest.json
frames/
```

`dist/index.json` 给出显示名、输出路径和 validation state；`dist/coverage-manifest.json` 给出 expected / implemented / validated / missing 计数；九张 contact sheet 中每个角色同时显示 idle 与 running-right 代表帧。

完整生成物按职业分组提交到 Git，clone 后可以直接审计每个角色的帧和 atlas；也可运行全量命令确定性重新生成并复验这些产物。

## 许可与声明

代码以 MIT License 发布。生成图形是非官方、简化的同人衍生设计；《明日方舟》及相关角色权利归其权利方所有。详见 `THIRD_PARTY_NOTICES.md`。
