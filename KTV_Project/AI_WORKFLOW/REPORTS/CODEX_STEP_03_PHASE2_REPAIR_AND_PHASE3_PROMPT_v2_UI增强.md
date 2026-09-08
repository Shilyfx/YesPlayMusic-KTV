# Codex Execution Prompt — YesPlayMusic KTV Phase 2.1 Repair + Phase 3 LAN Infrastructure

> **这是一次连续执行。**  
> 先修复 ChatGPT 对 `feat/ktv-phase-2` 的阻塞问题并完成可复现验证。只有修复门全部通过后，才从修复后的精确 SHA 创建 `feat/ktv-phase-3`，并继续完成 Phase 3。  
> **不允许只修复后停止，也不允许跳过修复直接进入 Phase 3。**

---

## 0. Repository Authority

Repository:

```text
Shilyfx/YesPlayMusic-KTV
```

Reviewed branch:

```text
feat/ktv-phase-2
```

Reviewed implementation commit:

```text
d091844f456bd91cc36b6bac6fc6500d3b55134e
```

Reviewed documentation checkpoint / expected current HEAD:

```text
5252177e8b6700b24ebc0e43882df77d9f60b60b
```

Phase 2 parent:

```text
98436df30434432037f8dfc0213b85df33205176
```

ChatGPT verdict:

```text
Conditional Pass
```

事实优先级：

```text
actual repository code
> Git history
> reproducible tests / GitHub Actions
> PROJECT_STATE
> Codex report
> agent narrative
```

---

# 1. Mandatory Startup Reading

修改前按顺序阅读：

1. `KTV_Project/YesPlayMusic_KTV_项目书.md`
2. `KTV_Project/AI_WORKFLOW/README.md`
3. `KTV_Project/AI_WORKFLOW/BASELINE.md`
4. `KTV_Project/AI_WORKFLOW/PROJECT_STATE.md`
5. `KTV_Project/AI_WORKFLOW/DECISIONS.md`
6. `KTV_Project/AI_WORKFLOW/TASKS/STEP_02_LOCAL_SESSION_AND_QUEUE.md`
7. `KTV_Project/AI_WORKFLOW/PROMPTS/CODEX_STEP_02_PHASE1_REPAIR_AND_PHASE2_PROMPT.md`
8. `KTV_Project/AI_WORKFLOW/REPORTS/CODEX_STEP_02_REPORT.md`
9. 最新 `KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_*.md`
10. 本 Prompt

然后自行检查真实源码。不要把已有报告当成完成证明。

---

# 2. Git Preflight

执行并记录：

```bash
pwd
git remote -v
git status --short --branch
git rev-parse HEAD
git log --oneline --decorate -n 20
git fetch --all --prune
```

确认 remote 指向：

```text
Shilyfx/YesPlayMusic-KTV
```

checkout：

```text
feat/ktv-phase-2
```

预期 HEAD：

```text
5252177e8b6700b24ebc0e43882df77d9f60b60b
```

如果 remote 已移动：

- 不 hard reset；
- 不 force push；
- 不覆盖用户改动；
- 先审查新增提交；
- 记录 divergence；
- 从实际安全 HEAD 继续。

---

# PART A — Phase 2.1 Repair Gate

## 3. P2-B01 — KTV playback must not fall through to ordinary playlist

当前：

```text
KaraokeManager
→ KaraokePlayerAdapter.playTrack()
→ Player.playTrackByID()
→ _replaceCurrentTrack()
```

而 `_replaceCurrentTrack()` 默认不可播放策略会执行普通 `PLAY_NEXT_TRACK`。

必须修复。

### Required

提供一个 **Player 公共 KTV-safe single-track playback contract**。

可扩展 `playTrackByID()` 或新增公共方法，但必须：

- Adapter 不调用 `_replaceCurrentTrack()` 等私有方法；
- 返回 Promise；
- 能明确区分 success / failure；
- KTV track unavailable 时不调用普通 `playNextTrack()`；
- KTV source load error 时不调用普通 `playNextTrack()`；
- 不要求 Manager 访问 `_howler`；
- normal music mode 原行为不变。

例如语义可为：

```text
playTrackByID(id, { fallback: 'none' })
```

具体 API 根据代码选择最小实现。

---

## 4. P2-B02 — Make playback transition transactional

当前 Manager 在真实播放结果返回前已经：

