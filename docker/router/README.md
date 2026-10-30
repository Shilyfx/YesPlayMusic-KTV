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

### 副屏独立设置（已部署）

在副屏打开“本屏歌词设置”。默认勾选“跟随主屏样式”和“跟随主屏提前 / 延后”；
取消相应勾选后，可独立选择现有四种舞台、四种字效、16–64px 字号，以及
−10 至 +10 秒偏移（0.1 秒步长）。偏移基于原始歌曲时间，不叠加主屏偏移。
“全部恢复跟随主屏”只恢复跟随开关，保留此前保存的本屏自定义值。

副屏设置布局优化（2026-10-26）：顶部控件缩小 20%；歌词全屏后无操作约 2.4 秒
渐隐，鼠标移入可唤回；打开设置时歌词留在左侧，舞台与同步两组设置在右侧上下排列，
停止操作 8 秒后自动收起。同步偏移提供与主屏相同的 ±0.1 秒按钮、数值编辑和归零。
歌词区使用可用的剩余高度，长句仍可在舞台内滚动；移除底部 Docker 说明。
本机 ego-browser 界面回归、歌词偏好/投影/舞台测试、lint 与 Docker 生产构建通过。
已更新路由器静态资源；Web 容器启动时间未变、KTV 健康且房间仍 active，无服务重启。
备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-follower-display-polish.tgz`。
真实多电脑与实体显示器布局尚未验收。

副屏顶部对齐微调（2026-10-26）：修正通用 header 样式覆盖操作按钮方向的问题，
“本屏歌词设置 / 歌词全屏”现为同一行，并与返回按钮、中央状态垂直居中；全屏顶边
保留约 16px 间距。设置栏桌面最大宽度从 460px 降至 322px（缩小 30%），手机断点保留
原有相对宽度以免控件过窄。ego-browser 实测按钮横排、中心线误差约 0.004px、栏宽约
322px；本地测试、lint、生产构建通过。已只更新静态资源，KTV 房间继续 active，未重启
Web/KTV/API 容器。备份：
`/mnt/mmc1-4/lumasing-backups/20261026-before-follower-header-alignment.tgz`。

副屏标题与全屏留白调整（2026-10-26）：顶部标题固定为“副屏歌词”，在宽屏与歌名共用
屏幕水平中心线，连接状态和本屏静音说明仍动态显示。全屏时按当前屏幕底边与歌词组合
底边的实际距离，将组合下移该空隙的 30%，保留约 70% 原有下方留白；退出全屏或打开
设置时清除位移，并在换句、换舞台、字号变化和窗口尺寸变化后重新计算。ego-browser
本地实际页面回归测得中心线误差小于 1px；测试画面下方空隙从 420.34px 降至
294.24px（减少 30%）。相关歌词显示测试、lint 和 Docker 生产构建通过。
只更新网页静态资源，没有重启容器；网页容器启动时间保持
`2026-10-26T06:28:31.194681417Z`，KTV 健康检查正常、房间部署前后均为 inactive。
备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-follower-centering.tgz`
（SHA256 `ec5fd875ac634d682e16b4b8ac94636ce8b31dd59299f4f1169bec3eca95080e`）。
发布索引 SHA256 `d68526bd35d28d38ab7ea41cebec92a57b3814e09a47bb8b232a83c306855792`；
首页、KTV 页面及其 JS/CSS 均返回 HTTP 200。真实多电脑与实体显示器仍未验收。

设置仅保存在当前浏览器的 `lumasing.ktv.display.preferences.v1`，不写主屏
Vuex 设置、不发送房间控制命令；刷新仍保留。浏览器禁止存储时仅本次生效并提示。
主题仍跟随主屏，本功能不编辑歌词文字、不改变音源或副屏静音行为。

主屏心跳提供原始时间前后 13 秒上下文（10 秒偏移 + 3 秒外推余量），不新增
请求或轮询。密集歌词按时间覆盖；极端数据以 4096 行 / 192KiB UTF-8 为限，
显式传递有效范围，超出时提示范围不足而非显示错误歌词。Host body 上限 1MiB，
继续先鉴权后读取。部署需同步更新 KTV 后端、刷新主屏并重新指定主机。

