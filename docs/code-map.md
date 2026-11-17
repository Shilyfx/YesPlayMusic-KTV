# KTV 代码入口与职责

- [主屏视图](../src/views/karaoke.vue)协调主屏操作、房间与各面板；[副屏视图](../src/views/karaokeWeb.vue)负责连接、只读投影与本机设置。两者共用歌词舞台、设置面板和节拍控件；副屏的设置与跟随状态由副屏单独管理。
- [队列与会话协调](../src/karaoke/KaraokeManager.js)负责当前歌曲、待唱和会话生命周期；[播放器适配器](../src/karaoke/KaraokePlayerAdapter.js)区分本地与在线播放并转发播放事件。刷新恢复的范围与限制见当前清单。
- [网页主屏房间桥接](../src/karaoke/webRoomBridge.js)负责网页主屏与房间服务的交换；桌面应用另经 Electron IPC 接入。
- [独立点歌页](../src/remote/main.js)是来宾页面入口，搜索、分页、试听及连接状态的独立模块位于同目录。
- [Docker 房间服务](../src/server/KaraokeWebHost.js)承接主屏、副屏和来宾请求；[点歌业务与 API](../src/electron/karaoke/KaraokeRemoteApi.js)供服务复用。公网入口另外经过反向代理和隧道，参见[公网配置](../docker/router/PUBLIC-KTV.md)。
- Folia 舞台渲染和 SmartBeat 继续使用现有实现；修改它们时应单独验证主副屏和深浅主题，避免将第三方资源搬移或删除当作普通清理。

队列恢复使用当前浏览器标签页的 sessionStorage，快照有效期最长 24 小时；恢复后需要重新指定主屏，不会自动恢复播放。主动结束 KTV 会清除恢复数据。点歌请求去重记录位于服务进程内，服务重启后不能保证对重启前的重试继续去重。
