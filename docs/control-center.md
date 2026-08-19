# Pet Ark Control Center

Control Center 是 Standalone Desktop Pet 的独立管理界面。它使用 Tauri 2、Svelte 和一个只暴露白名单命令的 Rust backend；关闭窗口不会结束或替换原生 C / Wayland 桌宠。

## 边界

```text
Svelte UI
  └─ Tauri invoke（白名单）
       ├─ systemctl --user：start / stop / restart / enable / disable
       ├─ journalctl --user：只读 pet-ark.service 日志
       ├─ runtime.env：原子保存持久配置
       └─ control.sock：受限 JSON runtime commands
             └─ 原生 C / Wayland 桌宠
```

WebView 没有通用 shell、文件系统或网络权限。角色和皮肤选择必须存在于 standalone registry；所有 ID 都限制为字母、数字、点、下划线和连字符。运行时 socket 位于 `$XDG_RUNTIME_DIR/pet-ark/control.sock`，权限为当前用户读写。

## 功能

- 总览：服务、PID、角色/皮肤、行为、动画、scale、speed 和开关状态；
- 设置：角色、皮肤、大小、速度、自动移动、点击穿透和显示器；
- 日志：读取 `pet-ark.service` 的 journald 记录并按内容筛选；
- 服务：启动、停止、重启和“登录时启动”；
- 预览：直接读取所选外观的 runtime manifest 与 idle atlas，不读取 Codex spritesheet。

大小、速度、角色、皮肤、自动移动与点击穿透通过 control socket 实时生效。显示器需要重建 Wayland surface，因此 UI 提供“保存并重启”。所有设置同时原子写入 `~/.config/pet-ark/runtime.env`。

“登录时启动”对应 `systemctl --user enable pet-ark.service`，默认关闭；它不是系统启动前运行，也不会自动启用 user lingering。

## 本地 JSON 控制协议

每次 Unix stream 连接发送一个 JSON 请求并接收一个 JSON 响应：

```json
{"command":"get_status"}
{"command":"set_scale","value":0.85}
{"command":"set_speed","value":1.25}
{"command":"set_auto_move","value":true}
{"command":"set_click_through","value":false}
{"command":"select","character":"amiya","variant":"default"}
{"command":"quit"}
```

命令行客户端：

```bash
npm run standalone:control -- status
npm run standalone:control -- scale 0.85
npm run standalone:control -- select amiya skin-winter-1
```

## 开发和部署

Fedora 开发依赖包括 Rust、Node.js、`webkit2gtk4.1-devel` 和原有 standalone native dependencies。安装依赖并检查：

```bash
npm run control:center:install
npm run control:center:check
cargo test --manifest-path control-center/src-tauri/Cargo.toml
```

开发启动：

```bash
npm run control:center:dev
```

构建 release 并安装到当前用户的应用菜单：

```bash
npm run control:center:build
npm run control:center:deploy
```

用户服务安装默认启动但不启用登录自启：

```bash
npm run standalone:service:install
```

只有显式传入 `--enable` 才会启用登录时启动。