```text
take()
→ PLAYING
→ notify()
```

这是错误的事务顺序。

### Required state model

至少支持：

```text
queued
loading
playing
played
skipped
removed
failed
```

`unplayable` 可单独保留，也可归为 failed，但报告中必须说明。

推荐：

```text
waiting
→ mark/loading transaction
→ await player
→ success: current PLAYING
→ failure: FAILED history, current null
```

### Concurrency

增加 transition guard，防止：

```text
rapid next
rapid start
double click
natural end + manual next race
```

同时触发两个播放切换。

可以用：

```text
isTransitioning
currentTransitionPromise
```

或等效方案。

不得使用任意 sleep 解决竞态。

---

## 5. P2-B03 — Correct next() semantics

必须覆盖四种情况。

### A. current + waiting

```text
current → SKIPPED
→ load next KTV
→ success PLAYING
```

下一首失败时不得进入普通 playlist。

### B. current + no waiting

```text
current → SKIPPED
→ stop/pause KTV-owned audio
→ currentItem = null
→ Session remains ACTIVE
```

### C. no current + waiting

```text
start first waiting
```

### D. no current + no waiting

```text
no-op
```

---

## 6. P2-B04 — Route natural end to KaraokeManager

当前：

```text
Howl.onend
→ Player._nextTrackCallback()
→ normal playlist next
```

KTV ACTIVE 时禁止。

### Required public event boundary

增加稳定公共机制，例如：

```text
Player.onPlaybackEnded(listener)
```

或等效 event subscription。

必须满足：

- Manager 不访问 Howler；
- Adapter 通过 Player 公共 API 获得 ended event；
- normal mode 仍执行原 normal-next；
- KTV owns playback 时 normal-next 被抑制；
- Adapter 把 ended 通知 Manager；
- Manager 将 current：

```text
PLAYING → PLAYED
```

并尝试 KTV next。

无 waiting：

```text
stop
current = null
Session remains active
```

---

## 7. P2-B05 — Session end playback policy

本轮统一采用：

> **结束 KTV Session 时停止当前 KTV-owned audio，不自动恢复进入 KTV 前的歌曲。**

实现：

```text
stop KTV playback
→ end session
→ reset queue/history
→ notify
→ release KTV playback ownership
```

验证：

```text
session ended
player not playing KTV audio
ordinary mode no longer intercepted
```

不要在本轮实现“恢复旧歌曲”。

---

## 8. P2-B06 — Global / Media commands must not bypass Manager

检查所有可能路径：

```text
src/electron/globalShortcut.js
src/electron/ipcRenderer.js
MediaSession action handlers
tray/menu next/play
keyboard Space
```

### Required routing

建立一个集中路由策略。

KTV Session ACTIVE 且 Manager owns playback 时：

```text
play/pause → KaraokeManager
next       → KaraokeManager
previous   → explicit no-op / unsupported in this phase
```

否则维持普通 Player 行为。

不要在每个 UI 组件复制 `if karaoke active`。

---

## 9. P2-B07 — Vuex must hold snapshot only

当前 `state.karaokeManager` 必须移除。

Vuex state 只保留：

```text
karaoke: snapshot
```

Manager 作为 non-reactive runtime service，例如：

```text
src/karaoke/runtime.js
```

或等效服务容器。

可挂：

```text
store.$karaokeManager
```

但不能放进：

```text
state.karaokeManager
```

组件通过 service 调用命令，通过 Vuex snapshot 渲染。

---

## 10. P2-B08 — Repair the red GitHub CI

当前真实 GitHub Actions：

```text
d091844...
Run 34183461124
failure
```

以及：

```text
5252177...
Run 34183501151
failure
```

实际失败发生在 Node 16 `Production web build`，原因是 CRLF/Prettier：

```text
src/App.vue
src/views/karaokeRemote.vue
src/views/lyrics.vue
src/views/settings.vue
src/utils/lyricsSettings.js
```

错误：

```text
Delete ␍⏎
```

### Required

- 规范上述文件为 LF；
- 遵守 `.gitattributes: * text eol=lf`；
- 不全仓库无关格式化；
- `git diff --check`；
- Node 16 `yarn build`；
- blocking scoped Prettier；
- blocking scoped ESLint；
- push 后等待/检查 GitHub Action。

### Hard Gate

**GitHub `KTV Phase Validation` 必须 green 才允许创建 Phase 3 branch。**

