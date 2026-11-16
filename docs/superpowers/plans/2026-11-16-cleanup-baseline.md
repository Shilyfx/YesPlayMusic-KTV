# 整理前基线与回退

整理工作目录为 `D:/VibeCoding/LumaSing-cleanup`，分支 `cleanup/20261116`，整理前源码检查点为 `f0d6919b119cd3f256f02f1ae9a656686989a25e`。原目录 `D:/VibeCoding/LumaSing` 的未提交文件保留原样。

检查点包含当时所有 Git 跟踪文件和未忽略的未跟踪文件。依赖目录、构建产物、临时文件及本地私有数据未复制进 Git。整理副本的 node_modules 是指向原目录依赖的联接，修改依赖前须单独隔离。

回退源码可从检查点新建 worktree 或分支。需要保留后续修改时先提交或备份，不在原工作目录执行硬重置。

## 当前线上

2026-11-16 只读核对时软路由 KTV 房间处于使用中。以下摘要仅用于比对，不能单独证明构建来源。

| 项目 | SHA-256 |
| --- | --- |
| 软路由 dist/ktv-server.cjs | `6c60ecd39c076d08b1e7263d44dc51bad8836a171435005ed27b3a404ee7a167` |
| 软路由 dist/remote/index.html | `3b5df2644ad818b1acbd5741849e45574135771a3fb185125446d1d55ca71c7c` |
| 软路由 dist/index.html | `985dea6ebcb25485ac66792e4b83b3abf5e9e46b565c541ce43e00f9c28b4f0b` |
| 软路由 compose.yml | `6342fc16286bb205bf0950efc3a4d1baef49c0defd24790898716dcc930a059f` |
| 云端 lumasing-ktv.conf | `928a8355a26f7c4b5afd6634ba091d31e1c74d094107ffa0d209d4c94ed269cd` |

软路由部署前备份位于 `/mnt/mmc1-4/lumasing/config_backup/public-ktv/`。上线前应新增完整部署备份并核对，不以旧备份覆盖新的现网状态。公网地址、证书和隧道见 docker/router/PUBLIC-KTV.md。

## 程序入口

- Docker 主屏和副屏经 `/karaoke` 进入，主屏房间桥接位于 `src/karaoke/webRoomBridge.js`。
- 来宾点歌由独立 `/room/` 页面进入，调用 `/ktv/api/`。公网 HTTPS 经云端 Nginx、SSH 隧道和来宾专用端口到同一个房间服务。
- `src/server/KaraokeWebHost.js` 管理 Docker 房间和主屏连接，复用 `src/electron/karaoke/KaraokeRemoteApi.js` 的来宾业务。
- Electron 桌面端通过 `src/background.js` 和 `src/electron/ipcMain.js` 对接房间服务。

## 发布产物回退

发布命令、归档边界及部署前检查见 [执行索引的软路由 KTV 发布清单](../../execution-index.md#软路由-ktv-发布清单)。打包脚本只生成归档，不会部署。默认归档不含 `dist/index.html` 和 `dist/ktv-server.cjs`；完整更新回退须连同备份里的这两个文件及归档覆盖的其他文件一起恢复。remote-only 回退只还原 `dist/remote/`，不要误覆盖主屏和服务端。

实际回退使用发布前刚创建并校验过的备份，不直接套用本页历史线上 SHA 或旧备份覆盖当前状态。恢复 Compose 挂载的路径时保持目录结构；若服务端 bind-mounted 文件的 inode 已更换，在路由器项目目录执行 `docker compose -f compose.yml up -d --force-recreate --no-deps ktv` 重新挂载，再检查健康状态和内网/公网入口。服务端重启会中断房间，操作前须再次确认房间空闲。源码恢复检查点为本页开头记录的 `f0d6919b119cd3f256f02f1ae9a656686989a25e`，它用于恢复源代码工作副本，不代替线上产物备份。
