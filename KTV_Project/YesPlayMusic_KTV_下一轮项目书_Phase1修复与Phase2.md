# YesPlayMusic KTV 下一轮项目书

## Phase 1.1 修复与证据固化 + Phase 2 本地 KTV Session/Queue 实施方案

**项目：** YesPlayMusic KTV  
**仓库：** `Shilyfx/YesPlayMusic-KTV`  
**Phase 1 审查分支：** `feat/ktv-phase-1`  
**ChatGPT 审查锚点：** `856de64d43ab0c11abcee532b238fe2c43909d09`  
**本轮执行方式：** 一次 Codex 执行，先修复 Phase 1，再从修复后的固定 SHA 创建 `feat/ktv-phase-2` 并完成 Phase 2  
**目标平台：** Windows 主开发环境；macOS 保持一等兼容目标  
**架构基线：** Vue 2 + Electron + Howler + Express + 原有网易云 API 能力  
**视觉方向：** Glassmorphism / 透明玻璃 + 动态背景 + Light / Dark / Auto  

---

# 1. 本轮项目定位

本轮不是重新设计 YesPlayMusic，也不是直接进入手机局域网点歌，而是完成两个连续目标：

1. **修正 Phase 1 审查发现的真实问题并建立可审计工程基线。**
2. **实现 Phase 2 的本机 KTV 业务核心：Session、真实临时待唱队列、KaraokeManager、Player 适配和桌面队列管理。**

完成后，电脑端将首次拥有真正的“临时 KTV 队列”，而不是演示数据；用户可以在电脑上开始一场 KTV Session，从现有歌曲列表加入歌曲，调整顺序、删除待唱、切歌、重唱、结束 Session。手机 Remote 页面仍然只是响应式视觉预览，不接入真实数据，也不开放局域网端口。

本轮结束时，项目应具备稳定进入 Phase 3（独立 LAN KaraokeServer）的条件。

---

# 2. Phase 1 审查结论

Phase 1 结论为：**Conditional Pass（主体通过，存在必须修复项）**。

已确认正确的部分：

- 普通歌词字号已改为 16–64px 连续调节，step=1，显示 px 数值。
- 字号继续使用原有 settings/Vuex/localStorage 持久化路径。
- `lyricOffsetSeconds` 已支持 -10.0~+10.0 秒，0.1 秒步进和归零。
- 正值语义统一为“歌词提前显示”。
- 普通歌词高亮使用 `playerProgress + lyricOffsetSeconds`。
- 原始歌词时间戳没有被重写。
- 点击歌词仍然 seek 到原始 `line.time`。
- KTV 一级入口和 `/karaoke` Desktop Shell 已存在。
- Desktop Shell 使用真实播放器当前歌曲、封面、歌手与歌词数据。
- Desktop Queue 明确标注为 mock/演示数据。
- `/karaoke/remote` 已有手机、平板和 PC 响应式布局。
- Remote 当前业务数据是本地 mock，没有真实点歌 API。
- 原有 Express 仍为 `127.0.0.1:27232`，没有暴露 LAN。
- 没有 `KaraokeServer`、`0.0.0.0`、27233、SSE、WebSocket、真实远程 API。
- `Player.js` 核心未被 Phase 1 修改。
- `package.json` / `yarn.lock` 没有升级 Vue、Electron，也没有引入大 UI 框架。

因此 Phase 1 的总体技术方向成立，Phase 2 不需要推倒重来。

---

# 3. Phase 1.1 必须修复的问题

## 3.1 KTV 舞台字号“数值变了，但舞台没变”

### 现状

KTV 底部已经显示：

- 减小字号
- 当前 `xx px`
- 增大字号

并且会修改 `settings.lyricFontSize`。

但舞台当前歌词仍由固定 CSS `clamp(...)` 决定，因此用户把字号从 16 改到 64，主舞台歌词并不会按该设置真实变化。

### 修复设计

推荐在 KTV stage 根节点绑定 CSS 变量：

```text
--ktv-active-lyric-size: 28px
```

