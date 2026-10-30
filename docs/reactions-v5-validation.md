# 互动角色与登场修复（2026-10-27）

## 范围与问题对应

- `src/karaoke/reactions.js`：补齐原版32个ID、名称与KTV说明，保留8个应援词；增加三角色元数据和统一解析。
- `src/remote/main.js`、`src/remote/styles.css`：互动应援支持球球、云宝、亮亮选择，预览与发送均使用所选角色；增加KTV应援/原版全部切换。预览仍为静态SVG，切换角色只重建预览网格，不新增轮询。
- `src/server/KaraokeWebHost.js`：发送接口接受经过固定允许列表校验的原版表情ID与角色，沿用认证、限速、过期、房间隔离和已有同步请求。
- `src/components/karaoke/ReactionActor.vue`：封装原版引擎的加载、静态绘制、可见性及销毁。切换角色或卸载时，用generation排除过期异步加载。
- `src/components/karaoke/ReactionOverlay.vue`：将常驻角色和临时登场分开，解决共用元素在动画结束时跳回左下角的问题。中央图层采用固定居中布局，倍率1.5改为1.8，淡出后销毁；连续发送先淡出旧表情，再创建新的登场图层。常驻角色独立淡入，不在屏幕中心和角落间移动。
- `src/views/karaoke.vue`、`src/views/karaokeWeb.vue`：传入播放状态与有无歌曲状态；常驻角色恢复呼吸眨眼，播放/暂停/空闲对应不同表情。
- `src/karaoke/moodMates.js`：原版两个引擎都在初始化时读取EMOTION_SEED。完整加载链串行，避免角色同时加载时互相覆盖种子数据；同一引擎保持single-flight和失败重试。
- `scripts/test-karaoke-reactions.js`、`scripts/test-reaction-loader.js`、`.github/workflows/phase-validation.yml`：补充96个角色表情组合、加载隔离和生命周期检查入口。

## 实测

1. Docker模式生产构建、定向ESLint、Prettier和git diff --check通过。
2. 表情接口96个组合通过；未知表情/角色被拒绝；认证、限速、开始/结束/切歌、过期、房间隔离测试通过。
3. Web Host、Web Bridge、Remote API回归测试通过；引擎加载隔离、single-flight、失败重试和缓存测试通过。
4. ego-browser本地页面：三个角色各32张预览均生成；390px页面没有横向溢出；静音测试音轨使用真实页面按钮验证点歌、播放、暂停、继续、切歌，暂停后常驻角色为06且动画引擎仍活动。
5. 软路由真实地址：发送云宝原版33，再连续发送亮亮原版14，主屏与副屏显示所选角色。中央动画中段与末段坐标一致，倍率1.8，末段透明度约0.024。登场结束后常驻角色恢复动画。验收使用单电脑浏览器页面，不代表实体多电脑或手机验收。

## 部署

已更新软路由Docker KTV。KTV healthy；音乐API与Nginx启动时间保持不变。
回滚归档：`/mnt/mmc1-4/lumasing-backups/20261027-before-reactions-v5.tgz`。
旧镜像：`lumasing-router-ktv:before-reactions-v5-20261027`。
临时验收房间已关闭。用户需要刷新页面并重新指定主电脑。

## 边界与下一步方案

当前常驻角色根据播放状态选择表情，原版引擎持续执行对应微动画。没有实现实际音频能量、节拍或高潮识别。
建议下一步由主电脑建立单一音频分析器，按能量及节奏起伏生成低频情绪状态，通过已有房间同步传给副屏。应验证HTML5/WebAudio播放路径、跨域和静音场景，不影响实际声音；设置冷却和迟滞避免表情频繁跳变。高能量不等于可靠识别副歌或歌曲情绪。

Guest切歌、Remote首曲自动开唱、本地曲库及增量索引保持原有路径。本次没有新增周期网络请求；未测量性能Before/After数值。GitHub CI与桌面打包未触发，实体手机/多电脑、连续真实歌曲体验待验收。
