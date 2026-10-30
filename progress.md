# LumaSing 音频能量实时联动与互动优先级方案 实施进度 (progress.md)

更新时间：2026-10-27

## 1. 方案评估与架构确认 (已完成)
- 状态：已完成
- 核心结论：
  - `docs/ktv-music-reaction-plan.md` 中的功能设计完全可行。
  - **Gate A（音频兼容性与安全接入）**：`Player.js` 使用 Howler `html5: true` 播放且支持 `setSinkId` 输出设备切换。对同源/Blob/本地音频且未指定特殊 `sinkId` 的安全音源建立单例 `WeakMap<HTMLMediaElement, AudioTap>` 进行 20Hz 时频特征采样（RMS、低频能量与瞬态、能量上升趋势）；对网易云在线跨域 CDN 音源（`https://m*.music.126.net/...` 无 CORS 头），保持原播放链零侵入，自动通过 `extractLyricCadenceFeatures` 结合实时歌词时间轴、句间密度、前奏/间奏留白与歌曲段落计算实时律动能量包络与节拍脉冲。
  - **音乐状态控制器 (`src/karaoke/musicReactionAnalyzer.js`)**：实现起播 6.5 秒动态基准校准、1.5 秒同向状态确认窗口、4.5 秒最小情绪保持期与迟滞阈值（Hysteresis）、15 秒撒花大动作冷却、静音与暂停区分、切歌/拖动进度重置、以及“柔和 / 标准 / 热闹”三档敏感度控制。
  - **服务端互动调度器 (`src/karaoke/reactionScheduler.js` & `src/server/KaraokeWebHost.js`)**：实现单人连点原地替换（有他人排队时最多延长当前席位 1 次防饿死，排队中替换不额外占席位）、多人并发公平排队（最多 1 个展示 + 2 个等待，超出返回 `REACTION_QUEUE_FULL` 繁忙状态）、切歌自动清理旧歌曲待播/在播互动、以及发送者会话 ID 脱敏。
  - **主副屏同步与双层图层协调 (`ReactionOverlay.vue` 等)**：扩展 `presentation.musicReaction` 同步字段，常驻角色与前景人工互动分层展示，常驻角色底部实时显示当前律动情绪胶囊（如 `认真听你唱`、`跟着节奏摇摆`、`气氛起来了`、`全场高能`、`余韵回落`）并随节拍与状态切换触发弹跳/撒花；互动期间常驻角色平滑避让，互动结束后经 450ms 平滑恢复至此刻实时音乐状态。

## 2. 实施步骤清单 (全部完成)
- [x] 步骤 1：实现 `src/karaoke/musicReactionAnalyzer.js`（Gate A 音频安全检测、20Hz 特征提取、在线跨域音源歌词节奏能量提取 `extractLyricCadenceFeatures`、多样化阶段表情与陪伴台词轮换 `MUSIC_MOOD_DIALOGUES`、自适应基准、状态机迟滞与冷却、三档敏感度）
- [x] 步骤 2：实现 `src/karaoke/reactionScheduler.js` 并接入 `src/server/KaraokeWebHost.js` 与 `src/remote/main.js`（服务端公平排队、同人替换防饿死、切歌清理、手机端排队/繁忙反馈）
- [x] 步骤 3：扩展 `src/karaoke/lyricDisplay.js`、`src/views/karaoke.vue`、`src/views/karaokeWeb.vue`（主屏实时分析、状态与动态台词同步至副屏）
- [x] 步骤 4：升级 `src/components/karaoke/ReactionOverlay.vue`（新增「随节奏弹跳」开关且默认关闭、将「大小」改为 `72px–260px` 无级滑块、多样化阶段表情与说话胶囊 `.dock-mood-caption`、前景互动分层避让与按服务端时间轴调度）
- [x] 步骤 5：编写确定性单元测试与集成验证脚本 `scripts/test-music-reaction-linkage.js`，执行 ESLint、Prettier、全量回归测试与 Docker 生产构建，并写入 `docs/music-reaction-linkage-validation.md`
- [x] 步骤 6：建立软路由 SSH 免密密钥，将更新后的 `dist/` 静态资源与 `dist/ktv-server.cjs` 部署至软路由 (`192.168.100.1:18080`) 并完成健康检查验证

---

## 3. KTV 远端扫码点歌界面加载提速、常用歌手修复与点歌反馈优化 (已完成)

