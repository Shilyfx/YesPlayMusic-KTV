# LumaSing 软路由网页版本

目标设备：192.168.100.1，iStoreOS，Linux ARM64，Docker + Compose。

部署目录：`/mnt/mmc1-4/lumasing`。入口：`http://192.168.100.1:18080`。
这里只发布 LAN 地址上的 18080 端口；API 通过 nginx 的 `/api/` 访问，不单独发布端口。

本版本提供浏览器音乐播放器和 Docker KTV 扫码房间服务。
在 `/karaoke` 点击“将本机设为主电脑”，输入名称指定负责播放的电脑。
其他电脑打开完全相同的 `/karaoke` 链接，自动作为静音歌词副屏，不再创建新房间。
手机仍扫描主电脑上的二维码点歌、Guest 切歌；第一首自动开唱。
音频在主机浏览器所在的电脑或电视播放，主机页面需要保持打开。
若浏览器拦截声音，点击「点击启用声音 / 播放」。
Electron 桌面专属的目录选择、本地曲库 IPC 不属于此部署；桌面原功能保留。
账号、播放列表等浏览器状态按项目原有方式存储在各浏览器中。
API 匿名 token 存储在部署目录的 `data/` 中。

## Docker 主电脑与多屏歌词

### 副屏独立设置（源码已完成，待部署）

在副屏打开“本屏歌词设置”。默认勾选“跟随主屏样式”和“跟随主屏提前 / 延后”；
取消相应勾选后，可独立选择现有四种舞台、四种字效、16–64px 字号，以及
−10 至 +10 秒偏移（0.1 秒步长）。偏移基于原始歌曲时间，不叠加主屏偏移。
“全部恢复跟随主屏”只恢复跟随开关，保留此前保存的本屏自定义值。

设置仅保存在当前浏览器的 `lumasing.ktv.display.preferences.v1`，不写主屏
Vuex 设置、不发送房间控制命令；刷新仍保留。浏览器禁止存储时仅本次生效并提示。
主题仍跟随主屏，本功能不编辑歌词文字、不改变音源或副屏静音行为。

主屏心跳提供原始时间前后 13 秒上下文（10 秒偏移 + 3 秒外推余量），不新增
请求或轮询。密集歌词按时间覆盖；极端数据以 4096 行 / 192KiB UTF-8 为限，
显式传递有效范围，超出时提示范围不足而非显示错误歌词。Host body 上限 1MiB，
继续先鉴权后读取。部署需同步更新 KTV 后端、刷新主屏并重新指定主机。

22 项源码回归和生产构建通过；ego-browser 本地编译页面验证了独立设置、
持久化、恢复跟随、全屏/窄屏及歌词不重复闪现；真实本地 KTV 后端的一主两副
流程通过。尚未部署到软路由，等待允许结束当前房间的明确答复。

副屏连续性修复（2026-10-26）：`src/karaoke/lyricDisplay.js` 的
`projectPresentation` 原先把滚动窗口内序号放入 cueKey。主电脑发布新的窗口后，
同一句歌词序号会变，引发 Vue 重建节点和重复入场动画。现使用歌曲标识、
绝对歌词时间和内容作为稳定标识，不删除换句动画，也不改变同步/点歌逻辑。
`test-karaoke-display-client.js` 覆盖窗口重排、真换句和换歌；ego-browser
`verify-lyric-continuity-ego.mjs` 使用实际编译的投影与组件验证同句 DOM 保留。
修复前失败、修复后本机及软路由通过；21 项源码回归、生产构建和 lint 通过
（7 条既有 warning）。只更新静态资源，当前房间保持 active，容器未重启。
备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-lyric-continuity.tgz`。
仅刷新副屏即可应用此修复；主电脑无需刷新。未进行实体多机或新打包验收。

1. 所有旧 KTV 页面先刷新一次，以加载支持主/副屏的新版本。
2. 在负责发声的电脑打开 `/karaoke`，填写主电脑名称，点击“将本机设为主电脑”。
3. 其他电脑打开同一地址 `http://192.168.100.1:18080/karaoke`，直接显示静音歌词舞台。
4. 主电脑控制声音、暂停/继续、进度和舞台模式；手机仍通过主电脑二维码点歌/切歌。
5. 换主电脑时，在原主电脑点击“切换为副屏”，确认结束房间后，在另一台电脑重新指定。

此版本不会抢占已有主机。关闭、刷新或离开主电脑的 KTV 页面会结束其房间，
副屏回到等待；主电脑非正常断网时，租期最多 90 秒。刷新后需要重新指定主电脑，
不会恢复旧队列或绕过浏览器的声音启用限制。旧版本页面不会自动升级，部署后请刷新。

