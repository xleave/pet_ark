# Control Center

Control Center 是 Standalone 桌宠的单窗口管理界面。关闭控制中心不会停止桌宠。

## 实例上下文

标题栏实例选择器控制整个窗口：

- 运行总览显示所选实例的角色、动作、PID 与参数；
- 桌宠设置读取并写入所选实例配置；
- 运行日志打开时直接显示所选实例最新 journald 输出；
- 服务管理负责所选实例的启停、重启和登录自启；
- 编队页负责实例创建、快速切换与互动测试。
- 交互中枢集中维护 AI provider、性格、互动强度、12 个行为开关、隐私字段、服务自启、空间总线和事件时间线。

默认实例配置位于 `~/.config/pet-ark/runtime.env`。其他实例位于 `~/.config/pet-ark/instances/<id>.env`。

## 控制链路

```text
Svelte UI
  └─ Tauri commands
       ├─ systemctl --user
       ├─ journalctl --user
       ├─ runtime.env / instances/*.env
       ├─ behavior.json / events.jsonl / world.json
       └─ $XDG_RUNTIME_DIR/pet-ark/*.sock
              └─ native Wayland runtime
```

角色和外观必须存在于 Standalone registry。实例 ID 支持字母、数字、点、下划线和连字符。

## 参数行为

大小和速度同时提供滑块、数值输入与微调按钮。角色、外观、大小、速度、自动移动和点击穿透通过 socket 实时应用；显示器编号改变时重启所选实例。

登录自启对应：

```bash
systemctl --user enable pet-ark.service
systemctl --user enable pet-ark@<id>.service
```

## JSON 控制协议

每个 Unix stream 连接发送一个 JSON 请求并读取一个 JSON 响应：

```json
{"command":"get_status"}
{"command":"set_scale","value":0.85}
{"command":"set_speed","value":1.25}
{"command":"set_auto_move","value":true}
{"command":"set_click_through","value":false}
{"command":"select","character":"amiya","variant":"default"}
{"command":"react","event":"attention"}
{"command":"act","action":"move_to","x":860}
{"command":"act","action":"look_at","direction":-1}
{"command":"act","action":"sleep"}
{"command":"act","action":"cancel"}
```

命令行客户端：

```bash
npm run standalone:control -- status
npm run standalone:control -- --instance mon3tr-side status
npm run standalone:control -- --instance mon3tr-side scale 0.85
npm run standalone:control -- --instance mon3tr-side act move-to 860
```

## AI 与隐私

默认 provider 是确定性的 Mock AI，可直接运行回放测试。`openai-compatible` 面向本地服务，`openai-responses` 面向 Responses API；密钥只读取配置指定的环境变量，不写入 JSON。窗口标题和工作区名称默认不进入 provider 上下文，应用 ID 可单独关闭。provider 失败时自动降级到 Mock AI。

事件时间线默认写入 `~/.local/state/pet-ark/events.jsonl`，约 2 MiB 时轮换；关闭“保留事件时间线”后停止持久化。行为配置由运行中的服务自动重载。

## 开发与部署

```bash
npm run control:center:install
npm run control:center:check
npm run control:center:dev
```

Release 部署：

```bash
npm run control:center:build
npm run control:center:deploy
```

部署产物安装到 `standalone/dist/app/bin/pet-ark-control-center`，并写入当前用户的应用菜单。
