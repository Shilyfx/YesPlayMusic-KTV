# YesPlayMusic KTV 改造项目书

> 基于 `qier222/YesPlayMusic` 的跨平台家庭/局域网 K 歌与多人点歌扩展方案

**项目代号：** YesPlayMusic KTV  
**基线项目：** qier222/YesPlayMusic  
**目标平台：** Windows / macOS（Linux 保持兼容优先，不作为首发验收平台）  
**主应用形态：** Electron 桌面端 + 独立局域网 KTV Web 端  
**Web 端目标：** 同一套响应式页面适配手机、平板和 PC 浏览器  
**UI 方向：** 透明玻璃（Glassmorphism）+ 动态专辑背景 + Light / Dark / Auto 主题  
**项目原则：** 最小侵入改造、优先复用现有 Player/歌词/网易云搜索能力、跨平台优先、安全地开放局域网能力。

---

## 1. 项目背景与目标

YesPlayMusic 已具备完整的网易云第三方播放器能力，包括 Electron 桌面封装、Vue 2 UI、Howler 播放器、歌词解析与高亮、播放列表/插队列表、网易云搜索、本地 Express 服务等。本项目不是重新开发播放器，而是在现有能力之上扩展“家庭 K 歌 / 聚会点歌”的完整体验。

本次改造的核心目标有四个：

1. **歌词体验增强**：歌词字体支持连续自定义，歌词时间轴支持提前/延迟 N 秒，并持久化用户设置。
2. **桌面 K 歌模式**：形成独立的 KTV Session、临时待唱队列、当前歌曲、下一首、已唱列表以及切歌/重唱等主控功能。
3. **局域网多人点歌**：手机扫码进入点歌 Web，搜索网易云歌曲、查看不同版本、判断可播放状态、加入临时 K 歌队列，并实时查看排队情况。
4. **统一视觉体验**：桌面 K 歌页与手机/PC 点歌 Web 使用一致的透明玻璃设计语言，支持深色、浅色和跟随系统主题，并对移动端、平板、PC 浏览器做响应式适配。

项目完成后，典型使用方式为：电脑连接电视/音响运行 YesPlayMusic KTV，进入 K 歌模式后生成二维码；同一局域网内的手机扫码点歌；桌面端自动接收歌曲并按队列播放；主机可切歌、重唱、管理队列。

---

## 2. 现有项目基线分析

### 2.1 当前技术栈

现有仓库采用：

- Vue 2.6.x
- Vue Router 3.x
- Vuex 3.x
- Electron 13.x
- Howler 2.x
- Express 4.x
- Axios
- Dexie / IndexedDB
- `@neteaseapireborn/api`
- `qrcode`

该技术栈虽然偏旧，但对本次功能仍然足够。第一阶段不应同时进行 Vue/Electron 大版本迁移，否则会把“功能改造风险”和“框架升级风险”耦合在一起。

### 2.2 可直接复用的现有能力

| 现有能力 | 复用方式 | 对本项目价值 |
|---|---|---|
| `src/utils/Player.js` | 继续作为唯一播放内核 | 播放、暂停、seek、下一首、列表替换、插队队列均可复用 |
| `src/views/lyrics.vue` | 改造成 K 歌歌词主视觉基础 | 已有歌词高亮、滚动、全屏、播放器控制 |
| `src/views/settings.vue` | 增加歌词偏移、连续字号等设置 | 已有歌词字体设置区 |
| `src/api/others.js` 搜索 | 手机点歌服务复用搜索逻辑 | 可返回网易云多版本歌曲 |
| `_playNextList` | 作为底层优先播放机制参考 | KTV 队列最终可以映射到现有 Player |
| Electron 主进程 Express | 新增独立 Karaoke Server | 已证明 Electron 内启动 HTTP 服务可行 |
| `qrcode` | 房间地址二维码 | 无需新引入二维码库 |

### 2.3 必须避免的错误方向

1. 不直接把现有 `127.0.0.1:27232` 改成 `0.0.0.0` 对局域网开放。
2. 不让手机直接访问完整 YesPlayMusic 桌面站点或完整网易云 API Proxy。
3. 不把 K 歌队列简单等同于 `_playNextList`，因为 KTV 队列需要点歌人、状态、时间、版本等业务元数据。
4. 不在第一阶段升级 Vue 3、Electron 新版本或整体替换播放内核。
5. 不使用 Windows 专属 shell 命令实现核心能力，避免后续 macOS 重构。

