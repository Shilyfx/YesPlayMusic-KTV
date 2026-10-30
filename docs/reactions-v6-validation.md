# 应援内容合并与居中效果验证（2026-10-27）

## 修改对应

- `src/karaoke/reactions.js`：新增统一的32张KTV应援卡片数据，保留原版ID供引擎使用；新增自定义文字规范化与40个Unicode码点上限。原8种接口保留兼容，不再作为独立UI分类。
- `src/remote/main.js`、`src/remote/styles.css`：移除KTV/原版全部分类，统一显示32张应援卡片；出场方式下方增加“自定义内容”按钮、输入区、计数与恢复默认。切换角色不会清空自定义文字。
- `src/server/KaraokeWebHost.js`：自定义文字经过类型、长度和控制字符校验后，作为同一条互动事件的字段同步。保留现有鉴权、限速、过期与房间隔离，不增加轮询。
- `src/components/karaoke/ReactionOverlay.vue`：所有临时登场使用中央图层；弹跳与温柔浮现基准宽度160改为192，增加20%。中央放大保持已有放大比例。自定义文字使用Vue文本插值展示，清空时恢复卡片文案，长文字换行。
- `scripts/test-karaoke-reactions.js`：新增Unicode计数、空白处理、超长/对象/控制字符拒绝，以及三角色96个组合的自定义文字传递验证。
- `docs/ktv-music-reaction-plan.md`：单独交付实时音频分析、延迟目标、工期估计、兼容性Gate、人工互动优先级与多人公平排队方案。音频分析和新调度器未在本次实现。

## 验证结果

- Docker模式生产构建、定向ESLint、Prettier、git diff --check通过。
- 互动接口、引擎加载器和Web Host测试通过；三角色96个表情组合可携带经过校验的自定义文字。
- ego-browser本地页面：32张统一卡片，无分类按钮；自定义文字原样显示，HTML标签文本不被解释成DOM；超长内容被阻止发送；恢复默认成功。
- 本地390px模拟手机布局没有横向溢出。截图：`artifacts/reactions-v6-mobile.png`。不是实体手机验收。
- 软路由真实页面：32张卡片、0个分类按钮、自定义按钮存在。使用临时房间发送云宝和自定义文字，主屏、副屏均显示同一文字；弹跳与温柔浮现的中段宽度为192，中心误差小于1 CSS像素。
- KTV容器为healthy；音乐API与Nginx没有重启。临时验收房间在关闭浏览器验收会话后结束。

## 部署记录

Base/当前Git HEAD：`252a0f59a1639598725e1c81f55fae3bbb7ebd14`；本轮未提交或推送。
回滚归档：`/mnt/mmc1-4/lumasing-backups/20261027-before-reactions-v6.tgz`。
保留旧镜像：`lumasing-router-ktv:before-reactions-v6-20261027`。
部署资产包SHA256：`272c3038a6c47b3306b9b2fe5e9ad4f2db4f5148f3699e4c88eb44abe6d812ce`。
主页面SHA256：`2b1213cee2616c5aa2a5663b78e38e09d2f32d7d5848d16c74adce6a675ac65d`。
KTV服务器SHA256：`7adbd8e13c29ef4eb25d86e82fb3aaf96c9769d50727aa6be46dea627dc6433f`。

没有实测性能Before/After数值，没有触发GitHub CI或桌面打包。实体手机、多电脑及连续真实歌曲体验仍待验收。Guest切歌、Remote首曲自动开唱、本地曲库和增量索引沿用既有路径。
