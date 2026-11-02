# YesPlayMusic KTV — Phase 3.1 修复与 Phase 4 项目书

> 仓库：`Shilyfx/YesPlayMusic-KTV`  
> 当前 Phase 3 分支：`feat/ktv-phase-3`  
> 已审查 Phase 3 提交：`9130ed28c705213ee02da0c3d383f39e89ba3a58`  
> Phase 3 基线 / 已通过 CI 的 Phase 2.1：`21385ac20ef56e69f597a5d78b2fb7b2cbb39b54`  
> Phase 3 GitHub Actions：`34187596563`，结论 `success`  
> Phase 3 审查结论：**Conditional Pass**  
> 下一次执行：**Phase 3.1 Repair Gate + Phase 4 Real Remote Song Request**

---

# 1. 本轮目标

下一轮不是单纯修 Phase 3，也不是直接无条件进入 Phase 4，而是一次连续交付：

```text
feat/ktv-phase-3 @ 9130ed28...
        ↓
Phase 3.1 修复与安全加固
        ↓
CI / Tests / Security Gate
        ↓
记录 PHASE3_FIXED_SHA
        ↓
从该 SHA 创建 feat/ktv-phase-4
        ↓
真实 Remote 搜索 / 版本 / 可播放性 / 点歌 / 优先点歌 / 队列同步
        ↓
真实手机 + PC Remote 验证
        ↓
GitHub CI 绿色
        ↓
Push + STOP
```

Phase 4 完成后，用户最初提出的核心 KTV 使用链路应基本闭环：

```text
电脑打开 KTV
→ 建立局域网房间
→ 手机扫码
→ 搜索网易云歌曲
→ 选择版本
→ 验证可播放性
→ 普通点歌 / 优先点歌
→ 进入真实临时 Queue
→ 电脑实时看到
→ 自动播放 / 切歌 / 重唱
→ 手机看到当前歌曲与队列状态
```

---

# 2. Phase 3 已通过部分

以下不重做：

- Phase 3 精确基于已通过 CI 的 `21385ac20...`；
- 独立 `KaraokeServer` 已建立；
- 27233 监听 `0.0.0.0`；
- 原 27232 仍只监听 `127.0.0.1`；
- LAN 地址已排除 loopback；
- `roomCode`、`token` 使用 `crypto.randomBytes`；
- 没有发现 token 主动日志泄露；
- QR 复用既有 `qrcode`；
- Remote 已有独立构建入口；
- 没有提前新增 Remote Search/Queue/Player API；
- 没有 SSE/WebSocket/网络 polling；
- Host 真实临时队列已有 `置顶`；
- `全屏 KTV` 与 `只看歌词` 使用不同 Fullscreen target；
- GitHub Actions `34187596563` 成功。

Phase 3.1 只修真正的问题和补安全边界，不重新设计整体架构。

---

# 3. Phase 3.1 必修项

## 3.1 Main Process 必须真正强制 KTV Active 才允许启动 LAN Room

当前正常 UI：

```text
startSession()
→ startLanRoom()
```

但 Main Process IPC 自身没有验证 KTV Session 状态，因此 renderer 若直接 invoke：

```text
karaoke:lan:start
```

仍可能在 KTV inactive 时启动 27233。

### 目标

监听权限必须由 Main Process / 受控 runtime 状态保证，而不是只靠按钮调用顺序。

推荐建立最小生命周期桥：

```text
KaraokeManager Session state
        ↓ controlled bridge
Main Process room eligibility
```

行为：

```text
KTV inactive
→ karaoke:lan:start
→ reject

KTV active
→ karaoke:lan:start
→ allow

KTV end
→ force stopRoom
→ invalidate all room/client tokens
```

不要让 LAN Server 反向成为 KaraokeSession 的业务状态源。

---

## 3.2 `startRoom()` listen 失败必须完整 rollback

当前可能：

```text
先 this.room = {...}
再 listen(27233)
```

若：

```text
EADDRINUSE
EACCES
network bind failure
```

会产生假 room / 假 QR 状态。

### 正确状态机

```text
IDLE
↓
STARTING
↓ listen success
ACTIVE
```

失败：

```text
STARTING
↓ error
IDLE
```

必须恢复：

