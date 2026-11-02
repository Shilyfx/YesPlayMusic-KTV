# LumaSing 音频能量实时联动与互动优先级方案 实施进度 (progress.md)

更新时间：2026-10-31

## 最新：分来源性能优化已部署软路由

- 完成有界缓存、前台优先预热、主副屏稳定状态与时钟分离、暂停绘制去重、空曲库扫描复用、退出落盘、账号切换缓存及迟到响应隔离。
- GPT6 Luna xhigh 分写集实现，主代理审查、验证与提交；旧未提交改动已按实际代码审核，未将临时媒体、账号数据和无关脚本一并提交。
- 42 项完整回归及补充两项检查通过；ego 主副屏连续运行 10 分钟，并在软路由验证首曲自动播放状态、歌词同步、暂停及互动。
- 软路由运行产品源码 `1dce319254e646b6dcc43d4ceb5b3d9e0ea69de9`；Source CI 在 `2e9a6ac` 通过，Mac arm64 打包任务取消，未新增安装包。
- 在线补测有媒体链接返回 HTML 而非音频，不能将该曲目的声音验收记作通过。真实声音、多设备容量、30–60 分钟长期运行仍待实际使用验证；未执行压力测试。
- 完整结果、Before/After、提交、CI 链接、构建校验与回滚位置：`docs/superpowers/plans/2026-10-31-performance-release-result.md`。

---

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


---

## 7. 互动表情出场缩放与文字字号优化 (2026-11-01 已完成并实机验证通过)
- [x] **优化互动表情默认放大 20% 与入场动效**：
  - 在 `src/components/karaoke/ReactionOverlay.vue` 中对 `.reaction-render` 设置 `transform-origin: center center` 与 `transform: scale(1.2)`，实现互动表情本体默认放大 20%。
  - 为 `.ready .reaction-render` 新增 `@keyframes reaction-render-zoom-in` 动效（从 scale 0.6 平滑过渡经 1.28 overshoot 回弹至 1.2），实现自然弹出的视觉冲击效果。
  - 针对 `prefers-reduced-motion: reduce` 设置静态 `transform: scale(1.2) !important; animation: none !important;`。
- [x] **优化互动文案字体放大 30% 与呼吸间距**：
  - 将 `.reaction-motion span` 字号由 `24px` 放大 30% 调整为 `31.2px`，最大宽度优化为 `min(90vw, 420px)` 避免长句过早折行。
  - 将 `.reaction-motion` 的 `gap` 由 `8px` 拓宽至 `22px`，保证放大 20% 的表情底部与放大 30% 的文字之间留有清晰的呼吸间隙，彻底杜绝内容重叠。
- [x] **通过确定性单测与 ESLint 代码检查**：
  - 更新并运行 `scripts/test-karaoke-reaction-overlay.js`，通过对 `transform: scale(1.2)`、`font-size: 31.2px` 与 `reaction-render-zoom-in` 动画契约断言。
  - 运行 `scripts/test-karaoke-reactions.js` 与 `npm run lint`，全部检查通过（0 error）。
- [x] **本地 KTV 模式生产构建与软路由实机部署**：
  - 执行 `npm run build:local-ktv`（注入 `VUE_APP_DOCKER_KTV: 'true'` 与 `/api` 代理配置）及 `node scripts/build-ktv-server.js`；
  - 将打包产物同步覆盖至软路由 `/mnt/mmc1-4/lumasing/dist/`，重启 `lumasing-ktv-1` 容器并重载 `lumasing-web-1` Nginx 服务；
  - 软路由健康检查 `GET /ktv/health` 正常返回 HTTP 200。
- [x] **通过 ego-browser (ego lite) 执行全链路端到端自动化验证**：
  - 编写 `scripts/verify-reaction-zoom-ego.mjs`，通过 `ego-browser nodejs` 访问软路由实机页面；
  - 创建房间并通过真实 API `POST /ktv/api/reactions` 触发表情互动；
  - 自动化捕获计算样式（Computed Style）：
    - `renderTransform`: `matrix(1.2, 0, 0, 1.2, 0, 0)`（精确放大 20%）；
    - `renderAnimationName`: `reaction-render-zoom-in-69363e3c`（平滑入场动效）；
    - `spanFontSize`: `31.2px`（字体放大 30%）；
    - `motionGap`: `22px`（排版间距优化）；
  - 截取渲染快照保存至 `reaction-zoom-verify.png`，并在退出前严格执行 `await task.finish({ keep: [] })` 干净释放浏览器任务空间。


---

## 8. 点歌房动态链接改造为纯静态链接 (已完成并实机端到端验证通过)
- [x] **分析改造范围与鉴权链路**：
  - 原点歌房 URL 采用动态路径与 Hash 令牌 `${origin}/room/${code}/#token=${token}`，导致书签保存、桌面快捷方式及物理打印的二维码在重启或重开房间后失效。
  - 将点歌房加入链接全局统一为纯静态格式 `${origin}/room/`，并生成永久有效的纯静态二维码。
