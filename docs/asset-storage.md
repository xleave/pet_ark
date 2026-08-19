# 资产存储策略

Standalone 的 source、cleaned frames、accepted generated motion、runtime atlas 与 contact sheets 当前作为普通 Git 对象提交。这样 checkout 后可以离线复现、审查 provenance，并避免 fork PR 只提交 LFS pointer 而上游拿不到对象。

仓库设置以下预算：

- tracked working tree：8 GiB；
- fresh shallow checkout 的 Git object storage：4 GiB；
- 单文件：50 MiB；
- 新的重复输出层必须说明独立用途。

检查命令：

```bash
npm run repository:asset-budget
```

CI 使用完整 depth-one checkout 计算文件预算。超过任一预算时，应在单独维护变更中选择由上游持有的 Git LFS 或 durable release storage，并同步调整历史迁移和 CI checkout。