---

## 3. 项目范围

### 3.1 本期必须完成

- 歌词字号连续调节并持久化。
- 歌词同步偏移：提前/延迟 N 秒，支持正负值、快速恢复 0。
- K 歌模式入口、退出与 Session 生命周期。
- 临时 KTV Queue，不写入用户网易云正式歌单。
- 当前歌曲、待唱、已唱状态。
- 切歌、重唱、播放/暂停。
- 局域网 KTV Server，独立端口。
- 二维码与房间链接。
- 响应式点歌 Web。
- 网易云歌曲搜索和多版本选择。
- 可播放性判定。
- 点歌、取消自己点的歌、查看队列。
- 深色/浅色/自动主题。
- Windows 首发可用，macOS 架构兼容。

### 3.2 本期暂不承诺

以下功能预留扩展位，但不进入首期核心验收：

- AI 消人声/伴奏分离。
- 麦克风输入、耳返、混响。
- 音高评分、音准评分。
- 升降调、变速不变调。
- 逐字卡拉 OK 时间轴重建。
- 互联网远程点歌（非局域网）。
- 多房间云服务。
- 用户账号体系和复杂权限系统。

---

## 4. 用户角色与核心场景

### 4.1 Host：K 歌主机操作者

设备通常是 Windows/Mac 电脑，可能连接电视、投影、音箱。

权限：

- 开启/关闭 K 歌模式。
- 生成房间二维码。
- 查看当前曲目和全部队列。
- 切歌、重唱、暂停、恢复。
- 删除/置顶/调整待唱歌曲。
- 控制是否允许游客取消/插队。
- 调整歌词字号、同步偏移、主题。

### 4.2 Guest：手机/网页点歌用户

无需安装 App，通过浏览器访问。

权限：

- 搜索歌曲。
- 查看歌曲/歌手/专辑/版本。
- 查看当前是否可播放。
- 点歌。
- 查看当前播放和待唱顺序。
- 在 Host 允许时取消自己点的歌曲。

### 4.3 PC Web Guest

同一 Web 页面在 PC 浏览器打开时使用双栏或三栏布局，适合聚会中放置第二台电脑/平板作为独立点歌台。

---

## 5. 产品信息架构

### 5.1 桌面 Electron 主应用

建议新增一级 K 歌入口：

- 首页 / Library 原有入口
- **K 歌模式**
- 设置

K 歌模式内部建议包含：

1. KTV 主舞台（歌词、封面、当前歌曲）
2. 当前队列抽屉
3. 房间与二维码面板
4. 快速控制面板
5. 歌词显示设置面板
6. K 歌 Session 设置

### 5.2 局域网点歌 Web

路由建议：

- `/`：加入/房间状态
- `/search`：搜索点歌
- `/queue`：待唱队列
- `/now`：当前歌曲
- `/settings`：仅 Web 本地主题设置

第一版可以用单页 Tab 实现，避免路由过度复杂。

---

## 6. 功能设计：歌词字号自定义

### 6.1 当前问题

原项目已有 16 / 22 / 28 / 36px 四档歌词字号，但 K 歌场景中显示设备可能是笔记本、桌面显示器、电视、投影，四档粒度不足。

### 6.2 新设计

新增连续范围：

- 最小：16px
- 默认：28px
- 建议最大：64px
- 步进：1px
- 快捷按钮：`-` / `+`
- 滑块：16–64
- 恢复默认：28px

桌面 KTV 大屏可允许更大的“舞台字号”，例如扩展到 72px，但应与普通歌词模式使用同一设置还是独立设置，由实现阶段决定。推荐采用两个字段：

- `lyricFontSize`：普通歌词页
- `karaokeLyricFontSize`：KTV 模式

这样可以避免用户为了电视 K 歌调大字号后，回到普通桌面播放器仍然巨大。

### 6.3 持久化

继续使用现有 settings/localStorage 机制，不增加新的持久化框架。

---

## 7. 功能设计：歌词时间提前/延迟

### 7.1 定义

新增 `lyricOffsetSeconds`：

- 范围建议：-10.0s ~ +10.0s
- 默认：0
- 细调步进：0.1s
- 快调步进：0.5s
- UI 显示：`提前 0.5s` / `延迟 1.2s` / `同步`。

### 7.2 计算原则

不要修改原始歌词数据。高亮计算时引入显示时间：

`effectiveProgress = playerProgress + lyricOffsetSeconds`