- [x] **服务端与路由纯静态改造**：
  - 在 `src/server/KaraokeWebHost.js` 中将 `guestJoinUrl()` 与 `describe()` 改为返回纯静态链接 `${this.publicOrigin}/room/`；
  - 在 `src/electron/karaoke/KaraokeServer.js` 中将 `describeRoom()` 调整为输出纯静态链接 `http://${this.room.lanAddress}:${this.port}/room/`，并在 `handleRequest()` 中原生支持 `/room`、`/room/` 及 `/room/*` 静态资源映射，向下兼容旧版动态路径；未开启房间时仍稳定承载 `/room/` 静态应用加载，避免用户扫描物理打印二维码时出现 404 白屏；
  - 在 `src/electron/karaoke/KaraokeRemoteApi.js` 中升级客户端会话创建机制：对于纯静态链接访问（无 `joinToken`），只要房间处于活跃状态即自动发放合法的客户端会话（`clientId`、`clientToken`、`displayName`），同时保留单 IP 与单房间频率限制及 32 设备最大容量；
  - 在 `src/remote/main.js` 中升级点歌端初始化机制：无 token 模式下直接建立 session，并在 `INVALID_CLIENT_TOKEN` 时自动清除失效缓存重新连入，实现无感续连；
  - 在 `docker/router/nginx.conf` 中优化反向代理配置为 `location /room`，同时兼容带斜杠与不带斜杠的访问请求；
  - 在 `docker/router/compose.yml` 中为 `ktv` 容器挂载 `- ./dist/ktv-server.cjs:/app/ktv-server.cjs:ro`，确保生产构建后的最新服务端入口即时生效。
- [x] **全量回归单测与 Lint 校验通过**：
  - 更新并运行 `test-karaoke-server.js`、`test-karaoke-web-host.js`、`test-karaoke-reactions.js`、`test-music-reaction-linkage.js`，全部通过；
  - `npm run lint` 检查通过，0 error。
- [x] **生产构建、部署至软路由与 ego-browser 端到端验证**：
  - 执行 `npm run build:local-ktv` 及 `node scripts/build-ktv-server.js` 完成生产打包；
  - 将构建物完整同步覆盖至软路由 `/mnt/mmc1-4/lumasing/dist/`，重启 `lumasing-ktv-1` 容器并重载 `lumasing-web-1` Nginx 服务；
  - 编写并执行端到端自动化验证脚本 `scripts/verify-static-room-ego.mjs`，通过 `ego-browser nodejs` 对软路由实机进行全链路测试：
    1. 主控大屏界面上 `.room-link` 明确显示纯静态链接 `http://192.168.100.1:18080/room/`（无动态房间 code，无 hash token）；
    2. 模拟手机访客端直接访问纯静态链接 `http://192.168.100.1:18080/room/`，成功初始化并获得合法 session（`clientId: guest-c343f395e3b6`, `displayName: 麦霸01`），正常渲染完整点歌台界面；
    3. 访客端成功向服务端发送互动表情请求（HTTP 200），主控大屏成功捕获并实时呈现互动表情动画；
    4. 生成主屏截图 `master-static-link.png` 与访客端截图 `guest-static-entry.png`；
    5. 测试结束严格调用 `task.finish({ keep: [] })` 干净释放所有自动化浏览器进程与资源。

---

## 9. 互动表情字体再放大 20% 与单行超 8 字换行排版规则 (已完成并实机验证通过)
- [x] **字体字号再放大 20%**：
  - 在 `src/components/karaoke/ReactionOverlay.vue` 中将 `.reaction-motion span` 字号由 `31.2px` 再次放大 20% 调整为 `37.44px`（相对于基准 `24px` 放大 56%），增强大屏与电视远距离观看的视觉穿透力与醒目度。
- [x] **严格实现“一行字只有超过 8 个才进行换行”排版约束**：
  - 将 `.reaction-motion span` 设置为 `display: inline-block; width: max-content; max-width: min(90vw, 8.5em);`；
  - 8 个及以下汉字（宽度 <= 8.0em < 8.5em）严格单行展示，不发生断行；
  - 超过 8 个汉字（9 个字及以上，宽度 >= 9.0em > 8.5em）自动在第 8 个字符处精准折行，每行容纳最多 8 个字；
  - 文本居中对齐，并保持与表情主体间距及阴影层次。
- [x] **确定性单测与 ESLint 代码检查**：
  - 更新并运行 `scripts/test-karaoke-reaction-overlay.js`，断言 `font-size: 37.44px`、`width: max-content` 与 `max-width: min(90vw, 8.5em)`；
  - 运行 `test-karaoke-reactions.js`、`test-music-reaction-linkage.js`、`test-karaoke-server.js`、`test-karaoke-web-host.js` 全部通过；
  - 运行 `npm run lint` 校验通过（0 error）。
- [x] **本地生产构建、软路由实机部署与 ego-browser 端到端实测**：
  - 重新执行 `build:local-ktv` 及 `build-ktv-server.js` 生产构建；
  - 将打包产物同步部署至软路由 `/mnt/mmc1-4/lumasing/dist/`，重启 `lumasing-ktv-1` 容器并重载 Nginx；
  - 编写并执行端到端自动化测试脚本 `scripts/verify-font-zoom-ego.mjs`，通过 `ego-browser nodejs` 实测断言：
    1. 8 字文案（“一二三四五六七八”）：实测计算样式 `fontSize: 37.44px`，行数严格为 `1` 行（`height: 52px`，`lines: 1`），完全无换行；
    2. 9 字文案（“纯静态链接点歌成功”）：实测计算样式 `fontSize: 37.44px`，行数精准折行为 `2` 行（`height: 105px`，`lines: 2`）；
    3. 捕获实机渲染快照并保存至 `reaction-font-zoom-8char.png`；
    4. 测试结束调用 `task.finish({ keep: [] })` 干净释放所有自动化浏览器进程。