### 3.1 根因分析
1. **点歌界面各页签（推荐歌单、歌手点歌、我的歌单等）加载慢**：
   - `src/karaoke/webRoomBridge.js` 中主机 `loop()` 轮询间隔为固定 `1000ms`，且收到命令执行完成后未在当轮或立即回传 `outbox` 结果，导致每次目录请求（`hostCatalog`）在 Web/Docker 模式下产生 `1.0s ~ 2.0s` 的轮询空等延迟；歌单列表 + 歌单详情两次串行请求叠加后耗时达 `3s ~ 4s` 以上。
   - `src/electron/karaoke/KaraokeRemoteApi.js` 的 `KaraokeCatalogService` 仅缓存了单曲详情与可用性，对 `recommendations`、`recommendationTracks`、`toplists`、`toplistTracks`、`playlists`、`playlistTracks`、`artistSearch`、`artistTracks` 缺少内存 TTL 缓存与并发去重（Single-Flight），且歌单/歌手/推荐返回的歌曲未写入 `trackCache`，导致点击点歌时还需额外请求 `trackDetail`。
   - `src/electron/ipcRenderer.js` 的 `hostCatalog` 在拉取歌单详情时强制禁用缓存（`getPlaylistDetail(id, true)`），并在 `detail.playlist.tracks` 已返回完整曲目信息的情况下无条件再次调用 `getTrackDetail`；`recommendations` 调用 `getRecommendPlayList` 时串行遍历雷达歌单详情；`getUserPlaylistAllowlist` 未优先复用已加载的 Vuex `store.state.liked.playlists`；`src/api/artist.js` 的 `getArtist` 在未登录状态下即便 `/artists` 已返回完整 `hotSongs` 仍会二次请求 `getTrackDetail`。
2. **歌手点歌界面显示“常用歌手暂时无法加载，可使用下方搜索。”**：
   - `src/remote/main.js` 在 `bootstrap()` 建立 `client` 会话前就调用了 `initializeShell()`，且 `loadFeaturedArtists()` 在异常或返回空数组时也在 `finally` 中将 `featuredArtistsLoaded = true` 锁死，导致首次失败后切换页签不再重试。
   - `loadFeaturedArtists()` 同时发起 6 个并发 `/artists/search` 请求，穿透主机桥接层并发搜索容易触发限流或上游空结果，缺少内置常用歌手（周杰伦、林俊杰、邓紫棋、陈奕迅、薛之谦、杨宗纬）兜底数据。
3. **点击点歌后缺少快速跟手的“点歌成功”渐变消失提示**：
   - 原 `requestSong` 需等待服务端完成 `getTrack` + `availability` + `enqueue` 全部异步流程（耗时 1~2 秒）后才在页面最顶部更新 `.notice`（且动画长达 3.2 秒，页面滚动后不可见）。

### 3.2 改造进展
- [x] 优化 `src/karaoke/webRoomBridge.js`：缩短主机轮询周期（350ms 空闲 / 80ms 活跃），并在 `loop()` 执行命令生成 `outbox` 结果后立即回传，消除 1~2 秒空等延迟。
- [x] 优化 `src/electron/ipcRenderer.js`、`src/api/artist.js` 与 `src/electron/karaoke/KaraokeRemoteApi.js`：新增常用歌手兜底与缓存、复用歌单详情与歌手热门单曲已有曲目列表、增加 `KaraokeCatalogService` 目录级缓存与并发去重、将目录曲目自动写入 `trackCache`、点歌入队并行化 `getTrack` 与 `availability` 校验。
- [x] 优化 `src/remote/main.js`、`src/remote/styles.css` 与 `src/views/karaokeRemote.vue`：修复常用歌手加载与兜底展示、会话就绪后后台预热目录数据、新增点击点歌即刻触发的 0.92 秒快速跟手渐变消失浮动提示（“点歌成功”）。
- [x] 运行单元与集成测试及 ESLint 验证通过。

---

## 4. 常驻角色颜色自定义、点歌卡片精简与已播放历史修复 (2026-10-28 已完成并部署)
- [x] **常驻角色整体与眼睛颜色自定义**：
  - 在 `public/reactions/emotion-ball/js/engine.js`、`public/reactions/mood-mates/src/core/engine.js`、`public/reactions/mood-mates/src/core/render.js` 与 `src/components/karaoke/ReactionActor.vue` 中支持独立自定义整体身体色 (`bodyColor`) 与眼睛色 (`eyeColor`)（含亮亮 `twinkle` 瞳孔眼虹膜渐变动态变色）。
  - 在 `src/components/karaoke/ReactionOverlay.vue` 右键设置面板中新增「整体颜色」与「眼睛颜色」取色器及一键恢复「默认」按钮，并持久化到 `localStorage`。
