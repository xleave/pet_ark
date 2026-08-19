# 角色数据

此目录保存 Codex 与 Standalone 共用的角色身份、外观范围和来源记录。

| 文件 | 用途 |
|---|---|
| `operators.json` | Codex roster、renderer 与视觉签名 |
| `codex-sources.json` | Codex 数据来源、获取日期与归一化统计 |
| `standalone-roster.json` | 425 个角色、508 个皮肤、933 个外观 |
| `standalone-sources.json` | Standalone 来源范围与统计 |
| `sources.json` | 跨产线来源索引与早期记录 |

## 数据边界

共享层保存稳定 ID、名称、来源页、game key、skin ID 和可复用视觉元数据。Codex 的 atlas 行/帧约束与 Standalone 的状态机/Wayland 设置分别留在各自目录。

## Codex roster

刷新工具：

```bash
python3 shared/asset-tools/compile-roster.py \
  --index-html /tmp/prts-operators.html \
  --character-table /tmp/arknights-character-table-current.json \
  --portraits /tmp/arknights-avatar-refs \
  --output shared/character-data/operators.json
```

刷新后同步 `codex-sources.json`，再运行 Codex 全量构建与验证。临时头像只用于视觉分析，不复制到 registry 或生成产物。

## Standalone roster

Standalone 从可玩角色记录出发，再通过 PRTS `char_spine/{game_key}/meta.json` 枚举默认外观和命名皮肤。每个 variant 记录：

- `character_id`、`variant_id`、`variant_type`；
- `skin_id`、名称与默认标志；
- `source_page`、`source_meta`、model、skeleton、atlas 与 texture；
- source 状态。

实际获取记录位于 `standalone/assets/source/<character>/<variant>/retrieval.json`。运行时覆盖以 `standalone/dist/coverage.json` 为准，动作覆盖以 `standalone/dist/animation-coverage.json` 为准。

生成补间的输入、输出、评审与使用位置位于 `standalone/assets/generated/manifest.json`。来源和权利说明见根目录 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
