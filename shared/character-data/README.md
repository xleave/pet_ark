# 角色数据

这里保存 Codex 与独立桌宠都能复用的角色身份和来源元数据，不包含任一运行时的状态假设。

## 文件

- `operators.json`：Codex 可玩角色 source-of-truth。每个条目包含稳定来源 ID、名称、实现状态、renderer、`visual_signature`，以及代码绘制 renderer 实际使用的 hair、face、outfit、palette、species、equipment、directional 等数据。
- `codex-sources.json`：Codex roster 的来源、获取日期、范围与去重统计。
- `standalone-roster.json`：2026-08-12 获取的 standalone source-of-truth；包含 425 个正式可玩角色、每个角色的默认外观、508 个皮肤和共 933 个 PRTS `基建` Q 版 asset set。
- `standalone-sources.json`：standalone roster 的来源、范围、日期、可用/不完整统计和 alter 审计来源。
- `sources.json`：跨产线来源索引与早期逐角色记录；新增 standalone 全量实现以 `standalone-roster.json` / `standalone-sources.json` 为准。

两条产线只共享角色 ID、名称、来源与可复用的视觉元数据：

- Codex 的 8 × 9 atlas、九行状态和帧数约束不会进入 standalone runtime。
- standalone 的窗口、桌面移动和状态机不会进入 Codex renderer。

## Codex roster 刷新

从本地已获取的索引、游戏数据与临时视觉分析输入重新编译 roster：

```bash
python3 shared/asset-tools/compile-roster.py \
  --index-html /tmp/prts-operators.html \
  --character-table /tmp/arknights-character-table-current.json \
  --portraits /tmp/arknights-avatar-refs \
  --output shared/character-data/operators.json
```

编译器会在索引条目缺少游戏数据映射或视觉分析输入时失败。刷新时还必须更新 `codex-sources.json` 的获取日期和 normalization 统计，并重新执行完整 Codex build 与 validation。

角色头像只作为临时分析输入，不会复制到 registry 或 Codex 生成物中。

## Standalone roster 与素材记录

Standalone 身份范围先来自 425 条可玩角色记录，再由 PRTS 公开 `char_spine/{game_key}/meta.json` 机器枚举默认外观和命名皮肤。正式 playable alter 不合并；皮肤作为所属角色的 variant，不作为动画状态。当前统计为：

- expected characters：425；
- expected default appearances：425；
- expected skins：508；
- expected variants：933；
- indexed variants lacking a public `基建` asset set：0。

每个 variant 在 `standalone-roster.json` 中至少记录：

- `character_id`、角色名称、`variant_id` 和 `variant_type`；
- `skin_id`、`skin_name` 和默认形象标志；
- `source_page`、`source_meta` 与 `.skel` / `.atlas` / texture / model asset set；
- source 状态和无法实现原因（如适用）。

每次实际获取还会在 `standalone/assets/source/<character>/<variant>/retrieval.json` 保存来源、日期、文件路径、原始动作和处理状态。source roster 数量不代表 runtime 已完成；actual implemented/missing/blocked 由 `standalone/dist/coverage.json` 计算。

AI/image2 或等效 image-to-image 补帧不能写成原始素材。逐序列的 character、variant/skin、A/B 源帧、生成帧路径、接受状态、评审结论和 accepted runtime usage 记录在 `standalone/assets/generated/manifest.json`。当前 1 个 accepted midpoint 已用于阿米娅默认外观 `sleep`，另有 1 个 rejected 反例未进入 runtime。