22 项源码回归和生产构建通过；ego-browser 本地编译页面验证了独立设置、
持久化、恢复跟随、全屏/窄屏及歌词不重复闪现；真实本地 KTV 后端的一主两副
流程通过。用户明确允许立即更新后，已部署到软路由并复测上述 UI、歌词连续性、
一主两副、Guest 首曲自动开唱/切歌、暂停/跳转/继续和重新指定主机，均通过。
仅 KTV 容器重建，音乐 API/web 未重启；测试房间已释放，健康状态正常。
部署备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-display-preferences.tgz`。
部署源码 `6aae7c942490dded9dd35df51fef5912b5a92e8d`；归档 SHA256
`bf210cb1579934a755118f98f367148183436c969123e5d71781540e8e22663c`。
实体多电脑、手机扫码和扬声器试听仍未验收，浏览器播放测试静音执行。

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

### 副屏点歌、主题与下一首（2026-10-26）

副屏右下角显示下一首曲目；顶部新增「点歌」并在新标签页打开当前房间 Guest
点歌页，将「本屏歌词设置」改为「歌词设置」。深浅主题使用主屏相同的切换控件，
默认跟随主屏，也可在本屏单独选择并持久化。新增按钮仍随顶部控件在歌词全屏时渐隐，
鼠标移入后显示。显示接口仅增加 Guest 加入链接和下一首的标题/歌手，不返回主机控制令牌。

回归：display preferences、KTV host/display/client、歌词舞台测试、lint、生产前端与
KTV 服务构建均通过；ego-browser 本地页面确认点歌新标签、主题切换、下一首、全屏渐隐，
全屏下方留白比例与此前约 30% 调整保持一致。部署后首页、`/karaoke`、KTV 健康接口及
首页引用的 JS/CSS 均返回 HTTP 200；KTV 健康为 `ok=true, active=false`。按此前授权重启
KTV 容器，结束了当时的房间；Web 与音乐 API 容器启动时间保持不变。需重新指定主电脑。

备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-follower-controls.tgz`
（SHA256 `646e0b8f4214bb9295d725da331a4d3f0a12fe79d279eb459dd1ed4902ce1819`）。
发布索引 SHA256 `0e745f4a3e1aaf188992058d1cf0d91f6ae734ed5510e35cabb957435055fc7e`；
KTV 服务包 SHA256 `a9b5c14eac1a2665f4a5a21da62c7e12b1b19e1371d57b439dec4746b6e71`。
未进行真实多台电脑/实体显示器验收。

回归测试（在路由器部署目录中，先复制本目录的 `tests/`）：

```sh
docker compose -p lumasing-header-regression -f tests/compose.yml up -d --pull never
docker compose -p lumasing-header-regression -f tests/compose.yml exec -T lumasing-api node /fixture/headers.cjs check
docker compose -p lumasing-header-regression -f tests/compose.yml down
```

### 副屏主题切换横排（2026-10-26）

根因是副屏 header 的通用 `div` 规则将主题控件覆盖为纵向布局，导致顶部栏被撑高。
现将主题三段切换横排并移到「点歌」左侧，桌面 header 固定最小高度 40px；窄屏时
操作区单独换行并允许控件折行，避免与「返回音乐」重叠或横向溢出。点歌、设置、全屏
控制及其全屏渐隐行为保持不变。

ego-browser 回归：桌面 theme→ 点歌顺序、水平排列、垂直对齐、header 40px；375px
设备模拟下（浏览器 CSS 视口 341px）操作行与返回按钮分离且无横向溢出。并复测主题
切换、点歌新标签、设置面板、全屏渐隐和下方歌词留白比例。lint 与生产构建通过；构建
仍报告现有 caniuse-lite/Sass 过时提示及 CSS 顺序、资源尺寸 warning。

仅覆盖更新网页静态资源，没有重启 KTV、Web 或音乐 API。部署后首页、`/karaoke`、
KTV 健康接口及新 JS/CSS 均 HTTP 200；KTV `healthy, active=true`，三个容器启动时间
保持不变。实体电脑/电视未验收。