```text
room = null
server = null
token invalid
no join URL
```

后续释放端口后再次 start 必须能够成功。

---

## 3.3 Remote 静态资源必须真正与 Desktop dist 隔离

Phase 3 虽已有独立 remote entry，但 server 仍可从整个 `dist/js|css|img` 读取静态资源。

Phase 4 开始有真实 Queue API 后，不再接受这个边界。

### 目标目录

推荐：

```text
dist/
  index.html
  ...desktop files

  remote/
    index.html
    js/
    css/
    img/
```

KaraokeServer 只能 serve：

```text
remoteDistPath
```

不得通过 27233 serve：

```text
desktop index
desktop js
desktop css
desktop img
/api
/player
```

Remote build 若依赖 shared chunk，应调整 Vue build 配置，让 Remote 的生产资源真正落到 remote subtree，或者复制出最小 immutable assets。

---

## 3.4 补齐 KaraokeServer 自动化验收

`scripts/test-karaoke-server.js` 必须增加：

```text
health
正确 room + 正确 token
正确 room + 无 token
正确 room + 错 token
错误 room + 正确/错误 token
stop 后旧 URL 失效
stop 后 27233 不再监听
restart 后旧 token 失效
restart 后新 token 有效
EADDRINUSE
EADDRINUSE rollback
释放端口后再次启动成功
非 KTV active 时 start 被拒绝（若测试层可覆盖 IPC/eligibility）
```

Phase 3.1 修完后，测试失败必须阻止进入 Phase 4。

---

# 4. Phase 3.1 推荐同时处理的 P2

这些不应再拖到 Phase 5，因为 Phase 4 网络能力会建立在它们之上。

## 4.1 LAN 地址选择升级

不能只取第一个 non-loopback IPv4。

返回候选：

```text
interfaceName
address
isPrivate
priority
```

优先：

```text
192.168.0.0/16
10.0.0.0/8
172.16.0.0/12
```

Host 可以从桌面选择：

```text
Wi-Fi 192.168.1.20
Ethernet 192.168.0.8
```

VPN / Docker / WSL 地址不得静默成为唯一默认项。

---

## 4.2 Join Token 从 URL query 改为更安全的 bootstrap

建议二维码：

```text
http://192.168.1.20:27233/room/AB12CD#token=<joinToken>
```

Remote 首次载入：

```text
读取 fragment token
→ POST /ktv/api/client-session
→ 换取 client session credential
→ token 存 sessionStorage
→ history.replaceState 清理地址栏 fragment
```

长期 API 不继续携带 room join token。

---

## 4.3 歌词全屏增加极简控制层

当前“只看歌词”已经是独立 Fullscreen target，但全屏后控制全部隐藏。

改为：

```text
歌词全屏
→ 上一句 / 当前 / 下一句
→ 自动隐藏极简控制条
```

至少：

```text
重唱
播放/暂停
切歌
退出歌词全屏
```

行为：

- 鼠标移动 / touch 显示；
- 3–5 秒无操作淡出；
- `Esc` 正常退出；
- 不新建第二套 Player 或歌词状态。

---

## 4.4 Phase Validation 覆盖 Phase 3 核心文件

blocking Prettier / ESLint 必须加入：

```text
src/electron/karaoke/**
src/remote/**
src/background.js
src/electron/ipcMain.js
vue.config.js
scripts/test-karaoke-server.js
```

后续 Phase 4 新网络模块同样加入。

---

# 5. Phase 3.1 Gate

只有以下全部通过，才允许创建 `feat/ktv-phase-4`：

- [ ] inactive KTV 无法启动 27233；
- [ ] KTV end 强制关闭 27233；
- [ ] listen failure 完整 rollback；
- [ ] EADDRINUSE 后可恢复重试；
- [ ] stop 后旧 URL/token 无效；
- [ ] Remote static 只来自 remote subtree；
- [ ] 27233 无法访问 desktop `/api`、`/player`、desktop bundles；
- [ ] wrong-token 测试真实使用正确 room + 错 token；
- [ ] shutdown / restart / old-token 测试存在；
- [ ] LAN candidate selection 可解释；
- [ ] blocking lint 覆盖新 Server/Remote 文件；
- [ ] Node 16 Production Build 通过；
- [ ] domain tests 通过；
- [ ] server tests 通过；
- [ ] GitHub Phase Validation GREEN。

