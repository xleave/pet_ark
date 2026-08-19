# 增量资产质量管线

全量重新导出 933 个外观耗时长，也会让一个构建器改动同时扩大到整个仓库。资产维护改为四级增量流程：

1. `npm run standalone:quality` 只读取 cleaned/runtime manifest 与 idle hitbox，通常一秒内生成 `standalone/dist/asset-quality.json`；
2. 候选通过 `npm run standalone:quality:plan` 运行 Spine placement dry-run，只计算新旧边界与预期缩放，不编码 PNG；
3. 仅重建当前导出器预测缩放至少改善 20% 的变体，逐变体原子替换 cleaned/runtime atlas；完整/核心边界策略仍记录在每个 manifest 中，不把“必须切换到核心边界”误当成重建前提；
4. 对变更集合运行代表帧、动作覆盖和一次 compositor 抽查；全量验证留给定时任务或构建器大版本升级。

质量索引同时使用 placement scale、同角色默认外观比例、idle 可见宽高和渲染修订号。它是修复队列而不是最终视觉结论：大型机械单位、远端 companion 或有意留白仍需人工确认。

当前基线为 933 个外观：346 pass、281 critical、109 high、197 review。Mon3tr“锋锐”已从 critical 修复为 pass。报告中的 `reasons` 可用于批量选择同类问题，例如 `placement-scale-critical`、`idle-width-critical` 和 `variant-default-scale-drift`。

新的 Spine 导出器有两项关键改进：

- 从角色 PRTS 页面动态发现当前 SpineViewer source map，不再依赖易失效的静态哈希；
- 同时计算完整特效边界，以及由 setup pose 锚定、吸收邻近常规动作几何的核心角色边界。完整边界把主体密度压到核心边界的 78% 以下时切换，完整边界仍写入 manifest 供审计。
- 在编码前用 Relax/Default 代表帧做 alpha 像素密度反馈；若角色仍过小，则在统一自然比例上限内重算整套动作的缩放、水平中心和落地点，而不是逐帧放大造成动画跳动。

`npm run standalone:quality:repair` 读取计划并进行有界并行重建。单个外观失败会隔离到 `standalone/dist/spine-repair-results.json`，不会终止其余队列；全部 worker 结束后只统一刷新一次 registry、dist runtime 和质量报告。`--severity`、`--limit`、`--concurrency` 可用于本地分批执行。

Spine 原始 `Special` / `Interact` 动作可能包含完全透明的变身或位移节拍。导出器会在像素编码阶段探测它们，并向 cleaned manifest 写入带 `blank_policy_revision`、帧号和具体原因的显式声明；核心 idle/move/sit/sleep 等动作出现未声明透明帧仍会使构建失败，不能用 1×1 hitbox 悄悄掩盖。
