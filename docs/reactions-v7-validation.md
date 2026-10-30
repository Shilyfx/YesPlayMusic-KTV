# 登场效果与自定义间距复核（2026-10-27）

## 问题与修改

- `src/remote/styles.css`：真实点歌页面上，自定义按钮上方约20px、下方接近0。增加自定义容器下方20px留白，展开输入区域上方也设为20px。
- `src/components/karaoke/ReactionOverlay.vue`：将居中定位放到所有临时登场共用的根容器，取消依赖模式类。弹跳与温柔浮现使用显式宽度：小号86.4、中号192、大号264，分别比72/160/220增加20%；中央放大保持原有比例。
- `src/karaoke/reactions.js`、`src/karaoke/webRoomBridge.js`、`src/server/KaraokeWebHost.js`、`src/server/main.js`：Docker主屏启动时校验界面版本，并在只读状态中记录已接入主屏版本。旧页面不能静默重新成为主屏，会提示刷新。没有新增轮询。不能直接读取用户其他电脑已打开的页面，因此不把缓存推断写成已确认根因。
- `scripts/test-karaoke-reactions.js`、`scripts/test-karaoke-web-bridge.js`：验证旧版被拒绝且没有取得主机资格，新版携带版本并成功建立房间；兼容原有通道和其他显示字段。

## 验证

1. 定向ESLint、Prettier、git diff --check、Docker模式生产构建通过。
2. 互动接口、Web Host、Web Bridge回归测试通过。
3. ego-browser本地矩阵：主屏/副屏 × 全屏/非全屏 × 弹跳/温柔浮现，共8项。测量实际SVG而不是仅测外层容器，宽度均约192 CSS像素，中心偏差小于1像素。主屏非全屏以歌词舞台为中心，全屏主屏和副屏以显示区域为中心。
4. 软路由真实页面：主屏与副屏分别发送两种效果，实际SVG均为192px，中心偏差小于1像素。未模拟重置屏幕字号/角色偏好。
5. 真实点歌页：收起时上、下留白均约20px；展开后上、下留白约20px，按钮与输入区域约20.12px（包含字体布局取整）。
6. 真实服务端：缺少界面版本的启动请求返回409并提示刷新；新主屏与服务端均为 `centered-effects-v7`。

以上浏览器矩阵在同一台电脑完成，不代表实体多电脑或实体手机验收。没有直接确认用户其他电脑的旧页面版本。更新后应主副屏各刷新一次再指定主电脑。

## 部署

已更新软路由Docker KTV；KTV healthy，音乐API与Nginx未重启。
回滚：`/mnt/mmc1-4/lumasing-backups/20261027-before-reactions-v7.tgz`。
保留旧镜像：`lumasing-router-ktv:before-reactions-v7-20261027`。
资产包SHA256：`b3dbfcfee8683d07933aca2c5d903a3808914a645792444b0a985e1ae8ea6b23`。
主页面SHA256：`7f01b8f5d00e6e1ff0fd7c3c0d52c73fbd6b7c2142a6ca1e8066a8c77f22c8dd`。
KTV服务器SHA256：`afcbdc8d1b3a6ddc9bfad6560f8e9c40fd463a076defeb6a9f580259d776179d`。

本轮未提交/推送、未触发CI或桌面打包；未测性能Before/After数值。Guest切歌、Remote首曲自动开唱、本地曲库/增量索引、各屏独立歌词偏好保持原路径。