记录：

```text
PHASE3_FIXED_SHA
```

然后从该 SHA 创建：

```text
feat/ktv-phase-4
```

---

# 6. Phase 4 核心目标

Phase 4 第一次真正开放手机点歌。

核心业务：

1. 手机/PC Remote 建立临时 client session；
2. 搜索网易云；
3. 展示多个版本；
4. 判定可播放性；
5. 普通点歌；
6. 优先点歌；
7. 查看真实等待队列；
8. 手机只能取消/置顶自己的 waiting item；
9. Host 可管理任何 waiting item；
10. 手机显示当前演唱；
11. 桌面与 Remote 进行真实状态同步。

---

# 7. Phase 4 总体架构

```text
                         Electron Desktop
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
           KaraokeManager                KaraokeServer
        Session / Queue / Player           :27233
                  │                           │
                  │                   KaraokeRemoteService
                  │                    / Catalog Adapter
                  │                           │
                  │                    Internal NetEase API
                  │                     127.0.0.1:10754
                  │
                  └──────── business bridge ────────┐
                                                    │
                                               Remote Web
                                            mobile/tablet/PC
```

原则：

> `KaraokeServer` 不能直接随意访问 Player 私有字段；Remote API 也不能成为第二个 Queue 状态源。

真实业务仍以：

```text
KaraokeManager
```

为唯一业务源。

---

# 8. Remote Client Session

仅靠共享 room token 无法实现：

> “用户只能删除/置顶自己的歌曲”。

Phase 4 必须引入服务端生成的临时 client identity。

## 8.1 Join

二维码中的短期 join token 仅用于建立客户端会话。

例如：

```http
POST /ktv/api/client-session
Authorization: Bearer <joinToken>
```

服务端生成：

```text
clientId
clientToken
displayName
createdAt
roomId
```

返回：

```json
{
  "clientId": "...",
  "clientToken": "...",
  "displayName": "客人 03"
}
```

Remote 将 `clientToken` 存：

```text
sessionStorage
```

后续 API：

```http
Authorization: Bearer <clientToken>
```

## 8.2 Client credential 生命周期

必须：

```text
room stop → 全部 clientToken 失效
new room → 全部重新创建
app restart → 旧 client token 无效
```

不得长期持久化。

---

# 9. Remote API 白名单

Phase 4 仍然只开放 KTV 专用窄 API。

推荐：

```text
POST /ktv/api/client-session

GET  /ktv/api/state
GET  /ktv/api/search?q=
GET  /ktv/api/track/:trackId/availability

POST /ktv/api/requests
DELETE /ktv/api/requests/:queueItemId
POST /ktv/api/requests/:queueItemId/front
```

可根据实现合并 `/availability` 到搜索结果。

禁止公开：

```text
/api/*
/player
arbitrary NetEase endpoint
arbitrary Player methods
filesystem
shell
Electron IPC
Host next/replay controls
```

---

# 10. 网易云搜索设计

## 10.1 Search

输入：

```text
关键词 / 歌曲名 / 歌手
```

服务端调用既有本机网易云 API，但只返回必要字段：

```text
trackId
name
artists[]
album
duration
aliases[]
versionLabel
playability
```

不返回：

```text
用户 cookie
账号
VIP profile
完整 API raw payload
```

## 10.2 搜索约束

- query trim；
- 最短 1–2 字；
- 最大长度建议 80；
- 返回 10–20 条；
- Remote debounce 300–500ms；
- Server 做最小速率限制；
- 搜索错误展示可恢复 UI；
- 取消过期前端请求；
- 不允许 query 直接拼接任意上游 URL。

---

# 11. 版本选择

用户最初要求：

> 原版 / Live / Remix / Cover / 其他版本可选择。

搜索结果应保留多条网易云 track，而不是仅按歌名去重。

UI 示例：

```text
晴天
周杰伦 · 叶惠美
原版
✓ 可播放
[点歌] [优先点歌]

晴天 (Live)
周杰伦
Live
✓ 可播放
[点歌] [优先点歌]

晴天 Remix
...
```

