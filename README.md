# pet_ark

`pet_ark` 同时提供两条边界清晰的《明日方舟》桌宠产线：

- **Codex Pets**：代码绘制的全角色 Q 版 Codex atlas，严格兼容既有 8 × 9 格式。
- **Standalone Desktop Pet**：完全不依赖 Codex 的原生 Linux Wayland 桌宠，使用独立动作资源、状态机、移动和交互运行时。

两者只共享角色身份、来源 metadata 和通用素材处理工具。Standalone 不读取 `pet.json` 或 Codex spritesheet；Codex 也不依赖 Wayland、桌面状态机或游戏 Spine runtime。

```text
pet_ark/
├── codex/
│   ├── build/          Codex atlas builder、finalizer、contact sheet
│   ├── characters/     registry loader 与 Priestess regression
│   ├── renderer/       vector renderer、动作与绘图 primitives
│   ├── validation/     Codex/coverage validator
│   └── dist/           角色输出、总索引、coverage、contact sheets
├── standalone/
│   ├── app/            原生 Wayland 应用入口
│   ├── runtime/        状态机、移动、图像和 Wayland backend
│   ├── characters/     多角色 registry
│   ├── animations/     独立动画播放器
│   ├── assets/         source/cleaned/generated/animations/runtime
│   └── dist/           独立应用包
├── shared/
│   ├── character-data/ roster 与统一来源记录
│   ├── asset-tools/    roster、PRTS 素材及 registry 工具
│   └── image-processing/
├── scripts/            根级命令代理
└── docs/
```

详细边界见 [`docs/architecture.md`](docs/architecture.md)。

## Codex Pets

Codex 产线保留 Priestess 作为像素级 regression baseline，并使用统一 roster、共享动作骨架和可组合角色特征扩展到获取日可核验的完整可玩角色集合。

当前 source-of-truth 获取日期为 **2026-08-12**：

- PRTS 可玩干员索引原始条目：427
- 合并 Amiya 职业转换后可玩角色：425
- Priestess 回归基线：1
- expected / implemented / validated / missing：**426 / 426 / 426 / 0**

每个角色定义包含稳定 ID、名称、状态、renderer、可审计 `visual_signature`，以及 renderer 实际使用的发型、面部、服装、种族、装备、饰品、动作和方向信息。精英阶段、皮肤、Live2D 和活动服装不单列；正式独立 playable alter 保留为独立条目。

Codex atlas contract 保持不变：

- 8 × 9 atlas，总尺寸 1536 × 1872；
- 单格 192 × 208；
- 状态顺序为 `idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`；
- 有效帧为 6 / 8 / 8 / 4 / 5 / 8 / 6 / 6 / 6，共 57 帧；
- 透明背景、lossless WebP；
- unused cells 完全透明，alpha=0 时 hidden RGB 清零。

输出位于 `codex/dist/`。每个角色包含 `pet.json`、`spritesheet.webp`、`manifest.json` 和 `frames/`；总索引、coverage 和九张人工验收总表分别位于：

- `codex/dist/index.json`
- `codex/dist/coverage-manifest.json`
- `codex/dist/contact-sheets/001.webp` … `009.webp`

共用动作不会抹去角色差异：长发、尾巴、耳朵、外套、光环、武器和 companion 会使用角色定义驱动的 secondary motion。基础左右步态可以镜像；眼罩、单侧饰品等不对称结构由 directional override 处理。

## Standalone Desktop Pet

Standalone 是原生 C / Wayland 客户端，以 `wl_shm` 提交透明像素，不需要 Codex，也不需要 X11 或 XWayland。它优先使用 `wlr-layer-shell` 创建透明 top-layer surface；在没有该协议的 GNOME Wayland 等环境回退到原生 `xdg-shell`。

2026-08-12 建立的 standalone source-of-truth 包含 **425 个正式可玩角色、425 个默认形象和 508 个皮肤，共 933 个外观变体**。正式 playable alter 是独立角色；皮肤是所属角色的独立外观变体，不会伪装成动画状态。目标清单与来源分别在 `shared/character-data/standalone-roster.json` 和 `shared/character-data/standalone-sources.json`，实际完成度只以 `standalone/dist/coverage.json` 为准；source 已索引或已获取不等同于 runtime 已实现。