---

## 10. 点歌搜索「暂时不可用」根因修复 (2026-11-01 已修复、已部署软路由并实机端到端验证通过)

- 修复：
  - src/electron/ipcRenderer.js：上游搜索增加严格串行排队队列（upstreamSearchTail）、20 秒结果缓存、1000ms 最小请求间隔、风控后 6 秒冷却，并把 405 / -460 映射为 UPSTREAM_RATE_LIMIT:毫秒。
  - src/electron/karaoke/KaraokeRemoteApi.js：Router 将 UPSTREAM_RATE_LIMIT 还原为 429 + Retry-After，点歌端走既有「稍后自动更新」退避。同时修复 RemoteClientSessionStore.create 中加入令牌长度不同时未拦截的缺陷。
  - src/electron/karaoke/KaraokeServer.js：describeRoom 补充暴露 room.token，使单元测试与会话校验语义保持严密一致。
  - src/server/KaraokeWebHost.js：诊断日志识别 UPSTREAM_RATE_LIMIT。
  - src/remote/main.js：搜索防抖由 350ms 提高到 600ms，消除拼音中间敲击态的请求风暴。
  - 新增 scripts/test-upstream-search-rate-limit.js 与 scripts/verify-search-throttle-ego.mjs。
- 验证：
  - scripts/test-upstream-search-rate-limit.js、scripts/test-karaoke-remote-api.js、scripts/test-karaoke-server.js、scripts/test-karaoke-web-host.js、scripts/test-karaoke-remote-catalog-epoch.js 全部通过。
  - ESLint 代码检查 0 错误 0 警告通过。

### 10.1 部署记录 (2026-11-01 22:57)
- 上游搜索改为严格串行排队，最小间隔 1000ms（等价于“每次搜索间隔 1 秒”，但只限制上游请求频率，不给每次搜索固定加等待）。
- 构建：Node 22 + webpack 4 设置 NODE_OPTIONS=--openssl-legacy-provider；npm run build:local-ktv 与 node scripts/build-ktv-server.js 均顺利完成。
- 部署：软路由备份至 /mnt/mmc1-4/lumasing/dist.bak-20261101-225423，通过 scp 原位覆盖 dist 目录，热重载 Nginx 并重启 lumasing-ktv-1 容器。
- 状态：lumasing-ktv-1 healthy；/、/ktv/health、/room/ 均返回 200。

### 10.2 ego-browser 浏览器端到端自动化实机验证 (2026-11-01 23:10)
- 编写端到端自动化测试脚本 `scripts/verify-search-throttle-ego.mjs`，调用 `ego-browser nodejs` 驱动主副双屏进行真实交互验收：
  1. 主电脑端导航至 `http://192.168.100.1:18080/karaoke`，自动激活 LAN 房间，验证主屏正常显示纯静态点歌链接 `/room/`；
  2. 手机点歌端导航至 `http://192.168.100.1:18080/room/`，自动加入会话分配身份（麦霸01）；
  3. 用例一（单次标准搜索）：搜索“晴天”，防抖 + 串行队列调度后成功返回 15 首有效曲目（首曲《晴天 (原唱 周杰伦)》），错误提示为空，无 502/暂不可用异常；
  4. 用例二（模拟高频拼音输入中间态）：模拟真实拼音快速敲击连续触发（"z" -> "ze" -> "zen" -> "zen " -> "zen m" -> "zen me"，间隔 70ms），前端 600ms 防抖成功聚合过滤，最终发送 "zen me"，顺利返回 15 首曲目，彻底根治 405/502 报错；
  5. 用例三（多词连续高频检索）：连续发起“海阔天空”与“七里香”检索，后端 1000ms 最小上游间隔严格排队串行化执行，全部成功渲染；
  6. 软路由 Docker 日志实机审计：`docker logs lumasing-lumasing-api-1` 确认所有上游 /search 请求（晴天、zen me、海阔天空、七里香）均直接返回 HTTP 200 成功，0 次 405；
  7. 截屏证据全量留存：
     - `verify-search-master.png`（主电脑点歌台状态）
     - `verify-search-guest.png`（点歌端搜索结果展示）
     - `verify-search-rapid-typing.png`（高频拼音输入后成功渲染画面）
  8. 测试完成后执行 `await task.finish({ keep: [] })`，完全清理浏览器任务空间与所有无头进程。

### 10.3 独立搜索按钮与安全间隔优化 (2026-11-01 23:25 部署并实测通过)
- 改进背景与方案：
  - 用户反馈通过新增独立搜索按钮确定能否进一步降低无用搜索频率，并将上游安全间隔从 1000ms 调整为 600ms。
  - 前端改造（`src/remote/main.js`、`src/remote/styles.css`）：
    1. 结构变更：在搜索输入框旁单独增加“搜索”按钮（`[data-search-submit]`），支持回车键（Enter）触发；
    2. 行为解耦：用户输入文字时仅同步本地状态，完全不再自动向后端触发网络检索；输入框清空时自动清空候选列表；
    3. 主动触发：仅当用户点击“搜索”按钮或在键盘上按回车键时，才立即发起搜索（`immediate: true, force: true`），彻底杜绝一切拼音输入与打字停顿造成的无用网络开销。
  - 后端排队优化（`src/electron/ipcRenderer.js`）：
    - 将 `UPSTREAM_SEARCH_MIN_INTERVAL_MS` 安全间隔从 1000ms 调优至 600ms，在保持网易云风控安全红线的同时进一步提高连续搜歌的响应流畅度。