当前歌词使用该值；上一句/下一句使用其比例值，例如约 55%–65%，同时保留合理的最小字号。

目标不是机械地把所有文字都设成同一个 px，而是让“舞台字号”确实控制视觉主句大小，同时保持层级感。

### 验收

- 16px：明显缩小。
- 28px：默认。
- 64px：明显放大。
- 1440×900 不裁切。
- 1920×1080 不裁切。
- 长歌词允许换行，不横向溢出。

---

## 3.2 KTV 首句未到时错误显示第二句为当前歌词

### 现状

当前 KTV stage 用 `findIndex()` 找 active lyric。如果返回 -1，会强制使用 index 1。

这会导致：

- 歌曲刚开始，第一句歌词还没到时间；
- 或设置了负 offset，使有效进度更早；

此时第二句歌词可能被错误当成当前句。

### 新状态设计

歌词舞台至少区分：

1. `before-first`
2. `active`
3. `after-last`
4. `no-lyric/fallback`

`before-first` 时：

```text
上一句：空 / ♪
当前：等待歌词开始
下一句：第一句真实歌词
```

不能伪造第二句为当前句。

---

## 3.3 Remote Shell 的 Space 键隔离

### 现状

Remote 页面本身没有真实 Player 调用，但它仍运行在主 App 中。主 App 的全局 Space 键会调用 `player.playOrPause()`，且没有排除 `karaokeRemote`。

### 修复原则

Remote Shell 在 Phase 1/2 必须满足：

> 页面即使运行在主应用路由里，也不能产生任何真实播放器控制副作用。

因此 `/karaoke/remote` 应被全局播放快捷键显式排除。

KTV Desktop `/karaoke` 则仍可保留本机 Space 播放控制。

---

## 3.4 普通歌词字号防御性规范统一

设置页已经 clamp 到 16–64，但歌词渲染页仍可能直接读取 localStorage 中的异常值。

需要统一 normalize：

```text
非数字 → 28
<16 → 16
>64 → 64
```

这样即使旧用户数据或调试期间 localStorage 被写坏，也不会造成超大/超小歌词。

---

## 3.5 Remote mock 行为一致性

当前 mock 中：

- 点歌后 `requested = true`；
- 取消队列项后没有把 requested 恢复 false；
- 已加入位置文案固定写“第 5 首”。

需要让 mock 自身逻辑也一致，否则 Phase 3 接真实数据时容易继承错误交互假设。

修复：

- 取消后可重新点。
- 排队位置动态计算。
- 不新增真实 API。

---

# 4. 工程审计与工作流修复

## 4.1 为什么需要新增 BASELINE.md

目前仓库的一个重要历史事实是：Phase 1 工作区最初没有 `.git`，Codex 在功能改完后才初始化 Git。

因此首个 KTV commit 同时包含：

- 上游 YesPlayMusic 源码快照；
- Phase 1 新增/修改内容。

这意味着仓库内部不能通过“父提交 vs Phase1”还原纯净 diff。

不能通过重写 Git 历史来制造一个不存在的 baseline，因为那会让审计记录失真。

### 解决方案

新增：

`KTV_Project/AI_WORKFLOW/BASELINE.md`

记录：

- upstream repo
- 参考 upstream commit
- Phase 1 ChatGPT 审查 HEAD
- 无法恢复 pre-Phase1 本地 commit 的事实
- 关键文件 SHA 对照
- 后续每个 Phase 必须从明确父 SHA 创建分支

从 Phase 1 修复后的 SHA 开始，项目正式进入可追踪的规范 Git 流程。

---

## 4.2 AI_WORKFLOW 状态一致性

当前存在：

- `PROJECT_STATE.md` 仍写 `.git` 缺失阻塞；
- `CHATGPT_LATEST.md` 仍写 Phase 1 未 push；
- `CHANGELOG.md` 却写已经 push。

本轮必须统一。

建议最终状态写法：

```text
Latest ChatGPT review:
Phase 1 @ 856de64 — Conditional Pass

Phase 1 repaired commit:
<PHASE1_FIXED_SHA>

Current phase:
Phase 2 implementation complete; awaiting ChatGPT review
```

