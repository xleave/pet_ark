# pet_ark — 普瑞赛斯 Q 版 Codex Pet

一个面向 Codex custom pet 格式的《明日方舟》普瑞赛斯 Q 版桌宠。角色图使用仓库内的矢量生成器绘制，没有打包游戏原始立绘或 Spine 文件。

## 当前版本

- 8 × 9 atlas
- 单格 192 × 208
- 9 个 Codex 状态
- 每个状态使用完整 8 帧，共 72 帧
- 透明背景、lossless WebP
- Q 版识别点：黑色长直发、灰白研究服、黑色内搭、紫色点缀、胸牌、手持终端

状态行顺序：

1. `idle`
2. `running-right`
3. `running-left`
4. `waving`
5. `jumping`
6. `failed`
7. `waiting`
8. `running`（工作/处理中）
9. `review`

## 构建

```bash
npm install
python3 -m pip install -r requirements.txt
npm run rebuild
```

输出：

```text
dist/priestess-chibi/
  pet.json
  spritesheet.webp
  manifest.json
  frames/
```

## 安装到 Codex

将 `dist/priestess-chibi` 复制到：

```text
${CODEX_HOME:-$HOME/.codex}/pets/priestess-chibi/
```

最终目录内至少需要：

```text
pet.json
spritesheet.webp
```

## 动作设计

这版没有把同一张立绘做位移假动画。`idle` 有呼吸、眨眼和发梢摆动；左右移动使用交替步态和衣摆惯性；`waving` 使用手臂真实摆动；`jumping` 有起跳、滞空和落地；`failed` 做低头塌肩；`waiting` 把终端抱在身前；`running` 表现为操作终端；`review` 用视线移动和轻微点头表现检查过程。

## 参考与许可

代码以 MIT License 发布。仓库里的普瑞赛斯 Q 版图形属于非官方同人衍生设计；《明日方舟》及相关角色权利归其权利方所有，该角色设计不因本仓库代码许可证而获得额外授权。

实现格式参考 OpenAI `hatch-pet` 的 Codex pet atlas 规范；动作布局研究参考 `x-if666/lappland-codex-pets` 的开源实现。详见 `THIRD_PARTY_NOTICES.md`。
