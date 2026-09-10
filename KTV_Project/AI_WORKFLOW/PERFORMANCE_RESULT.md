# LumaSing Performance Result

## 测量口径

- Base SHA：`b26a7976d568321297c0c57111646d620ef32a12`
- 测量提交：`ef57e496c805368492b1d339786dfa01e381ff20`
- 测量脚本：`scripts/measure-karaoke-performance.js`
- 环境：Windows 工作站，Node `v24.13.0`；源构建使用进程级 `NODE_OPTIONS=--openssl-legacy-provider`，未写入 Node 16 CI。
- 本地扫描 fixture：10 首音频，每首同名 LRC/JPG；Remote availability 使用可计数的真实 `KaraokeRemoteService`/`KaraokeCatalogService`。

## Before / After

| 路径                                       |                              Before |                              After | 证据 / 说明                                                           |
| ------------------------------------------ | ----------------------------------: | ---------------------------------: | --------------------------------------------------------------------- |
| Remote bootstrap 固定请求                  |                                  11 |                                  2 | 新 client 的 `client-session + state`；推荐、歌手、歌单等模块按需加载 |
| Featured artist 搜索                       |                                   6 |                          6（按需） | 保留 6 个固定歌手查询；不再进入房间即请求                             |
| `/state` / 30s（visible 1500ms）           |                                  21 |                                 21 | 周期不删除；single-flight 只消除 overlap                              |
| `/state` synthetic max concurrent          |                                   2 |                                  1 | `refreshScheduler` 单 owner + queued refresh 测试                     |
| 15 首搜索 availability                     |                                  15 |                                  0 | 列表展示改为 cached `peekAvailability`，点歌仍 fresh 检查             |
| 100 首歌单 availability                    |                                  85 |                                  0 | 列表不再 N+1；数值按真实 fixture 顺序记录                             |
| 本地首次 scan                              | 1 readdir / 20 access / 10 readFile | 1 readdir / 0 access / 10 readFile | 首次建立持久化索引                                                    |
| 本地第二次 scan                            | 1 readdir / 20 access / 10 readFile |  1 readdir / 0 access / 0 readFile | 未改变的 LRC/cover/metadata 复用索引                                  |
| Player 每次 property set 的即时 save / IPC |                               1 / 1 |                              0 / 0 | 250ms save、100ms IPC debounce；退出/关键切换仍 flush                 |
| KTV mutation 的 settings/data 即时写盘     |                                   2 |                                  0 | settings/data 仅 allowlist + 250ms debounce                           |
| KTV stageLyrics 线性 `findIndex` 调用点    |                                   1 |                                  0 | 二分查找 + 游标推进；100ms clock 仍保留                               |
| Remote entrypoint gzip                     |                           389,390 B |                           28,210 B | 仅 Remote 实际引用资产；约减少 92.8%                                  |
| Desktop entrypoint gzip                    |                           632,329 B |                          634,906 B | 未针对 Desktop 做 bundle 删除；构建产物存在小幅非确定差异             |

## 不能从本机 fixture 推断的项目

真实 Electron/手机浏览器网络、CPU/GPU、帧率、音频输出设备、Windows 安装、macOS x64/arm64 安装与局域网跨设备播放均未在本机完成，不以源码测试代替实机结论。
