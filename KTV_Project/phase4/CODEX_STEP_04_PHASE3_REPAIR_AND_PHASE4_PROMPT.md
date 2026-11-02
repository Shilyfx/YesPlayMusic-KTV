# Codex STEP 04 — Phase 3.1 Repair + Phase 4 Real Remote Song Request

> **一次连续执行。**  
> 当前起点：`feat/ktv-phase-3`，已审查提交 `9130ed28c705213ee02da0c3d383f39e89ba3a58`。  
> 先完成 Phase 3.1 的阻塞修复与安全加固；只有 Gate 全绿后，才从修复后的精确 SHA 创建 `feat/ktv-phase-4`，然后继续完成 Phase 4。  
> **不允许只修复后停止；不允许跳过修复直接写 Remote 点歌。**

---

# 0. Authority

Repository:

```text
Shilyfx/YesPlayMusic-KTV
```

Current reviewed Phase 3:

```text
branch: feat/ktv-phase-3
sha: 9130ed28c705213ee02da0c3d383f39e89ba3a58
```

Phase 3 parent / Phase 2.1 green:

```text
21385ac20ef56e69f597a5d78b2fb7b2cbb39b54
```

Known successful Phase 3 Action:

```text
34187596563
```

ChatGPT verdict:

```text
Conditional Pass
P0: 0
P1: 4
```

事实优先级：

```text
actual code
> git history
> executable tests
> GitHub Actions
> AI_WORKFLOW docs
> agent narrative
```

---

# 1. Read Before Editing

按顺序阅读：

1. `KTV_Project/YesPlayMusic_KTV_项目书.md`
2. `KTV_Project/AI_WORKFLOW/README.md`
3. `KTV_Project/AI_WORKFLOW/BASELINE.md`
4. `KTV_Project/AI_WORKFLOW/PROJECT_STATE.md`
5. `KTV_Project/AI_WORKFLOW/DECISIONS.md`
6. `KTV_Project/AI_WORKFLOW/TASKS/STEP_03_LAN_ROOM_INFRASTRUCTURE.md`（若存在）
7. `KTV_Project/AI_WORKFLOW/REPORTS/CODEX_STEP_03_REPORT.md`
8. `KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_PHASE_03_REVIEW.md`（若用户已放入仓库）
9. Phase 3 项目书
10. 本 Prompt

同时真实检查：

```text
src/electron/karaoke/KaraokeServer.js
src/background.js
src/electron/ipcMain.js
src/views/karaoke.vue
src/remote/*
vue.config.js
scripts/test-karaoke-server.js
.github/workflows/phase-validation.yml
src/karaoke/*
```

---

# 2. Git Preflight

```bash
git fetch --all --prune
git checkout feat/ktv-phase-3
git status --short --branch
git rev-parse HEAD
git log --oneline --decorate -n 20
git merge-base HEAD 9130ed28c705213ee02da0c3d383f39e89ba3a58
```

如果当前 remote HEAD 已有用户新提交：

- 不 reset；
- 不 force；
- 审查新增提交；
- 从安全实际 HEAD 继续；
- 报告 divergence。

---

# PART A — PHASE 3.1 REPAIR

# 3. Fix P1-01 — Main Process must enforce KTV-active room eligibility

当前 IPC：

```text
karaoke:lan:start
```

不能只依赖 Vue 按钮顺序。

实现一个受控 eligibility/lifecycle bridge，使 Main Process 明确知道：

```text
KTV Session ACTIVE / INACTIVE
```

要求：

```text
inactive → lan:start rejected
active   → lan:start allowed
end KTV  → force stopRoom()
```

可以通过最小 IPC lifecycle event、shared runtime contract 或 Main/Renderer controlled state 实现。

约束：

- KaraokeServer 不是 Session source of truth；
- KaraokeManager 仍是 KTV business source；
- LAN room failure 不结束 Local KTV。

写自动测试覆盖 eligibility。