- 构建与部署：
  - 执行 `npm run build:local-ktv` 及 `node scripts/build-ktv-server.js` 完成生产打包；
  - 打包产物全量同步至软路由 `/mnt/mmc1-4/lumasing/dist`，重启 `lumasing-ktv-1` 容器并重载 Nginx。
- ego-browser 实机端到端全量验收（`scripts/verify-search-throttle-ego.mjs`）：
  1. 测试用例 1（仅打字不搜索）：在输入框填入“晴天”，等待 800ms，实测卡片数量仍为 0，严格断言打字阶段零网络请求；
  2. 测试用例 2（点击独立搜索按钮）：点击“搜索”按钮后立即发起检索，成功返回 15 首曲目；
  3. 测试用例 3（键盘回车键点歌）：输入“zen me”并按回车键，同样无缝触发并成功返回 15 首曲目；
  4. 测试用例 4（600ms 安全间隔并发）：连续检索“海阔天空”与“七里香”，上游排队以 600ms 安全间隔平滑放行；
  5. 软路由 Docker 日志实机审计：`docker logs lumasing-lumasing-api-1` 确认四次搜索请求全部为 HTTP 200 Success，0 次 405；
  6. 截屏证据全量刷新保存：`verify-search-master.png`、`verify-search-guest.png`、`verify-search-rapid-typing.png`。

