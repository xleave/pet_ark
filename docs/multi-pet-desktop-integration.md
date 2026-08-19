# 多桌宠与桌面交互设计

## 多实例模型

多桌宠采用“一个实例一个原生进程/Wayland surface”，不把多个角色塞进同一个渲染循环。这样单个素材或协议故障不会拖垮全部桌宠，也能独立设置显示器、大小、速度、层级和交互策略。

```text
Pet Ark Manager
  ├─ instance: amiya-main  → pet-ark@amiya-main.service → amiya-main.sock
  ├─ instance: mon3tr-side → pet-ark@mon3tr-side.service → mon3tr-side.sock
  └─ instance: mascot      → pet-ark@mascot.service     → mascot.sock
```

实例注册表保存到 `~/.config/pet-ark/instances.json`，单实例配置位于 `~/.config/pet-ark/instances/<id>.env`。运行时 socket 使用 `$XDG_RUNTIME_DIR/pet-ark/<id>.sock`，systemd 使用 `pet-ark@.service` 模板。现有 `pet-ark.service` 和 `runtime.env` 迁移为 ID `default`，保持兼容。

Control Center 的总览将变为实例列表；角色、日志、启停、自启和参数操作都绑定选中实例。新增/复制实例是普通操作，删除实例需要二次确认且只删除该实例配置，不删除角色资产。

为避免多只桌宠重叠，manager 分配初始区域并广播其他实例的 alpha bounds。每个原生进程仍自行处理动画与拖动，但移动目标会避开其他桌宠。默认上限建议 8 个实例，并显示总内存与 surface 数。

## 桌面与应用程序交互

Wayland 不允许普通客户端任意读取所有窗口或注入全局输入，因此交互必须通过独立、可关闭的 `desktop-context-broker`，不能把 compositor 私有权限直接塞进动画进程。

第一阶段只读感知：

- 当前 workspace、focused app ID、窗口标题与可见矩形；
- 显示器工作区和窗口边缘；
- 锁屏、全屏、演示和空闲状态。

niri 适配器使用其 JSON event stream；KDE/GNOME 后续使用各自受支持接口。broker 将统一事件发送给 manager，桌宠只能收到去敏后的结构化上下文，不读取窗口内容。

首批安全行为包括：靠在活动窗口边缘、避让最大化窗口、切换应用时播放反应、全屏时自动安静/隐藏、在空桌面恢复巡游。任何会打开 URI、文件或应用的动作必须通过 xdg-desktop-portal 和用户确认。

默认禁止全局键鼠注入、读取剪贴板、截取窗口内容和按窗口标题执行 shell。若以后加入自动化，必须是单独 capability、应用级 allowlist、可见审计日志和随时可撤销的授权。

## 实施顺序

1. 实例 ID、独立 socket 和 `pet-ark@.service`；
2. Control Center 实例列表、复制/新增与逐实例日志；
3. manager 的碰撞避让和资源预算；
4. niri 只读 broker 与窗口边缘/全屏行为；
5. portal 动作和其他 compositor adapter。

这样多实例基础不依赖某个桌面环境，桌面交互也不会破坏原生桌宠的最小权限边界。

## 已落地的第一阶段

- 原生 runtime 接受 `PET_ARK_INSTANCE` / `--instance`。默认实例继续使用 `control.sock`，其他实例使用 `<id>.sock`；状态响应包含实例 ID，初始位置与随机行为种子也按实例打散。
- `pet-ark@.service` 从 `~/.config/pet-ark/instances/<id>.env` 启动独立实例；`npm run standalone:instance -- create <id>` 会校验 registry 后创建并启动实例。
- `pet-ark-context.service` 运行只读 niri event-stream broker。它对焦点、工作区和多桌宠社交时刻发送受限的 `wake`、`attention`、`celebrate` 事件，不注入键鼠、不读取窗口内容，也不依赖轮询。
- 多桌宠“社交时刻”带抖动间隔和轮换目标，避免所有角色机械地同步播放同一动作；可用 `PET_ARK_CONTEXT_FOCUS=false` 或 `PET_ARK_CONTEXT_SOCIAL=false` 分别关闭。