- [x] **取消点歌列表中的“待检测”文字**：
  - 修改 `src/remote/main.js` 中的 `trackRequestMarkup`，当歌曲可用性状态为 `unknown` 时不再显示 `· 待检测`。
- [x] **修正“已播放”历史记录逻辑**：
  - 修改 `src/electron/karaoke/KaraokeRemoteApi.js` 中的 `state()` 接口，将已进入播放阶段但中途切歌 (`status === 'skipped'`) 的歌曲与完整播完 (`status === 'played'`) 的歌曲一同纳入 `history`（“已播放”列表），排除未播放即从等待队列删除 (`removed`) 或加载失败 (`failed`) 的条目，并同步更新 `scripts/test-karaoke-remote-api.js` 集成测试。
- [x] **新增全部 10 种登场方式（总计 13 种）并支持随机展示 6 种与折叠展开**：
  - 在 `src/karaoke/reactions.js`、`src/server/KaraokeWebHost.js`、`src/components/karaoke/ReactionActor.vue`、`src/components/karaoke/ReactionOverlay.vue` 中接入全部 13 种登场方式（原有的 `bounce`、`zoom`、`fade` 以及新增的 `spin` 旋转彩带、`firework` 烟花爆闪、`meteor` 流星滑入、`spotlight` 聚光降临、`sway` 左右摇摆、`spring` 弹簧冲刺、`carnival` 庆典狂欢、`peek` 惊喜探头、`heartbeat` 心跳律动、`vortex` 旋风瞬移）。
  - 在 `src/remote/main.js` 与 `src/remote/styles.css` 中实现每次进入点歌页随机洗牌并默认展示 6 种登场方式，其余 7 种默认折叠，点击「展开更多登场方式（7）」即可展开全部选项。
- [x] **修复软路由 Web 容器目录挂载句柄失效与清理旧 Docker 镜像**：
  - 定位并修复因 `rm -rf dist` 重建目录导致 `lumasing-web-1` 容器 bind mount inode 失效（返回 403/500）的问题，改为原位更新 `dist/*` 并恢复 `http://192.168.100.1:18080/` 与 `/karaoke` 正常访问（HTTP 200）。
  - 清理软路由上 7 个早期旧版 `lumasing-router-ktv` 镜像，仅保留最近 3 个版本（`0.4.10`、`before-music-reaction-20261027`、`before-reactions-v7-20261027`）。

---

## 5. 软路由本地歌单上传、按钮恢复及封面歌词显示验证 (2026-10-28 已完成并部署)
- [x] **上传本地周杰伦曲库至软路由**：
  - 将本地 `D:\APP\音乐\周杰伦` 目录（共 39 个文件：13 首 `.mp3`、13 个 UTF-8 `.lrc` 歌词文件、13 张 `.jpg` 封面图片）完整上传至软路由 `/mnt/mmc1-4/lumasing/local-music/周杰伦`，并在 `/mnt/mmc1-4/lumasing/compose.yml` 中挂载为 `ktv` 容器的 `/music`（默认配置 `/music/周杰伦` 为本地歌单目录）。
- [x] **恢复 Web/Docker KTV 模式下的“本地歌单”按钮与管理面板**：
  - 移除 `src/views/karaoke.vue` 中对“本地歌单”按钮与面板的 `v-if="isElectron"` 限制，接入 `src/karaoke/webRoomBridge.js` 与 `src/server/KaraokeWebHost.js` 的 `/ktv/local/*` 接口，支持在主屏直接查看本地歌单曲目缩略图、点歌/优先点歌、添加或移除服务器目录及重新扫描。
  - 在手机远端扫码点歌页 (`src/remote/main.js`) 顶部模块导航栏新增独立的「本地歌单」一级页签，并在本地歌曲卡片上展示封面缩略图。
- [x] **修复 Web/Docker 模式下本地歌曲播放、封面与同步歌词加载**：
  - 更新 `src/utils/Player.js` (`playKaraokeLocalTrack`、`_updateMediaSessionMetaData`、`_scrobble`) 与 `src/views/karaoke.vue` (`loadLyrics`)，支持浏览器通过 `/ktv/local/resolve/:id`、`/ktv/local/audio/:id`（支持 HTTP 206 Range）与 `/ktv/local/cover/:id` 流式播放本地音频并即时渲染封面与 `.lrc` 同步歌词。
  - 经无头浏览器端到端实测验证：主控台与手机端均正常显示 13 首周杰伦本地歌曲及 `500x500` `.jpg` 封面，点播《晴天》等曲目后主舞台与副屏均正常显示封面及 42 行同步滚动 `.lrc` 歌词。