不要把 Windows 本地 build pass 当作 GitHub CI pass。

---

## 11. P2-B09 — Update Phase Validation scope

更新：

```text
.github/workflows/phase-validation.yml
```

至少覆盖：

```text
src/karaoke/**/*.js
src/views/karaoke.vue
src/views/karaokeRemote.vue
src/utils/lyricsSettings.js
src/utils/Player.js
src/store/index.js
src/store/state.js
src/store/mutations.js
src/App.vue
```

Phase 3 创建 server/remote bundle 后继续加入新文件。

Full repo lint 可以继续 diagnostic non-blocking，但：

- scoped KTV lint 必须 blocking；
- 新错误不得标为 upstream；
- Production Build 必须 blocking。

---

## 12. Add focused domain transition tests

不要升级大型测试栈。

如果现有项目没有合适 test runner，可创建 Node 16 可运行的最小测试 harness / assertions。

使用 fake PlayerAdapter。

至少测试：

1. duplicate trackId → unique queueItemId
2. remove by queueItemId
3. move by queueItemId
4. new session resets queue
5. end session clears queue
6. playback success → PLAYING
7. playback failure → FAILED, not PLAYING
8. next with waiting
9. next without waiting
10. replay does not consume queue
11. transition concurrency guard
12. natural end → PLAYED + KTV next
13. KTV failure never calls normal-next behavior

测试应 deterministic，不依赖真实网易云网络。

---

## 13. Phase 2.1 AI_WORKFLOW

创建：

```text
KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_PHASE_02_REVIEW.md
```

内容包括：

```text
reviewed HEAD: 5252177...
verdict: Conditional Pass
blocking findings
GitHub Action run ids
```

更新：

```text
KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_LATEST.md
KTV_Project/AI_WORKFLOW/PROJECT_STATE.md
KTV_Project/AI_WORKFLOW/DECISIONS.md
KTV_Project/AI_WORKFLOW/CHANGELOG.md
```

创建：

```text
KTV_Project/AI_WORKFLOW/REPORTS/CODEX_PHASE_02_1_REPAIR_REPORT.md
```

不要写“ChatGPT approved repair”，因为未来 repair commit 尚未被 ChatGPT 审查。

---

## 14. Commit Phase 2.1

正常提交并 push：

```text
feat/ktv-phase-2
```

建议 commit：

```text
fix: stabilize KTV playback ownership and phase validation
```

记录精确：

```text
PHASE2_FIXED_SHA
```

---

# 15. HARD GATE BEFORE PHASE 3

只有全部为真才能继续：

- [ ] KTV unavailable 不 normal-next
- [ ] KTV loaderror 不 normal-next
- [ ] natural end 不 normal-next
- [ ] next empty 停止旧 KTV audio
- [ ] end Session 停止 KTV audio
- [ ] global/media next 不绕过 Manager
- [ ] `state.karaokeManager` 已移除
- [ ] domain tests pass
- [ ] Node 16 production build pass
- [ ] scoped Prettier pass
- [ ] scoped ESLint pass
- [ ] GitHub KTV Phase Validation GREEN
- [ ] 27232 仍 `127.0.0.1`
- [ ] Phase2 repair commit 中仍没有 27233/KaraokeServer/Remote API

任何一项失败：

```text
DO NOT CREATE PHASE 3
```

全部通过：

**继续执行下面 Part B，不要停止。**

---

# PART B — Phase 3 LAN Room Infrastructure

## 16. Create Phase 3 branch

从精确：

```text
PHASE2_FIXED_SHA
```

创建：

```bash
git checkout -b feat/ktv-phase-3 <PHASE2_FIXED_SHA>
```

如果 remote branch 已存在：

- 检查 ancestry；
- 不 blind overwrite；
- 不 force push；
- 安全 reconcile。

记录：

```text
PHASE3_PARENT_SHA
```

---

## 17. Phase 3 Required Outcomes

本阶段必须实现：

1. 独立 `KaraokeServer`
2. dedicated 27233
3. LAN IPv4 discovery
4. roomCode
5. cryptographic ephemeral token
6. functional QR
7. independent Remote Web bundle/entry
8. minimal token-protected room API
9. Main-process server lifecycle
10. Desktop room status UI
11. Remote connection states
12. graceful port/network failure
13. security boundary tests
14. real same-LAN device validation
15. desktop main KTV stage fills the available workspace and narrows side panels
16. lyric-stage fullscreen and full-KTV-page fullscreen
17. Host local waiting queue supports one-click move-to-front