---

# 4. Fix P1-02 — startRoom rollback

重构 KaraokeServer start lifecycle：

```text
IDLE
→ STARTING
→ ACTIVE
```

listen error：

```text
STARTING
→ rollback
→ IDLE
```

异常后必须：

```text
this.room === null
this.server === null
no usable URL
token invalid
```

测试：

1. 占用 27233；
2. `startRoom()` reject；
3. describeRoom null；
4. 释放端口；
5. 再次 start 成功；
6. stop 成功。

---

# 5. Fix P1-03 — Isolate Remote static assets

当前不要继续从整个：

```text
dist/js
dist/css
dist/img
```

通过 27233 通用 serve。

调整 build / server，使 Remote 完整资源位于：

```text
dist/remote/
```

包括它需要的：

```text
index.html
js/
css/
img/
```

KaraokeServer 只允许：

```text
remoteDistPath
```

不得提供：

```text
desktop index.html
desktop js
desktop css
desktop img
/api
/player
```

测试尝试获取 desktop bundle，应 404。

不要复制用户数据、缓存数据库或账号信息到 remote directory。

---

# 6. Fix P1-04 — Complete server tests

重写/扩展：

```text
scripts/test-karaoke-server.js
```

至少覆盖：

```text
health 200
valid room + valid token
valid room + missing token rejected
valid room + wrong token rejected
wrong room rejected
stop → port closed
stop → old URL invalid
restart → old token invalid
restart → new token valid
EADDRINUSE
EADDRINUSE rollback
retry after EADDRINUSE
desktop /api denied
desktop /player denied
desktop bundle denied
```

不要用：

```text
wrong room + wrong token
```

代替“正确 room + 错 token”。

---

# 7. Harden LAN address selection

把：

```text
getLanAddress()
```

升级为：

```text
getLanAddressCandidates()
```

建议结果：

```json
[
  {
    "interfaceName": "Wi-Fi",
    "address": "192.168.1.20",
    "isPrivate": true,
    "priority": 100
  }
]
```

优先 RFC1918：

```text
192.168/16
10/8
172.16/12
```

Host UI 多个候选时允许选择。

不使用：

```text
ipconfig
ifconfig
PowerShell
shell
registry
```

---

# 8. Improve token bootstrap

Phase 4 前将 QR URL 的长期 query token 改掉。

推荐：

```text
/room/CODE#token=<joinToken>
```

Room HTML 本身可按 room code 返回，但真正 API session 建立需要 fragment 中 join token。

Remote：

```text
read fragment
→ establish client session
→ sessionStorage
→ history.replaceState cleanup
```

不要 console.log token。

---

# 9. Lyric fullscreen controls

保留两个不同 Fullscreen target：

```text
全屏 KTV → karaokeSurface
只看歌词 → lyricStage
```

为 lyric fullscreen 加极简 overlay：

```text
重唱
播放/暂停
切歌
退出全屏
```

要求：

- mousemove/touch 显示；
- 3–5s inactivity hide；
- Esc 正常；
- 不建立新 Player；
- 不复制歌词 source；
- normal/full KTV fullscreen 不互相破坏。

---

# 10. Update CI scope

blocking Prettier/ESLint 加入：

```text
src/electron/karaoke/**
src/remote/**
src/background.js
src/electron/ipcMain.js
vue.config.js
scripts/test-karaoke-server.js
```

不要仅依赖 continue-on-error 的 full lint。

---

# 11. Phase 3.1 AI_WORKFLOW

创建：

```text
KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_PHASE_03_REVIEW.md
KTV_Project/AI_WORKFLOW/REPORTS/CODEX_PHASE_03_1_REPAIR_REPORT.md
```

更新：

```text
PROJECT_STATE.md
DECISIONS.md
CHANGELOG.md
REVIEWS/CHATGPT_LATEST.md
```

记录已审查：

```text
9130ed28...
Action 34187596563
Conditional Pass
```

