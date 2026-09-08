# YesPlayMusic KTV — Phase 2 审查与 Phase 3 项目书

> 审查仓库：`Shilyfx/YesPlayMusic-KTV`
> 审查分支：`feat/ktv-phase-2`
> Phase 2 功能提交：`d091844f456bd91cc36b6bac6fc6500d3b55134e`
> 文档检查点 / 当前审查 HEAD：`5252177e8b6700b24ebc0e43882df77d9f60b60b`
> Phase 2 父提交：`98436df30434432037f8dfc0213b85df33205176`
> 审查结论：**Conditional Pass。Phase 2 领域模型主体成立，但播放所有权、状态事务和 CI 必须在 Phase 2.1 修复门中解决；门槛通过后，同一次执行继续 Phase 3。**

---

## 1. 总体结论

Phase 2 的架构方向正确，以下项目通过：

- `KaraokeManager` 已成为真实 KTV 业务状态源，`karaoke.vue` 不再用临时数组承担真实 Queue。
- `KaraokeSession` 与 `KaraokeQueue` 职责分离。
- `queueItemId` 与 NetEase `trackId` 独立，因此同一 `trackId` 可重复点歌。
- 删除、移动和状态变化均基于 `queueItemId`。
- `KaraokePlayerAdapter` 只调用 Player 公共方法，没有直接访问 `_currentTrack`、`_list`、`_playNextList`、`_howler` 等私有字段。
- Vuex 的 `karaoke` 对象是 Manager 发出的渲染快照。
- `/karaoke/remote` 仍是本地 mock-only 页面，没有接真实 Queue、Manager 或播放器。
- Phase 2 没有新增 LAN listener、`0.0.0.0`、27233、`KaraokeServer`、真实二维码房间、Remote API、SSE、WebSocket 或 polling。
- 原有 27232 仍绑定 `127.0.0.1`。
- `5252177...` 相对 `d091844...` 只修改 `PROJECT_STATE.md` 与 `CODEX_STEP_02_REPORT.md`，没有新增代码行为。

但是，当前 KTV Queue 与普通 Player 尚未形成可靠的“播放所有权”边界。自然结束、不可播放、load error、系统媒体键等路径仍可能绕过 `KaraokeManager` 进入普通播放列表，导致 UI/Queue 与实际音频分裂。因此 Phase 2 不能作为完全干净的验收点直接进入网络化。

---

## 2. 领域模型验收

### 2.1 KaraokeManager

**通过。**

实际业务状态位于：

```text
src/karaoke/KaraokeManager.js
src/karaoke/KaraokeSession.js
src/karaoke/KaraokeQueue.js
src/karaoke/KaraokePlayerAdapter.js
```

`karaoke.vue` 读取 Vuex snapshot 渲染，并通过 Manager 执行业务动作；Manager 修改自己的 Session/Queue 后 `notify()`，再由 Vuex `replaceKaraokeState` 更新 UI。

### 2.2 KaraokeSession

**基本通过。**

生命周期：

```text
idle → active → ended
```

包含：

```text
sessionId
status
createdAt
startedAt
endedAt
```

重复 start 在 ACTIVE 时幂等；end 只对 ACTIVE 生效。新 Session 会建立新 Queue。

### 2.3 KaraokeQueue

**通过核心要求。**

当前：

```text
queueItemId = ktv-item-<timestamp>-<sequence>
trackId     = NetEase track ID
```

所以三个相同 `trackId` 可以拥有三个不同 `queueItemId`。`remove()`、`move()`、`take()` 都依据 queueItemId。

Phase 4 网络 API 必须继续坚持：

> 客户端队列操作使用 `queueItemId`，不能用 `trackId` 作为队列唯一键。

### 2.4 PlayerAdapter

**通过“不得访问私有字段”要求。**

当前只调用：

```text
player.playTrackByID()
player.seek()
player.play()
player.playOrPause()
```

问题不在 Adapter 越界，而在 Player 的公共 `playTrackByID()` 目前仍继承普通播放列表的 fallback 行为。

---

# 3. 阻塞问题

## B2-01：KTV 不可播放会落回普通播放列表

当前 KTV 路径：

```text
KaraokeManager
→ KaraokePlayerAdapter.playTrack
→ Player.playTrackByID
→ _replaceCurrentTrack
```