每个已构建外观提供统一基础状态，并保留来源动作允许的特殊状态：

- `idle`
- `walk-left` / `walk-right`
- `run-left` / `run-right`
- `clicked` / `special`
- `picked-up` / `dragging` / `dropped`
- `rest` / `sleep` / `wake`

桌宠使用真正的行为状态机，而不是循环 GIF。idle 会等待合理时间后选择屏幕内随机目标；movement 完成后回到 idle；一次性交互和 transition 播放结束后才切换；长时间无交互进入 rest/sleep；点击睡眠角色会先 wake。移动系统维护朝向、输出边界、拖动恢复、速度倍率和每个外观的镜像规则。

运行时 registry 按 `character → variants` 建模，启动时可同时指定角色与皮肤：

```bash
npm run standalone:dev -- --character amiya --skin skin-winter-1
```

动作解析次序固定为：当前外观精确状态 → 当前外观声明的兼容状态 → 该角色默认外观精确状态 → 默认外观声明的兼容状态。回退必须由 manifest 明确声明，绝不会跨到另一角色，也不会无提示混用错误皮肤。

透明 surface 的 pointer input region 按当前帧 alpha bounds 更新，角色外透明区域不会用完整巨大矩形阻挡桌面。`--click-through` 可将 input region 置空，使用 `SIGUSR1` 恢复。

启动：

```bash
npm run standalone:dev -- --character amiya
```

带参数启动：

```bash
npm run standalone:dev -- --character amiya -- --scale 0.8 --speed 1.25 --verbose
npm run standalone:dev -- --character amiya -- --no-auto-move --monitor 1
```

运行时控制：

| 操作 | 行为 |
|---|---|
| 左键 / 拖动 | click reaction / 抓取并拖动 / dropped transition |
| 右键 | 角色 special |
| 中键 | 开关自动移动 |
| 滚轮 | 调整缩放 |
| `SIGUSR1` | 开关 click-through |
| `SIGUSR2` | 开关自动移动 |
| `SIGHUP` | 切换到 registry 中下一个角色 |
| `SIGRTMIN` | 切换当前角色的下一个可用皮肤 |
| `SIGINT` / `SIGTERM` | 退出 |

例如 `pkill -USR1 -x pet-ark` 可以在完全 click-through 后恢复输入。

当前设置入口是启动参数、鼠标控制和进程信号，尚未提供托盘或可视设置面板。切换时只选择已经存在 runtime assets 的角色或皮肤。退出可使用前台 `Ctrl-C`、`SIGTERM`，也会响应 compositor close。

Wayland/niri/KDE/GNOME 的具体实现路径与必须实机检查的项目见 [`docs/wayland.md`](docs/wayland.md)。原生应用已完成严格编译和真实链接且无编译警告；当前自动化环境没有图形 Wayland/niri session，因此不把 build、单元测试或无会话失败路径冒充 niri 实机验证。

## Character Assets

Standalone 使用与 Codex 完全独立的逐动作资源：

```text
standalone/assets/
├── source/       原始公开 meta、Spine skeleton、atlas、texture
├── cleaned/      确定性导出的透明 RGBA 逐帧 PNG
├── generated/    image2 补帧候选与 accepted/rejected manifest
├── animations/   状态、来源动作和帧顺序映射
└── runtime/      应用加载的 per-animation spritesheet 与 metadata
```

每个外观的 PRTS meta、Spine skeleton、atlas 和 texture 先原样写入 `source/<character>/<variant>/`；导出器再确定性生成透明、地面对齐、hidden RGB 已清零的逐帧 PNG，并按 source animation 生成独立 spritesheet 和逐帧可见 bounds。画布、采样率与最大帧数记录在各自 manifest，不依赖 Codex atlas。

image2/等效 image-to-image 流程不会为了增加帧数无意义生成。当前 manifest 有 1 个实际采纳序列：阿米娅默认外观 `sleep/000` 与 `sleep/001` 之间的光流 midpoint，经透明度、身份、配色、配件、地面配准和 hidden-RGB 检查后插入 runtime `sleep`；另一个 `idle-to-rest` 候选因画风、比例、伪文字、透明度和地面配准问题被明确 rejected。完整 A/B 源帧、生成器、候选路径、runtime usage、日期和评审结论在 `standalone/assets/generated/manifest.json`。