本阶段不实现真实点歌业务。

---

## 18. Network Boundary

必须保持：

```text
existing desktop Express
127.0.0.1:27232
```

新增：

```text
KaraokeServer
0.0.0.0:27233
```

只在 active LAN room 时监听。

严格禁止：

```text
27232 → 0.0.0.0
27233 proxy → full desktop /api
27233 expose → /player
```

---

## 19. Main-process ownership

KaraokeServer 必须在 Electron Main Process。

建议结构：

```text
src/electron/karaoke/KaraokeServer.js
src/electron/karaoke/LanAddressResolver.js
src/electron/karaoke/KaraokeRoomToken.js
```

实际可调整，但 renderer 不得直接 `listen()`。

---

## 20. Server lifecycle

推荐：

```text
Local KTV Session ACTIVE
→ Host clicks 开启手机点歌
→ IPC invoke
→ Main KaraokeServer.start()
→ resolve LAN addresses
→ roomCode/token
→ listen 0.0.0.0:27233
→ return room info
```

关闭：

```text
Host closes LAN room
or KTV Session ends
or app before-quit
→ server.stop()
→ token invalid
```

KTV 本机模式和 LAN room 必须解耦：

> LAN Server 启动失败不能结束 Local KaraokeSession。

---

## 21. LAN address resolution

使用：

```js
require('os').networkInterfaces();
```

条件：

- IPv4
- non-internal
- RFC1918 优先

禁止：

```text
ipconfig
ifconfig
powershell
shell parsing
Windows registry
```

多个地址时：

- 返回候选列表；
- Desktop 显示；
- Host 可选 Wi-Fi/Ethernet。

不要自动优先 VPN 而不告诉用户。

---

## 22. Room identity

每个 active room：

```text
roomId
roomCode
sessionId
token
createdAt
address
port
status
```

roomCode：

```text
4–6 digit human friendly
```

它不是认证秘密。

Token：

```text
crypto.randomBytes(...)
```

必须：

- high entropy
- per room
- ephemeral
- room stop invalidates
- session end invalidates
- not persisted long term
- never written to logs

禁止安全 token 使用：

```text
Math.random()
```

---

## 23. QR / Join URL

复用现有：

```text
qrcode
```

不要新加大型 QR 库。

示例：

```text
http://192.168.1.20:27233/ktv/#/join?room=5826&token=<secret>
```

优先 fragment token。

Remote 初始化：

1. parse fragment
2. save token to `sessionStorage`
3. remove token from visible URL when practical
4. protected API use:

```http
Authorization: Bearer <token>
```

Token 不应出现在 console/log。

---

## 24. Independent Remote bundle

当前 `/karaoke/remote` 属于 Desktop SPA preview。

Phase 3 要建立真正独立 Remote entry/bundle。

可以复用：

- Vue 2
- Glass styles
- ThemeSwitcher
- Remote visual components

不要升级 Vue/Electron。

推荐：

```text
src/remote/main.js
src/remote/RemoteApp.vue
src/remote/api/*
```

或适合当前 Vue CLI 的 multi-page 结构。

### Security Constraint

KaraokeServer 不得：

```js
express.static(fullDesktopDist);
```

不能让 LAN 用户通过 27233 获取：

```text
desktop index
desktop /api proxy
/player
arbitrary built files
```

只 serve Remote 所需静态资源。

---

## 25. Minimal Phase 3 API

允许：

```http
GET /ktv/api/health
GET /ktv/api/room
```

`/room` 必须 Bearer token 验证。

可返回：

```json
{
  "active": true,
  "roomCode": "5826",
  "sessionId": "...",
  "serverVersion": 1
}
```

绝不返回 secret token。

---

## 26. Forbidden Phase 3 network features

不得实现：

```text
GET /search
POST /queue
DELETE /queue/:id
POST /control/next
POST /control/replay
POST /control/play
SSE
WebSocket
live queue polling
```

Remote 可以：

- initial room fetch
- manual retry
- reload

不要提前做实时同步。

---

## 27. HTTP security

必须：

- no wildcard CORS
- same-origin Remote
- 404 unknown routes
- path traversal protection
- request/body/query size limits
- security headers
- protected endpoint token auth
- no token logs
- no arbitrary file access
- no shell command
- no desktop API exposure
- no Player exposure

