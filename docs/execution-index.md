# 执行索引

本页只提供入口导航；任务状态、历史记录和部署事实以各自原文为准。

## 入口

- [当前执行清单](superpowers/plans/2026-11-16-task-handoff.md)：执行顺序、已完成项和待办。
- [整理基线与回退说明](superpowers/plans/2026-11-16-cleanup-baseline.md)：代码入口、线上指纹及回退注意事项。
- [整理阶段计划](superpowers/plans/2026-11-15-lumasing-code-cleanup.md)：整理范围与阶段安排。
- [历史记录索引](history-index.md)：历史设计、排查和阶段记录；保留原始路径。
- [KTV 工作流说明](../KTV_Project/AI_WORKFLOW/README.md)：持续任务的开始、记录和审查入口。

## 测试

- KTV 快速回归：`yarn test:ktv:quick`；覆盖房间/API、目录分页、播放及主副屏。入口为 [`scripts/test-ktv-quick-regression.js`](../scripts/test-ktv-quick-regression.js)，CI 配置见 [phase-validation.yml](../.github/workflows/phase-validation.yml)。
- 定向回归：点歌/API、访客、房间和主副屏测试位于 [`scripts/`](../scripts/)；按改动选择对应 `test-*.js`。
- 构建与发布清单检查：`yarn test:local-ktv-build`、`node scripts/test-ktv-release-manifest.cjs`，命令和脚本见 [package.json](../package.json) 与 [`scripts/`](../scripts/)。

## 构建

- 网页生产构建：`yarn build`，生成 `dist/`；定义见 [package.json](../package.json)，Docker 构建见 [Dockerfile](../Dockerfile)。
- 本地 KTV 网页构建：`yarn build:local-ktv`；验证命令为 `yarn test:local-ktv-build`，均定义于 [package.json](../package.json)。
- KTV 服务包：`node scripts/build-ktv-server.js`，输出 `dist/ktv-server.cjs`；脚本见 [`scripts/build-ktv-server.js`](../scripts/build-ktv-server.js)。
- Electron 客户端：平台命令见 [package.json](../package.json) 中的 `electron:build-*` 脚本。

## 软路由 KTV 发布清单

在仓库根目录执行。先运行 `yarn test:local-ktv-build` 和 `node scripts/test-ktv-release-manifest.cjs`；再构建本地 KTV 页面、房间服务及版本清单：

```sh
yarn build:local-ktv
node scripts/build-ktv-server.js
node scripts/write-ktv-release-manifest.cjs
```

按发布范围选择一种归档命令，输出必须放在 `dist/` 之外：

```sh
# 完整 dist 静态资源归档（保留原有默认范围）
node scripts/package-router-update.cjs scratch/ktv-router-update-full.tgz

# 只更新独立点歌页
node scripts/package-router-update.cjs --remote-only scratch/ktv-router-update-remote-only.tgz
```

默认归档包含 `dist/` 根目录中除 `index.html` 与 `ktv-server.cjs` 外的内容（包括 `remote/`）；完整更新时须另外更新这两个文件。`--remote-only` 归档仅包含 `remote/`，不会替换主屏、服务端或其他静态文件。两种归档都会校验点歌页 HTML 引用的散列 JS/CSS 存在；用 `tar -tzf <归档路径>` 复核最终文件清单。`ktv-release.json` 记录提交、构建时间、工作区是否有改动，以及主屏、点歌页和服务端入口 SHA-256；发布前确认 `workingTreeDirty` 为 `false`。默认归档包含它，remote-only 归档不包含它，因此 remote-only 部署记录需注明实际部署范围。

实际部署前，为 `dist/`、Compose/Nginx/环境配置及需要保留的数据建立新的备份并记录 SHA-256；确认房间空闲后再更新。回退完整更新时，从同一份备份恢复 `dist/index.html`、`dist/ktv-server.cjs` 及完整归档覆盖的文件；回退 remote-only 时只恢复 `dist/remote/`。保持 Compose 挂载目录和文件路径不变；若服务端文件 inode 已更换，在路由器项目目录执行 `docker compose -f compose.yml up -d --force-recreate --no-deps ktv` 重新挂载。恢复后检查服务健康和主屏/来宾页入口。不要用源代码硬重置代替线上产物回退；本轮仅补充文档，不执行部署。

## 部署

- Vercel、普通 Web 服务器、Docker、Replit 和客户端打包说明：见 [README 安装与部署章节](../README.md)。Docker 配置入口为 [docker-compose.yml](../docker-compose.yml) 和 [Dockerfile](../Dockerfile)。
- 软路由 KTV 构建、部署及日常管理：[路由器部署说明](../docker/router/README.md)；公网点歌配置：[公网 KTV 说明](../docker/router/PUBLIC-KTV.md)；对应 Compose 文件：[docker/router/compose.yml](../docker/router/compose.yml)。
