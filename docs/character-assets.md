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

这些数字描述期望范围和可访问来源，不自动等于运行时实现完成。`standalone/dist/coverage.json` 独立统计 expected、implemented、missing、blocked 和 unaccounted 的角色、外观与皮肤；`standalone/dist/animation-coverage.json` 则逐外观统计真实动作完成度。只有两类门禁都通过后，才可以把全量 runtime 报告为动作完成。

当前仓库产物已经通过两类门禁：425 / 425 角色、933 / 933 外观、508 / 508 皮肤，missing、blocked 和 unaccounted 均为 0；动作审计为 933 animation-complete、0 partial、0 static-only。`idle`、movement、interaction、drag、rest、sleep、wake、special 八组动作分别都有 933 个外观通过。

动作完整不是字段完整。门禁要求每个必需状态在排除 transition bridge 后达到规定的核心帧数和可见视觉唯一帧数；bridge 另做结构、endpoint 与 double-exposure 检查，不能用于给核心动作凑数。透明 source 帧只有在 canonical cleaned manifest 的 `intentional_blank_frames` 中逐帧给出具体原因时才允许；人工核对表维护在 `shared/character-data/standalone-intentional-blanks.json`，可用 `shared/asset-tools/sync-standalone-intentional-blanks.mjs` 确定性同步。仅有静态图、多个状态使用同一帧、重复 idle、`sleep`/`special` 到 `Relax` 的语义回退，或只有 metadata 名称不同都不能通过。每个状态的审计条目记录 source、`direct`/`derived`/`generated`、core/displayed/bridge frame count、duration、loop mode、fallback 和 visual uniqueness。

当前 provenance 统计为：5,146 个 source animation sequences、3,716 个 direct runtime states、8,392 个 deterministically derived sequences；920 个外观包含 derived asset set，27 个 runtime 状态实际使用 image2 生成帧，semantic fallback 为 0。

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
├── contact-sheets/       # 外观覆盖总表与逐动作 strip
├── animation-coverage.json
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

导出器使用 PRTS 页面当前声明的 SpineViewer source map 动态提取 Spine 3.8 runtime，不依赖会失效的静态文件哈希。它将 mesh triangle 确定性合成到透明画布，进行地面对齐并清除 alpha=0 像素中的 hidden RGB。画布、FPS、最大采样帧数和 source bounds 写入每个 cleaned manifest；runtime 每个 source animation 单独打包，不经过 Codex atlas。

placement 同时记录完整动画边界与核心角色边界。若默认激活的远端 attachment 或大型特效会把角色主体压缩到正常比例的 60% 以下，导出器使用基于 attachment 空间聚类的核心边界决定缩放，同时保留完整边界用于审计；超出桌宠画布的远端特效允许裁切。`render_revision` 会使策略变化后旧 cleaned 帧失效，避免错误复用缓存。`standalone:test` 包含 Mon3tr“锋锐”的比例与可见像素回归门禁。

选择非默认皮肤时，会同时准备同角色默认外观。这样 manifest 声明的默认外观回退始终可解析，不会跨角色取错资源。

## 全量构建

```bash
npm run standalone:build-all -- --concurrency 4
npm run standalone:validate-all
npm run standalone:animation-coverage
npm run standalone:contact-sheets
```

全量流程按 roster 获取并导出 933 个外观，再以有界 worker 数整理 runtime，避免无上限子进程和所有 raster 同时驻留内存。随后重建 JSON/C registry、同步 `standalone/dist/characters/` 与 manifest，并执行角色/皮肤和真实动作两类 coverage gate。`standalone:validate-all` 会包含动作覆盖审计；后两个命令可分别重建动作报告和人工验收图。

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

当前 generated manifest 包含 14 个 accepted 序列 / 14 帧和 2 个 rejected 序列。accepted 结果被 27 个 runtime 状态实际引用；rejected 结果保留拒绝原因但绝不进入 runtime。Amiya 的 sleep midpoint 是其中一个 accepted 结果；`idle-to-rest` 的不透明棋盘背景、比例/线条漂移和伪文字候选仍作为 rejected 反例保留。

验证命令会检查 source/generated 路径、PNG 格式、alpha、hidden RGB、accepted runtime usage，以及 runtime state 是否实际列出生成帧。

## 动作覆盖与重复审计

`standalone/dist/animation-coverage.json` 保存总统计和 933 个外观的逐状态审计。当前结果：

| 指标 | 数量 |
|---|---:|
| animation-complete / partial / static-only | 933 / 0 / 0 |
| idle / movement / interaction / drag complete | 933 / 933 / 933 / 933 |
| rest / sleep / wake / special complete | 933 / 933 / 933 / 933 |
| exact duplicate animation | 1,866 |
| same-frame fallback / static reused state | 0 / 0 |
| unresolved semantic duplicate | 0 |
| suspicious duplicate sequence | 1 |

1,866 组 exact duplicate 全部被分类为方向镜像关系，不是缺失动作的同帧 fallback。唯一 suspicious 条目是 Amiya default 的 `sleep`/`wake` 共享已追踪 generated 帧；13 个低来源机械外观的 `rest`/`wake` 被独立分类为有意反向序列。两者均不计为未解决的 semantic fallback。检测使用普通解码像素比较，不引入 SHA-256 或 digest。

跨状态 transition boundary 共检查 5,601 处：warning-only 为 4，severe 为 0。3,735 个 `dropped`、`rest`、`wake`、`special` 和 `exit` endpoint bridge 的结构错误、endpoint mismatch 和 double exposure 均为 0。78,445 个 derived atlas 帧全部被 runtime 引用且全部有 provenance，反向缺口均为 0；28 个透明 source 帧全部有 canonical cleaned 声明，unexpected/invalid 为 0。

最终全量图像 QA 另检查了 933 个 runtime manifest、6,080 张 atlas 和 119,574 个使用中的 cell，结构性硬错误为 0。保守阈值列出的人工复核项为：411 个相邻动作帧、41 个 bridge 内部帧、上述 4 个边界以及 1 个 source sleep loop。定向 contact strip 复核确认它们属于大型特效、单轮廓淡出/淡入或 source 特效边界变化，没有双轮廓、错误皮肤、边缘裁切或身份闪回。

## 人工验收

批量机器验证不能替代视觉检查。每个角色/皮肤至少抽查 idle、移动、点击、拖动、休息/睡眠、左右朝向、配饰完整性和边缘裁切。特别检查单侧武器、文字、眼罩、光环、长发、尾巴、衣摆和大型装置的方向与 secondary motion。

Standalone contact sheets 位于：

- `standalone/dist/contact-sheets/coverage/`：每个 variant 的 idle、movement、interaction、rest/sleep、special 代表帧；
- `standalone/dist/contact-sheets/animation-strips/<character>/<variant>.webp`：按状态排列的完整动作序列 strip。

使用 `npm run standalone:contact-sheets` 重新生成，使用 `npm run standalone:test-contact-sheets` 检查输出格式和透明像素。当前自动化环境没有真实 Wayland/niri 图形会话，因此这里报告的是资源、构建和静态 QA，不宣称完成 compositor 实机呈现验收。

## 425 与 426 的 roster 对账

Standalone roster 是 425 个正式可玩角色。Codex roster 为 426：相同的 425 个正式可玩角色，加上为旧版视觉回归保留的剧情角色 Priestess。Priestess 是额外的 story/regression entry，不是 standalone 漏掉的 playable operator；机器对账保存在 `standalone/dist/animation-coverage.json` 的 `roster_reconciliation`。

来源素材与项目 MIT 代码的许可边界见 `THIRD_PARTY_NOTICES.md`。
