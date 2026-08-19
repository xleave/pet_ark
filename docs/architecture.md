# 架构与目录边界

仓库包含两条独立产线。它们复用角色身份、来源记录和确定性图像处理工具，但不共享运行时格式或状态机。

```text
pet_ark/
├── codex/
│   ├── build/                 # Codex atlas 构建、finalizer、contact sheet
│   ├── characters/            # Priestess 回归实现与 registry loader
│   ├── renderer/              # Q 版 vector renderer、动作与绘图 primitives
│   ├── validation/            # atlas、manifest、registry 与 coverage 检查
│   └── dist/                  # 426 个 Codex Pet 及 coverage/contact sheets
├── standalone/
│   ├── app/                   # Wayland 桌宠入口与窗口/交互实现
│   ├── runtime/               # 状态机、移动、图像与 Wayland 协议绑定
│   ├── characters/            # character → skin/variant registry 与生成的 C 数据
│   ├── animations/            # 独立逐动作播放器
│   ├── assets/                # source → cleaned/generated/animations → runtime
│   └── dist/                  # app、characters、registry、coverage、动作审计/contact sheets
├── control-center/            # Tauri/Svelte 管理界面与受限 Rust backend
├── shared/
│   ├── character-data/        # 角色 ID、名称、Codex/standalone roster 与来源
│   ├── asset-tools/           # roster、PRTS 获取/导出、C registry 生成
│   └── image-processing/      # standalone 图像整理与 manifest 验证
├── scripts/                   # 根级命令代理，不承载业务实现
└── docs/
```

## Codex 边界

`codex/` 只负责 Codex Pet：

- 8 × 9、单格 192 × 208 的固定 atlas；
- 九个固定状态与 57 个有效帧；
- `pet.json`、lossless WebP spritesheet、逐帧 PNG 和每角色 manifest；
- hidden RGB、unused cells、帧数、尺寸与 coverage validation；
- 批量 contact sheet。

Codex renderer 使用代码绘制的 SVG/vector primitives。它不读取 standalone 的 Spine、运行时 spritesheet、桌面状态或 Wayland 窗口代码。

## Standalone 边界

`standalone/` 是不依赖 Codex 的桌面应用：

- 读取逐动作 runtime spritesheet 和独立 metadata；
- 使用 `idle`、移动、交互、抓取、落下、休息、睡眠与 transition 状态机；
- 在桌面边界内选择随机目标，按角色速度和朝向播放动作；
- 每个角色通过统一 registry 声明移动参数，并在嵌套 variant 中声明皮肤身份、动画、缩放、镜像与回退规则；
- 不读取 `pet.json`，也不从 8 × 9 Codex atlas 裁帧。

2026-08-12 的 standalone source-of-truth 包含 425 个正式可玩角色、425 个默认形象和 508 个皮肤，共 933 个外观。正式 playable alter 是独立 character，皮肤是所属 character 的 variant。期望范围保存在 `shared/character-data/standalone-roster.json`，资源条目 coverage 保存在 `standalone/dist/coverage.json`，真实动作 coverage 保存在 `standalone/dist/animation-coverage.json`，三者不能混为一谈。

动作 coverage 以八组必需动作（idle、movement、interaction、drag、rest、sleep、wake、special）为门禁，检查不含 transition bridge 后缀的核心帧数/视觉唯一帧数、时长、loop mode、provenance、fallback 和跨状态像素重复；bridge 由独立结构、endpoint 和 double-exposure 门禁负责。当前 933 个外观全部 animation-complete，partial/static-only 均为 0；八组动作分别都是 933 / 933。报告统计 5,146 个 source sequences、3,716 个 direct runtime states、8,392 个 deterministically derived sequences（覆盖 920 个 derived asset sets）、27 个使用 image2 生成帧的 runtime 状态和 0 个 semantic fallback。

重复审计中 1,866 组 exact duplicate 全部是已分类的左右方向镜像；same-frame fallback、static reused state 和 unresolved semantic duplicate 均为 0。最终 suspicious relation 为 1 组（Amiya default 的 `sleep`/`wake` 共享已追踪 generated 帧）；13 个低来源机械外观的 `rest`/`wake` 是有意反向序列，不计作 suspicious。跨状态边界共审计 5,601 处，4 处 warning-only、0 处 severe；3,735 个真实 endpoint bridge 的结构错误、endpoint mismatch 和 double exposure 均为 0。derived 帧的 runtime/provenance 双向覆盖为 78,445 / 78,445；28 个透明 source 帧均有 canonical cleaned 声明，unexpected/invalid 为 0。

