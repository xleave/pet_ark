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
│   ├── characters/            # 多角色 registry 与生成的 C 数据
│   ├── animations/            # 独立逐动作播放器
│   ├── assets/                # source → cleaned/generated → runtime
│   └── dist/                  # 独立应用打包输出
├── shared/
│   ├── character-data/        # 角色 ID、名称、来源与 Codex roster
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
- 每个角色通过统一 registry 声明动画、缩放、移动参数和镜像规则；
- 不读取 `pet.json`，也不从 8 × 9 Codex atlas 裁帧。

JSON registry 在构建前转换为 `generated_registry.c`，因此运行时不需要 Node、Sharp 或 JSON parser。增加角色不需要创建新的桌面程序。

## 真正共享的部分

`shared/` 只保存两条产线都能合理使用的内容：

- 稳定角色 ID、名称与 roster/source metadata；
- 素材来源获取记录；
- 通用获取、裁剪、透明像素处理和格式转换工具。

以下内容刻意不共享：

- Codex atlas 行、固定帧数与九状态约束；
- standalone 桌面状态机、窗口、输入区域和移动系统；
- Codex 的代码绘制 renderer 与 standalone 的游戏 Q 版 Spine runtime 资源。

这种边界允许两条产线独立构建和验证，也避免为了复用形成耦合的万能 renderer。