`versionLabel` 可以从：

```text
track name
aliases
album
```

推断显示标签，但不得把推断当成可靠版权元数据。

推荐标签：

```text
原版
Live
Remix
Acoustic
伴奏
Cover/翻唱
其他
```

不确定就：

```text
其他版本
```

---

# 12. Playability 判定

“搜索得到”不代表“可播放”。

Phase 4 必须区分：

```text
PLAYABLE
TRIAL_ONLY
UNAVAILABLE
CHECKING
ERROR
```

建议复用普通 Player 当前对 NetEase MP3 的真实规则：

```text
URL exists
freeTrialInfo == null
```

但不要让 Remote 直接调用 Player。

应创建：

```text
KaraokeCatalogService
```

或等效 service，对 Track availability 做只读检查。

## 性能要求

不要同时无上限请求 20 首音源。

推荐：

```text
top 10–15
concurrency 3–4
5 min in-memory cache
```

Remote 搜索先展示 metadata，再逐条补 availability 也可以。

点歌提交时必须再次 server-side 验证，不能信任前端显示的 `playable=true`。

---

# 13. 点歌 API

## 13.1 普通点歌

```http
POST /ktv/api/requests
```

body：

```json
{
  "trackId": "123456",
  "priority": false
}
```

流程：

```text
验证 clientToken
→ 验证 room active
→ 读取 track metadata
→ 再次验证 playability
→ KaraokeManager.enqueueTrack(track, requester)
→ waitingItems 尾部
```

---

## 13.2 优先点歌

```json
{
  "trackId": "123456",
  "priority": true
}
```

行为：

```text
加入 waiting
→ moveToFront(queueItemId)
→ 成为下一首
```

**不是立即切歌。**

例：

```text
current: A
waiting: B C

Remote 优先点 D
→ current: A
→ waiting: D B C
```

---

# 14. Remote 用户自己的 Queue 权限

Client 可：

```text
查看全部 waiting queue
查看 current
普通点歌
优先点歌
删除自己的 waiting item
把自己的 waiting item 置顶
```

Client 默认不可：

```text
删除别人的歌曲
移动别人的歌曲
切歌
重唱
暂停/播放
结束 KTV
```

Host Desktop：

```text
完整控制全部 queue
```

权限校验必须 server-side：

```text
queueItem.requesterId === clientId
```

不能只在前端隐藏按钮。

---

# 15. Queue Item 数据模型扩展

每个 Queue item 至少：

```text
queueItemId
trackId
trackName
artists
album
requesterId
requesterName
requesterType: host | remote
requestedAt
priorityRequested
status
```

注意：

```text
requesterId
```

由 Server client session 生成。

同一 trackId 可重复点：

```text
trackId 123
queueItemId A
queueItemId B
```

仍然必须安全。

---

# 16. 状态同步方案：Phase 4 采用 HTTP Polling MVP

本阶段明确采用：

> **轻量 polling，不引入 WebSocket/SSE。**

理由：

- Vue2/Electron13 老项目；
- 不新增网络实时依赖；
- LAN 用户通常数量很少；
- Queue 数据量小；
- 易测试、易恢复；
- Phase 5 如有需要再升级 SSE/WebSocket。

## 推荐频率

Remote visible：

```text
GET /ktv/api/state
每 1.5 秒
```

页面 hidden：

```text
5 秒或暂停
```

请求失败：

```text
2s → 4s → 8s backoff
```

用户成功 mutation 后：

```text
立即 refresh
```

禁止 100ms 级网络 polling。

---

# 17. `/ktv/api/state`

必须返回 sanitized snapshot：

```json
{
  "room": {
    "active": true,
    "code": "AB12CD"
  },
  "current": {
    "queueItemId": "...",
    "trackId": "...",
    "name": "...",
    "artists": ["..."],
    "requesterName": "...",
    "startedAt": 0
  },
  "waiting": [],
  "client": {
    "clientId": "...",
    "displayName": "...",
    "permissions": {
      "priority": true
    }
  }
}
```

可以增加：

```text
playing
progress
duration
```

但 progress 应来自公开 Player snapshot/adapter，不得访问私有字段。

不返回：

```text
Player internals
full account state
cookies
local paths
history unless product needs
```