约定必须统一：

- 正值：歌词更早出现（提前）。
- 负值：歌词更晚出现（延迟）。

或者反过来亦可，但 UI、变量名、测试必须完全一致。推荐在代码中用明确字段名和注释，避免后续符号混乱。

### 7.3 控件位置

普通歌词页：在歌词控制区域增加小型“同步”按钮，点击打开浮层。

KTV 模式：直接在右侧控制面板或底部工具条显示：

`歌词同步  [-0.1]  +0.6s  [+0.1]  [归零]`

### 7.4 验收

- 调整后无需重新加载歌词。
- 调整立即生效。
- 切歌后仍保留全局偏移。
- 重启应用后保留。
- 点击歌词行 seek 时应基于原始歌词时间，不把显示偏移错误写回播放进度。

---

## 8. 功能设计：K 歌 Session

K 歌模式不是普通网易云歌单，应新增业务对象 `KaraokeSession`。

建议字段：

```text
sessionId
roomCode
createdAt
startedAt
endedAt
status: idle | active | ended
hostName
allowGuestCancel
allowGuestDuplicate
queuePolicy
```

开启 K 歌模式时：

1. 创建 Session。
2. 创建空 KTV Queue。
3. 启动局域网服务（或确认服务已启动）。
4. 获取可用局域网 IPv4。
5. 创建短期房间 Token。
6. 生成二维码。
7. 显示 KTV 主舞台。

退出时：

- 停止接收新点歌。
- 提示是否清空临时队列。
- 默认不修改网易云正式歌单。
- 记录当前 Session 为 ended。

第一版 Session 可仅保存在运行时内存；为了崩溃恢复，可在后续把轻量状态写入 localStorage/electron-store。

---

## 9. 功能设计：KTV Queue

### 9.1 业务模型

推荐队列项：

```json
{
  "queueItemId": "uuid",
  "trackId": 123456,
  "trackName": "晴天",
  "artists": ["周杰伦"],
  "albumName": "叶惠美",
  "coverUrl": "...",
  "durationMs": 269000,
  "requesterId": "guest-xxx",
  "requesterName": "手机 A",
  "requestedAt": "ISO time",
  "status": "waiting",
  "playability": "playable",
  "versionLabel": "原版"
}
```

状态建议：

- `waiting`
- `playing`
- `played`
- `skipped`
- `removed`
- `failed`

### 9.2 队列原则

- 默认 FIFO。
- Host 可以置顶、删除、拖动排序。
- Guest 默认只能取消自己点的、尚未开始播放的歌曲。
- 同一 trackId 重复点歌默认允许，但 UI 提示“队列中已有该歌曲”。
- 可增加“禁止连续重复同一首”的 Host 设置。

### 9.3 与 Player 的关系

`KaraokeManager` 是业务真相源；Player 只负责播放。

当 Queue 的下一项要播放时：

1. KaraokeManager 选择下一项。
2. 调用 Player 播放 trackId。
3. 更新 queue item 状态。
4. Player 播放结束回调触发下一项。

不要让 UI 直接维护 Player 内部数组，以避免业务层和播放器状态互相污染。

---

## 10. 功能设计：切歌、重唱与播放控制

### 10.1 切歌

Host 点击“切歌”：

- 当前 queue item 标记 `skipped`。
- 调用 KaraokeManager 的 `next()`。
- Player 进入下一待唱项。
- Web 客户端立即同步。

Guest 默认不提供切歌权限。

### 10.2 重唱

重唱不改变队列顺序：

- 当前歌曲保持 playing。
- `player.seek(0)`。
- 确保恢复 `play()`。
- 歌词高亮回到首句。

### 10.3 暂停

暂停只是 Player 状态，Queue 仍保持 playing。

---

## 11. 功能设计：网易云搜索与多版本选择

### 11.1 搜索入口

搜索框支持：

- 歌名
- 歌手
- “歌名 + 歌手”
- 部分拼音/关键词能力取决于网易云 API 返回，不额外承诺本地搜索引擎。

### 11.2 搜索结果卡片

每条建议显示：

- 封面
- 歌名
- 歌手
- 专辑
- 时长
- 版本标签（原版/Live/伴奏/翻唱，仅在可可靠推断时显示）
- 可播放状态
- “点歌”按钮

### 11.3 多版本策略

不要自动武断地选唯一版本。

当结果高度明确时可提供“直接点歌”；否则用户选择具体搜索结果。可以在视觉上对“歌名+主要歌手完全匹配”的结果加“推荐”标识，但不能隐藏其他版本。

