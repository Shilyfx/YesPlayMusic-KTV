# LumaSing Performance Baseline

基线冻结时间：2026-09-11（本机执行）
Base SHA：`e9ed96a7299231dd4f683a240d431e93a5bf73a6`
测量脚本：`scripts/measure-karaoke-performance.js`

## 运行环境

- OS：Windows（工作站）
- Node：v24.13.0
- 说明：项目 CI 使用 Node 16；本机未安装 Yarn，因此仅使用等价的 Node/npm 脚本和既有 KTV 测试命令。Node 24 直接构建会触发旧 Webpack 的 OpenSSL 错误；临时设置 `NODE_OPTIONS=--openssl-legacy-provider` 后构建成功。该变量没有写入 Node 16 workflow。

## Before 指标

以下数值来自 `node scripts/measure-karaoke-performance.js`。本地扫描使用 10 首歌曲、每首同名 LRC 和 JPG 的临时目录；Remote availability 使用真实 `KaraokeRemoteService`/`KaraokeCatalogService`，Host bridge 为可计数 fixture。

| 路径                                   |                                        Before | 测量方式                                                      |
| -------------------------------------- | --------------------------------------------: | ------------------------------------------------------------- |
| Remote bootstrap 固定请求（新 client） |                                            11 | 当前 bootstrap 调用结构 + 6 个 featured artist query          |
| Featured artist 搜索                   |                                             6 | 当前 `featuredArtistQueries` 数组和实际加载逻辑               |
| `/state` 请求 / 30s（visible 1500ms）  |                                            21 | 当前 timer 周期上界（立即请求 + 20 个周期）                   |
| `/state` synthetic max concurrent      |                                             2 | 1.5s 周期、2s 响应的可复现 overlap 模型；当前无 in-flight 锁  |
| 15 首搜索 availability                 |                                            15 | 当前 `KaraokeRemoteService.search()` fixture                  |
| 100 首歌单 availability                |                                            85 | 当前 `playlistTracks()` fixture；其中 15 首命中前一步搜索缓存 |
| 本地首次 scan                          | 10 音频 / 1 readdir / 20 access / 10 readFile | 当前 `KaraokeLocalLibrary.scan()` fixture                     |
| 本地第二次 scan                        | 10 音频 / 1 readdir / 20 access / 10 readFile | 同一实例第二次 scan；当前无索引复用                           |
| Player save / property set             |                                             1 | 当前 `store/index.js` Proxy set 路径                          |
| Player IPC / property set              |                                             1 | 当前 `store/index.js` Proxy set 路径                          |
| Vuex storage writes / mutation         |                                             2 | 当前 plugin 对每次 mutation 写 settings + data                |
| KTV stageLyrics tick                   |                                      10 / sec | 当前 `karaoke.vue` 100ms timer                                |
| KTV stageLyrics linear scan            |                       1 个 `findIndex` 调用点 | 当前 computed 实现                                            |
| Remote entrypoint gzip                 |                                  389390 bytes | 当前 `dist/remote/index.html` 引用资产                        |
| Desktop entrypoint gzip                |                                  632329 bytes | 当前 `dist/index.html` 引用资产                               |

### 受环境限制的指标

Player 实际每分钟调用量、Vuex 每分钟写盘量、浏览器 30 秒真实 `/state` 并发、KTV DevTools CPU/GPU/帧率，需要 Electron/浏览器运行时和真实网络/用户操作。本 baseline 对这些项目记录了当前代码路径的确定性上界/合成重现，不冒充真实设备测量。

## 保留能力确认

本 Step 仅新增测量脚本和报告，没有修改 Guest 切歌、Remote 第一首自动开唱或本地曲库/后续增量索引产品语义。