---

# 18. Remote UI — Glass / Light / Dark / Responsive

Phase 4 Remote 从“连接占位页”升级为真实点歌产品。

## 18.1 移动端

优先布局：

```text
┌─────────────────────────┐
│ 房间 AB12CD      深/浅  │
├─────────────────────────┤
│ 当前演唱                │
│ 晴天 · 周杰伦           │
│ 客人 02                 │
├─────────────────────────┤
│ 🔍 搜索歌曲 / 歌手      │
├─────────────────────────┤
│ 搜索结果                │
│ [点歌] [优先点歌]       │
├─────────────────────────┤
│ 待唱队列                │
│ 我的歌：置顶 / 取消     │
└─────────────────────────┘
```

Glass 要求：

- 半透明卡片；
- backdrop-filter；
- 柔和 border；
- light / dark 分别保证文字对比；
- 不用过度发光。

## 18.2 Tablet

搜索结果 + Queue 可双栏。

## 18.3 PC Browser

三栏：

```text
Search
Results
Queue / Now Playing
```

最大宽度保持可读，不把内容拉得过散。

---

# 19. Remote Theme

支持：

```text
自动
浅色
深色
```

Remote 本地偏好：

```text
localStorage / session preference
```

不需要写入 Desktop settings。

自动模式跟随：

```text
prefers-color-scheme
```

---

# 20. Desktop Host UI Phase 4

Host Queue 每个远程条目显示：

```text
客人 03
普通点歌 / 优先点歌
```

可选标志：

```text
📱
```

Host 仍可以：

```text
置顶
上移
下移
删除
切歌
重唱
```

搜索功能仍主要在手机端，桌面无需复制一套大型 Search UI，除非实现成本很低。

---

# 21. KTV 自动播放行为

Phase 2.1 已建立 KaraokeManager 的播放所有权。

Phase 4 必须保证：

```text
current null + waiting first item
```

是否自动开始，要固定策略。

推荐：

### Session 刚开始
不自动。

### 当前歌曲自然结束
自动播放 Queue 下一首。

### Remote 首次点歌且 current null
**不自动播放**，由 Host 点击“开始待唱”。

原因：

> 手机点歌不应该意外让电脑自动开始发声。

可在未来增加 Host 设置：

```text
空闲时收到第一首点歌自动开始
```

---

# 22. 搜索与队列错误状态

Remote 必须有真实错误 UI：

```text
连接失败
房间已结束
登录凭据失效
搜索失败
歌曲不可播放
仅试听
点歌失败
歌曲已经被别人删除
自己的歌曲已经开始播放，不能再取消
```

不能只 console.error。

---

# 23. Remote Security

## Authentication

- join token 只用于建立 client session；
- mutation 使用 client token；
- 所有 Remote API 检查 active room；
- room stop 清空所有 client sessions。

## Authorization

- read queue：所有房间 client；
- enqueue：所有有效 client；
- priority enqueue：有效 client（如 Host 未关闭）；
- remove/front：仅自己的 waiting item；
- Host control API：不开放 LAN。

## Input

限制：

```text
q length
trackId type/length
queueItemId length
JSON body size
display name length
```

## Rate Limit

无需大型依赖，可做简单内存 token bucket：

```text
search: 10 / 10s / client
mutation: 20 / 10s / client
```

具体可调整。

---

# 24. Remote API 不得暴露的能力

Phase 4 仍然禁止：

```text
远程切歌
远程重唱
远程 play/pause
远程音量
远程歌词 offset
远程退出 KTV
任意网易云 API proxy
任意 Electron IPC
文件下载/上传
```

这些只有未来明确产品需求才开放。

---

# 25. Phase 4 自动化测试

至少增加：

## Client Session

- valid join token → client session；
- wrong join token → reject；
- stop room → client token invalid；
- restart → old client token invalid。

## Search

用 mock catalog：

- query validation；
- result sanitize；
- version preservation；
- upstream error；
- rate limit。

## Availability

- playable；
- trial-only；
- unavailable；
- network error；
- cache；
- request-time revalidation。

## Queue

