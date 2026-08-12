# 角色数据

这里保存 Codex 与独立桌宠都能复用的角色身份和来源元数据，不包含任一运行时的状态假设。

## 文件

- `operators.json`：Codex 可玩角色 source-of-truth。每个条目包含稳定来源 ID、名称、实现状态、renderer、`visual_signature`，以及代码绘制 renderer 实际使用的 hair、face、outfit、palette、species、equipment、directional 等数据。
- `codex-sources.json`：Codex roster 的来源、获取日期、范围与去重统计。
- `sources.json`：跨产线来源索引。目前记录 Codex registry 位置以及 standalone 阿米娅素材的来源页面、原始资源、获取日期、原始动作、处理后动作和补帧结论。

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

## Standalone 素材记录

新增 standalone 角色时，必须先在 `sources.json` 增加来源记录，再获取素材。每条记录至少需要：

- `character_id`、`character_name`
- `source_page`、`source_asset`、`retrieval_date`
- `original_animation_states`
- `processed_states`
- `generated_interpolated_states`
- 被拒绝的补帧及采用原始动作的原因（如适用）

AI/image2 补帧不能写成原始素材。逐序列的 A/B 源帧、生成帧路径、接受状态与评审结论记录在 `standalone/assets/generated/manifest.json`。