---

## 12. 功能设计：可播放性判定

搜索结果“存在”不等于“可播放”。

建议状态：

- `checking`：检查中
- `playable`：可播放
- `trial`：仅试听
- `unavailable`：不可播放
- `unknown`：暂无法确定

实现原则：

- 优先复用原 Player 获取音源时已有的 URL / `freeTrialInfo` 判断逻辑。
- 服务端可以按需检查，避免一次搜索对所有结果并发请求过多。
- 第一版可以只对用户展开或点击的结果检查；后续再加批量缓存。

UI：

- 可播放：绿色/成功状态，但不要只依赖颜色。
- 仅试听：明确文字“仅试听”。
- 不可播放：禁用点歌按钮并说明。

---

## 13. 局域网架构设计

### 13.1 端口分离

保留原桌面内部服务：

`127.0.0.1:27232`

新增独立 KTV 服务：

`0.0.0.0:27233`（默认值，可配置）

KTV Server 仅公开必要接口，不暴露整个桌面应用和完整 `/api` Proxy。

### 13.2 网络地址选择

应用应枚举本机网络接口，优先选择：

- IPv4
- 非 loopback
- 私有网段
- 当前可用网卡

若存在 Wi-Fi + 虚拟网卡 + VPN 多个地址，应允许 Host 在房间面板手动切换“对外地址”。

### 13.3 房间安全

局域网也不应完全裸奔。

第一版建议：

- 启动 Session 时生成随机 `roomToken`。
- 二维码包含 token。
- API 请求必须携带 session/token。
- Host 控制接口使用不同的 host token，不暴露给 Guest。
- Guest 端不允许直接执行 `next/replay/removeOther` 等 Host 操作。
- 默认不开放跨网卡公网访问能力。

---

## 14. KTV Web API 草案

建议统一前缀 `/ktv-api`。

| Method | Endpoint | Guest | Host | 作用 |
|---|---|---:|---:|---|
| GET | `/ktv-api/session` | ✓ | ✓ | 房间信息 |
| GET | `/ktv-api/status` | ✓ | ✓ | 当前播放状态 |
| GET | `/ktv-api/search?q=` | ✓ | ✓ | 搜索歌曲 |
| GET | `/ktv-api/tracks/:id/playability` | ✓ | ✓ | 可播放性 |
| GET | `/ktv-api/queue` | ✓ | ✓ | 队列 |
| POST | `/ktv-api/queue` | ✓ | ✓ | 点歌 |
| DELETE | `/ktv-api/queue/:queueItemId` | 条件 | ✓ | 取消/删除 |
| PATCH | `/ktv-api/queue/order` | ✗ | ✓ | 调整顺序 |
| POST | `/ktv-api/control/next` | ✗ | ✓ | 切歌 |
| POST | `/ktv-api/control/replay` | ✗ | ✓ | 重唱 |
| POST | `/ktv-api/control/toggle-play` | ✗ | ✓ | 暂停/播放 |

第一版状态同步可使用 1 秒轮询，优先简单可靠；稳定后升级 SSE/WebSocket。

---

## 15. UI 设计总则

### 15.1 设计关键词

- Glassmorphism
- Ambient Album Art
- Immersive Karaoke
- Calm Motion
- High Readability
- Touch First

设计重点不是“玻璃越透明越好”，而是让背景有氛围、前景信息仍保持高可读性。

### 15.2 视觉层级

1. **环境层**：专辑封面放大、模糊、渐变、暗化/亮化。
2. **玻璃层**：半透明面板、背景模糊、细边框、轻阴影。
3. **内容层**：高对比文字、按钮、标签。
4. **交互层**：Hover、Pressed、Focus、Loading、Toast。

---

## 16. 主题系统

### 16.1 模式

- `Auto`：跟随系统 `prefers-color-scheme`
- `Light`
- `Dark`

Web 端主题保存在浏览器 localStorage；桌面端保存在现有 settings。

### 16.2 Dark Glass 建议 Token

```text
--bg-base: #0B0D12
--bg-overlay: rgba(6, 8, 12, 0.52)
--glass-bg: rgba(20, 24, 33, 0.52)
--glass-bg-strong: rgba(20, 24, 33, 0.72)
--glass-border: rgba(255, 255, 255, 0.12)
--glass-highlight: rgba(255, 255, 255, 0.08)
--text-primary: rgba(255,255,255,0.94)
--text-secondary: rgba(255,255,255,0.68)
--text-tertiary: rgba(255,255,255,0.48)
--blur-panel: 24px
--blur-modal: 36px
--radius-card: 20px
--radius-control: 14px
```