`_replaceCurrentTrack()` 默认 `ifUnplayableThen = PLAY_NEXT_TRACK`。当 KTV 曲目拿不到音源时，Player 会调用普通 `_playNextTrack()`。

结果可能变为：

```text
KaraokeManager.currentItem = KTV A / PLAYING
Player 实际播放            = 普通歌单 B
```

**这是硬阻塞。**

### 修复要求

提供一个公共、可等待结果、不会落入普通 playlist 的 KTV 单曲播放策略。例如：

```text
playTrackByID(id, { fallback: 'none' })
```

具体形式可调整，但必须：

- 返回 Promise；
- 明确 success / failure；
- KTV unplayable 不执行普通 next；
- KTV loaderror 不执行普通 next；
- Adapter 仍不得调用 Player 私有方法；
- Manager 根据播放结果提交业务状态。

---

## B2-02：playQueueItem 不是事务型状态转换

当前顺序大致为：

```text
queue.take()
→ item = PLAYING
→ currentItem = item
→ notify()
→ playerAdapter.playTrack()
```

播放器失败时，Manager 已经声称该条目正在播放。

**这是硬阻塞。**

### 修复要求

采用“先尝试、后提交”或显式 `loading` 状态：

```text
queued
→ loading
→ playback success
→ playing
```

失败：

```text
queued/loading
→ failed/unplayable
→ history
→ currentItem = null
```

并增加 transition guard，避免用户快速重复点击 start/next 形成并发播放切换。

---

## B2-03：next() 无下一首时业务状态与音频分裂

当前 `next()` 先把 current 标记为 `SKIPPED` 并清空，再调用 `startQueue()`。如果 waiting 为空，Player 并不会停止旧音频。

结果：

```text
Manager.currentItem = null
Player              = 继续播放旧 KTV 歌
```

### 修复规则

```text
current + waiting
→ current SKIPPED
→ 尝试下一首 KTV

current + no waiting
→ current SKIPPED
→ stop/pause KTV audio
→ current = null
→ Session 保持 active
```

`no current + waiting` 时按钮可以启动第一首；两者都为空则 no-op。

---

## B2-04：自然结束当前会自动进入普通 playlist

Howler 仍是：

```text
onend
→ Player._nextTrackCallback()
→ Player._playNextTrack()
```

因此 `DECISIONS.md` 中“自然结束自动前进延后处理”与真实运行行为并不等价：现在不是“不自动前进”，而是**自动进入普通播放器下一首**。

**这是硬阻塞。**

### 修复要求

给 Player 增加稳定的公共结束事件/播放所有权机制，例如：

```text
Player.onPlaybackEnded(listener)
```

KTV ACTIVE 且拥有当前播放时：

```text
Player ended
→ Adapter public event
→ KaraokeManager.handleTrackEnded()
→ current → PLAYED
→ 尝试下一首 KTV
```

没有下一首则停止并进入等待。

普通模式下必须继续保留原来的 normal-next 行为。

KaraokeManager 不得理解 Howler，也不得访问 `_howler`。

---

## B2-05：结束 Session 未处理正在播放的 KTV 音频

当前 `endSession()` 只：

```text
session.end()
queue.reset()
notify()
```

可能留下：

```text
Session = ended
Queue   = empty
Player  = 仍播放 KTV 曲目
```

同时普通播放器的 list/current index 仍可能指向进入 KTV 前的上下文。

### 本阶段确定策略

Phase 2.1 采用最确定的第一版策略：

> **结束 KTV Session 时停止当前 KTV 音频，不自动恢复进入 KTV 前的歌曲。**

以后 Phase 5 可增加“恢复之前播放”。

---

## B2-06：全局快捷键 / MediaSession 可以绕过 Manager

Electron global shortcut 的 next 最终直接调用：

```text
player.playNextTrack()
```

MediaSession next/previous 也走 Player 普通路径。

因此 KTV ACTIVE 时媒体键可以绕过 KaraokeManager。

### 修复要求

建立集中控制路由，或最低限度统一判断：

```text
if KTV owns playback:
    play/pause → KaraokeManager
    next       → KaraokeManager
    previous   → 明确 no-op / unsupported
else:
    原 Player 行为
```

不要把 KTV 判断散落到大量组件。

---

## B2-07：Vuex 严格意义上还不是“只存快照”

当前：

```text
state.karaokeManager = karaokeManager
state.karaoke        = snapshot
```

