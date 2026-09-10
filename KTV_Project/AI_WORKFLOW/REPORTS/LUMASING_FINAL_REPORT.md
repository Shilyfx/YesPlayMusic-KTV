# LumaSing Final Execution Report

## Scope and base

- Base SHA：`b26a7976d568321297c0c57111646d620ef32a12`
- Validation HEAD before this report：`ef57e496c805368492b1d339786dfa01e381ff20`
- Branch：`fix/ktv-release-stabilization`
- Execution order followed：CI fix → baseline → Remote polling/lazy → availability/catalog → local index → Player/Store/request → lyrics → bundle/cache → macOS → UI → semantic races → rebrand。

## Step record

| Step / commit        | File / function                                            | Root cause and exact change                                                            | Unchanged behavior                                             | Test result                                                 |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `e9ed96a`            | KTV test scripts / packaging workflow                      | Babel bootstrap 与当前 `src` alias 不一致；移除 Node16 workflow 的 legacy OpenSSL 参数 | 测试目标、Node16 CI 版本不变                                   | KTV tests、format、local build pass（Node24 需进程级 shim） |
| `a75bbbf`            | `scripts/measure-karaoke-performance.js`                   | 缺少可复现请求/I/O/包体基线                                                            | 无业务代码变化                                                 | Before baseline recorded                                    |
| `d7639fd`            | `src/remote/main.js`, `refreshScheduler`, `KaraokeManager` | `/state` timer、mutation、visibility 可重叠；无 revision                               | 轮询周期、结束态、队列语义保留                                 | polling/domain/API/build pass                               |
| `b70aa91`, `8962a8a` | Remote module loaders                                      | bootstrap 固定加载模块；强制刷新未绕过 host cache                                      | 搜索、推荐、歌手、用户/本地歌单入口保留                        | remote API/build pass                                       |
| `ff694e1`, `646f529` | `KaraokeRemoteApi`, catalog/user playlist cache            | 列表 availability N+1、Catalog 与 allowlist 无 single-flight                           | enqueue fresh availability、playlist ownership 保留            | catalog/API tests pass                                      |
| `2a00ad6`            | `KaraokeLocalLibrary`, local IPC, KTV page                 | 每次完整重建 metadata/LRC/cover；list 触发 scan                                        | 本地目录/歌单/后续增量索引保留                                 | local incremental test pass                                 |
| `5988fdd`, `17a47aa` | Player/store/request                                       | Player property、进度和每个 Vuex mutation 重复序列化/IPC；请求反复读 settings          | 关键切换 flush、设置/data allowlist、播放与 KTV ownership 保留 | Player/store/safe-storage tests pass                        |
| `50ce7e9`            | `karaoke.vue`, `lyricCursor`                               | 每 100ms 全数组线性查找；双 watcher 重复拉词；隐藏页仍 ticker                          | 歌词 offset、字号、本地/远程歌词和展示状态保留                 | lyric cursor/domain/build pass                              |
| `c816247`            | `vue.config.js`, Remote asset isolation                    | Remote HTML preload desktop vendor；实际 LAN 入口不需要                                | 27232 Desktop bundle 未暴露到 27233                            | bundle/server/build pass                                    |
| `371ffcf`            | `KaraokeServer` static assets                              | 所有静态响应 no-store                                                                  | HTML/API/audio/cover 仍 no-store                               | hashed asset server test pass                               |
| `4493d12`            | macOS server/view/package workflow                         | 虚拟网卡规则、窗口控件和 x64/arm64 CI 不完整                                           | Windows/Linux/Universal 配置保留                               | server fixture/source build pass                            |
| `5ca7cdd`            | `karaoke.vue` overlays/4K CSS                              | room/local panel 占主 flex 流；4K 动效成本无预算                                       | QR/self-test/retry/copy、local scan、本来三栏比例保留          | domain/server/local/lyrics/build pass                       |
| `4b1a63c`, `ef57e49` | KTV Manager semantic tests                                 | 需要验证自动开唱/Guest 切歌竞态，而非通过删功能提速                                    | Guest 切歌、Remote 第一首自动开唱、队列 generation 保留        | simultaneous enqueue + five-next race pass                  |
| `78942e9`            | app identity / README / updater                            | 可见身份仍为旧品牌，发布源仍指向旧仓库                                                 | `yesplaymusic` storage/DB/IPC/window alias 保留以保护数据兼容  | identity/API/server/build pass                              |

## Mandatory product semantics

已由源码和测试确认未删除或弱化：

- Guest 切歌：`Remote /next → KaraokeRemoteService.next → manager.next`。
- Remote 第一首自动开唱：enqueue 后在无 current、无 transition 时调用 `manager.startQueue()`。
- 本地曲库与增量索引：`local:list` 不扫描；`local:scan` 使用持久化 index、generation 和 scanPromise。

## CI status

| Pipeline             | Actual status                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Source CI            | 未在远端运行；本机 `npm run lint` 通过（7 条既有 warning），全量 KTV scripts 通过，源 `npm run build` 通过并有 7 条既有 CSS order warning |
| Windows Packaging CI | 未实际运行 / 无远端结果                                                                                                                   |
| macOS x64 CI         | 未实际运行 / 无远端结果                                                                                                                   |
| macOS arm64 CI       | 未实际运行 / 无远端结果                                                                                                                   |

此前尝试推送时 GitHub 连接被 reset，故不虚构远端状态。当前本机工作树中的三个 `KTV_Project` 未跟踪文档目录属于既有用户文件，未纳入本次提交。

## Performance

完整数字见 [`PERFORMANCE_RESULT.md`](../PERFORMANCE_RESULT.md)。核心结果：Remote bootstrap `11 → 2`，synthetic `/state` concurrent `2 → 1`，搜索/歌单列表 availability `15/85 → 0/0`，本地二次 scan `1 readdir + 20 access + 10 readFile → 1 readdir + 0 access + 0 readFile`，Remote entrypoint gzip `389,390 → 28,210 B`；Desktop bundle 未做目标性删除。

## Real-device acceptance remaining

未完成且不能由本机测试替代：Windows 安装包安装/升级与真实播放器、macOS x64/arm64 DMG 安装与 traffic lights/音频输出、Android/iOS 手机浏览器扫描二维码后跨设备点歌/切歌/本地音频播放、真实 4K/Retina GPU 帧率与长时间网络稳定性。
