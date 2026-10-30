# Docker KTV 固定房间邀请与悬浮二维码

日期：2026-10-27（Asia/Shanghai）。本次只发布网页静态资源。

## 修改与依据

| 文件 / 模块 | 当前问题及根因 | 修改 | 验证 |
| --- | --- | --- | --- |
| `src/remote/main.js / bootstrap` | 加入后 `history.replaceState` 删除邀请凭证片段，地址栏链接发生变化，复制到另一设备无法作为完整邀请使用 | 保留完整房间邀请；不更换服务端房间码或房间凭证 | 实际 Guest 页面加入、刷新后 URL 与原邀请逐字相同 |
| `src/remote/main.js / performRefresh, joinRoom` | Guest 凭证 5 小时过期时原先直接显示房间结束，虽然房间邀请仍有效 | 现有单一刷新 owner 收到 `INVALID_CLIENT_TOKEN` 后用原邀请重新加入；不重放歌曲 mutation；房间结束或邀请失效仍结束页面 | 浏览器注入失效 Guest 凭证，真实 HTTP 返回 401 后重新加入成功；URL 不变。没有等待真实 5 小时 |
| `src/components/karaoke/SongRequestButton.vue` | 主、副屏需要一致的悬浮二维码操作 | 本地 QR 生成，共享最多 8 个 URL 对应的生成 Promise；按钮 mouseenter 显示，mouseleave 移除；弹层只有二维码且不拦截鼠标；点击仍打开新点歌页面 | 悬浮、移开、点击新页面、连续 polling 保留同一图片节点均通过 |
| `src/views/karaoke.vue` | 主屏全屏底部缺少点歌入口 | 歌词全屏控件、整页 KTV 全屏底栏接入按钮；悬浮期间维持控件可见 | 实际编译主屏两种全屏模式，QR 为 200px、位于视口内，移开立即消失 |
| `src/views/karaokeWeb.vue` | 副屏原有点歌按钮只能点击 | 使用共用按钮，保留原有点击新页面功能及 URL 限制，悬浮向下显示二维码 | 非全屏及全屏通过；按钮高度与相邻控件相同；全屏 idle 后悬浮仍显示 |
| `scripts/test-karaoke-web-host.js` | 需要确认服务端真实房间生命周期，而非假设其会动态轮换 | 增加同房间 status/QR/队列变化后的原邀请稳定性、再次加入、新房间拒绝旧邀请的断言 | 测试通过；服务端原本已满足房间内固定邀请，因此未重复修改后端 |

## 已执行验证

- `test-karaoke-web-host.js`、`test-karaoke-web-bridge.js`、`test-karaoke-remote-api.js` 通过。
- `test-karaoke-remote-polling.js`、`test-remote-bundle.js` 通过。
- 定向 ESLint、格式化、`git diff --check` 和 Docker 前端生产构建通过；构建保留既有警告。
- ego-browser 本机真实 HTTP 服务：主屏两种全屏、副屏全屏与非全屏、悬浮进出、全屏自动隐藏、点击新标签、完整 URL 保留、过期客户端重入、旧邀请撤销通过。
- 线上副屏：实际二维码加载，跨多次现有 polling 保留同一图片节点，鼠标移开立即消失。
- 线上 Guest：加入及刷新后完整 URL 保持不变。
- 没有对正在使用的线上主屏发出控制命令；线上主屏新按钮需刷新页面加载。没有执行实体手机扫码、实体多电脑同步或真实 5 小时等待验收。

## 功能与性能边界

Guest 切歌、Remote 第一首自动开唱、本地曲库与增量索引实现未改动。现有主机交换与副屏轮询 owner 不变；悬浮二维码新增网络轮询为 0，每个稳定 URL 的本地生成工作合并并缓存。未测 FPS 或功耗。

发布前后房间均 `active=true`。KTV、Web、音乐 API 容器均未重启，启动时间分别保持：

- KTV：`2026-10-27T13:13:44.959616283Z`
- Web：`2026-10-27T05:21:57.777289876Z`
- API：`2026-10-27T05:21:57.754677251Z`

备份：`/mnt/mmc1-4/lumasing-backups/20261027-before-hover-qr.tgz`

- 备份 SHA256：`f6bab84f06b745d550fae3c1ca480a8d8be39f8a89bd5d87fa0e75520fa45b11`
- 静态包 SHA256：`bc509949963defe5efd3f32ce2204179d202fee162b46e3cdb20ac3e78b48966`
- 主入口 SHA256：`cf9a4d2c3cd72d37cb60ff679f49f8fee9fd61e379457891bac6adda3e1aa730`
- Guest 入口 SHA256：`b3fa8c7b97d86479b616df0f211a3ee6a90d0636375d4b6e9eafad573d344979`

对应源码包已重新生成并同步。未提交、推送、触发 GitHub CI 或重新打包桌面安装包。