---

## 6. 本地歌词字幕信息全面修复与软路由同步覆盖 (2026-10-28 已完成并通过 ego-browser 实测)
- [x] **本地 13 首周杰伦 `.lrc` 文件逐一排查与元数据信息补全**：
  - 逐一检查 `D:\APP\音乐\周杰伦` 目录下全部 13 个 `.lrc` 文件的前后时间轴及内容：
    1. 《一路向北》：前奏 34.5 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（蔡科俊）、制作人（周杰伦）、电影《头文字D》插曲。
    2. 《七里香》：前奏 27.3 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（钟兴民）、制作人（周杰伦）。
    3. 《以父之名》：前奏 86.6 秒，补全歌名、作词（黄俊郎）、作曲（周杰伦）、编曲（洪敬尧）、制作人（周杰伦），以及前奏完整意大利语祷告念白与中文字幕（Ave Maria, grazia ricevuta per la mia famiglia 等）。
    4. 《反方向的钟》：前奏 44.9 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（周杰伦）、制作人（周杰伦），以及经典的注音符号倒数前奏（ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏ）。
    5. 《听妈妈的话》：彻底剔除原有广告水印（`[00:00.56] 无左无右：246115905`），在前奏 4.25 秒人声起唱前补全歌名、作词（周杰伦）、作曲（周杰伦）、编曲（林迈可 / 洪敬尧）、制作人（周杰伦）。
    6. 《夜曲》：前奏 24.6 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（林迈可）、制作人（周杰伦）。
    7. 《我是如此相信》：前奏 36.5 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（黄雨勋）、制作人（周杰伦）、电影《天火》主题曲。
    8. 《明明就》：前奏 19.4 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（黄雨勋）、制作人（周杰伦）。
    9. 《晴天》：前奏 29.3 秒，补全歌名、作词（周杰伦）、作曲（周杰伦）、编曲（周杰伦）、制作人（周杰伦）、吉他（蔡科俊）。
    10. 《稻香》：前奏 31.0 秒，补全歌名、作词（周杰伦）、作曲（周杰伦）、编曲（黄雨勋）、制作人（周杰伦）。
    11. 《简单爱》：规范化补充制作人（周杰伦），保持与词（徐若瑄）、曲（周杰伦）、编曲（林迈可）统一规整。
    12. 《给我一首歌的时间》：前奏 17.5 秒，补全歌名、作词（周杰伦）、作曲（周杰伦）、编曲（林迈可）、制作人（周杰伦）。
    13. 《说好的幸福呢》：前奏 22.1 秒，补全歌名、作词（方文山）、作曲（周杰伦）、编曲（钟兴民）、制作人（周杰伦）。
  - 执行 `KaraokeLocalLibrary.js` 的 `parseLrc` 验证：13 首歌曲共解析 710 行歌词，时间戳递增严格单调，0 语法/时间错误。
- [x] **全量覆盖软路由物理文件并触发歌单重新索引**：
  - 编写并执行管道传输脚本 `scripts/upload-jay-lyrics.cjs`，将全部 13 个修复后的 UTF-8 `.lrc` 文件完整覆盖至软路由物理路径 `/mnt/mmc1-4/lumasing/local-music/周杰伦/`。
  - 调用 `POST /ktv/local/scan` 接口强制刷新索引，软路由成功完成重新索引与解析，`/ktv/local/list` 与 `/ktv/local/resolve/:id` 均即时返回带完整报头信息的歌词数据。
- [x] **遵循规范通过 ego-browser (ego lite) 执行全流程端到端播放验证**：
  - 使用 `ego-browser nodejs` 启动真实环境自动化测试（遵循用户指引严格采用 ego lite 工具，并在测试完毕后调用 `task.finish({ keep: [] })` 彻底关闭任务空间与浏览器进程）。
  - 在主控台先后点播并切换《听妈妈的话》、《以父之名》、《一路向北》、《反方向的钟》：
    - 实测证明：歌曲起播瞬间前奏阶段，主舞台 `.active-line` 正确展示歌名与周杰伦署名，`.after-line` 依次平滑滚动展示作词、作曲、编曲、制作人及前奏念白，人声起唱时无缝衔接第一句唱词；《听妈妈的话》原广告水印已彻底清除。