不要写“ChatGPT approved Phase 3.1”。

---

# 12. Phase 3.1 Commit + Push

提交到：

```text
feat/ktv-phase-3
```

建议：

```text
fix(karaoke): harden LAN room lifecycle and remote isolation
```

push。

等待 GitHub Actions。

记录：

```text
PHASE3_FIXED_SHA
PHASE3_FIXED_ACTION_RUN
```

---

# 13. HARD GATE

只有全部满足才能继续 Phase 4：

- [ ] inactive KTV cannot start LAN room
- [ ] KTV end force stops room
- [ ] listen failure rolls back room/server
- [ ] EADDRINUSE retry works
- [ ] old URL invalid after stop
- [ ] old token invalid after restart
- [ ] Remote static isolated under remote subtree
- [ ] desktop `/api` denied on 27233
- [ ] `/player` denied on 27233
- [ ] desktop bundles denied
- [ ] wrong-token test is real
- [ ] LAN candidates returned
- [ ] lyric fullscreen controls work
- [ ] Phase scoped lint includes new files
- [ ] Production Build passes Node 16
- [ ] domain tests pass
- [ ] server tests pass
- [ ] GitHub Action GREEN

任何一项失败：

```text
DO NOT CREATE feat/ktv-phase-4
```

全部通过后继续，不要停止。

---

# PART B — PHASE 4

# 14. Create Phase 4 branch

从：

```text
PHASE3_FIXED_SHA
```

创建：

```bash
git checkout -b feat/ktv-phase-4 <PHASE3_FIXED_SHA>
```

记录：

```text
PHASE4_PARENT_SHA
```

---

# 15. Phase 4 architecture

保持 canonical：

```text
KaraokeManager
= Session + Queue business source
```

新增：

```text
KaraokeRemoteService
KaraokeCatalogService
RemoteClientSessionStore
RemoteApiRouter
```

名称可按项目结构调整。

禁止：

```text
Remote API 直接修改 Vuex arrays
Remote API 直接访问 Player private fields
KaraokeServer 成为第二 Queue
```

所有 enqueue/remove/move-to-front 最终必须调用 KaraokeManager 的公共业务 API。

---

# 16. Client Session

共享 room join token 只用于换客户端身份。

实现：

```http
POST /ktv/api/client-session
Authorization: Bearer <joinToken>
```

生成：

```text
clientId
clientToken
displayName
roomId
createdAt
```

使用：

```text
crypto.randomBytes
```

Remote 保存：

```text
sessionStorage
```

Room stop：

```text
invalidate all client sessions
```

新 room：

```text
all old clients invalid
```

不要使用 client 自己提交的 ID 作为权限依据。

---

# 17. API White List

允许：

```text
POST /ktv/api/client-session
GET  /ktv/api/state
GET  /ktv/api/search?q=
GET  /ktv/api/track/:trackId/availability
POST /ktv/api/requests
DELETE /ktv/api/requests/:queueItemId
POST /ktv/api/requests/:queueItemId/front
```

availability 可合并进 search，但 contract 必须清晰。

禁止：

```text
generic /api proxy
/player
remote next
remote replay
remote play
remote volume
remote KTV end
arbitrary Netease endpoints
```

---

# 18. Authentication Middleware

除 client-session bootstrap 外，Remote API 使用：

```http
Authorization: Bearer <clientToken>
```

校验：

```text
token exists
client exists
client belongs current room
room active
token not expired
```

401/403 区分合理即可，但不要泄露 token 细节。

---

# 19. Search implementation

通过本地现有网易云能力搜索，不允许浏览器直接访问：

```text
127.0.0.1:10754
```

Server-side adapter 返回 sanitized results：

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

Remote：

```text
debounce 300–500ms
10–20 results
cancel stale response
loading/error/empty
```

限制：

```text
q max ~80
```

不返回 raw NetEase payload/cookie/account。

---