注意：不能写“ChatGPT 已批准修复 commit”，因为 ChatGPT 还没有检查未来的修复 SHA。

---

# 5. 可复现验证体系

## 5.1 当前问题

Codex 报告中有本地 build、Prettier、viewport 结果，但 GitHub HEAD 没有 CI status。

现有 `build.yaml` 是 Release workflow，主要用于 master/tag 发布，不适合作为 feature phase 的验证门。

## 5.2 新增 Phase Validation Workflow

建议新增：

`.github/workflows/phase-validation.yml`

触发：

```text
push: feat/ktv-*
pull_request: feat/ktv-*
workflow_dispatch
```

Node：16。

执行：

1. checkout
2. Yarn frozen-lockfile install
3. production web build
4. KTV/本轮变更文件 Prettier check
5. KTV/本轮变更文件 ESLint
6. full lint diagnostic

### Full lint 的处理原则

如果上游已有 lint 错误，full lint 可以作为 diagnostic，但必须：

- 输出真实错误；
- 新增 KTV 文件 lint 必须是 blocking；
- 不允许把本轮新错误写成“pre-existing”；
- 不为了让 full lint 绿而修改大量无关上游文件。

---

# 6. Phase 2 核心目标

Phase 2 是整个项目从“UI 原型”进入“真实 KTV 产品逻辑”的关键阶段。

Phase 2 完成后应实现：

```text
Desktop KTV
    │
    ├── KaraokeSession（真实）
    ├── KaraokeManager（真实）
    ├── KaraokeQueue（真实）
    ├── KaraokePlayerAdapter（真实）
    │
    ├── 当前演唱
    ├── 待唱顺序
    ├── 已唱/切歌状态
    ├── 上移/下移
    ├── 删除待唱
    ├── 清空待唱
    ├── 重唱
    └── 切歌

Remote Web
    └── 仍然 Mock / 尚未联网
```

也就是说：**电脑端先成为一个完整、可独立使用的 KTV 主机；手机联网能力延后。**

---

# 7. Phase 2 架构设计

## 7.1 分层原则

```text
┌───────────────────────────────┐
│        Desktop KTV UI         │
│ karaoke.vue / host actions    │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│       KaraokeManager          │
│ Session / Queue / state rules │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│    KaraokePlayerAdapter       │
│ thin playback integration     │
└──────────────┬────────────────┘
               │
               ▼
┌───────────────────────────────┐
│      Existing Player.js       │
│ Howler / source / playback    │
└───────────────────────────────┘
```

### 核心原则

`Player.js` 管“怎么播放”。

`KaraokeManager` 管“为什么播放这一首、这首在 KTV 队列是什么状态、下一首是谁”。

两者职责必须分离。

---

# 8. KaraokeSession 设计

Phase 2 只需要本地 Session，不需要 room code/token/IP。

建议数据：

```text
sessionId
status: idle | active | ended
createdAt
startedAt
endedAt
```

## 8.1 开始 Session

用户进入 KTV 后点击：

**开始本机 KTV**

系统：

1. 创建 sessionId。
2. status → active。
3. 初始化空 waiting queue。
4. 初始化空 history。
5. UI 显示“本机模式”。
6. 明确显示“局域网房间将在 Phase 3 开启”。

不启动网络服务。

## 8.2 结束 Session

如果存在待唱队列，提示确认。

结束后：

- Session ended。
- 清空临时 queue/history（本期推荐）。
- 不修改网易云歌单。
- 不退出 YesPlayMusic。
- KTV 页面回到 idle。

Phase 2 默认不做崩溃恢复，不把 queue 长期持久化。

---

# 9. KaraokeQueue 数据模型

## 9.1 为什么不能只保存 trackId

同一首歌可能被唱两次：

```text
晴天 — 小明
晴天 — 小王
```

因此队列项身份不能等于 trackId。

必须有独立 `queueItemId`。

## 9.2 推荐结构