部署前 dist 备份：
`/mnt/mmc1-4/lumasing-backups/20261026-before-follower-toolbar.tgz`
（SHA256 `de0baf818141881c8b1fb4e68d09fa65003a9dc9dc170bce77b39a8d49c1d57a`）。
静态资源包 SHA256 `56cad9b1310fb9d13d13d2a9fc3d7ffdc4cd81db6c44e61a94994af471b26e7c`；
发布索引 SHA256 `1bbcf756626efbfa479f82f807b2829b1b4f2437b4c5e63421e5fa1f7a50cdca`。

### 隐藏副屏当前歌曲信息（2026-10-26）

副屏页面移除了歌词舞台上方的当前歌曲名/歌手行；只改副屏自己的模板，主屏歌曲信息
不变。歌词、顶部“副屏歌词”、下一首提示及歌词设置仍显示。

ego-browser 使用合成歌词验证歌曲信息行不存在且当前歌词仍显示，并复测主题切换、
点歌新标签、歌词设置、全屏渐隐与歌词留白。lint 与生产构建通过。部署只叠加静态资源，
KTV/Web/API 均未重启；KTV 仍 healthy 且 `active=true`。首页、`/karaoke`、健康接口和新
JS/CSS 均 HTTP 200。没有进行实体设备验收。

部署前 dist 备份：
`/mnt/mmc1-4/lumasing-backups/20261026-before-hide-song-title.tgz`
（SHA256 `b1c71f7945acb29cd827537e888852c01789a1143577d09183cda966b93497f9`）。
静态资源包 SHA256 `48a8b69f5a74cbe5617f877710220fc714c8bf8804f5bb67d4fff7840805f359`；
发布索引 SHA256 `95faa08469a336ef85397634985b2bc2f966753f2910aa0effea41df3e66ed36`。

### Folia 原版 Sonnet / Tempera / Hanabi（2026-10-26）

新增商籁、拼贴、花火；主屏和副屏共用选择器中的七个模式。此次使用 Folia 提交
`aecd330b720eb8fc728e6b10ebcec261b144d683` 的原版分镜和 Pixi 运行时，165 个源码文件
与上游逐字节一致，清单和 AGPL-3.0 许可证保存在 `vendor/folia-pv/`。Vue 适配层管理
播放时钟、初始化取消、隐藏/暂停、主题和销毁；不启动第二路音频。

PV 采用原版字效，Sonnet/Tempera 接收字号比例，Hanabi 保留构图自动字号。原有模式的
渐变/霓虹/描边/纯色与字号设置保留。副屏歌名隐藏仍有效；Folia 的 AI 主题、音频分析模型、
模组宿主和用户图片库不在本次移植范围。普通 LRC 只有行时间，原版算法的字间时间分配
不代表真实逐字对齐。

整首歌词通过主机 exchange 在文档变化时上传，服务端保存按 generation/revision
隔离的只读文档；副屏在现有 polling owner 中按版本 single-flight 获取并缓存同一对象。
无效/超大可选文档不会阻断心跳和 Guest 命令；完整请求超 1 MiB 时先发送基础状态，
后续不带大队列快照的请求再补传歌词。原来的滚动时间窗口继续服务既有舞台。

验证：14 项 KTV 源码测试全部通过（含 Guest API、播放器和本地曲库增量索引），
原版编译器确定性/定位、时间转换/缓存与时钟插值测试通过；锁文件冻结安装、定向 ESLint、
Prettier、前端和 KTV 服务构建通过。前端构建报告 12 组 lint/CSS 顺序/资源体积警告。
本地真实 HTTP 服务加真实副屏轮询器的浏览器测试完成 8 次状态请求、两个歌词版本，
完整文档只取两次；时钟刷新、定位和本屏偏移保持同一 canvas。

ego-browser 在本机生产构建与软路由部署上确认三种原版 WebGL 动画出图、主题/暂停/定位、
快速切换取消、长歌词、减少动态效果、全屏和返回旧舞台。实际主屏 Vue 页面也验证三种
引擎接收完整歌词（合成歌词、没有申请房间）。模拟 WebGL 不可用时保留歌词并可重试恢复。
线上设置面板宽 322px，七个选项和 AGPL 源码下载入口正常。未做实体多电脑/手机/电视验收，
未测真实 FPS、功耗或重新打包桌面安装包；GitHub CI 本次未触发。

PV 模块共 54 个 JS 文件、约 1.70 MB 未压缩，按需加载；service worker 预缓存排除整个
`pv/` 目录。对应源码使用明确白名单打包至 `/pv/source.tgz`，不含环境文件、登录数据、
node_modules 或 Git 元数据，源码与许可证入口均 HTTP 200。

