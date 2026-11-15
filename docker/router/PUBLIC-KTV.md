# 公网点歌部署与迁移

公网入口使用独立 HTTPS 域名。云端 Nginx 把请求送到云端回环端口，软路由通过反向 SSH 转发把该端口连到本机的来宾专用监听端口。公网和内网共用软路由上的 KTV 房间。

| 配置 | 示例 | 设置位置 |
| --- | --- | --- |
| 公网点歌地址 | `https://ktv.shilyfx.icu` | 软路由 Compose 项目目录的 `.env` 文件，变量 `KTV_PUBLIC_GUEST_ORIGIN` |
| 隧道 SSH 目标 | 当前云主机或专用 SSH 主机名 | 软路由上的 SSH 服务配置 |
| 云端隧道端口 | `127.0.0.1:13101` | SSH 转发参数、云端 Nginx |
| 软路由来宾端口 | `127.0.0.1:13101` | Compose 的 `ktv` 服务端口映射 |

## 首次启用

1. 在 DNS 添加 `ktv.shilyfx.icu` 指向云主机的记录。签发覆盖该子域名的 HTTPS 证书。检查云端回环端口 13101 是否空闲，如需更换，只改反向转发的云端端口及 Nginx 上游。
2. 更新软路由的 KTV 构建产物和 Compose 配置。在 Compose 项目目录的 `.env` 设置 `KTV_PUBLIC_GUEST_ORIGIN=https://ktv.shilyfx.icu`，结束当前房间后执行 `docker compose up -d ktv`。配置在容器启动时读取。主屏开场后在二维码面板显示两个入口。
3. 为 KTV 创建专用 SSH 用户和密钥，限制该账户只能进行远端 TCP 转发，监听地址仅为云端 `127.0.0.1:13101`。在软路由预先校验并登记云主机的 SSH 主机指纹，再配置开机启动和断线重连。下面的命令可用于首次验证，示例账户和密钥路径按实际配置替换。

   ```sh
   ssh -NT -p 22 -i /etc/lumasing/ktv_tunnel_ed25519 \
     -o BatchMode=yes -o StrictHostKeyChecking=yes \
     -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
     -R 127.0.0.1:13101:127.0.0.1:13101 ktv-tunnel@CLOUD_HOST
   ```

4. 在云端现有 Nginx 中新增独立站点。证书路径替换为实际路径。先运行 `nginx -t`，通过后再重载。其他站点及 VideoCollector 的隧道、端口和证书配置照常使用。

   ```nginx
   server {
       listen 443 ssl;
       server_name ktv.shilyfx.icu;

       ssl_certificate /path/to/fullchain.pem;
       ssl_certificate_key /path/to/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:13101;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto https;
           proxy_connect_timeout 3s;
           proxy_read_timeout 20s;
           client_max_body_size 1m;
       }
   }
   ```

5. 手机关闭 Wi-Fi，从主屏扫码。确认搜索、点歌、正在播放、等待队列和应援可用，再用内网扫码确认进入同一队列。结束房间，确认旧的公网链接无法加入下一场。验证期间也应检查已有云端站点能正常访问。

公网转发目标始终是来宾专用端口。软路由的主站端口承载主屏和内部接口。公网来宾页支持在线搜索、歌手点歌、查看房间状态和互动。

## 换云主机，保留点歌域名

1. 在新云主机配置同一个域名的证书、专用 SSH 账户及 Nginx 站点。保留旧主机在线，先在软路由验证新目标的 SSH 主机指纹，再启动指向新主机的隧道。两台主机可以临时各维持一条隧道。
2. 在新云主机确认 `curl -fsS http://127.0.0.1:13101/room/` 返回点歌页。切换 DNS 前，可用 `curl --resolve ktv.shilyfx.icu:443:NEW_IP https://ktv.shilyfx.icu/room/` 检查新站点和证书。
3. 把 DNS 指向新主机。公网地址和软路由的 KTV 服务继续使用原配置，同一场已发出的链接保持有效。等 DNS 缓存过期并用手机流量确认后，停止旧隧道。
4. 若切换失败，把 DNS 指回旧主机，确认旧隧道仍在运行。

## 换点歌域名

1. 为新域名配置 DNS、证书和云端 Nginx 站点，可复用原隧道。
2. 在两场之间改软路由 `.env` 中的 `KTV_PUBLIC_GUEST_ORIGIN`，执行 `docker compose up -d ktv` 后重新开场。主屏将显示新二维码和新入场链接。把新链接发给来宾。
3. 如需给访问旧域名的人引路，可以保留旧域名和证书，在旧站点提供新地址。旧房间凭证随容器重启和房间结束失效，旧域名跳转无法替代重新分享新房间链接。
4. 若需回退，恢复原域名的配置并重启 KTV 服务，再开场生成链接。

需要临时停止公网时，可先停掉反向隧道。要同时隐藏主屏的公网二维码，在两场之间清空 `KTV_PUBLIC_GUEST_ORIGIN` 后执行 `docker compose up -d ktv`。密钥、私有证书和带入场凭证的链接应保存在仓库之外。

## 当前部署信息

- 公网地址为 `https://ktv.shilyfx.icu/room/`，DNS 指向 `112.125.122.203`。
- 云端站点配置位于 `/www/server/panel/vhost/nginx/lumasing-ktv.conf`，证书通过 Certbot 管理。
- 软路由项目位于 `/mnt/mmc1-4/lumasing`。运行时地址保存在该目录的 `.env`，来宾端口仅绑定回环地址。
- 隧道服务为 `/etc/init.d/lumasing-tunnel`，通过 procd 自动重连及开机启动。软路由密钥位于 `/etc/lumasing/tunnel_ed25519`，云端专用账号为 `ktv-tunnel`，目标地址保存在此服务文件。远端 SSH 主机公钥保存在软路由 `/root/.ssh/known_hosts`。
- 更新云主机时先核对新主机的 SSH 指纹，并替换服务文件中的云主机地址。更新软路由的 SSH known_hosts 后执行 `/etc/init.d/lumasing-tunnel restart`。新主机需配置专用账号和受限公钥，以及 Nginx、证书。
- 上线前的软路由文件备份位于 `/mnt/mmc1-4/lumasing/config_backup/public-ktv/`。
