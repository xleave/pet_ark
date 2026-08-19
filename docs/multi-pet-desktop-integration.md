# 多桌宠与桌面互动

## 实例与空间总线

每只桌宠使用独立进程、Wayland surface、配置和 Unix socket：

```text
default       → pet-ark.service          → control.sock
amiya-side    → pet-ark@amiya-side       → amiya-side.sock
mon3tr-side   → pet-ark@mon3tr-side      → mon3tr-side.sock
```

行为服务每 700 ms 读取在线实例的角色、外观、位置、尺寸、朝向和悬停状态，写入 `$XDG_RUNTIME_DIR/pet-ark/world.json`。它根据包围盒判断重叠，并为跟随、会合、朝向和避让解析相对目标。实例上限为 8。

```bash
npm run standalone:instance -- list
npm run standalone:instance -- create mon3tr-side --character mon3tr --variant skin-boc-11
npm run standalone:control -- --instance mon3tr-side status
npm run standalone:instance -- delete mon3tr-side --yes
```

## 动作协议与调度

运行时动作白名单为：

| 动作 | 参数 | 用途 |
|---|---|---|
| `emote` | `attention` / `celebrate` / `wake` | 表情与短互动 |
| `move_to` | 目标 x | 定点移动 |
| `follow` | 解析后的目标 x | 靠近另一桌宠 |
| `flee` | 解析后的目标 x | 重叠避让 |
| `look_at` | `-1` / `1` | 改变朝向 |
| `rest` / `sleep` / `wake` | 无 | 生活状态 |
| `cancel` | 无 | 返回 idle |

intent 还包含优先级、延迟、TTL、冷却键和原因。调度器按实例建立短执行租约，高优先级动作可抢占，低优先级动作会延后而不是丢失。

## 12 种情境行为

| 情境 | 默认动作 |
|---|---|
| 焦点变化 | 唤醒并问候 |
| 终端 / 编辑器获得焦点 | 面向工作区域 |
| 浏览器获得焦点 | 好奇互动 |
| 媒体应用获得焦点 | 安静休息 |
| 工作区切换 | 切换庆祝动作 |
| 新窗口 | 注意动作 |
| 窗口关闭 | 回望 |
| 紧急窗口 | 高优先级提醒 |
| 总览打开 / 关闭 | 休息 / 唤醒 |
| 指针进入桌宠 | 悬停问候 |
| 社交计时 | 一只靠近、另一只回望 |
| 桌宠重叠 | 高优先级避让 |

窗口与工作区来自 niri JSON event stream；其他 compositor 可通过同一上下文结构增加 adapter。

## AI provider

Mock AI 是默认 provider，用固定规则把情境映射到 intent，并由 JSONL 夹具回放。控制中心还可选择：

- `openai-compatible`：本地模型或兼容 `/chat/completions` 的服务；
- `openai-responses`：支持结构化输出的 Responses API。

两种远端模式都使用严格 JSON schema。所有响应再次经过本地 allowlist 和参数边界校验；失败时降级到 Mock AI。AI 只规划动作，不获得 shell、键盘、文件、应用启动或任意工具调用能力。

## 配置与运行

```bash
systemctl --user start pet-ark-context.service
systemctl --user enable pet-ark-context.service
npm run behavior:test
```

- 配置：`~/.config/pet-ark/behavior.json`
- 事件时间线：`~/.local/state/pet-ark/events.jsonl`
- 空间快照：`$XDG_RUNTIME_DIR/pet-ark/world.json`

控制中心统一编辑 provider、模型、密钥环境变量名、性格、互动强度、12 个行为开关、隐私字段和服务自启。