只读副屏接口 `/ktv/display` 仅提供脱敏歌曲信息、有限时间歌词和播放进度，不提供
音源 URL、Host token 或 Guest token。所有歌词由主电脑现有心跳发布，副屏没有单独
歌词/目录请求，也不取得主机控制权限。每个可见副屏单一 1 秒轮询，隐藏时停止；
本地进度外推最多 3 秒，连接中断时冻结，不保证网络抖动下的逐帧同步。

自动化验收使用 ego-browser 导入 `scripts/smoke-karaoke-multiscreen-ego.mjs` 的
`smokeMultiScreen(task, base)`；该测试需要空房间，会创建并结束测试房间。
保留的 Playwright 旧验收脚本用于旧单主机网页入口，不用于本版多屏验收。

## 构建和部署

在源码电脑设置 `VUE_APP_NETEASE_API_URL=/api`、`VUE_APP_DOCKER_KTV=true` 并运行 `npm run build`，
然后运行 `node scripts/build-ktv-server.js`。
Node 24 构建本项目时，进程环境需要 `NODE_OPTIONS=--openssl-legacy-provider`。
将 `dist/` 和本目录的 `compose.yml`、`Dockerfile.api`、`Dockerfile.ktv`、`api.cjs`、`nginx.conf`
复制到路由器部署目录；API 数据目录需要允许 uid 1000 写入。

在路由器执行：

```sh
cd /mnt/mmc1-4/lumasing
mkdir -p data
chown 1000:1000 data
docker compose -f compose.yml build lumasing-api
docker compose -f compose.yml build ktv
docker compose -f compose.yml up -d --no-build
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail=50
```

镜像：Node 22 Alpine、nginx stable Alpine；后端依赖固定为
`@neteaseapireborn/api@4.29.7`，不安装 Electron。
若 Docker Hub 不通，可先从 `mirror.gcr.io/library/` 拉取对应官方镜像并打上本地原名标签。
依赖安装需要能够访问 npm registry。

## 日常管理

```sh
cd /mnt/mmc1-4/lumasing
docker compose -f compose.yml restart
docker compose -f compose.yml stop
docker compose -f compose.yml up -d
```

设置了 `unless-stopped`，运行中的容器随 Docker 服务启动。
升级前备份 `dist/`、配置和 `data/`；如果替换了挂载配置文件的 inode，
需要 `docker compose -f compose.yml up -d --force-recreate --no-deps web`
重新挂载，单独 nginx reload 可能仍读取旧文件。
不要在 Compose 或 Git 中保存路由器登录密码。

`ssh.py` 是部署传输工具，需要本机安装 Paramiko。
通过环境变量 `LUMASING_ROUTER_PASSWORD` 和 `LUMASING_ROUTER_FINGERPRINT`
传入登录凭据及已核对的 SSH 主机指纹。

## KTV 使用与生命周期

1. 主机浏览器访问 `/karaoke`，选择 Docker 服务地址并点击「生成房间二维码」。
2. 手机与主机在同一局域网，扫码进入 `/room/<房间码>/`。
3. 手机搜索并点歌，主机浏览器使用自身账号播放；手机拿不到主机登录 Cookie。
4. 一个服务同一时刻只允许一个主机浏览器开房；离开 KTV 页或结束会话会关房。
5. 页面异常断开后最多 90 秒释放房间；旧 Guest token 随房间关闭失效。
6. 主机每秒一次 single-flight exchange；慢目录请求不阻塞心跳，命令重试去重，
   12 秒超时的未执行命令不会继续切歌。服务重启后需重新生成二维码。

服务配置 `KTV_PUBLIC_ORIGIN` 必须与浏览器访问的 origin 完全一致。
更换 IP/端口时同时修改 Compose 的端口绑定和该环境变量。