如果使用 `crypto.timingSafeEqual`，先处理 buffer length，避免长度不一致抛异常。

---

## 28. IPC surface

建议：

```text
karaoke:lan:start
karaoke:lan:stop
karaoke:lan:status
```

Renderer 可得到：

```text
running
address
candidateAddresses
port
roomCode
joinUrl
qrDataUrl
error
```

Phase 3 IPC 不允许：

```text
remote queue mutation
remote player controls
remote search
```

---

## 29. Desktop Room UI

### OFF

```text
局域网点歌未开启
[开启手机点歌]
```

### STARTING

```text
正在启动局域网房间…
```

### ACTIVE

显示：

```text
房间 5826
192.168.1.20:27233
QR CODE
[复制链接]
[关闭房间]
```

多个 IPv4：

```text
网络地址选择
Wi-Fi / Ethernet / ...
```

### ERROR

如：

```text
端口 27233 已被占用
本机 KTV 仍可正常使用
```

禁止自动回退到 27232。

---

## 29A. Mandatory KTV stage layout / fullscreen enhancement

本轮同时执行已经加入项目书的 UI 强制要求。

### Main layout

当前桌面 KTV 三栏区域不能继续只占页面中部较小高度。

要求：

- Header 与 Footer 之间的三栏主区域应占约 90% 可用垂直空间；
- 1440×900、1920×1080 下不应存在明显的大面积上下空白；
- 中央歌词区成为绝对主视觉；
- 左右侧栏明显收窄。

目标视觉比例约：

```text
left  12%–16%
stage 68%–76%
right 12%–18%
```

允许响应式 `minmax` 等实现，不要求硬编码百分比。

Queue 长时在右栏内部滚动，不把整页撑高。

### Lyric-stage fullscreen

新增明确：

```text
歌词全屏
```

进入后：

- 隐藏左右侧栏；
- 隐藏非必要 Header/Footer；
- 歌词舞台铺满 viewport；
- 保留 lyricFontSize / lyricOffset；
- 保留当前、上一、下一歌词；
- 提供极简 overlay controls：
  - play/pause
  - next
  - replay
  - exit fullscreen
- Esc 退出；
- 控制层允许自动隐藏；
- 不复制第二套歌词状态。

### Full KTV page fullscreen

另增加：

```text
全屏 KTV
```

区别于歌词全屏：

```text
Full KTV:
Header + Left + Lyrics + Queue + Footer 全部存在

Lyric fullscreen:
只保留歌词舞台 + 极简控制
```

要求 Windows/macOS 跨平台，不使用 Windows-only API。

将上述行为加入桌面 viewport/manual regression。

---

## 29B. Local Queue move-to-front

Phase 3 中 Host 当前真实临时 Queue 必须增加：

```text
置顶
```

业务语义：

```text
waiting item → index 0
```

要求：

- 使用 queueItemId；
- duplicate trackId 安全；
- 只允许 waiting item；
- 不打断 currentItem；
- 置顶后成为下一首；
- snapshot 立即更新。

UI 可为：

```text
[置顶] [↑] [↓] [删除]
```

窄栏可折叠菜单。

建议给 KaraokeManager/KaraokeQueue 增加明确的：

```text
moveToFront(queueItemId)
```

或等效 domain API，而不是 UI 层直接修改数组。

---

## 29C. Mobile priority request is a Phase 4 contract, not Phase 3 network work

产品正式需求：

手机真实点歌阶段必须支持：

```text
点歌
优先点歌
```

Phase 4 语义：

```text
点歌     → append waiting tail
优先点歌 → insert/move to waiting head
```

并允许手机把**自己的 waiting item**置顶。

Host 始终可以置顶任意 waiting item。

默认不允许 guest 修改别人歌曲顺序。

### Critical Phase 3 boundary

本轮仍然：

- 不增加 Remote Queue mutation API；
- 不实现 mobile enqueue；
- 不实现 mobile move-to-front；
- 不为了这个需求提前开放 POST/DELETE Queue endpoint。

Phase 3 只实现 Local Host 的 `置顶`，并在 Phase 3 文档/Remote UI 中保留 Phase 4 产品契约。

## 30. Remote UI Phase 3

真实 connection states：

```text
connecting
connected
invalid-token
room-ended
host-offline
```

Connected 显示真实：

