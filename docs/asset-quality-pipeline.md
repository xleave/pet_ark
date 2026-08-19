# 增量资产质量管线

资产修复以“索引 → 计划 → 单变体重建 → 抽查”为主；只有来源策略或渲染器升级才全量重建 932 个可运行外观。

## 当前状态

`standalone/dist/asset-quality.json` 当前统计：

| 分类 | 数量 |
|---|---:|
| 外观总数 | 933 |
| pass | 703 |
| review | 230 |
| critical / high | 0 / 0 |

`review` 是人工构图复核队列，常见对象包括大型机械单位、远端 companion 与有意留白。Mon3tr“锋锐”已有独立的可见像素和主体比例回归门禁。

## 工作流

1. 更新快速索引：

   ```bash
   npm run standalone:quality
   ```

2. 对候选执行 placement dry-run：

   ```bash
   npm run standalone:quality:plan
   ```

3. 重建计划中的变体：

   ```bash
   npm run standalone:quality:repair
   ```

4. 检查代表帧、动作 strip 与实际桌面显示。

质量索引结合 placement scale、同角色默认外观比例、idle 可见宽高和渲染修订号。修复器只处理预计有明确改善的候选，并原子替换 cleaned/runtime 产物。

## 导出清晰度策略

- 优先使用 Ark-Models 的 PC 客户端纹理，固定上游提交并校验 SHA-256；大型仓库不整库复制，只按外观获取；
- 使用固定提交的官方 spine-ts 3.8 解析器，不依赖 PRTS 页面运行时代码；
- 同时记录完整动画边界与核心角色边界；
- setup pose attachment 聚类用于识别主体，远端特效不再主导缩放；
- Relax/Default 代表帧执行像素密度探测，主体过小时统一提高所有动作的渲染比例；
- CPU 合成器处理 Spine light/dark tint、slot blend mode 与 clipping attachment；
- `placement_revision` 与 `render_revision` 变化会使旧缓存失效；
- 超出桌宠画布的远端特效可以裁切，角色主体、武器和 companion 进入人工复核。

全量 coverage 与动作完整性由 `standalone:validate-all` 管理；本流程只负责清晰度和构图风险。

予愿安洁莉娜的闭眼帧是 render revision 4 的回归样例：眼睑 tint 与 clipping 必须完整遮挡 open-eye attachment。后续触达的旧外观会按 revision 增量重建。

Mon3tr“锋锐”是高清来源回归样例：当前 PC 纹理为 976 × 976，代表帧必须保持主体宽高与可见像素门禁。普通来源升级只重建受影响外观；切换唯一来源策略时执行一次全量 932 外观重导出。
