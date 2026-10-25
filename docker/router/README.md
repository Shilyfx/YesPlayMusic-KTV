# LumaSing 软路由网页版本

目标设备：192.168.100.1，iStoreOS，Linux ARM64，Docker + Compose。

部署目录：`/mnt/mmc1-4/lumasing`。入口：`http://192.168.100.1:18080`。
这里只发布 LAN 地址上的 18080 端口；API 通过 nginx 的 `/api/` 访问，不单独发布端口。

本版本提供浏览器音乐播放器和 Docker KTV 扫码房间服务。
主机在 `/karaoke` 页面生成二维码，手机扫码点歌、Guest 切歌；第一首自动开唱。
音频在主机浏览器所在的电脑或电视播放，主机页面需要保持打开。
若浏览器拦截声音，点击「点击启用声音 / 播放」。
Electron 桌面专属的目录选择、本地曲库 IPC 不属于此部署；桌面原功能保留。
账号、播放列表等浏览器状态按项目原有方式存储在各浏览器中。
API 匿名 token 存储在部署目录的 `data/` 中。

## 构建和部署

在源码电脑设置 `VUE_APP_NETEASE_API_URL=/api` 并运行 `npm run build`，
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