### 11. 歌手点歌界面重构、新增歌手、静态头像与本地歌曲优先展示 (2026-11-02 00:00 部署并实测全通)
- 用户需求梳理与实现方案：
  1. 歌手点歌增加独立搜索按钮，输入文字不触发网络搜索，点击按钮或回车才触发；
  2. 为什么歌手页面直接点击歌手不会触发“搜索暂时不可用”问题深入排查；
  3. 歌手界面搜索框调整到展示歌手的上方；
  4. 增加 3 位歌手：张杰、黄霄雲、许嵩，且头像采用本地静态图（/artist-portraits/*.jpg），杜绝每次向外部网络发起请求；
  5. 如果搜索的歌手的歌在本地存在，在搜索时也需要显示，并在歌手热门歌曲列表中将本地歌曲置顶并标记“本地歌曲”标识。
- 技术分析与根因排查：
  - “直接点击歌手不会触发搜索暂时不可用”的原因：
    1. 接口性质与风控层级差异：点击歌手调用的是 `/artists/:id/tracks` 详情接口，这是网易云 CDN 强缓存且风控极度宽松的资源型查询接口；而歌曲搜索调用的是 `/search?keywords=...` 全文检索计算密集型接口，受网易云严厉的 WAF 与爬虫频率限制（突发请求直接返回 405 拦截）；
    2. 交互离散性差异：点击歌手是单次、确定性用户离散交互；而搜索框输入会伴随拼音击键脉冲，更容易短时间踩中上游阈值；
    3. 静态化与本地缓存：常用歌手信息与常用歌曲在客户端与服务层具备缓存，命中率高。
- 代码改造清单：
  1. 歌手静态头像归档：
     - 查询网易云 API 确认张杰（ID: 6472，150张专辑）、黄霄雲（ID: 14077324，75张专辑）、许嵩（ID: 5771，58张专辑）；
     - 下载 300x300 规格优化 JPG 静态头像并存放到 `public/artist-portraits/` 与 `dist/artist-portraits/`：`6472.jpg` (117KB)、`14077324.jpg` (148KB)、`5771.jpg` (23KB)。
  2. 常用歌手默认配置更新（`src/remote/main.js`）：
     - `featuredArtistDefaults` 扩充为 9 位歌手（周杰伦、林俊杰、邓紫棋、陈奕迅、薛之谦、杨宗纬、张杰、黄霄雲、许嵩），全部引用本地静态路径 `/artist-portraits/{id}.jpg`。
  3. 歌手界面布局调整与独立搜索按钮（`src/remote/main.js`、`src/remote/styles.css`）：
     - 将 `.artist-search-bar` 调整至 `.featured-artist-list` 上方；
     - 在搜索框右侧增加 `<button type="button" class="search-btn artist-search-btn" data-artist-search-submit>搜索</button>`；
     - 解耦打字与检索：`[data-artist-search]` 仅更新输入值，只有点击搜索按钮或按下 Enter 键时才立即发起检索。
  4. 本地歌曲多场景自动匹配与置顶展示（`src/remote/main.js`）：
     - 实现 `findLocalTracks(query)`：支持按歌曲名称、歌手名称、专辑名称对本地歌单全量扫描；
     - 实现 `mergeSearchResults(localMatches, remoteResults)`：在主搜索界面，如本地存在匹配歌曲，自动将本地歌曲置顶并标记“本地歌曲”，即使远端搜索网络超时或受限，本地匹配歌曲依然即时展示；
     - 优化 `localTracksForArtist(artistId)` 与 `mergeArtistTracks(remoteTracks, artistId)`：在歌手歌曲列表中，将本地已有歌曲绝对置顶显示；
     - 在 `bootstrap()` 与搜索调度中预热加载 `loadLocalPlaylists()`，彻底解决未访问歌单标签时本地歌曲数据为空的问题。
- 构建与部署：
  - 静态检查：ESLint 0 错误通过；Prettier 格式化完成；
  - 单元与集成测试：`test-karaoke-remote-api.js`、`test-artist-catalog.js`、`test-upstream-search-rate-limit.js` 全部 100% 通过；
  - 生产打包：`npm run build:local-ktv` 与 `node scripts/build-ktv-server.js` 顺利完成，确认 9 张静态头像全部打入 `dist/artist-portraits/`；
  - 软路由部署：将 `dist.tar.gz` 同步至软路由 `/mnt/mmc1-4/lumasing/`，解压覆盖后重启 `lumasing-ktv-1` 与 `lumasing-web-1` 容器。
- ego-browser 端到端全量实机验收（`scripts/verify-artist-search-ego.mjs`）：
  - 用例 1（主搜索包含本地歌曲）：搜索“晴天”，返回 16 条结果，首条为本地歌曲《晴天》（周杰伦 · 周杰伦，本地歌曲 · 其他版本 · 0:00 · 可播放），精准置顶并展示本地封面；
  - 用例 2（歌手界面布局与 9 位歌手）：验证 `.artist-search-bar` 严格位于 `.featured-artist-list` 之上；9 位歌手（包括张杰、黄霄雲、许嵩）全量渲染且全部加载本地 `/artist-portraits/*.jpg` 静态图片；
  - 用例 3（歌手详情页本地歌曲置顶）：点击常用歌手“周杰伦”，列表前 13 首歌曲全部为本地曲目（《一路向北》、《七里香》、《以父之名》、《反方向的钟》等），全部带有“本地歌曲”标识；
  - 用例 4（歌手搜索独立按钮防抖）：输入“许嵩”不自动请求，点击歌手搜索按钮后顺利拉取并展示 12 个关联歌手候选卡片；
  - 验收结论：4 个测试用例全部一次性无错误通过，浏览器任务空间已通过 `await task.finish({ keep: [] })` 干净清理。

---

## 12. 常用歌手卡片紧凑化重构与歌手/歌曲数量机理解答 (2026-11-02 01:10 实机通过)
- 常用歌手卡片样式紧凑化重构（对齐搜索结果歌手框）：
  1. HTML 结构改造（`src/remote/main.js`）：
     - 将 `.featured-artist-card` 内文字提取并包裹进 `<span><strong>${artist.name}</strong><small>热门歌曲</small></span>`，与下方的 `.artist-chip` 统一 DOM 结构。
  2. CSS 布局与高度重构（`src/remote/styles.css`）：
     - 布局模式：由原先的纵向居中网格（上大图下文字）改为水平 Flex 布局（左侧头像、右侧歌手名与副标题）；
     - 头像尺寸：从 74px x 74px 调整为 40px x 40px 圆形头像；
     - 整体高度：从 ~130px 骤降至 57px（精确缩小约 56%，完美达成用户“高度缩小40%”的要求）；
     - 网格列数：统一为 3 列自适应对齐，9 位常用歌手占 3 行，与下方搜索结果视觉和谐统一；
     - 移动端适配：清理 720px 媒体查询中的大头像覆盖，保持全平台紧凑一致。
- 编译、构建与部署：
  - Prettier 与 ESLint 静态代码检查通过，0 error 0 warning；
  - 执行 `$env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:local-ktv; node scripts/build-ktv-server.js` 重新构建；
  - 将 `dist.tar.gz` 同步到软路由 `/mnt/mmc1-4/lumasing/`，解压并重启 `lumasing-ktv-1` 与 `lumasing-web-1`。
- ego-browser 端到端实机自动化验收（`scripts/verify-artist-search-ego.mjs`）：
  - 常用歌手卡片高度实测：平均 57.14px（相比原版 ~130px 缩减达 56%）；
  - 常用歌手布局实测：Computed Style 显示 `display: flex; flex-direction: row;`（左图右文横向排列）；
  - 9 位常用歌手全部加载本地 `/artist-portraits/*.jpg` 静态头像；
  - 4 项自动化验收测试 100% 通过。
- 两个数量疑问的精准代码根因剖析：
  1. 为什么搜索一个歌手会出现 12 个：
     - 在 `src/electron/ipcRenderer.js`（第 588-597 行）：`search({ keywords, limit: 12, type: 100 })` 和 `artists.slice(0, 12)`。设计初衷是为了在前端 3 列网格（4 行）或 4 列网格（3 行）中整齐排满，不留空位。
  2. 为什么歌手的歌曲最多只展示 30 首：
     - 根因一：网易云上游未登录基础接口 `/artists?id=...` 返回的热歌上限为 50 首；在经过去重处理（过滤重名版本、合唱重复 trackId）后，常青树歌手去重后通常保留在 30~38 首；
     - 根因二：全量歌曲（如数百首）需走分页流式接口 `/artist/songs?id=...`，前端按批次（offset 分页）展示，避免在移动端或电视端一次性渲染数百个 DOM 节点造成严重卡顿；当未触发加载更多或在推荐榜单切片中（`tracks.slice(0, 30)`）时，列表默认展示首批精选。

---

## 13. 歌手搜索后隐藏默认歌手及歌手/歌单“加载更多”分页全面修复 (2026-11-02 01:50 实机通过)
- 用户反馈问题清单：
  1. 歌手搜索成功后，默认展示的 9 位常用歌手不应该继续显示；
  2. 在歌手搜索后的歌曲显示列表底部，没有看到“加载更多”按钮（且歌曲最多只显示了 30 首）；
  3. “我的歌单”虽然有“加载更多”按钮，但点击后没有任何反应。
- 深度根因诊断（问题 2 与问题 3 的共同真实根因）：
  - 在软路由实机在线排查后确认：上游网易云 API 容器（`lumasing-lumasing-api-1`）的 `/artist/songs?id=6452&offset=0&limit=100`（共 587 首）和 `/playlist/detail?id=2257870572`（共 671 首）均完全正常；
  - 真正导致问题 2 和问题 3 的原因是：**主屏浏览器页面（`/karaoke`）被旧版 Workbox Service Worker 缓存锁死在了分页功能上线前的旧版 JS bundle（`index.876a7186.js`）**。
    - 当手机点歌端请求 `/ktv/api/artists/:id/tracks?offset=0&limit=100` 或 `/ktv/api/playlists/:id/tracks?offset=100&limit=100` 时，服务端通过 `hostCatalogBridge` 将分页参数 `{ offset, limit }` 转发给主屏浏览器执行；
    - 旧版主屏 `index.876a7186.js` 尚未实现分页逻辑：
      1. 对于歌手歌曲 (`artistTracks`)：旧版主屏忽略 `offset/limit`，直接调用 `/artists?id=...` 并固定截取返回 30 首歌的纯数组。服务端 `catalogPageFallback` 看到返回长度 30 < 100，判定 `hasMore: false`，因此点歌端只显示 30 首且隐藏了“加载更多”按钮；
      2. 对于用户歌单 (`playlistTracks`)：旧版主屏忽略 `offset/limit`，固定调用 `resolvePlaylistCatalogTracks(playlistId, 100)`，无论请求第几页永远只返回前 100 首。第 1 页返回 100 首使 `hasMore: true`（显示了“加载更多”按钮），但点击“加载更多”请求 `offset=100` 时，旧版主屏再次把前 100 首原样返回，点歌端去重（`previousIds`）后新增歌曲为 0 首，导致点击“加载更多”没有任何反应！
- 代码修复方案与改造清单：
  1. 歌手搜索成功后自动隐藏默认常用歌手（`src/remote/main.js`、`src/remote/styles.css`）：
     - 在 `src/remote/styles.css` 中增加 `.featured-artist-list[hidden] { display: none; }`（防止 `.featured-artist-list` 的 `display: grid` 覆盖 HTML `hidden` 属性）；
     - 在 `src/remote/main.js` 的 `renderFeaturedArtists()` 中：当搜索结果 `artists.length > 0` 时设置 `container.hidden = true` 隐藏常用歌手；当 `artists.length === 0` 时恢复 `container.hidden = false`；
     - 在 `scheduleArtistSearch()` 搜索完成回调中同步调用 `renderFeaturedArtists()`，并在搜索框 `input` 事件被清空时自动重置恢复默认歌手显示。
  2. 彻底清除旧版 Service Worker 缓存锁死并强制校验主屏版本（`src/registerServiceWorker.js`、`scripts/isolate-remote-assets.js`、`src/karaoke/reactions.js`）：
     - 将 `src/registerServiceWorker.js` 改造为主动注销所有已注册 Service Worker 并清理 `window.caches` 缓存；
     - 在 `scripts/isolate-remote-assets.js` 中，将构建产物 `dist/service-worker.js` 生成为零外部依赖（不依赖 Google CDN）的自毁型 Service Worker（安装后立即 `skipWaiting`、清空全部 Cache Storage、自我注销并自动刷新客户端页面）；
     - 将 `src/karaoke/reactions.js` 中的 `REACTION_UI_REVISION` 从 `'centered-effects-v7'` 升级为 `'centered-effects-v8'`，确保任何未刷新的旧版主屏页面在连接房间时被服务端直接拦截提示刷新，杜绝新旧代码混跑。
- 构建与软路由干净部署：
  - Prettier、ESLint 及 5 套核心单元/集成测试（`test-artist-catalog.js`, `test-playlist-catalog-pagination.js`, `test-karaoke-remote-api.js`, `test-karaoke-reactions.js`, `test-karaoke-web-bridge.js`）全部通过；
  - 执行 `npm run build:local-ktv` 与 `node scripts/build-ktv-server.js` 构建；
  - 清空软路由 `/mnt/mmc1-4/lumasing/dist/*` 所有历史旧 hash 残留文件，解压最新产物，并通过 `docker compose up -d --force-recreate ktv web` 刷新容器文件挂载（确认 `/ktv/health` 返回 `uiRevision: "centered-effects-v8"`）。
- ego-browser 端到端实机验证结果（`scripts/verify-artist-search-ego.mjs`）：
  1. 歌手搜索后隐藏默认歌手：搜索“汪苏泷”返回 12 个歌手芯片后，`[data-featured-artists]` 的 `hidden === true` 且 `display === "none"`；清空搜索框后默认 9 位歌手立即恢复 `display === "grid"`；
  2. 歌手歌曲分页与“加载更多”按钮：
     - 点击常用歌手“周杰伦”：首屏加载 113 首（13 首本地歌曲 + 100 首在线歌曲），底部清晰显示 `已显示 100 / 587 首。` 与“加载更多”按钮；点击“加载更多”后列表增长至 213 首（`已显示 200 / 587 首。`）；
     - 点击搜索结果歌手“汪苏泷”：首屏加载 100 首，底部清晰显示 `已显示 100 / 725 首。` 与“加载更多”按钮；
  3. 歌单歌曲“加载更多”按钮：选择多页大歌单（671 首），首屏显示 100 首（`已显示 100 / 671 首。`），点击“加载更多”按钮后列表立即追加第 2 页至 200 首（`已显示 200 / 671 首。`）。

---

## 14. 内网自定义域名 ktv.home 免端口访问与零 IP 硬绑定解耦改造 (2026-11-02 已完成并通过软路由实机与 ego-browser 全量验证)
- 用户需求目标：
  1. 在局域网内使用自定义域名 `ktv.home` 代替输入 IP，且实现免端口访问（直接访问 80 端口，无需附带 `:18080`）；
  2. 彻底去除程序代码与配置中对 IP 的硬绑定，预防未来更换软路由、IP、迁移至其他机器或直接运行于电脑端/Electron 模式时发生失效；
  3. 保留原有的 IP 访问方式（`http://192.168.100.1:18080/`），实现双轨并存。
- 实施方案与技术实现：
  1. 路由器网络与 80 端口冲突化解：
     - iStoreOS / OpenWrt 默认由 `uhttpd`（管理后台 LuCI）监听全局 `0.0.0.0:80`，与 Docker Nginx 占用冲突；
     - 在软路由 `br-lan` 网桥配置永久辅助 IP（LAN Alias）`192.168.100.8/24`（通过 `/etc/config/network` 持久化）；
     - 将 `uhttpd` 的监听地址从全局 `0.0.0.0:80` 精确收敛到 `192.168.100.1:80`、`127.0.0.1:80` 与 `10.222.222.1:80`，彻底将 `192.168.100.8:80` 释放给 Docker 独占，完全不影响软路由原生管理后台（LuCI 仍以 `192.168.100.1` 正常访问）；
     - 在路由器内网 DNS（`dnsmasq` 与 `AdGuardHome`）中配置静态域名解析 `ktv.home -> 192.168.100.8`；
     - 网络与服务配置文件已备份至 `/mnt/mmc1-4/lumasing/config_backup/`。
  2. Docker 端口与双轨反向代理配置：
     - `docker/router/compose.yml`：
       - 端口绑定为 `"192.168.100.8:80:80"`（免端口访问）与 `"192.168.100.1:18080:80"`（旧 IP 端口兼容）；
       - 彻底移除 `KTV_PUBLIC_ORIGIN` 硬编码环境变量；
       - 补全 `./local-music:/music:ro` 与 `./data:/data` 容器数据持久化挂载卷。
     - `docker/router/nginx.conf`：
       - 将代理头 `Host $host` 更新为 `Host $http_host`，并增加 `proxy_set_header X-Forwarded-Host $http_host;` 与 `proxy_set_header X-Forwarded-Proto $scheme;`，确保无论客户端通过 `ktv.home` 还是 `192.168.100.1:18080` 进入，上游 Node 服务端均能精准识别其原始访问域名和端口。
  3. 程序代码全面解耦硬绑定 IP，实现全动态多源信任：
     - `src/server/KaraokeWebHost.js`：
       - `publicOrigin` 改为可选；支持通过配置/环境变量 `KTV_ALLOWED_HOSTS` 扩展白名单；
       - 内置 `isAllowedHost(hostname)` 通配信任校验：自动放行本地回环（`localhost`、`127.0.0.1`）、内网私有网段（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）、常用局域网/内网域名后缀（`.home`、`.lan`、`.local`、`.internal`）；
       - 动态解析来源 `resolveRequestOrigin(request)` 与 `getTrustedOrigin(request)`：优先以合法请求的 `Host` / `X-Forwarded-Host` 及经过校验的 `Origin` 头动态计算 `origin`；
       - 将 `/ktv/api/reactions` 和 `/ktv/host/*` 中的强硬 `origin === this.publicOrigin` 校验替换为 `isValidOrigin(request)`，在保证抵御外网恶意 CSRF / DNS 重绑定攻击的同时，无缝支持任何内网 IP 或自定义域名访问；
       - 扫码点歌链接与二维码生成 `guestJoinUrl(request)`、`describe(request)`：动态使用当前请求来源的基础 URL（例如主电脑访问 `http://ktv.home/karaoke` 时，二维码自动展示 `http://ktv.home/room/`；访问 `http://192.168.100.1:18080/karaoke` 时自动展示 `http://192.168.100.1:18080/room/`）。
     - `src/electron/karaoke/KaraokeLocalLibrary.js`：
       - 对本地音乐扫描目录增加安全 `try/catch` 容错，捕获 `ENOENT`/`ENOTDIR`，防止音乐目录未挂载时 Node 服务端异常退出。
     - `src/karaoke/reactions.js`：
       - 升级 `REACTION_UI_REVISION` 至 `'centered-effects-v9'`，保证新旧主屏与服务端版本严格协同。
- 验证结果：
  - 自动化单元与集成测试（`scripts/test-karaoke-web-host.js`）：多源动态解析测试全部通过；
  - ego-browser 端到端实机验证（`scripts/verify-domain-access-ego.mjs`）：
    1. 主机通过域名免端口访问 `http://ktv.home/karaoke` 顺利开房，二维码直接加入链接动态显示为 `http://ktv.home/room/`；
    2. 手机端 1 通过域名免端口访问 `http://ktv.home/room/`，搜索“晴天”返回 16 首，发送表情互动成功（提示“表情已送出”，无任何 CSRF 报错）；
    3. 手机端 2 通过 IP 访问 `http://192.168.100.1:18080/room/`，发送表情互动成功（提示“已加入排队”，双轨并存完全正常）；
    4. 软路由原生 LuCI 管理后台（`http://192.168.100.1/`）访问完全不受影响（HTTP 200）。

---

## 15. 路由启动持久化保护、备用 IP 一键加入与剪贴板容错增强 (2026-11-02 已完成并全量验证)
- 隐患排查与解决清单：
  1. **路由器开机启动顺序守护（`/etc/rc.local`）**：
     - 在软路由系统初始化脚本 `/etc/rc.local` 中增加网络别名轮询检测逻辑（最多等待 30 秒检测 `br-lan` 上的 `192.168.100.8` 就绪后启动 `lumasing-web-1` 容器），彻底规避软路由重启时 Docker 提早启动导致端口绑定失败的问题；原始配置已备份至 `/mnt/mmc1-4/lumasing/config_backup/rc.local.bak`。
  2. **手机端 DoH / 私有 DNS 备用地址直接显示与一键复制**：
     - 主屏幕房间面板（`src/views/karaoke.vue`）新增「备用加入链接（如手机开启加密DNS无法解析域名请用此链接）」，直接展示对应 IP 地址（`http://192.168.100.1:18080/room/`）；
     - 服务端（`src/server/KaraokeWebHost.js`）在 `describe()` 接口中动态下发 `backupJoinUrl`；
     - 主屏提供独立的 `copyBackupLink` 一键复制按钮与已复制状态提示。
  3. **非安全上下文（HTTP）剪贴板 API 强容错**：
     - 完善 `copyLanLink` 与 `copyBackupLink`：在 `http://` 域名访问（非安全上下文）导致 `navigator.clipboard` 为空或写权限被拒时，自动平滑降级使用 `document.execCommand('copy')` 与隐藏只读 `textarea`，杜绝静默失败与控制台报错。
  4. **严格主机隔离模式支持（`strictHosts` 与 `KTV_STRICT_HOSTS`）**：
     - 在 `src/server/KaraokeWebHost.js` 中新增严格模式开关，在保留默认局域网免配置自适应的前提下，满足未来公网或私有集群下的严格白名单隔离需求。
  5. **代码库与测试脚本全量提交审计**：
     - 将此前未提交的分页特性、搜索限流、测试脚本及高清歌手头像分 3 批次（`13f1a61`, `9906a03`, `dc5d48f`）规范纳入 Git 版本历史，确保构建一致性与可追溯性。
- 验证结果：
  - 自动化单元与集成测试（`test-karaoke-web-host.js`, `test-artist-catalog.js`, `test-playlist-catalog-pagination.js`, `test-karaoke-remote-api.js`, `test-karaoke-server.js`）全量通过；
  - 重新构建生产产物与服务并在软路由平滑部署完成；
  - 无头浏览器（ego-browser）端到端验证通过，主屏弹窗清晰呈现直接加入链接与备用加入链接，双轨访问与互动表情均正常工作。





## 16. 复查修正：备用链接去除代码内 IP 硬编码 (2026-11-02 已完成并部署)
- 复查发现：第 15 节新增的备用加入链接在 `KaraokeWebHost.js` 中写死了 `192.168.100.1:18080` 与 `ktv.home`，与"程序不绑定 IP、可迁移"的初衷相悖；同时备用地址还被误加入"网卡地址"下拉框。
- 修正：
  1. 新增可配置项 `altOrigins`（环境变量 `KTV_ALT_ORIGINS`，逗号分隔）；服务端取其中第一个与当前访问主机名不同的地址作为 `backupJoinUrl`，未配置则不显示备用链接；代码内不再出现任何具体 IP 或域名。
  2. 部署相关地址只写在 `docker/router/compose.yml`（`KTV_ALT_ORIGINS: "http://ktv.home,http://192.168.100.1:18080"`），换路由或换机器只需改该配置。
  3. 移除下拉框中的"备用访问"条目。
  4. `scripts/test-karaoke-web-host.js` 改用测试专用地址验证域名到 IP、IP 到域名两个方向，并验证未配置时无备用链接。
- 验证：web-host 测试与 ESLint 通过；软路由 `ktv.home`、`192.168.100.1:18080`、LuCI 均返回 200；ego-browser 端到端全部通过。

---

## 17. 工作区未提交文档全量纳入版本管理 (2026-11-02 已完成)
- 审计排查：检查工作区内残留的未跟踪文件，确认 `KTV_Project/` 目录下的 Phase 4 项目需求书与工作流报告属于项目核心规格文档，无任何敏感信息或语法错误。
- 提交落地：
  - `0a29732`: `docs(ktv): track Phase 4 project specifications and workflow reports`（纳入全部 Phase 4 项目书与提示词报告文档）；
  - 当前工作区状态（`git status`）为完全干净状态（`working tree clean`），后续所有功能与文档改动均保持即刻归档提交，确保多 Agent 协作时对变更上下文 100% 透明可查。