# 20. Version handling

不要按 song name 去重所有结果。

保留网易云不同 track ID。

生成仅用于展示的：

```text
versionLabel
```

可识别：

```text
Live
Remix
Acoustic
伴奏
Cover
原版/普通
其他版本
```

不能确定就显示：

```text
其他版本
```

不要伪造“官方原版”的强结论。

---

# 21. Playability

分类：

```text
checking
playable
trial-only
unavailable
error
```

复用普通 Player 实际音源判断语义，但放入独立 catalog service。

核心：

```text
URL missing → unavailable
freeTrialInfo != null → trial-only
otherwise → playable
```

具体以仓库真实 getMP3 返回为准。

实现缓存：

```text
in-memory ~5 min
```

并发：

```text
3–4
```

提交点歌时**必须重新服务端验证**。

---

# 22. Enqueue request

Request：

```http
POST /ktv/api/requests
```

body：

```json
{
  "trackId": "123",
  "priority": false
}
```

Server：

```text
auth client
→ validate trackId
→ resolve metadata
→ validate playability
→ enqueue via KaraokeManager
→ attach requester
```

普通：

```text
tail
```

优先：

```text
enqueue
→ manager.moveQueueItemToFront(queueItemId)
```

Priority 不得：

```text
interrupt current
```

---

# 23. Queue ownership

Queue item remote fields：

```text
requesterId
requesterName
requesterType = remote
priorityRequested
```

Remote client：

```text
DELETE own waiting only
POST own waiting /front only
```

Server must deny：

```text
other user's item
current item
history item
unknown queueItemId
```

Host 不受此 guest ownership 限制。

---

# 24. State endpoint

```http
GET /ktv/api/state
```

返回 sanitized state：

```text
room
current
waiting
client
playing/progress optional
```

不得返回：

```text
KaraokeManager object
Player object
underscored fields
Vuex whole state
cookies
paths
tokens
```

如果加入 progress，通过公开 Adapter/Player getter。

---

# 25. Polling decision

Phase 4 明确采用：

```text
HTTP Polling
```

不要 WebSocket/SSE。

Remote visible：

```text
1500ms
```

hidden：

```text
5000ms or pause
```

error：

```text
2s → 4s → 8s
```

mutation 成功：

```text
immediate refresh
```

禁止 100ms 网络 polling。

---

# 26. Remote UI

使用独立 remote entry，重做成真实点歌页。

必须继续：

```text
Glass
Auto / Light / Dark
mobile/tablet/PC responsive
```

### Mobile order

```text
Room header
Now Playing
Search
Search Results
My/All Queue
```

Search card：

```text
Song
Artists
Album
Version tag
Availability

[点歌]
[优先点歌]
```

Queue item：

自己的：

```text
[置顶] [取消]
```

别人的：

```text
只显示
```

---

# 27. Priority request product semantics

必须实现两种：

```text
点歌
优先点歌
```

Example：

```text
current: A
waiting: B C
client requests D priority
→ current A
→ waiting D B C
```

Remote 自己已在 waiting 的歌曲也可以：

```text
置顶
```

不是切歌。

---

# 28. Host Desktop

队列 remote item 显示：

```text
requesterName
remote/host
priority marker optional
```

Host 仍保留：

```text
置顶
↑
↓
删除
切歌
重唱
```

不要让 Remote permissions 影响 Host。

---

# 29. Playback start policy

固定：

```text
Remote 在 KTV idle waiting-empty 时点第一首
→ 只进入 waiting
→ 不自动播放
```

Host 点击：

```text
开始待唱
```

才播放。

自然结束：

```text
KaraokeManager 自动 next KTV
```

---

# 30. Rate limiting

最小内存限流，无需新大型依赖。

建议：

```text
search: 10 / 10 sec / client
mutation: 20 / 10 sec / client
```

返回：

```text
429
```

Room stop 清理 limiter state。

---

# 31. Security input validation