```json
{
  "queueItemId": "uuid-or-equivalent",
  "trackId": 186016,
  "trackName": "晴天",
  "artists": ["周杰伦"],
  "albumName": "叶惠美",
  "coverUrl": "https://...",
  "durationMs": 269000,
  "requesterId": "host",
  "requesterName": "主机",
  "requestedAt": "2026-09-08T03:00:00+08:00",
  "status": "queued"
}
```

## 9.3 状态

```text
queued
playing
played
skipped
removed
```

Phase 2 可以只把 removed 从活动队列移除并留在短期 history，也可以直接删除，但行为必须一致并记录。

---

# 10. 重复歌曲策略

Phase 2 明确定义：**允许重复 trackId**。

原因：家庭 KTV 中同一首歌被不同人重复点非常常见。

例如：

```text
queueItem A → trackId 123 → 晴天
queueItem B → trackId 123 → 晴天
```

两个 queueItemId 必须不同。

排序/删除操作必须针对 queueItemId，而不是 trackId。

这也是以后多人手机点歌的必要基础。

---

# 11. KaraokeManager API 设计

最低需要：

```text
startSession()
endSession()
enqueueTrack(track, requester)
removeQueueItem(queueItemId)
moveQueueItem(queueItemId, targetIndex)
clearWaitingQueue()
startQueue()
next()
replay()
playOrPause()
```

可进一步提供：

```text
currentItem
waitingItems
historyItems
queueCount
isSessionActive
nextItem
```

UI 不应自己拼复杂业务状态。

---

# 12. 队列状态机

## 12.1 初始

```text
Session active
current = null
waiting = [A, B, C]
```

## 12.2 开始演唱

```text
A: queued → playing
current = A
waiting = [B, C]
```

播放器播放 A.trackId。

## 12.3 点击“切歌/下一首”

```text
A: playing → skipped
B: queued → playing
current = B
waiting = [C]
```

## 12.4 重唱

```text
B remains playing
waiting = [C]
player.seek(0)
player.play()
```

队列顺序、数量、status 不改变。

## 12.5 没有下一首

```text
current → skipped/played
current = null
waiting = []
session = active
```

页面显示：

**待唱列表为空，可继续点歌。**

不应抛异常，也不应自动结束 Session。

---

# 13. 自然播放结束如何处理

这是 Phase 2 中需要谨慎处理的一点。

理想状态：歌曲自然结束时：

```text
playing → played
next queued → playing
```

但不能为了这一点大幅侵入 Player.js。

优先顺序：

1. 查找现有 Player 是否已有可复用 end callback/event。
2. 如果可用，建立极薄的 adapter/hook。
3. 如果只能靠大幅修改内部 `_howler`，则 Phase 2 可以暂时明确：
   - 主机“下一首/切歌”流程完整；
   - 自然结束自动队列推进列为 Phase 2 已知缺口或用最小安全 hook 实现。

不能假装已经自动推进而实际没有。

---

# 14. KaraokePlayerAdapter 设计

## 14.1 目的

防止未来代码到处出现：

```text
player._list
player._currentTrack
player._howler
player._playNextList
```

KTV 业务层不应依赖 Player 私有字段。

## 14.2 Adapter 负责

```text
playTrack(trackId)
play()
pause/playOrPause
seek(0)
getCurrentTrack()
```

如果现有 Player 没有安全的 `playTrack(id)` 公共能力，可以：

- 优先复用已有 public API；
- 或只新增一个通用、最小的 public method；
- 不要把整个 KTV queue 塞进 Player。

---

# 15. 主机如何加入真实歌曲

Phase 2 没有手机，所以需要桌面本机入口。

## 推荐方案 A：TrackList 右键菜单

当 Session active 时，TrackList 增加：

**加入 KTV 待唱**

例如：

```text
播放
下一首播放
加入播放列表
────────
加入 KTV 待唱
```

点击后：

```text
real track object
     ↓
KaraokeManager.enqueueTrack()
     ↓
Desktop KTV Queue
```

toast：

**已加入 KTV 待唱：晴天**

## 备用方案 B：KTV 页加入当前歌曲

KTV 空队列时可以提供：

**将当前播放歌曲加入待唱**