获取、导出、接受/拒绝规则与新增角色步骤见 [`docs/character-assets.md`](docs/character-assets.md)。

## Building

安装 Node 图像工具依赖：

```bash
npm install
python3 -m pip install -r requirements.txt
```

### Codex

兼容命令 `npm run rebuild` 继续构建并验证 Priestess。单角色和全量命令：

```bash
npm run codex:build -- --character amiya
npm run codex:validate -- --character amiya
npm run codex:build-all
npm run codex:validate-all
npm run codex:test
```

原有别名仍可用：

```bash
npm run build -- --character amiya
npm run validate -- --character amiya
npm run build:all
npm run validate:all
npm run rebuild
```

全量构建采用有界角色/帧并发；单角色完成后释放 atlas 中间缓冲，不把完整 roster raster 同时驻留内存。

### Standalone

Debian / Ubuntu 原生依赖：

```bash
sudo apt install build-essential pkg-config libwayland-dev libpng-dev
```

Fedora：

```bash
sudo dnf install gcc make pkgconf-pkg-config wayland-devel libpng-devel
```

单角色默认外观或指定皮肤构建：

```bash
npm run standalone:build -- --character amiya --skin default
npm run standalone:build -- --character amiya --skin skin-winter-1
```

全量素材构建使用有界并发；只有 425 个角色和 933 个外观全部进入 runtime 后才会通过完整性门禁：

```bash
npm run standalone:build-all -- --concurrency 4
npm run standalone:validate-all
```

原生应用构建、测试、当前覆盖验证与打包：

```bash
npm run standalone:build
npm run standalone:test
npm run standalone:validate
npm run standalone:package
```

打包输出位于 `standalone/dist/app/`，包含原生可执行文件、独立 runtime assets、角色 registry、manifest、license 和 third-party notices。

重新整理已有素材，可指定默认外观或皮肤：

```bash
npm run standalone:assets -- --character amiya --skin default
npm run standalone:assets -- --character amiya --skin skin-winter-1
```

需要从记录中的 PRTS URL 重新获取并导出时显式加入：

```bash
npm run standalone:assets -- --character amiya --skin skin-winter-1 --refresh-source
```

该步骤需要网络；普通 build/test/validate 使用仓库内已有资源，不依赖手工下载。

## Asset Sources

来源和获取日期不散落在代码注释中：

- `shared/character-data/codex-sources.json`：完整 Codex roster 的范围、来源、日期和 normalization 统计。
- `shared/character-data/operators.json`：425 条可玩角色定义；Priestess 回归定义单独保存在 `codex/characters/`。
- `shared/character-data/standalone-roster.json`：425 个角色、425 个默认形象、508 个皮肤及其 PRTS asset set。
- `shared/character-data/standalone-sources.json`：standalone 来源、范围、日期和机器统计。
- `shared/character-data/sources.json`：跨产线索引；保留早期逐角色来源记录。
- `standalone/assets/source/<character>/<variant>/retrieval.json`：每个外观的单次获取记录。
- `standalone/assets/generated/manifest.json`：所有 image2 序列的来源帧、生成帧和 accepted/rejected 结论。
- `standalone/dist/coverage.json`：expected / implemented / missing / blocked 的角色、外观与皮肤覆盖结果。

Codex roster 优先用鹰角网络官方干员档案核对；在官方页面不足以形成机器列表时，使用 PRTS、公开 game-data mirror 和公开 avatar index 做索引与视觉核对。Standalone roster 以同日 425 条可玩角色记录为身份基线，通过 PRTS 公开 `char_spine` metadata 枚举 933 个可访问的基建 Q 版外观 asset set，并用公开 `char_meta_table.json` 审计正式 alter 分组；获取日期为 2026-08-12。

## Licensing

项目自有代码以 MIT License 发布。该许可不覆盖《明日方舟》角色、商标或 standalone 中记录/分发的游戏来源素材。

Codex 产物是本项目代码绘制的非官方简化同人衍生图形；Standalone 的 `source/` 明确保存公开来源 Spine 文件，处理和生成层也分别标识，不会把 AI 补帧冒充原游戏素材。本项目与鹰角网络、PRTS 或 OpenAI 均无隶属或背书关系。

完整来源、协议文件许可和权利声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