- remote normal enqueue → tail；
- priority enqueue → head；
- priority does not interrupt current；
- duplicate trackId allowed；
- requesterId recorded；
- own delete success；
- delete other user's item forbidden；
- own move-front success；
- move-front other user's item forbidden；
- playing item cannot be deleted/moved by guest。

## State

- sanitized state；
- no private fields；
- current/waiting order correct。

---

# 26. Phase 4 Integration Test

建立一个测试专用 fake catalog / fake manager bridge，至少验证完整 HTTP 链路：

```text
start room
→ join client
→ search
→ enqueue
→ get state
→ priority enqueue
→ queue order
→ delete own
→ ownership deny
→ stop room
→ old credentials fail
```

不能依赖真实网易云网络作为 CI 的唯一测试。

真实 NetEase 只做 manual smoke test。

---

# 27. Real Device Acceptance

至少：

```text
Windows Electron Host
+
Android Chrome 或 iPhone Safari
+
可选另一台 PC 浏览器
```

实测：

1. KTV；
2. 开房；
3. QR；
4. Remote Connected；
5. 深浅模式；
6. 搜索歌曲；
7. 出现多个版本；
8. 可播放状态；
9. 普通点歌；
10. 优先点歌；
11. Host Queue 顺序正确；
12. 手机取消自己的歌；
13. 手机置顶自己的歌；
14. 手机不能修改别人歌曲；
15. Host 切歌；
16. Remote 1.5s 内看到 current 变化；
17. 结束 KTV；
18. Remote 失效。

---

# 28. Phase 4 CI

GitHub blocking：

```text
Production build
Scoped Prettier
Scoped ESLint
KTV domain tests
KTV server tests
Remote auth tests
Remote API tests
Queue authorization tests
```

继续 Node 16。

Phase 4 新文件必须进入 scoped validation。

---

# 29. AI_WORKFLOW

新增：

```text
TASKS/STEP_04_REAL_REMOTE_SONG_REQUEST.md
REPORTS/CODEX_STEP_04_REPORT.md
REVIEWS/CHATGPT_PHASE_03_REVIEW.md
```

更新：

```text
PROJECT_STATE.md
DECISIONS.md
CHANGELOG.md
REVIEWS/CHATGPT_LATEST.md
```

必须记录：

```text
PHASE3_FIXED_SHA
PHASE4_PARENT_SHA
PHASE4_IMPLEMENTATION_SHA
DOC_CHECKPOINT_SHA
GitHub Action run ID
real LAN test result
real NetEase smoke result
```

---

# 30. Phase 4 不做

仍不做：

- 公网穿透；
- 云服务器；
- 用户账号系统；
- 麦克风输入；
- 混响；
- 消人声；
- 音轨分离；
- 音准评分；
- AI 评分；
- Remote Host 控制；
- WebSocket/SSE；
- Electron/Node 大版本升级。

---

# 31. Phase 4 完成后的产品状态

```text
Desktop Host
├─ KTV lyric stage
├─ fullscreen / lyric fullscreen
├─ real KaraokeManager
├─ real temporary Queue
├─ next / replay / reorder / front
├─ LAN room + QR
└─ Host full queue authority

Remote Mobile / Tablet / PC
├─ Glass Light/Dark
├─ join room
├─ real NetEase search
├─ multi-version results
├─ playability status
├─ normal request
├─ priority request
├─ real current song
├─ real waiting queue
├─ cancel own waiting
└─ move own waiting to front
```

此时最初需求的主体已完成。

剩余 Phase 5 主要是：

```text
稳定性
Windows/macOS packaging
长期回归
安装包
release
防火墙/网络体验
UI polish
```

---

# 32. 最终执行顺序

```text
feat/ktv-phase-3 @ 9130ed28...
        ↓
Phase 3.1 Repair
        ↓
Tests + CI GREEN
        ↓
PHASE3_FIXED_SHA
        ↓
feat/ktv-phase-4
        ↓
Remote Client Session
        ↓
NetEase Search
        ↓
Version + Playability
        ↓
Normal / Priority Request
        ↓
Queue Authorization
        ↓
1.5s Polling State Sync
        ↓
Responsive Glass Remote UI
        ↓
Real LAN Device Test
        ↓
GitHub CI GREEN
        ↓
Push
        ↓
STOP FOR CHATGPT REVIEW
```