部署前备份：`/mnt/mmc1-4/lumasing-backups/20261026-before-original-folia.tgz`
（SHA256 `47ffc6a806992c647e3fad7be50d8fdb32d093447aafd3b1036d8099034f37f0`）；
旧镜像另保留为 `lumasing-router-ktv:before-folia-20261026`。仅重建/重启 KTV，启动时间
变为 `2026-10-26T10:04:34.910527581Z`，部署后 healthy、房间 inactive，需重新指定主电脑。
Web/API 容器启动时间保持原值，页面与 PV 模块 HTTP 200。

最终资源包 SHA256 `f1c7c810bf3f560970e651d53ce54641a5cab93679ef838eb4fc2579aada52ec`；
索引 SHA256 `bbb8e5de04de5d95dd55fa726e6c576a9b6cd33325d622352b35f9c54c6b05a8`；
KTV 服务包 SHA256 `bc6909ee986d1c9c8606ab85e883f066a6b0f8f16aa9895955e8c7cc522acb94`；
对应源码包 SHA256 `d8c48886f997dd9887649cf3739a2378263488be69412c90ad110a657c3048cc`。

### 2026-10-26：原版 PV 行时间与全屏边界修复

- `src/karaoke/folia/timing.js / toFoliaLines`：此前一整句 LRC 作为一个 word，
  上游 `buildWordGraphemeTimings` 会把整句时间均匀分给每个字；不均匀演唱及句尾停顿
  会形成假的逐字节奏。现在无逐字数据的歌词显式使用共享行起止时间及整句语义边界，
  原版分镜、字体与转场保留；真实 word 时间输入仍原样保留。不是通过修改用户偏移纠正。
- `karaokeWeb.vue / display-stage`：浏览器实测受到全局 main 样式影响，原舞台
  padding 为 `64px 175.634px 96px`（1756px 视口）；显式清零。
  副屏 PV 全屏单独铺满容器，不使用旧舞台向下平移和留白。
- `karaoke.vue / stage:fullscreen`、`KaraokePvScene.vue`：原版画布全屏定位铺满，
  清除继承的歌词 padding，避免原版不透明背景成为嵌入矩形。旧舞台布局规则保留。
- 验证：先用真实上游 grapheme 函数复现失败测试，再验证共享行时间与真实 word
  时间保留；三种原版编译器/确定性/定位、display-client、display-preferences、
  player、remote-api、local-library 增量索引、舞台模式测试通过。
  ESLint、Prettier、diff 检查及 Docker 模式生产构建通过（保留既有构建警告）。
  ego-browser 本地实际主屏与副屏的三个 PV 全屏 canvas 均铺满屏幕（误差 <1px），
  同时验证主题、暂停/定位/独立偏移、快速切换与旧舞台。合成歌词验证不能替代真实歌曲听感。
- 仅覆盖静态资源，索引最后原子替换；没有重启容器，当前房间和音乐播放保持。
  三个容器启动时间与前次部署相同；没有提交、推送或触发 GitHub CI、桌面打包。
  Guest 切歌、Remote 首曲自动开唱、本地曲库及增量索引语义未改变。

备份 `/mnt/mmc1-4/lumasing-backups/20261026-before-pv-sync-layout-fix.tgz`，
SHA256 `de23ee9d6c9ac098a6f63f6a1544a16964cc786af8272cae558ef816399924c8`。
静态包 SHA256 `3b045f248b0bd3264dc26440c9684b729bf409cfaff3955c5df4e1d9f63fe6b2`；
索引 `18b75d380566ef64aaa64cb6d4365f0421d2827d1736db48629b5463d647722f`；
对应源码包 `5451093c735f93ff6653bb8c6f1f4e71621f7796637e0723506060b250e7ee66`。
未完成：用户实际错位歌曲的逐句听感、多电脑实体同步、电视/手机验收；无实际 FPS 测量。

### 2026-10-26：主屏控件精简与底部对齐

