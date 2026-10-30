# 互动应援 v4 验证记录（2026-10-27）

## 修改与原因

- `src/remote/main.js`、`src/remote/styles.css`：原互动条未沿用页面圆角，依赖系统 emoji 和原生下拉框。改为独立“互动应援”标签，先选择出场方式，再点球球预览卡发送。沿用页面字体、24px 圆角与主题色，390px 宽度使用两列卡片。
- `src/karaoke/reactions.js`：统一八种 KTV 应援文案、上游表情 ID 和自动状态映射，避免手机与舞台各自维护不一致的数据。
- `src/components/karaoke/ReactionOverlay.vue`：旧状态排队可能过期而不显示；停止动画前切换待机表情可能没有实际绘制最终帧。改为最新操作立即显示，暂停保留休息表情；先停止动画再静态绘制最终帧。中号增大至160px，反馈持续4.2秒。保持透明背景和右键设置。
- `src/server/KaraokeWebHost.js`：使用共享允许列表支持新增应援，保留原有认证、限速、过期、房间隔离和现有同步通道。
- `scripts/package-router-update.cjs`、`scripts/build-folia-pv.cjs`：打包时枚举根目录，验证包含 `remote/index.html` 和它引用的脚本，防止 tar 排除规则误删点歌入口。对应源代码归档包含打包脚本。
- `scripts/test-karaoke-reactions.js`：验证全部应援可发送、映射到真实上游表情，保持认证、限速、自动状态和去重测试。

## 已完成验证

- Docker 模式生产构建、定向 ESLint、Prettier、git diff --check 通过。
- 互动服务、Web Host、Web Bridge、Remote API、显示客户端、本地曲库增量索引测试通过。
- ego-browser 本地页面：390px 布局截图、八张真实球球 SVG 预览、无表情下拉框，发送后主屏实际 SVG 与表情 ID 发生变化。
- 本地静音测试音轨：真实队列点歌，以及页面按钮播放、暂停、继续和切歌，均触发对应表情；没有替换这些业务方法。
- 软路由真实地址：手机点歌模块发送 encore 后，主屏实际 SVG 变化；发送 love 后主屏和副屏均切换到上游表情14。验收使用同一台电脑的浏览器页面，不代表实体多电脑或实体手机验收。
- KTV 容器重建后 healthy。Nginx 与音乐 API 的启动时间保持不变。

## 部署与回滚

部署前归档：`/mnt/mmc1-4/lumasing-backups/20261027-before-reactions-v4.tgz`。
保留镜像：`lumasing-router-ktv:before-reactions-v4-20261027`。
真实页面验收用临时房间已关闭，用户需要重新指定主电脑。

## 功能与性能边界

Guest 切歌、Remote 第一首自动开唱、本地曲库与增量索引保持原路径。本次复用主副屏既有同步请求，没有新增轮询；表情预览在打开模块时加载，以静态 SVG 显示，不保留动画实例。未测量性能 Before/After 数值。

尚未完成实体手机、实体多电脑、真实歌曲连续使用验收；未触发 GitHub CI 或桌面打包。