主要用于快速测试与使用。

---

# 16. Desktop KTV UI 详细设计

Phase 1 已建立玻璃 UI，应保留整体语言，不重做风格。

## 16.1 顶栏

建议：

```text
← 返回音乐

● 本机 KTV 进行中
局域网房间将在 Phase 3 开启

[自动] [浅色] [深色]

[结束 KTV]
```

未开始时：

```text
KTV 尚未开始
[开始本机 KTV]
```

## 16.2 左栏：当前歌曲

显示：

- 封面
- 歌名
- 歌手
- 专辑
- 当前状态

Session active 且 currentItem 存在：

**正在演唱**

没有 currentItem：

**等待下一首**

## 16.3 中栏：歌词舞台

保留：

```text
上一句
当前句
下一句
```

当前句主视觉最强。

底部：

```text
歌词同步：提前 0.4s
字号：42px
```

## 16.4 右栏：真实待唱队列

Phase 2 取消“演示数据”徽标。

建议每项：

```text
01  晴天
    周杰伦 · 主机
    [↑] [↓] [删除]
```

当前 playing 项独立显示，不参与普通上/下排序。

空状态：

```text
还没有待唱歌曲
在歌曲列表中选择“加入 KTV 待唱”
```

## 16.5 队列较长

10+ 首时右栏内部滚动，不让整页布局被撑坏。

桌面 1440×900、1920×1080 必须都可用。

---

# 17. 底部主控 UI

建议三段：

```text
歌词同步
[-] 提前0.3s [+] [归零]

       [重唱] [暂停/播放] [切歌]

舞台字号
[-] 42px [+]
```

当 Session 未 active：

- 队列管理 disabled；
- 主控可以仍控制普通 Player，或明确置灰 KTV 特定动作；
- 行为必须清晰，不能看起来可用但无效果。

---

# 18. End Session UI

点击“结束 KTV”：

若队列非空：

```text
结束本次 KTV？
当前与待唱列表将被清空，网易云歌单不会受到影响。

[取消] [结束并清空]
```

结束后：

- queue 清空；
- history 清空（Phase 2 推荐）；
- session 进入 ended/idle 展示；
- Remote 仍显示预览，不创建房间。

---

# 19. Remote Web 在 Phase 2 的定位

Phase 2 **不接真实 KTV Manager**。

Remote 页面继续用于：

- UI 验证
- 响应式验证
- Light/Dark/Auto 验证
- 搜索卡片状态设计
- Queue 视觉设计

顶部文案建议改成：

```text
KTV Remote · Phase 2 预览
尚未连接局域网房间
```

不显示会误导用户的“房间已经可用”状态。

---

# 20. Remote 响应式规范

## 390 / 430 手机

布局：

```text
Header
Now Playing 小卡片
当前 Tab 内容
Bottom Navigation
```

Bottom Nav：

```text
点歌 | 队列 | 正在播放
```

触控目标至少约 44px 高。

## 768 平板

两栏：

```text
左：搜索结果
右：Now Playing + Queue
```

## 1440 PC Web

三栏：

```text
Now Playing | Search | Queue
```

不要只是把手机版横向拉宽。

---

# 21. Glass UI 规范延续

当前 Phase 1 已有可复用 token，本轮不重做设计系统。

## 21.1 Glass Panel

继续采用：

- 半透明背景
- 1px 低对比边框
- backdrop blur
- 柔和 shadow
- 20px 左右大圆角

## 21.2 Light

背景更亮，但必须保证：

- 正文对比度清晰
- glass 不接近全透明
- 输入框边界可辨认

## 21.3 Dark

- 深色底
- glass 不纯黑
- 当前歌词高亮明显
- 辅助文字透明度适中

## 21.4 Auto

跟随 `prefers-color-scheme`。

## 21.5 可访问性

保留：

- `prefers-reduced-motion`
- `prefers-reduced-transparency`
- focus-visible
- touch target

---

# 22. Phase 2 状态管理选择

不强制为了 KTV 增加新的第三方状态库。

可选：

