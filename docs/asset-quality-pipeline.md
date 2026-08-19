# 增量资产质量管线

全量重新导出 933 个外观耗时长，也会让一个构建器改动同时扩大到整个仓库。资产维护改为四级增量流程：

1. `npm run standalone:quality` 只读取 cleaned/runtime manifest 与 idle hitbox，通常一秒内生成 `standalone/dist/asset-quality.json`；
2. critical/high 候选先运行 Spine placement dry-run，只计算新旧边界与预期缩放，不编码 PNG；
3. 仅重建预测改善明显的变体，逐变体原子替换 cleaned/runtime atlas；
4. 对变更集合运行代表帧、动作覆盖和一次 compositor 抽查；全量验证留给定时任务或构建器大版本升级。

质量索引同时使用 placement scale、同角色默认外观比例、idle 可见宽高和渲染修订号。它是修复队列而不是最终视觉结论：大型机械单位、远端 companion 或有意留白仍需人工确认。

当前基线为 933 个外观：346 pass、281 critical、109 high、197 review。Mon3tr“锋锐”已从 critical 修复为 pass。报告中的 `reasons` 可用于批量选择同类问题，例如 `placement-scale-critical`、`idle-width-critical` 和 `variant-default-scale-drift`。

新的 Spine 导出器有两项关键改进：

- 从角色 PRTS 页面动态发现当前 SpineViewer source map，不再依赖易失效的静态哈希；
- 同时计算完整特效边界和 attachment 聚类后的核心角色边界。只有完整边界把主体压缩到核心比例的 60% 以下时才切换，完整边界仍写入 manifest 供审计。

后续 repair runner 应按 source fingerprint + render revision 缓存，并接受 `--severity`、`--limit` 和显式角色列表。默认每批 10–20 个，成功后统一重建 registry，避免每个变体重复执行全局步骤。