最终全量图像 QA 覆盖 933 个 runtime manifest、6,080 张 atlas 和 119,574 个使用中的 cell，结构性硬错误为 0。保守阈值保留 411 个相邻帧、41 个 bridge 内部帧、4 个边界和 1 个 source sleep loop 人工复核 warning；定向 strip 检查未发现双轮廓、错误皮肤、裁切或身份闪回。资源人工验收输出到 `standalone/dist/contact-sheets/coverage/` 与 `standalone/dist/contact-sheets/animation-strips/`，不进入 Codex contact sheet 产线。

JSON registry 在构建前转换为 `generated_registry.c`，因此运行时不需要 Node、Sharp 或 JSON parser。增加角色或皮肤不需要创建新的桌面程序。启动参数 `--character` 和 `--skin` 选择初始外观；`SIGHUP` 与 `SIGRTMIN` 分别切换到下一个可用角色和当前角色的下一个可用皮肤。

Wayland backend 只在动画帧、整数像素位置、scale、selection 或 input region 变化时标记 surface dirty，并用 `wl_surface_frame` callback 节流 buffer commit。layer-shell 是默认支持路径；xdg fullscreen fallback 必须显式 opt-in，避免在尚未实机验证的 GNOME 环境无意创建真正的 fullscreen toplevel。

运行时仍支持 manifest 显式声明的兼容解析顺序：当前 variant 精确状态 → 当前 variant 兼容状态 → 同角色默认 variant 精确状态 → 默认 variant 兼容状态。动作完成门禁不会把这种运行时容错当成完成依据；当前完整产物的 semantic fallback 计数为 0。运行时不会跨角色回退，也不会在缺少声明时静默混用错误皮肤。

Codex roster 的 426 来自 425 个正式可玩角色加 1 个 Priestess story regression baseline；Standalone roster 只包含 425 个正式可玩角色，因此两者差 1 是有意边界，不是 Standalone 漏角色。本阶段不改变 Codex renderer、atlas contract 或其构建产线。

## Control Center 边界

`control-center/` 是可选管理界面，不进入桌宠的动画循环，也不改变 Codex/Standalone 素材边界。它通过当前用户的 systemd manager 管理 `pet-ark.service`，通过 journald 读取该 unit 的日志，并通过 `$XDG_RUNTIME_DIR/pet-ark/control.sock` 查询或实时设置原生运行时。

前端没有通用 shell 或任意文件访问权限。Rust backend 只暴露服务启停、自启、配置、registry、预览、日志和固定 JSON 控制命令。持久配置位于 `~/.config/pet-ark/runtime.env`；角色、皮肤、大小、速度与行为开关可实时应用，显示器变更通过服务重启应用。

Control Center 的动画预览读取 Standalone runtime manifest 与 atlas，不读取 Codex `pet.json` 或 8 × 9 spritesheet。关闭控制中心不会退出桌宠；关闭桌宠也不会要求控制中心常驻。

## 真正共享的部分

`shared/` 只保存两条产线都能合理使用的内容：

- 稳定角色 ID、名称与 roster/source metadata；
- 默认形象、皮肤 ID、来源 asset set 与获取记录；
- 通用获取、裁剪、透明像素处理和格式转换工具。

以下内容刻意不共享：

- Codex atlas 行、固定帧数与九状态约束；
- standalone 桌面状态机、窗口、输入区域和移动系统；
- Codex 的代码绘制 renderer 与 standalone 的游戏 Q 版 Spine runtime 资源。

这种边界允许两条产线独立构建和验证，也避免为了复用形成耦合的万能 renderer。

全量二进制资产当前有意使用普通 Git，并受 8 GiB 未压缩 tracked-tree、4 GiB Git 对象存储与 50 MiB 单文件预算约束；详见 [`asset-storage.md`](asset-storage.md)。这项存储决策独立于运行时/renderer 边界，超过预算时必须在合并前单独决定由 upstream 持有的 LFS 或 durable release 迁移。