### 16.3 Light Glass 建议 Token

```text
--bg-base: #F3F5F8
--bg-overlay: rgba(244, 247, 250, 0.44)
--glass-bg: rgba(255,255,255,0.58)
--glass-bg-strong: rgba(255,255,255,0.78)
--glass-border: rgba(20, 28, 40, 0.10)
--glass-highlight: rgba(255,255,255,0.72)
--text-primary: rgba(18,24,32,0.92)
--text-secondary: rgba(18,24,32,0.64)
--text-tertiary: rgba(18,24,32,0.44)
```

### 16.4 玻璃效果约束

- `backdrop-filter: blur(...)` 有性能代价，移动端不得在大量滚动卡片上重复使用超大 blur。
- 搜索结果列表卡片建议使用轻透明背景；主 Header、Bottom Sheet、Queue Panel 才使用强玻璃。
- 低性能设备提供 `reduced-transparency` 降级样式。
- 遵守 `prefers-reduced-motion`，减少背景动画。

---

## 17. 桌面 KTV 主舞台 UI

### 17.1 大屏布局（>= 1280px）

建议三段式：

```text
┌────────────────────────────────────────────────────────────────────┐
│ YesPlayMusic KTV       房间 5826        网络状态      QR/设置      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐        前一句歌词                         ┌─────┐ │
│  │              │     当前歌词（大号高亮）                 │队列 │ │
│  │    专辑封面   │        下一句歌词                         │ 6首 │ │
│  │              │                                          │     │ │
│  └──────────────┘                                          │     │ │
│   晴天 · 周杰伦                                             │     │ │
│                                                            └─────┘ │
├────────────────────────────────────────────────────────────────────┤
│  歌词 -0.3s    字号 44    [重唱]   [暂停]   [切歌]    下一首：江南 │
└────────────────────────────────────────────────────────────────────┘
```

### 17.2 主歌词视觉

- 当前句：最大字号、100% opacity、适度发光或背景渐变。
- 前后句：60–70% opacity。
- 当前句不要使用过度缩放动画，避免电视观看疲劳。
- 长句自动缩放或最大两行，禁止横向溢出。
- 翻译歌词作为次级行，字号 60–72%。

### 17.3 队列抽屉

右侧 Glass Panel：

- 当前播放
- 下一首突出显示
- 待唱列表
- 点歌人头像/设备昵称（第一版可用首字母圆形）
- 拖拽排序（Host）
- 删除
- 置顶

当屏幕宽度不足时切换成底部抽屉。

---

## 18. 点歌 Web UI：移动端

### 18.1 页面背景

- 当前歌曲封面作为环境背景。
- 使用 `cover -> blur(48~72px) -> scale(1.15)`。
- 上层增加深浅主题 overlay，避免歌词/搜索内容失去对比度。

### 18.2 顶部区域

```text
┌────────────────────────────┐
│  KTV · 房间 5826      ☼/☾  │
│  正在播放：晴天 · 周杰伦   │
└────────────────────────────┘
```

### 18.3 搜索

大号 Glass Search Bar：

- 高度建议 52–56px。
- 移动端全宽。
- 搜索时显示 clear button。
- 300ms debounce。
- 支持 Enter/搜索按钮。

### 18.4 搜索结果卡片

```text
┌────────────────────────────┐
│ [封面] 晴天                │
│        周杰伦 · 叶惠美     │
│        4:29  ✓ 可播放      │
│                   [点歌]   │
└────────────────────────────┘
```

点歌成功后按钮变为：

`已加入 · 第 5 首`

防止用户误以为没有成功而重复点击。

### 18.5 Bottom Navigation

移动端固定底部：

- 点歌
- 队列
- 正在播放

使用半透明玻璃底栏，并考虑 iPhone Safe Area：`env(safe-area-inset-bottom)`。

---

## 19. 点歌 Web UI：平板与 PC

### 19.1 Tablet（768–1199px）

- 左侧搜索结果 60%。
- 右侧当前播放 + Queue 40%。
- Bottom Nav 可改成顶部 Tab。

### 19.2 PC Web（>=1200px）

三栏：