- roomCode
- host reachable
- theme Auto/Light/Dark

搜索/点歌/队列：

```text
仍为 mock 或 disabled
```

必须显著标注：

```text
真实点歌将在 Phase 4 开启
```

Now Playing 若非真实 API，也不得伪装成实时数据。

---

## 31. Failure handling

### EADDRINUSE

- explicit error
- local KTV stays active
- no 27232 fallback
- no silent random port

### No LAN IPv4

- server remains off
- local KTV stays active
- Desktop clear error

### Bad/expired token

Remote：

```text
房间链接无效或已过期
```

不要暴露 stack trace。

---

## 32. Phase 3 tests

### Unit

至少：

1. LAN address filter
2. roomCode generation
3. strong token generation
4. token invalidation
5. server start idempotence
6. server stop idempotence
7. port collision
8. protected endpoint auth
9. traversal protection
10. invalid route 404

### Integration

```text
room off → 27233 closed
room on  → 27233 available
room stop → 27233 closed
```

安全：

```text
27233 /api        → denied
27233 /player     → denied
missing token     → 401
bad token         → 401
valid token       → 200
old token after stop → invalid
```

---

## 33. Real LAN validation

Windows Host：

1. 启动 Electron；
2. 开始 Local KTV；
3. 开启 LAN Room；
4. 手机和电脑同 Wi-Fi；
5. 手机扫码；
6. Remote 加载；
7. token validation 成功；
8. 显示 Connected；
9. Light/Dark 切换；
10. 关闭 room；
11. 手机 refresh/retry 应显示结束/不可达。

报告：

- host OS
- LAN IP（可记录）
- phone/browser 类型
- result

**不要记录 token。**

---

## 34. Regression validation

普通播放模式验证：

- playlist
- play/pause
- next/previous
- lyrics
- global/media next where feasible

Local KTV：

- start
- duplicate tracks
- reorder
- delete
- replay
- next
- empty-next
- natural-end
- unavailable
- end

LAN：

- start
- stop
- restart
- port conflict
- no LAN address

---

## 35. CI

扩展 `phase-validation.yml`，覆盖：

```text
src/karaoke/**
src/electron/karaoke/**
Remote entry/bundle
KTV views
store/runtime bridge
Player public integration
background/main IPC changes
```

Node 16。

Blocking：

```text
Production Build
Scoped Prettier
Scoped ESLint
Domain tests
Server tests
```

不要 release/sign/notarize。

---

## 36. AI_WORKFLOW outputs

创建：

```text
KTV_Project/AI_WORKFLOW/TASKS/STEP_03_LAN_ROOM_INFRASTRUCTURE.md
KTV_Project/AI_WORKFLOW/REPORTS/CODEX_STEP_03_REPORT.md
```

更新：

```text
PROJECT_STATE.md
DECISIONS.md
CHANGELOG.md
REVIEWS/CHATGPT_LATEST.md
```

报告必须写：

- PHASE2_FIXED_SHA
- PHASE3_PARENT_SHA
- Phase 3 implementation SHA(s)
- documentation checkpoint SHA
- all material changed files
- exact test commands/results
- GitHub Action run ID/conclusion
- real LAN device result
- security tests
- unresolved issues
- explicit Phase 4 exclusions

---

## 37. Git checkpoint

先：

```text
feat/ktv-phase-2
```

push repair，确认 CI green。

然后：

```text
feat/ktv-phase-3
```

从 `PHASE2_FIXED_SHA` 创建。

建议 Phase 3 commits：

```text
feat: add isolated KTV LAN room server
feat: add secure KTV room join and QR
feat: add independent KTV remote room shell
docs: record phase 3 checkpoint
```

不强制机械拆分，保持 scoped 即可。

---

# 38. STOP AFTER PHASE 3

Phase 3 push 后停止。

**不得开始 Phase 4。**

Phase 4 才做：

- real NetEase Remote search
- version selection
- real playability check
- Remote enqueue
- mobile priority request / mobile move-to-front
- cancel own request
- queue sync
- real now-playing
- Remote host policy
- polling/SSE/WebSocket decision

最终向用户输出一个审查请求，包含：

```text
feat/ktv-phase-3 branch
PHASE2_FIXED_SHA
Phase 3 implementation SHA(s)
documentation checkpoint SHA
GitHub Action run ID
real LAN verification summary
```

然后等待 ChatGPT 审查。