至少：

```text
query max length
trackId string/number constraints
queueItemId max length
JSON body max
content-type
HTTP methods
```

未知 API：

```text
404
```

错误响应不要包含：

```text
stack
local paths
token
raw upstream response
```

---

# 32. Automated tests

## Client Session

```text
valid join
bad join
old join after restart
client invalid after stop
```

## Search

用 mock Catalog：

```text
sanitize
versions preserved
query validation
upstream fail
rate limit
```

## Playability

```text
playable
trial
unavailable
error
cache
revalidate on enqueue
```

## Queue Auth

两 clients：

```text
A enqueue
B enqueue
A cannot delete B
A cannot front B
A can delete A
A can front A
priority insert head
duplicate trackId safe
current not interrupted
```

## State

assert no：

```text
_private
token
cookie
local paths
```

---

# 33. HTTP Integration Test

新增例如：

```text
scripts/test-karaoke-remote-api.js
```

使用 fake catalog / fake manager bridge。

完整：

```text
start room
→ bootstrap A
→ bootstrap B
→ search
→ enqueue A
→ enqueue priority B
→ state order
→ unauthorized ownership mutation
→ own front/delete
→ stop
→ all credentials invalid
```

CI 不依赖真实网易云。

---

# 34. Real NetEase Smoke

本地手工真实验证至少 3 类：

```text
常规可播放
Live/Remix/另版本
不可播放或试听（若可找到）
```

记录 track name / ID / status 可以，禁止记录 cookie/token。

---

# 35. Real LAN Test

Windows + phone：

```text
QR
join
search
version
normal request
priority request
queue sync
own front
own cancel
Host next
Remote current refresh
room end
Remote invalid
```

再用 PC browser 测 responsive 如条件允许。

---

# 36. CI

blocking：

```text
Node 16 Production Build
Scoped Prettier
Scoped ESLint
Domain Test
Server Test
Remote API Test
Authorization Test
```

新增 Phase 4 文件必须在 scoped checks。

---

# 37. AI_WORKFLOW

创建：

```text
TASKS/STEP_04_REAL_REMOTE_SONG_REQUEST.md
REPORTS/CODEX_STEP_04_REPORT.md
```

更新：

```text
PROJECT_STATE.md
DECISIONS.md
CHANGELOG.md
REVIEWS/CHATGPT_LATEST.md
```

报告必须包含：

```text
PHASE3_FIXED_SHA
PHASE3_FIXED_ACTION_RUN
PHASE4_PARENT_SHA
PHASE4_IMPLEMENTATION_SHA(s)
DOC_CHECKPOINT_SHA
PHASE4_ACTION_RUN
```

以及：

```text
real LAN test
real NetEase smoke
known limitations
Phase 5 exclusions
```

---

# 38. Git Sequence

Phase 3 repair：

```text
feat/ktv-phase-3
```

push + CI GREEN。

然后：

```text
feat/ktv-phase-4
```

from exact `PHASE3_FIXED_SHA`。

建议 commits：

```text
feat(karaoke): add authenticated remote client sessions
feat(karaoke): add remote search and playability service
feat(karaoke): add real remote request and queue sync
feat(karaoke): add responsive remote request UI
docs: record phase 4 checkpoint
```

可按实际修改合理拆分。

---

# 39. STOP CONDITION

Phase 4 push + CI green 后停止。

不要开始：

```text
Phase 5 packaging
macOS notarization
Electron upgrade
microphone
vocal removal
scoring
remote player controls
```

最终向用户输出审查请求，包含：

```text
feat/ktv-phase-4
PHASE3_FIXED_SHA
PHASE3_FIXED_ACTION_RUN
PHASE4_PARENT_SHA
PHASE4_IMPLEMENTATION_SHA
DOC_CHECKPOINT_SHA
PHASE4_ACTION_RUN
real LAN test summary
real NetEase smoke summary
```

等待 ChatGPT 审查。