1. KaraokeManager 实例挂在现有 Vuex state 的明确字段；
2. 独立 singleton/service + Vue 可观察桥；
3. 小型 Vuex module。

选择标准：

- UI 能响应 queue 状态变化；
- 业务逻辑可测试；
- 不把所有逻辑塞进 `karaoke.vue`；
- Phase 3 Server 将来可直接调用/订阅同一 Manager，而不重写业务队列。

推荐：**将 KaraokeManager 设计为框架相对独立的业务对象，再通过薄 Vue 层暴露状态。**

这样 Phase 3 的 Express 服务可以复用相同 Manager。

---

# 23. Phase 3 兼容性预留

虽然本轮不做网络，但 Phase 2 数据结构要为 Phase 3 做准备。

以后：

```text
Phone
  ↓
KaraokeServer
  ↓
KaraokeManager
  ↓
KaraokeQueue
  ↓
PlayerAdapter
  ↓
Player
```

因此 Phase 2 绝不能把 queue 写成只适合某个 Vue 页面使用的临时数组。

Manager 应成为未来 Desktop UI 和 Server 的共同业务源。

---

# 24. Phase 2 明确禁止项

本轮不允许：

- `0.0.0.0`
- `27233` listener
- KaraokeServer
- 二维码真实功能
- LAN IP 获取
- room token
- roomCode 真业务
- 手机真实搜索
- Remote `fetch/axios` KTV API
- real remote queue
- SSE
- WebSocket
- polling
- 互联网访问
- Vue 3 / Electron 升级
- 大型 UI 框架
- 音源分离/消人声
- 麦克风/音准评分

这些不是“做得越多越好”，而是越界。

---

# 25. Phase 2 测试计划

## 25.1 Session

| Case | 期望 |
|---|---|
| 初始 | idle |
| start | active |
| active 再 start | 安全，不产生第二个活跃 session |
| end | ended/idle（按最终决策） |
| end with queue | 有明确确认并清空临时数据 |

## 25.2 Queue

| Case | 期望 |
|---|---|
| 加 1 首 | 正确出现 |
| 加 5 首 | 顺序一致 |
| 同 trackId 加 2 次 | 两个不同 queueItemId |
| 删除中间项 | 其余顺序正确 |
| 第一首上移 | 不越界 |
| 最后一首下移 | 不越界 |
| reorder | UI 与 Manager 一致 |
| clear | waiting 清空 |

## 25.3 Playback

| Case | 期望 |
|---|---|
| start first | queued → playing |
| next | current → skipped；下一首 → playing |
| replay | seek 0；queue 不变化 |
| empty next | 不报错 |
| normal player outside KTV | 不受影响 |

## 25.4 Lyrics

- 16/28/64 px
- -1/0/+1s
- positive = earlier
- click seek 原始 timestamp
- before-first 正确

## 25.5 Remote

- 390×844
- 430×932
- 768×1024
- 1440×900
- Space 不控制 Player
- 无真实数据/API

---

# 26. Git 分支执行规范

本轮是一次执行，但分为两个 Git 检查点。

## Part A

```text
feat/ktv-phase-1
    ↓
修复 B-01~B-06
    ↓
验证
    ↓
commit + push
    ↓
PHASE1_FIXED_SHA
```

## Part B

```text
PHASE1_FIXED_SHA
    ↓
create feat/ktv-phase-2
    ↓
Phase 2 实现
    ↓
验证
    ↓
commit + push
```

禁止 force push。

如果 Phase 1 修复门失败，则**整次执行停在 Part A**，不能因为“计划里还有 Phase 2”而继续。

---

# 27. AI_WORKFLOW 下一轮结构

建议最终新增：

```text
KTV_Project/AI_WORKFLOW/
├── BASELINE.md
├── PROJECT_STATE.md
├── DECISIONS.md
├── CHANGELOG.md
│
├── REVIEWS/
│   ├── CHATGPT_PHASE_01_REVIEW.md
│   └── CHATGPT_LATEST.md
│
├── TASKS/
│   ├── STEP_01_FOUNDATION_UI_AND_LYRICS.md
│   └── STEP_02_LOCAL_SESSION_AND_QUEUE.md
│
├── PROMPTS/
│   ├── CODEX_STEP_01_PROMPT.md
│   └── CODEX_STEP_02_PHASE1_REPAIR_AND_PHASE2_PROMPT.md
│
└── REPORTS/
    ├── CODEX_STEP_01_REPORT.md
    └── CODEX_STEP_02_REPORT.md
```

