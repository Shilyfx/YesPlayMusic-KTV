# 稳定化发布测试矩阵

| 场景            | 入口/命令                                              | 预期                                              | 当前证据                                 |
| --------------- | ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------- |
| 干净存储启动    | `node scripts/test-safe-storage.js`                    | 损坏 JSON 不阻塞启动并生成备份                    | 通过                                     |
| 网页生产构建    | `NODE_OPTIONS=--openssl-legacy-provider npm run build` | desktop 与 remote bundle 均生成                   | 通过                                     |
| 路由/API 失败态 | 断开 API 或返回 503                                    | 页面保留结构并呈现重试/空状态                     | Explore 已接入；其他页面依赖既有错误处理 |
| 登录二维码      | `/login/account?mode=qrCode`                           | 获取 key、显示二维码、失败有文字提示              | 代码路径已捕获失败；需真实账号复测       |
| KTV 局域网      | 选择网卡 → 生成二维码                                  | 服务监听全部地址，链接使用所选 IPv4               | 服务器/生命周期测试通过                  |
| KTV 二维码故障  | IPC `karaoke:lan:refresh-qr`                           | 房间不回滚，可复制 joinUrl 并重试                 | 代码已实现                               |
| 网卡可达性      | IPC `karaoke:lan:self-test`                            | `/health` 返回 active=true                        | 代码已实现；需真实网络复测               |
| 远程点歌        | `/room/<code>/`                                        | 登录上下文搜索、可播放性检查、重复点歌、置顶/删除 | Remote API 测试通过                      |
| 打包 Windows    | `npm run electron:build-win`                           | portable 与 NSIS 产物生成                         | 本地通过                                 |
| 打包 macOS      | `npm run electron:build-mac` / CI                      | dmg 产物生成、原生依赖不阻塞启动                  | 待 macOS runner                          |
| 发布后回归      | GitHub Actions workflows                               | Phase validation 与 packaging validation 全绿     | 推送后执行                               |

## 人工发布 gate

1. Windows 打包应用冷启动无白屏，导航到首页、发现、音乐库、登录和 KTV 均有可见内容。
2. 手机与主机在同一 `192.168.*` 网段，扫码链接可打开远程页；结束 KTV 后旧链接失效。
3. Mac 连接电视/音箱，播放、歌词全屏、输出设备和退出清理均正常。