`karaoke` 是正确的渲染快照，但 Manager service 实例仍被放进 Vuex state。

### 修复要求

Vuex 只保留：

```text
state.karaoke
```

Manager 改为非响应式 runtime service，例如：

```text
src/karaoke/runtime.js
```

或 `store.$karaokeManager` 等不属于 serializable state 的方式。

这样 Phase 3 Main/Renderer bridge 不会和 Vuex service locator 耦合。

---

## B2-08：GitHub CI 当前为红色

真实 GitHub Actions：

```text
d091844... → KTV Phase Validation run 34183461124 → failure
5252177... → KTV Phase Validation run 34183501151 → failure
```

`yarn install --frozen-lockfile` 成功，失败发生在 `Production web build`。

日志显示 Prettier/CRLF 问题：

```text
src/App.vue
src/views/karaokeRemote.vue
src/views/lyrics.vue
src/views/settings.vue
src/utils/lyricsSettings.js
```

错误形式：

```text
Delete ␍⏎
```

因此 `CODEX_STEP_02_REPORT.md` 中“Production web build passed”只能代表本地 Windows 结果，不能视为仓库级验证通过。

### 修复要求

- 上述文本统一 LF；
- 不全仓库无关 reformat；
- `git diff --check` 通过；
- Node 16 Production Build 通过；
- scoped Prettier/ESLint 通过；
- **Phase 2 repair push 后 GitHub Action 必须 green 才允许创建 Phase 3。**

---

## B2-09：Phase validation 范围已落后于 Phase 2

现有 workflow 的 scoped Prettier/ESLint 主要仍覆盖 Phase 1 文件，没有明确覆盖：

```text
src/karaoke/**/*.js
src/store/index.js
src/store/state.js
src/store/mutations.js
src/utils/Player.js
```

### 修复要求

扩大稳定 KTV source set，Phase 3 继续加入 server/remote entry。新 KTV 文件不得绕过 blocking lint。

---

# 4. 建议优化项

### O2-01 网络化前加强 Queue 输入校验

未来 Remote API 的：

```text
queueItemId
targetIndex
requester
```

都是不可信输入。

Phase 4 前至少验证：

- queueItemId 类型与长度；
- targetIndex 为 finite integer；
- index clamp 规则明确；
- item 必须仍是 waiting；
- requesterId 由服务端生成，不接受客户端伪装 host。

### O2-02 Queue history 顺序

`clearWaiting()` 连续 `unshift()` 会反转一次批量清理项的历史顺序。不是 Phase 2 核心阻塞，但 Phase 4 展示历史前建议固定排序语义。

---

# 5. Phase 3 目标

Phase 3 的目标不是完整手机点歌，而是建立：

> **安全、独立、可关闭、可扫码访问的局域网 KTV 房间基础设施。**

完成后：

```text
电脑开始本机 KTV
→ Host 开启手机点歌
→ 获取 LAN IPv4
→ 创建 roomCode + 强随机 token
→ 独立 KaraokeServer 监听 0.0.0.0:27233
→ 生成真实 QR
→ 手机打开独立 Remote Web
→ 验证 token
→ 显示 Connected / Room Code
```

仍不实现真实网易云搜索和 Queue mutation。

---

# 6. Phase 3 网络架构

```text
Electron Main Process
│
├── Existing Desktop Express
│     └── 127.0.0.1:27232   ← 完全保持
│
└── KaraokeServer
      └── 0.0.0.0:27233     ← 仅房间开启时
           ├── Remote static bundle
           ├── Room identity
           ├── Token validation
           └── Minimal read-only room API
```

禁止：

```text
27232 → 0.0.0.0
27233 → proxy full /api
27233 → /player
```

---

# 7. KaraokeServer 生命周期

Server 必须由 Electron Main Process 管理，renderer 不得直接 `listen()`。

推荐生命周期：

```text
Local KTV Session active
→ Host 点击“开启手机点歌”
→ IPC invoke
→ Main KaraokeServer.start()
→ resolve LAN IP
→ create roomCode/token
→ listen 0.0.0.0:27233
```

停止条件：

```text
Host 关闭 LAN room
或 KTV Session 结束
或 app quit
→ KaraokeServer.stop()
→ token 失效
```

没有 active room 时，27233 不应监听。

**LAN Server 启动失败不得终止本机 KTV。**

---

# 8. LAN IPv4

使用 Node：

```text
os.networkInterfaces()
```