以后 ChatGPT 审查优先读取：

1. `BASELINE.md`
2. `PROJECT_STATE.md`
3. `DECISIONS.md`
4. 当前 TASK
5. 当前 PROMPT
6. 当前 CODEX REPORT
7. 最新代码与提交历史

---

# 28. Phase 2 完成定义（Definition of Done）

只有全部满足，Phase 2 才算完成：

### Phase 1 修复

- 舞台字号真实生效。
- before-first lyric 修复。
- Remote Space 隔离。
- font normalize 一致。
- mock 取消/重加正确。
- AI_WORKFLOW 一致。
- baseline provenance 已记录。
- validation workflow 已加入。

### Phase 2 业务

- 真实本地 Session。
- 真实 canonical Queue。
- 独立 queueItemId。
- 允许重复 trackId。
- KaraokeManager。
- Player Adapter 边界清晰。
- Desktop Queue 不再是 mock。
- Host 可以从真实歌曲加入待唱。
- 上/下移动与删除。
- replay/next 正确协调队列。
- End Session 不碰网易云歌单。

### 工程

- 生产 build 通过。
- KTV scoped lint/Prettier 通过。
- CI workflow 已触发或明确 pending。
- 没有 LAN/server 越界。
- 精确 commit SHA 记录。
- `feat/ktv-phase-2` 已 push。

---

# 29. Phase 2 后的下一审查节点

Codex 完成并 push 后，下一次 ChatGPT 审查目标：

```text
Shilyfx/YesPlayMusic-KTV
branch: feat/ktv-phase-2
```

下一次重点审查：

- Phase 1 修复是否真实生效。
- Queue 是否是真实业务源而不是 UI 临时数组。
- Manager/Adapter 是否边界清晰。
- 是否错误依赖 Player 私有字段。
- duplicate track 处理。
- next/replay 状态机。
- normal player regression。
- Remote 是否仍 mock-only。
- 是否偷偷提前加入 LAN server。
- Phase CI 是否可复现。

如果 Phase 2 通过，才进入 Phase 3：

> 独立 KaraokeServer、安全的 LAN 监听、房间 Token、二维码、只读/写受限 API。

---

# 30. 后续完整路线图

```text
Phase 1
歌词增强 + Glass Design + KTV/Remote Shell
        │
        ▼
Phase 1.1
审查修复 + Baseline + Validation
        │
        ▼
Phase 2
Local Session + Real Queue + Manager + Player Adapter
        │
        ▼
Phase 3
Isolated LAN KaraokeServer + Room + QR + Security Boundary
        │
        ▼
Phase 4
Remote Real Search + Version Choice + Playability + Request/Cancel
        │
        ▼
Phase 5
Realtime Sync / SSE（必要时）+ UX Polish + macOS Packaging Validation
        │
        ▼
Optional
伴奏/消人声/麦克风/评分等高级 KTV 能力
```

---

# 31. 本轮最终产物

本轮 Codex 应最终在 GitHub 留下：

1. 修复后的 `feat/ktv-phase-1`。
2. 明确记录的 `PHASE1_FIXED_SHA`。
3. 新的 `feat/ktv-phase-2`。
4. 真实本地 KTV Session/Queue/Manager。
5. `BASELINE.md`。
6. Phase Validation workflow。
7. ChatGPT Phase 1 Review 归档。
8. STEP 02 Task / Prompt / Report。
9. 更新后的 PROJECT_STATE / DECISIONS / CHANGELOG。
10. 完整验证证据与精确 Git SHA。

本轮执行结束后立即停止，等待 `feat/ktv-phase-2` 的下一次 ChatGPT 审查，不进入 Phase 3。

