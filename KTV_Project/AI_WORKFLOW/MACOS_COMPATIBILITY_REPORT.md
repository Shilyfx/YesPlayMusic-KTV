# LumaSing macOS Compatibility Report

## 已检查并修改

| Issue   | 文件 / 函数                                                          | 当前问题                                                  | 精确处理                                                                                    | 保留行为                                               | 验证                                                |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| MAC-001 | `src/utils/Player.js::setOutputDevice()`                             | macOS/WebAudio 节点可能没有 `setSinkId` 或设备 id         | capability guard、空 device guard，并捕获 `setSinkId` rejection                             | 默认输出与可用设备选择不变                             | `test-karaoke-player.js`、源构建                    |
| MAC-002 | `src/electron/karaoke/KaraokeLocalLibrary.js::pathKey/canonicalPath` | 不同平台路径大小写语义不能混用                            | 仅 Windows lower-case；macOS/Linux 保留大小写；realpath 后生成 localId                      | 本地目录、歌单、增量索引和播放 URL 不变                | `test-karaoke-local-library.js`                     |
| MAC-003 | `src/views/karaoke.vue`                                              | macOS 原生 traffic lights 与自绘三键重复                  | `isMac` 下隐藏自绘最小化/最大化/关闭按钮                                                    | Windows/Linux 自绘窗口控制保留                         | `test-karaoke-server.js`、源构建                    |
| MAC-004 | `src/electron/karaoke/KaraokeServer.js::getLanAddressCandidates`     | 未过滤 macOS `awdl/llw/utun/bridge/vmenet/vmnet` 虚拟接口 | 扩展 virtual-interface 规则，仍按候选优先级选择真实局域网地址                               | 27233 仍监听 `0.0.0.0`；二维码、self-test、Remote 不变 | macOS interface fixture in `test-karaoke-server.js` |
| MAC-005 | `package.json` / `.github/workflows/packaging-validation.yml`        | 原 workflow 只有一个 macOS 入口                           | 增加 `electron:build-mac-x64` 与 `electron:build-mac-arm64`；分别使用 `macos-13`/`macos-14` | Windows packaging job 保留；Universal 配置未删除       | YAML Prettier、配置审计                             |

## CI / 实机状态

本报告在 Windows 工作站生成。macOS x64/arm64 runner、真实 macOS 音频设备、交通灯、DMG 安装和手机局域网验收均未实际执行；对应 CI 状态只能在推送后由 GitHub Actions 产生，不能在这里宣称通过。