```text
┌────────────┬──────────────────────────────┬─────────────┐
│ 当前播放   │ 搜索 / 搜索结果              │ 待唱队列    │
│ 封面       │                              │             │
│ 歌名       │                              │             │
└────────────┴──────────────────────────────┴─────────────┘
```

PC Web 仍是 Guest 端，不自动获得 Host 控制权限。

---

## 20. Web 交互状态设计

必须定义完整状态，避免只有“正常态”设计：

- 初次连接房间
- 房间已结束
- 电脑离线
- 搜索中
- 搜索无结果
- 搜索失败
- 可播放性检查中
- 点歌提交中
- 点歌成功
- 重复点歌提示
- 队列为空
- 网络断开重连
- Session token 失效

Toast 使用短反馈；需要用户动作的错误使用 Glass Alert/Bottom Sheet。

---

## 21. 响应式断点建议

```text
< 480px        小屏手机
480–767px      常规手机
768–1023px     平板/横屏手机
1024–1279px    小型 PC/平板横屏
>=1280px       桌面
>=1600px       大屏/电视优化
```

不要只根据宽度做响应式；KTV 主舞台应特别关注 16:9、超宽屏和 4K 缩放。

---

## 22. 可访问性与易用性

- 所有图标按钮必须有 aria-label/title。
- 文本与背景保持足够对比度。
- 不仅用颜色表示“可播放/不可播放”。
- Touch target 不小于 44x44px。
- Focus ring 不可移除。
- 支持键盘操作 Host 控制。
- 减少动画模式下取消大幅动态背景。
- 字号调整后布局不应截断主要歌词。

---

## 23. 技术架构建议

```text
Electron Main Process
│
├─ Existing Desktop Express : 127.0.0.1:27232
│
├─ KaraokeServer : 0.0.0.0:27233
│   ├─ Static Remote Web
│   ├─ /ktv-api/search
│   ├─ /ktv-api/queue
│   └─ /ktv-api/status
│
└─ IPC
    │
Renderer Process
│
├─ Existing Player.js
├─ KaraokeManager
├─ Karaoke Store/Module
├─ Karaoke Desktop View
└─ Lyrics View
```

重要原则：网络请求进入主进程后，不应通过不受控的 `executeJavaScript` 任意执行字符串。推荐使用明确 IPC channel，把 Host 控制和队列操作桥接给 Renderer/KaraokeManager。

---

## 24. 模块划分建议

在尽量不破坏原目录的前提下：

```text
src/
├─ karaoke/
│  ├─ KaraokeManager.js
│  ├─ KaraokeQueue.js
│  ├─ models.js
│  ├─ constants.js
│  └─ validators.js
│
├─ electron/
│  └─ karaoke/
│     ├─ KaraokeServer.js
│     ├─ network.js
│     ├─ auth.js
│     └─ routes/
│
├─ views/
│  └─ karaoke.vue
│
├─ components/
│  └─ karaoke/
│     ├─ KaraokeStage.vue
│     ├─ KaraokeQueuePanel.vue
│     ├─ KaraokeRoomPanel.vue
│     ├─ KaraokeControls.vue
│     └─ LyricSyncControl.vue
│
└─ remote/
   └─ karaoke-web/
      ├─ ...responsive web...
      └─ ...theme tokens...
```

最终结构由 Codex 根据实际构建链调整，但边界必须保持：业务层、HTTP 服务层、桌面 UI、远程 Web UI分离。

---

## 25. 状态同步

第一版建议以 `KaraokeManager` 为单一真相源。

桌面 UI：Vuex/响应式状态映射。  
KTV Server：通过受控 IPC/事件读取快照和提交动作。  
Web：轮询 `/status` + `/queue`。

升级阶段：

- SSE：服务端单向广播当前播放、队列变化，成本低。
- WebSocket：仅在需要多人实时互动、投票、抢麦等双向功能时引入。

---

## 26. 跨平台要求

### 26.1 Windows

首发开发和主验收平台。

关注：

- Windows Defender Firewall 首次开放端口。
- 多网卡/VPN 地址选择。
- 高 DPI 缩放。

### 26.2 macOS

必须从代码设计阶段保持兼容：

- 不写死 Windows 路径。
- 不依赖 PowerShell/ipconfig。
- 使用 Node `os.networkInterfaces()` 等跨平台 API。
- 文件路径使用 `path.join`。
- 不使用仅 Windows 支持的 Electron 能力作为核心链路。