筛选：

- IPv4
- `internal === false`
- 优先 RFC1918 地址

禁止：

```text
ipconfig
ifconfig
PowerShell
Registry
```

多个网卡时提供候选并允许 Host 选择：

```text
Wi-Fi
Ethernet
VPN / virtual adapter
```

---

# 9. Room identity 与 Token

每个房间最少：

```text
roomId
roomCode
sessionId
token
createdAt
hostAddress
port
status
```

`roomCode` 仅用于人类识别，可为 4–6 位。

认证 token 必须：

```text
crypto.randomBytes(...)
```

禁止用 `Math.random()` 作为安全 token。

Token：

- 每次房间重新生成；
- room stop/session end 后立即失效；
- 不长期持久化；
- 不写普通日志；
- 旧 token 不能复用。

---

# 10. QR 与 Join URL

复用仓库已有 `qrcode`，不引入新的大型二维码库。

建议：

```text
http://192.168.1.22:27233/ktv/#/join?room=5826&token=<secret>
```

优先把 token 放 URL fragment：

1. Remote 从 fragment 读取；
2. 存 `sessionStorage`；
3. 清理地址栏 secret；
4. API 请求使用：

```http
Authorization: Bearer <token>
```

不要长期把 token 放 query/log/referrer 中。

---

# 11. Remote Web 必须独立化

Phase 1/2 的 `/karaoke/remote` 仍属于完整 Desktop SPA。

Phase 3 必须建立真正的独立 Remote bundle/entry，可继续使用 Vue 2、Glass tokens、ThemeSwitcher，但：

```text
Remote bundle ≠ Desktop SPA
```

可以使用 Vue CLI multi-page 或独立 entry。

**KaraokeServer 不能 `express.static()` 整个桌面 dist 根目录。**

27233 只允许 Remote 需要的 HTML/JS/CSS/asset。

---

# 12. Phase 3 最小 API

允许：

```http
GET /ktv/api/health
GET /ktv/api/room
```

`/room` 必须 token protected。

示例响应：

```json
{
  "active": true,
  "roomCode": "5826",
  "sessionId": "...",
  "serverVersion": 1
}
```

不得返回 secret token。

Phase 3 禁止：

```text
/search
POST /queue
DELETE /queue/:id
/control/next
/control/replay
/control/play
SSE
WebSocket
polling live sync
```

Remote 可以首次加载 fetch + 手动 retry。实时同步留给 Phase 4。

---

# 13. IPC 边界

推荐：

```text
karaoke:lan:start
karaoke:lan:stop
karaoke:lan:status
```

返回：

```text
running
address
port
roomCode
joinUrl
qrDataUrl
error
```

Phase 3 IPC 不暴露：

```text
queue mutation
player control
search
```

---

# 14. HTTP 安全要求

KaraokeServer 必须：

- same-origin Remote 优先；
- 不使用 wildcard CORS；
- unknown routes 404；
- 防目录穿越；
- 请求体/参数长度限制；
- 基础安全 headers；
- 不输出 token；
- 不暴露 desktop `/api`；
- 不暴露 `/player`；
- 不暴露任意文件系统；
- 不执行 shell；
- protected endpoint 缺 token / 错 token 返回 401；
- server stop 后旧 token 无效。

不需要引入大型安全框架。

---

# 15. Desktop UI

KTV 房间区域需要真实状态。

### Off

```text
局域网点歌未开启
[开启手机点歌]
```

### Starting

```text
正在启动局域网房间…
```

### Active

显示：

```text
房间 5826
192.168.1.22:27233
二维码
[复制链接]
[关闭房间]
```

多个 IPv4 时允许选择。

### Error

例如：

```text
27233 已被占用
本机 KTV 仍可正常使用
```

不能自动回退到 27232。

---

# 16. Remote UI Phase 3

真实状态：

```text
connecting
connected
invalid-token
room-ended
host-offline
```

Connected 后展示真实：

- roomCode
- host reachable
- theme

Search / Queue / Now Playing 的业务数据仍保持 mock 或 disabled，并显著标注：

```text
真实点歌将在 Phase 4 开启
```

避免让用户误以为已经接入真实点歌。

---

# 16A. KTV 主舞台 UI 布局增强（新增强制要求）

本项依据当前桌面 KTV 页面实际视觉效果新增。当前三栏主内容区域在大屏下占用高度偏小，顶部与底部存在明显的大面积空白，歌词舞台没有成为页面视觉中心。

