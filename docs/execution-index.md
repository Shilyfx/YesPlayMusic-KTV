# 执行索引

本页只提供入口导航；任务状态、历史记录和部署事实以各自原文为准。

## 入口

- [当前执行清单](superpowers/plans/2026-11-16-task-handoff.md)：执行顺序、已完成项和待办。
- [整理基线与回退说明](superpowers/plans/2026-11-16-cleanup-baseline.md)：代码入口、线上指纹及回退注意事项。
- [整理阶段计划](superpowers/plans/2026-11-15-lumasing-code-cleanup.md)：整理范围与阶段安排。
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

## 部署

- Vercel、普通 Web 服务器、Docker、Replit 和客户端打包说明：见 [README 安装与部署章节](../README.md)。Docker 配置入口为 [docker-compose.yml](../docker-compose.yml) 和 [Dockerfile](../Dockerfile)。
- 软路由 KTV 构建、部署及日常管理：[路由器部署说明](../docker/router/README.md)；公网点歌配置：[公网 KTV 说明](../docker/router/PUBLIC-KTV.md)；对应 Compose 文件：[docker/router/compose.yml](../docker/router/compose.yml)。