正式 `.app/.dmg` 建议通过 macOS Runner 或真实 Mac 构建，并在公开发布时处理签名和 notarization。

---

## 27. 数据与隐私原则

- KTV Queue 默认只存在本机。
- Guest nickname/设备 ID 使用随机本地 ID，不要求注册账号。
- 不把局域网设备信息上传到第三方服务器。
- 不记录不必要的 IP 历史。
- Session 结束后可清理 Guest/token 数据。

---

## 28. 分阶段实施路线

### Phase 0：基线与协作机制

- Fork + clone。
- 确认 Windows 开发环境可运行。
- 记录原始 build/test 状态。
- 建立 `AI_WORKFLOW/`。
- 禁止无关格式化和依赖升级。

### Phase 1：歌词增强 + UI 设计系统 + KTV Shell

这是 Codex 第一轮任务，也是首次 GitHub 审查节点。

完成：

1. 连续歌词字号。
2. 歌词 offset。
3. Glassmorphism design tokens。
4. Light/Dark/Auto 主题基础。
5. 新增 K 歌模式入口与桌面 UI Shell。
6. 新增响应式 Remote Web UI Shell（可使用 mock 数据）。
7. 手机/平板/PC 三种断点可展示。
8. `AI_WORKFLOW` 记录完整。

**明确不做：**真实局域网服务器、真实点歌、真实队列控制。Phase 1 重点是验证不会破坏现有播放器，并确认视觉/状态基础。

### Phase 2：KaraokeManager 与真实临时队列

- Session。
- Queue model。
- 桌面队列管理。
- 切歌/重唱。
- Player 适配。
- 结束 Session。

### Phase 3：局域网 Karaoke Server

- 独立端口。
- IP 枚举。
- QR。
- Room token。
- Status/Queue API。
- Windows 防火墙使用说明。

### Phase 4：真实手机点歌

- 搜索。
- 多版本。
- 可播放性。
- 点歌。
- Guest 自己取消。
- 轮询状态同步。

### Phase 5：体验完善

- SSE。
- 动画和低性能降级。
- 队列拖拽。
- 连接异常恢复。
- macOS 测试和 CI build。

---

## 29. Phase 1 验收标准

### 29.1 功能

- 原播放器仍正常启动、搜索、播放、切歌。
- 普通歌词页字体可在规定范围连续调整。
- 歌词 offset 正负方向行为与 UI 文案一致。
- 设置重启后保留。
- K 歌入口可进入/退出，不影响正常播放。
- KTV Shell 显示当前歌曲/歌词区域/控制区域/Queue mock。
- Remote Web Shell 有搜索、结果、Queue、Now Playing 结构。

### 29.2 UI

至少人工检查：

- Desktop 1440x900
- Desktop 1920x1080
- Mobile 390x844
- Mobile 430x932
- Tablet 768x1024
- PC Web 1440x900

每个尺寸检查 Light/Dark；Auto 至少验证一次系统切换。

### 29.3 代码质量

- 不升级 Vue/Electron。
- 不新增大体积 UI 框架。
- 无硬编码 Windows 路径。
- 不把 `27232` 暴露到 LAN。
- 不引入真实 KTV API 之前先保持网络边界。
- 新状态和设置有默认值与迁移兼容。

---

## 30. 测试策略

### 30.1 回归

- Electron 启动。
- 登录/未登录基础路径。
- 搜索。
- 播放。
- 上一首/下一首。
- 进度 seek。
- 歌词加载/无歌词。
- 翻译歌词。
- 全屏歌词。

### 30.2 新功能

歌词 offset：-10、-0.5、0、+0.5、+10。  
字号：16、28、64。  
长歌词、双行翻译、纯音乐。  
KTV Shell 空队列与多条队列。  
Light/Dark。  
移动端竖屏/横屏。

### 30.3 后续网络测试

- 手机和电脑同 Wi-Fi。
- Wi-Fi + VPN。
- Windows 防火墙开启。
- 路由器 AP isolation 情况提示。
- Host 断网/睡眠/退出。
- 手机刷新页面/重新连接。

---

## 31. Git 与发布策略

建议：

```text
master / main       稳定主线
feat/ktv-phase-1    第一阶段
feat/ktv-phase-2    队列
feat/ktv-phase-3    LAN server
feat/ktv-phase-4    remote request
```

第一阶段不要直接合并主线，先 push 功能分支，由 ChatGPT 基于 GitHub 实际代码审查。

推荐 commit 粒度：