部署前备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-ktv.tgz`。
该备份保留旧网页、nginx、Compose 和 API 启动文件，不含用户浏览器凭据。

## Docker KTV 验证记录

17 个 `scripts/test-*.js` 通过；新增 host HTTP 测试和 browser bridge 测试覆盖
主机互斥、跨源拒绝、Guest/Host token 隔离、命令重试、过期、旧会话、关闭页面、
服务重启和慢请求心跳。生产构建通过；lint 无错误，保留 7 条既有 warning。
独立审查发现的四个重连/超时问题均补充失败回归后修复。
真实 ARM64 软路由上使用两个隔离 Chromium 上下文验证：二维码生成、手机尺寸
Guest 加入、真实搜索、第一首自动开始且播放器 `playing()` 为 true、Guest 切歌
HTTP 200、主机退出后服务 `active=false`。测试浏览器静音，未进行真实手机扫码和听音。
结束会话后重新开始也已验证：生成新房间链接，旧二维码不再沿用。
`ego-browser` 在当前 Windows 环境未安装，浏览器验证使用独立的 Playwright + Chrome。

实时浏览器验收脚本：`scripts/smoke-karaoke-docker-browser.js`，通过
`LUMASING_PLAYWRIGHT_MODULE` 和 `LUMASING_CHROME_PATH` 指定测试运行时。

## 本次部署验证

### 增量歌词舞台（2026-10-26）

滚动条修复：`KaraokeLyricScene.vue` 的全屏容器原先 `overflow:auto`，环轨
旋转文字/装饰溢出时产生横、纵原生滚动条。现限制横向溢出，并在歌词容器内
隐藏原生滚动条；保留长歌词纵向滚动和游标自动跟随，不改播放或点歌逻辑。
使用 ego-browser 的 `scripts/verify-lyric-scrollbars-ego.mjs` 回归函数，对实际
编译组件验证：修改前环轨失败；修改后本机构建与软路由部署均通过（三种舞台
滚动条无可见轨道、占位宽度 0，长歌词可滚动、换句后回到视野）。
18 项源码测试、生产构建通过，lint 无错误（7 条既有 warning）。
备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-scrollbar-fix.tgz`；
仅更新网页资源，未重启容器或中断既有房间；未做新的真实设备验收。

KTV 底部“歌词舞台”新增诗页、纵深、环轨；经典仍是默认模式，可随时切回。
这是一版独立实现的排版/入场动效，不是完整移植 Folia，也不伪造逐字时间。
原有渐变/霓虹/描边/纯色、16–64px 字号和歌词偏移继续生效。
横屏全屏遇到极长歌词时可滚动阅读；减少动态效果时关闭入场动画。

使用现有歌词游标和设置持久化，不新增请求、定时器或依赖。经典与新模式
均只渲染四行；10,000 行测试夹具切换模式新增歌词请求为 0。
没有测量真实设备 FPS/功耗，不能据此宣称帧率提升。

源码回归：`node scripts/test-lyric-stage-modes.js`。
浏览器回归：`node scripts/smoke-lyric-stages.js`，默认测试本机构建，设置
`LUMASING_WEB_URL=http://192.168.100.1:18080` 可验部署版本。
截图保存在忽略的 `artifacts/lyric-stages/`；测试夹具仅存在隔离浏览器内。

部署前备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-lyric-stages.tgz`。
仅叠加更新 dist（保留旧哈希资源），不重启 API/KTV，不修改用户数据。
已在上述路由器部署并复测三种舞台、二维码、Guest 加入/搜索、第一首自动播放、
Guest 切歌和结束后新建房间。浏览器验证通过不代表完成真实手机扫码或扬声器试听。

2026-10-26（Asia/Shanghai）：源码基于 `3e40c072319b58eb1e1fb8afe073300460f297e5`。
本机构建成功；两个运行镜像均为 arm64，已实际部署到上述目录。
HTTP 首页 200、标题 LumaSing；`/api/login/status` 返回 200；搜索返回 2 首歌曲；
测试歌曲 ID 5257138 的播放地址接口返回 200 且包含 URL。
两个容器重启后，首页、搜索和播放地址接口再次验证成功。
已设置 `unless-stopped`；未重启整台路由器，未进行手机/电脑实际音频试听。

二维码授权反向代理修复：nginx 默认响应头缓冲区不足，真实扫码确认时
日志出现 `upstream sent too big header` 并返回 502。现已恢复原项目的
`proxy_buffer_size 128k`、`proxy_buffers 16 32k`、`proxy_busy_buffers_size 128k`。
独立 Docker 回归测试使用八个 3KB 模拟 Cookie 响应头：修改前 502，修改后
200 且全部 Cookie 完整转发。实际账号扫码确认仍需用户本人操作。

回归测试（在路由器部署目录中，先复制本目录的 `tests/`）：

```sh
docker compose -p lumasing-header-regression -f tests/compose.yml up -d --pull never
docker compose -p lumasing-header-regression -f tests/compose.yml exec -T lumasing-api node /fixture/headers.cjs check
docker compose -p lumasing-header-regression -f tests/compose.yml down
```