## 16A.1 主内容区域必须填满主要可用空间

桌面端 KTV 页面应调整为：

```text
Header
┌─────────────────────────────────────────────────────────────┐
│ 左侧歌曲信息 │          中央歌词主舞台          │ 右侧队列 │
│              │                                  │          │
│              │        主视觉区域尽量铺满         │          │
│              │                                  │          │
└─────────────────────────────────────────────────────────────┘
Footer Controls
```

### 强制目标

- 红框所示的三栏主内容区域应占 Header 与 Footer 之间**约 90% 的可用垂直空间**；
- 不允许在 1440×900、1920×1080 等桌面分辨率下出现当前这种“主内容只占中间一条、上下大量留白”的效果；
- 外层仅保留必要的安全边距，建议视觉边距约 16–24px；
- 主舞台应随窗口高度自适应拉伸，而不是由内容本身决定一个较小的固定高度；
- 主舞台最小高度需要保证歌词在 16–64px 字号范围内仍有足够空间。

### 布局比例

桌面三栏应改为“中央歌词明显主导”的结构。

推荐视觉比例：

```text
左侧：约 12%–16%
中间：约 68%–76%
右侧：约 12%–18%
```

具体实现允许使用：

```text
minmax + 1fr
```

等响应式布局，不要求死写百分比，但最终视觉效果必须满足：

> **中央歌词区是绝对主视觉；左、右两侧仅作为辅助信息栏。**

左侧和右侧应明显比当前更窄。

### 侧栏约束

左侧：

- 封面缩小；
- 歌曲名、歌手、专辑信息紧凑排布；
- “加入待唱”等操作保留；
- 不得为了展示大封面侵占歌词舞台。

右侧：

- Queue 保持可读；
- 单行歌曲信息允许省略号；
- 操作按钮紧凑化；
- 队列长时内部滚动，不扩大整个页面高度。

---

## 16A.2 中央歌词舞台独立全屏

中央歌词区必须增加：

```text
[歌词全屏]
```

或等效按钮。

进入后：

```text
只保留歌词舞台
隐藏左侧歌曲信息
隐藏右侧队列
隐藏非必要 Header
隐藏非必要 Footer
```

歌词舞台占满整个可视区域。

### 全屏歌词模式要求

- 保留当前歌词、上一句、下一句；
- 保留歌词偏移状态；
- 保留歌词字号；
- 可选择保留一个自动隐藏的极简控制层；
- 至少保留：
  - 播放/暂停；
  - 切歌；
  - 重唱；
  - 退出全屏；
- 鼠标移动或触摸后显示控制层；
- 一段时间无操作后控制层自动淡出；
- `Esc` 可退出；
- 不改变歌词时间戳；
- 不改变 Queue 状态；
- 不创建第二套歌词数据源。

### UI 目标

全屏歌词模式应更接近真实 KTV：

```text
背景：
当前歌曲封面模糊 / 渐变氛围

中央：
上一句
当前歌词（最大）
下一句

底部：
极简播放进度 / 控制
```

---

## 16A.3 整个 KTV 页面支持全屏

除“歌词舞台全屏”外，整个 KTV 页面还需要一个独立：

```text
[全屏 KTV]
```

功能。

两种全屏必须区分：

### A. 页面全屏

```text
Header + 左栏 + 歌词 + Queue + Footer
```

整体铺满屏幕。

### B. 歌词全屏

```text
仅歌词舞台 + 极简控制
```

铺满屏幕。

### 行为要求

- 两个模式不可混淆；
- 页面全屏后仍显示左右栏；
- 歌词全屏后侧栏隐藏；
- 支持退出；
- Windows 与 macOS 均可工作；
- 优先使用标准 Fullscreen API / Electron 跨平台能力；
- 不使用 Windows-only API。

---

# 16B. 队列“置顶 / 移到队头”能力（新增强制要求）

当前 Queue 已支持逐步上移/下移，但实际 KTV 使用中需要快速把某一首歌调整为下一首。

新增统一操作语义：

```text
置顶
```

等价于：

```text
moveQueueItem(queueItemId, 0)
```

但业务层应提供明确的“move to front”语义，不要求 UI 连续点多次“上移”。

## 16B.1 桌面当前临时队列

Phase 3 前/期间，Host 端真实临时 Queue 必须支持：