- `chore: establish ktv project workflow`
- `feat: add lyric timing offset setting`
- `feat: support continuous lyric font sizing`
- `feat: add karaoke desktop shell`
- `feat: add responsive karaoke remote shell`
- `docs: update AI workflow report for phase 1`

---

## 32. ChatGPT ↔ Codex 协作协议

仓库增加：

```text
AI_WORKFLOW/
├─ README.md
├─ PROJECT_STATE.md
├─ DECISIONS.md
├─ CHANGELOG.md
├─ TASKS/
├─ PROMPTS/
├─ REPORTS/
└─ REVIEWS/
```

### Codex 每轮完成后必须

1. 更新 `PROJECT_STATE.md`。
2. 写本轮 `REPORTS/CODEX_*.md`。
3. 列出真实修改文件。
4. 写运行过的命令和结果。
5. 写未完成/无法验证项目。
6. 更新 `CHANGELOG.md`。
7. commit 并 push 指定 GitHub 分支。

### ChatGPT 审查时

优先级：

1. GitHub 实际代码/commit。
2. 可运行测试结果。
3. `PROJECT_STATE.md`。
4. Codex report。
5. Codex 自述。

如果报告说“完成”但代码未实现，以代码为准。

ChatGPT 审查结果写入新的 `REVIEWS/CHATGPT_*.md`（当前阶段可由 ChatGPT生成文件后交给用户/Codex提交），并生成下一阶段 Prompt。

---

## 33. 关键风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 老 Electron/Vue 依赖 | 新环境构建问题 | 首期冻结依赖版本，功能稳定后独立升级 |
| 局域网服务暴露过多 | 安全风险 | 独立端口、最小 API、token、Host/Guest 分权 |
| 网易云搜索可见但不可播放 | 点歌失败 | 可播放性检查与明确 UI 状态 |
| 多网卡/VPN 选错 IP | 手机无法连接 | 自动评分 + Host 手动切换地址 |
| 玻璃效果移动端卡顿 | UI 卡顿耗电 | 减少大面积 blur、提供透明度降级 |
| KTV 队列与 Player 状态分裂 | 跳歌/重复 | KaraokeManager 作为单一真相源 |
| Windows-only 实现 | Mac 无法使用 | 跨平台 API、CI/macOS runner |
| 一次改造过大 | 难以审查 | 分 Phase，每阶段 push + GitHub 审核 |

---

## 34. 后续可扩展能力

在首版稳定后，可评估：

1. Demucs/MDX 离线伴奏分离。
2. 原唱/伴奏双轨切换。
3. 麦克风混音和监听。
4. 逐字歌词和卡拉 OK 进度染色。
5. 音高评分。
6. 多人投票置顶。
7. “下一位演唱者”机制。
8. PWA 安装。
9. Apple TV/Android TV 遥控模式。
10. 家庭 NAS 常驻 KTV Server。

这些能力必须在核心 KTV Session + Queue + LAN 结构稳定后再做。

---

# 附录 A：第一阶段用户可见页面清单

1. Settings / Lyrics：连续字号、歌词同步偏移。
2. Lyrics：同步快捷入口。
3. KTV Desktop Shell：大屏歌词、当前曲目、控制、Queue。
4. KTV Room Panel：二维码区域（Phase 1 可占位）。
5. Remote Mobile：Search。
6. Remote Mobile：Queue。
7. Remote Mobile：Now Playing。
8. Remote PC：三栏响应式布局。
9. Theme Switcher：Auto / Light / Dark。

# 附录 B：UI 组件建议

- `GlassPanel`
- `GlassButton`
- `ThemeSwitcher`
- `TrackSearchCard`
- `PlayabilityBadge`
- `QueueItem`
- `NowPlayingMiniCard`
- `KaraokeLyricStage`
- `LyricOffsetControl`
- `LyricFontSizeControl`
- `RoomQrCard`
- `ConnectionStatus`

不要为了这些组件引入完整第三方 UI 框架，优先本项目 SCSS + Vue 组件。

# 附录 C：完成定义（Definition of Done）

一个阶段只有同时满足以下条件才算完成：

- 功能代码存在且路径明确。
- 构建/运行结果已验证。
- 关键交互可以人工复现。
- 原核心功能没有明显回归。
- AI_WORKFLOW 报告与真实代码一致。
- 未完成事项显式记录，不用“理论上可行”代替实现。
- 已 push 到 GitHub 指定分支，可供 ChatGPT 独立审查。
