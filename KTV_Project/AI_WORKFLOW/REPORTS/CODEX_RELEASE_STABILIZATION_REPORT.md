# YesPlayMusic KTV 全面稳定化修复报告

## 执行范围

- 修复计划：`C:/Users/Shilyfx/Downloads/YesPlayMusic_KTV_全面稳定化修复计划.md`
- 执行提示词：`C:/Users/Shilyfx/Downloads/CODEX_KTV_FULL_PRODUCT_STABILIZATION_PROMPT.md`
- 稳定化分支：`fix/ktv-release-stabilization`
- 稳定化基线：`a4c5c9c0d84a2d331f005e1a9deee6b37986c6e2`
- 范围：启动、API 契约、存储、原生依赖、Electron 本地服务、路由错误态、登录二维码、KTV 局域网二维码与打包验证；未新增 KTV 业务能力。

## 已完成修复

1. Electron 生产环境使用 `/api`，开发环境明确使用 `127.0.0.1:10754`；本地桌面 HTTP 服务只监听 `127.0.0.1:27232`。
2. Axios 统一将网络/业务失败转换为可识别的 `AppError` 并 reject，调用方可以进入错误态；登录过期仍执行登出与路由跳转。
3. Vuex、播放器、认证、歌词 API、通用工具和渲染 IPC 改为显式注入引用，消除启动期间的循环导入；播放器网络初始化延后到 store 完成后并捕获失败。
4. 新增安全存储读写与形状校验；损坏 JSON 会备份到 `yesplaymusic.invalid.*`，设置会与当前默认值合并，缓存策略不再在 store 初始化前读取 store。
5. `@unblockneteasemusic/rust-napi` 改为真正按需动态加载；主进程日志记录未捕获异常、未处理拒绝、服务启动状态及 renderer 生命周期。
6. 新增 `GET /__health`、`renderer:ready`、启动超时遮罩、重试与日志目录入口；API 服务未就绪时返回结构化 503，而不是让页面静默空白。
7. KTV 房间服务保持 `0.0.0.0` 监听，网卡选择只影响二维码/加入链接；二维码生成与房间生命周期解耦，生成失败时仍提供复制链接和重试。
8. KTV 面板新增加入链接复制、二维码重试和所选网卡健康自检；二维码显示尺寸提升至 240px，并保留小屏布局。
9. Explore 歌单加载增加 loading/empty/error/retry 状态；路由守卫修复重复 `next()` 导致的异常导航。
10. 新增安全存储回归测试和 Windows/macOS 打包验证工作流；远端资源仍由隔离脚本复制到 `remote/`，不回退到桌面 bundle。

## 验证证据

| 检查                                                            | 结果                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm.cmd run lint -- --no-fix`                                  | 通过；仅 7 条既有 warning，无 error                                           |
| `npm.cmd run build`（`NODE_OPTIONS=--openssl-legacy-provider`） | 通过，远端资源隔离完成                                                        |
| `node scripts/test-safe-storage.js`                             | 通过                                                                          |
| `node scripts/test-karaoke-domain.js`                           | 通过                                                                          |
| `node scripts/test-karaoke-player.js`                           | 通过                                                                          |
| `node scripts/test-karaoke-server.js`                           | 通过                                                                          |
| `node scripts/test-karaoke-lifecycle.js`                        | 通过                                                                          |
| `node scripts/test-karaoke-remote-api.js`                       | 通过                                                                          |
| `npm.cmd run electron:build-win`                                | 通过，生成 portable/NSIS 安装包                                               |
| packaged `app.asar` 远端资源检查                                | 通过，存在 `remote/index.html`、remote JS/CSS，桌面 JS/CSS 未混入 remote 路径 |
| GitHub Actions                                                  | 本地无法代替远端执行，待推送后由 workflow 验证                                |
| 实体手机扫码、电视显示、音频输出                                | 未在本轮自动化环境验证，保留为发布前人工 gate                                 |

## 发布前 gate

- 在真实 Windows 主机启动打包程序，确认 `http://127.0.0.1:27232/__health` 中 desktopServer/renderer/neteaseApi 状态。
- 登录网易云，切换到 KTV，选择实际 `192.168.*` 网卡，扫码进入 `/room/<code>/`，完成搜索、普通点歌、置顶、删除和结束房间。
- 检查 Mac 作为音箱/电视主机时的输出设备、全屏歌词和退出清理。
- 等待 GitHub Actions 的 `KTV Phase Validation` 与 `KTV Packaging Validation` 通过后，再提交 ChatGPT 审查。