```text
[置顶]
```

操作。

规则：

- 仅 waiting item 可置顶；
- currentItem 不参与置顶；
- 置顶只改变等待队列顺序；
- 不打断正在播放的歌曲；
- 置顶后该歌曲成为**下一首待唱**；
- 使用 `queueItemId`；
- duplicate trackId 必须安全；
- 操作后立即刷新 Vuex rendering snapshot。

队列项目建议操作：

```text
[置顶] [↑] [↓] [删除]
```

在窄侧栏下可折叠为：

```text
⋯
  置顶
  上移
  下移
  删除
```

---

## 16B.2 手机端“点歌到队头”

这是正式产品需求，但网络实现属于 **Phase 4**，不得为了它在 Phase 3 提前开放 Queue mutation API。

Phase 4 手机真实点歌时应至少提供：

```text
[点歌]
[优先点歌]
```

其中：

```text
点歌
→ 加入 waitingItems 尾部

优先点歌
→ 加入 waitingItems 队头
→ 成为下一首待唱
```

推荐权限：

### 默认

手机用户可以：

- 把自己新点的歌曲直接“优先点歌”到队头；
- 把自己已经在 waiting Queue 中的歌曲“置顶”。

手机用户默认不能：

- 删除别人歌曲；
- 修改别人歌曲顺序；
- 置顶别人歌曲。

Host Desktop 始终拥有完整 Queue 管理权限。

未来可在 Host 设置中增加：

```text
允许客人调整全部队列
```

但不是 Phase 3 必做项。

### 重要语义

“置顶”不是“立即切歌”。

即：

```text
当前正在唱 A
waiting: B C D

把 D 置顶

结果：
当前：A
waiting: D B C
```

不会立即中断 A。

真正立即中断当前歌曲的是：

```text
切歌 / Next
```

两者必须严格区分。

# 17. Phase 3 验收门

## Phase 2.1

必须全部通过：

- KTV unplayable 不进入普通 playlist；
- KTV loaderror 不进入普通 playlist；
- natural end 不进入普通 playlist；
- next empty 时停止旧 KTV audio；
- end Session 后无悬挂播放；
- global/media next 不绕过 Manager；
- Vuex state 不再保存 Manager service；
- domain transition tests 通过；
- GitHub Phase Validation green；
- scoped Prettier/ESLint 覆盖 Phase 2 新源码；
- 27232 仍只监听 `127.0.0.1`。

## LAN lifecycle

```text
room inactive → 27233 closed
room active   → 27233 listening
room stopped  → 27233 closed
```

## Security

验证：

```text
27233 /api       → 404/denied
27233 /player    → 404/denied
protected room API missing token → 401
bad token → 401
valid token → 200
old token after stop → invalid
```

## Real device

至少一次：

```text
Windows Host + 同一 Wi-Fi 手机/另一台 PC
```

通过二维码打开独立 Remote 并显示 Connected。

记录设备/浏览器/结果，不记录 token。

---

# 18. Phase 3 明确不做

本轮不做：

- Remote 真实网易云搜索；
- 多版本真实选择；
- playability 实时判定；
- Remote enqueue/delete；
- 手机真实“优先点歌 / 置顶到队头”API（Phase 4）；
- Remote next/replay；
- live queue；
- SSE/WebSocket；
- polling；
- 公网访问；
- 麦克风/混响；
- 消人声；
- 音准评分。

这些进入 Phase 4 或以后。

---

# 19. Phase 3 完成架构

```text
                     Electron Desktop
                            │
              ┌─────────────┴─────────────┐
              │                           │
      KaraokeManager                KaraokeServer
      Session + Queue              0.0.0.0:27233
              │                           │
            Player                    Room/Token
                                          │
                                      Remote Web
                                          │
                                  房间连接已真实
                                  点歌仍未开放
```

Phase 4 再建立：

```text
Remote Web
→ Remote API
→ KaraokeManager
→ KaraokeQueue
```

---

# 20. 最终判定

**Verdict: Conditional Pass**

下一次执行顺序固定为：

```text
feat/ktv-phase-2
→ Phase 2.1 修复
→ GitHub CI GREEN
→ 记录 PHASE2_FIXED_SHA
→ 从该 SHA 创建 feat/ktv-phase-3
→ 完成 Phase 3 LAN Room Infrastructure
→ push
→ STOP
→ ChatGPT 再审查
```