按最终截图要求，`karaokeWeb.vue` 移除主屏顶部切换副屏按钮及其专用确认入口；
`karaoke.vue` 移除主屏底部的原版 PV 说明和源码链接。原说明占据右侧第二行，
删除后沿用底部网格居中布局，歌词字号/舞台/字效与左侧同步控件恢复同一水平中心。
顶部原有“结束 KTV”入口保留。此次只调整主屏界面，源码下载资源仍随部署提供。

格式、ESLint、diff 检查和 Docker 前端生产构建通过；ego-browser 在本地产物和
路由器部署上确认主屏无被删按钮、无底部说明，两侧按钮垂直中心差为 0px。
仅发布静态资源，没有重启容器。未重新进行实体多电脑验收，未触发 GitHub CI 或桌面打包。

部署前备份 `/mnt/mmc1-4/lumasing-backups/20261026-before-master-header-label.tgz`，
SHA256 `45e94e708107ed3eae83d5d54bced9a99ba3b62a229be4699654d23bba5df17c`。
资源包 SHA256 `2699310cd5549070b4080ca680ec97b02e2b8c27ae1b6fcc222bb3fb9a3ddcca`；
索引 `b6c83e02c5fd5ad18ada36864999155b31ff3ec4113ad7db9f8446d1effb52d5`；
对应源码包 `becfaa8e9cda688b32f90b6524afed04c18fa4ab68c96a4d8aa46b6c32b3c0de`。

### 2026-10-26：副屏点击外部收起、二维码缩放与商籁防裁切

- `src/views/karaokeWeb.vue / closeSettingsOutside`：设置面板与切换按钮增加 ref，
  document 的 pointerdown 在面板外关闭设置并清理关闭 timer；面板内与原生下拉框
  操作保留，组件销毁时移除监听。原来只支持按钮或超时关闭。
- `src/views/karaoke.vue / room-access-overlay`：桌面与小屏的定位规则中对二维码
  面板整体应用 scale(0.8)，以顶部中心为原点；文字、二维码与控件一起缩小，
  本地歌单弹层不缩放。浏览器实测面板与二维码宽度比例均为 0.8。
- `src/karaoke/folia/sonnetViewport.ts / fitSonnetLyrics`、`viewportFit.js`：原版
  商籁文字排版之后仍会经过镜头放大、偏移、旋转和转场，能把正文推到画布之外。
  现在缓存当前分镜的正文核心字形尺寸，在原版镜头与转场更新后测量其实际矩形，
  仅在超界时缩小或平移回 4% 短边安全间距。背景装饰、光晕、回声不参与尺寸计算，
  不扫描整首歌词，不增加 timer、网络请求、歌词上传或持久化。
- 原版运行时仅 `createSonnetPixiRuntime.ts` 增加一个可选回调扩展；164 个文件
  与固定上游提交相同。改动记录在 `vendor/folia-pv/LUMASING.patch`，重新提取依赖
  的脚本会重放补丁，失败即中止。主屏与副屏共用适配层；其他舞台原有算法保留。

验证：原版编译器/定位/行时间/时钟、实际 Pixi 旋转缩放矩阵与安全边界回归测试通过，
display lifecycle 测试通过；Prettier、ESLint、diff、Docker 前端生产构建通过，
构建保留既有警告。ego-browser 在本地验证主屏小舞台、大字号、短句/长句、13 个播放
及转场时刻，并确认面板内点击不关闭、外部点击关闭；线上确认副屏全屏正文边界、
主屏正文边界与二维码缩放均正确。浏览器验收使用合成歌词/演示二维码，不是手机实扫
或多电脑实体同步验收；未测真实 FPS、未触发 GitHub CI 或桌面安装包构建。

仅静态更新，三个容器启动时间未变，保留当前房间。Guest 切歌、Remote 第一首自动
开唱、本地曲库和增量索引的实现未改动。

备份 `/mnt/mmc1-4/lumasing-backups/20261026-before-settings-qr-sonnet-fit.tgz`，
SHA256 `d82970f810e855764bea2a63991d00f4015806f05d91f4116eb295dd706c5f80`。
资源包 `2a76a295978ca5c0a1d229114ae832eb2095d9b6184ed623f2189dabaef8f850`；
索引 `4d03eaa71d95dbb886da0dc4ddd23ed74c713b798d7847aabdcaf8c150d43a62`；
对应源码包 `a9161de713149e51a3faca01face76eee9f376cae67111e049c108a0edc980e3`。
