# 多桌宠与桌面互动

## 多实例模型

每只桌宠运行在独立进程和 Wayland surface 中：

```text
default       → pet-ark.service          → control.sock
amiya-side    → pet-ark@amiya-side       → amiya-side.sock
mon3tr-side   → pet-ark@mon3tr-side      → mon3tr-side.sock
```

实例配置位于：

```text
~/.config/pet-ark/runtime.env
~/.config/pet-ark/instances/<id>.env
```

Control Center 使用统一实例上下文切换总览、设置、日志和服务操作。编队上限为 8 个实例。

命令行：

```bash
npm run standalone:instance -- list
npm run standalone:instance -- create mon3tr-side mon3tr default
npm run standalone:control -- --instance mon3tr-side status
```

## niri 事件 broker

`pet-ark-context.service` 运行 `scripts/pet-ark-context-broker.mjs` 并订阅 niri event stream。当前事件映射：

| 桌面事件 | 桌宠反应 |
|---|---|
| 工作区 / 焦点变化 | `attention` 或 `wake` |
| 桌宠社交计时 | 轮换实例发送 `celebrate` / `attention` |
| broker 启动或重连 | 刷新实例与活动窗口状态 |

社交事件使用随机间隔和轮换目标，避免所有桌宠同步播放相同动作。

启停：

```bash
systemctl --user start pet-ark-context.service
systemctl --user stop pet-ark-context.service
```

可用环境变量：

```text
PET_ARK_CONTEXT_FOCUS=false
PET_ARK_CONTEXT_SOCIAL=false
```

## 互动演进

下一阶段沿用桌面环境的成熟接口：

1. 使用 niri window/layout 信息让桌宠靠近活动窗口边缘并避让全屏区域；
2. 引入跨实例位置广播，减少桌宠重叠并增加追逐、会合、接力等社交动作；
3. 使用 `xdg-desktop-portal` 打开 URI、文件或应用，为角色动作配置可见的快捷行为；
4. 为 KDE/GNOME 增加独立 adapter，保持事件模型一致；
5. 在控制中心提供事件时间线和逐实例互动强度。

桌宠运行时只接收 `wake`、`attention`、`celebrate` 等结构化事件；桌面环境适配保留在 broker 中，避免将 compositor 逻辑耦合到动画进程。
