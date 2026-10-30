# KTV 音频能量实时联动与互动优先级调度验证记录（2026-10-27）

## 修改与依据

| 文件 / 模块 | 问题 / 需求与根因分析 | 修改方案 | 验证结果 |
| --- | --- | --- | --- |
| `src/karaoke/musicReactionAnalyzer.js` | `Player.js` 采用 Howler `html5: true` 与 `setSinkId` 输出设备切换；若对无 CORS 的跨域 `<audio>` 强行挂载 `MediaElementAudioSourceNode`，按 W3C Web Audio 规范会导致静音或绕过输出设备；同时网易云在线流媒体音源（`https://m*.music.126.net/...`）属于跨域音源，若仅用静态兜底会导致角色一直停留在单一表情 `10` | 实现 Gate A 安全检测 `canSafelyTapMediaElement`：对 `blob:`、`data:`、`file:`、同源或显式开启 CORS 且未指定特殊输出设备的音源建立 `WeakMap` 单例分析节点执行 20Hz 时频采样；对在线跨域音源，保持原播放链零侵入，新增 `extractLyricCadenceFeatures` 结合实时歌词时间轴、句间密度、前奏/间奏留白与歌曲段落计算实时律动能量包络与节拍脉冲，驱动同样的状态机与节奏动作 | 同源/Blob/文件安全放行、跨域与自定义输出设备拦截、在线跨域音源歌词节奏能量与状态起伏校验通过 |
| `src/karaoke/musicReactionAnalyzer.js` | 音乐情绪若直接按固定音量或单次鼓点切换，会导致不同响度歌曲表现失衡或频繁变脸 | 实现 `createMusicReactionController`：新歌起播前 6.5s 建立本曲动态 RMS 均值与离散度基准（期间显示专注聆听 `16`）；状态切换需 1.5s 同向持续观察确认、进入后至少保持 4.5s 并采用进出迟滞阈值；本地节奏点头遵循敏感度冷却（520ms–1100ms），撒花大动作强制 15s 冷却；支持柔和/标准/热闹三档调节；区分静音（保持聆听 `16`）与暂停（休息 `06`） | 起播校准、短促爆音不误切、持续增强进入 `13`/`33`、4.5s 最短保持、15s 撒花冷却、静音不误判暂停、切歌与进度拖动重置全部通过 |
| `src/karaoke/reactionScheduler.js`、`src/server/KaraokeWebHost.js` | 原互动采用扁平数组追加，缺乏多人并发席位限制、同人连点防饿死保护及切歌待播清理 | 新增服务端统一调度器 `createReactionScheduler`：最多 1 个正在展示 + 2 个排队等待；同人连点在展示中原地替换（若他人正在排队则最多允许延长当前席位 1 次，防止连点饿死后续宾客），在排队中则原地更新自身席位不额外占坑；等待队列已满返回 429 `REACTION_QUEUE_FULL` (`busy`)；切歌时自动取消上一首歌在播及排队中的人工互动；对外输出剥离 `senderId` | 同人替换、双人/三人排队、第四人繁忙拒绝、防饿死上限、切歌取消旧互动、隐私脱敏测试全部通过 |
| `src/remote/main.js` | 手机点歌端需区分立即登场、替换更新、加入排队与舞台繁忙 | 根据 `/ktv/api/reactions` 返回的 `status` 与 `queuePosition` 提示“表情已送出”、“已更新当前登场表情”、“已加入排队（第 X 位）”或“当前舞台互动较多，请稍后再试” | 手机端请求响应状态分支与错误提示通过 |
| `src/karaoke/lyricDisplay.js`、`src/views/karaoke.vue`、`src/views/karaokeWeb.vue` | 主屏计算的音乐状态需同步至各副屏，且不增加额外轮询或暴露敏感字段 | 主屏在非隐藏状态下以 20Hz 更新 `musicReaction`，页面隐藏时自动降频至随心跳按需采样；通过既有 `presentation.musicReaction` 同步并经 `sanitizeMusicReaction` 白名单清洗后下发副屏 | 主副屏状态同步、白名单字段脱敏、生命周期销毁清理通过 |
| `src/components/karaoke/ReactionOverlay.vue` | 音乐常驻状态与手机人工互动同时发生时需分层避让；用户希望常驻角色默认不要一直弹跳（提供独立开关），重点随歌曲段落切换丰富表情与多样化陪伴台词，且右键角色大小调节改为滑块 | 常驻角色（Dock）与前景临时登场（Shot）分层控制；右键设置新增 **「随节奏弹跳」开关（默认关闭）** 与 **「大小 72px–260px」无级滑块**（同步缩放常驻角色与中央登场动画，并兼容旧版 `small`/`medium`/`large` 本地存档）；`MUSIC_MOOD_DIALOGUES` 在前奏/主歌/递进/高潮/回落/暂停/完曲各阶段提供多组差异化表情与 KTV 陪伴台词（每约 5.2s 自然轮换，且通过 `presentation.musicReaction.label` 主副屏同步） | 双层优先级、默认不持续跳动、开启开关后恢复节拍弹跳、多样化陪伴台词轮换、滑块无级缩放及律动档位持久化通过 |

## 已执行验证

1. `node scripts/test-music-reaction-linkage.js`：Gate A 音源安全检测、特征提取、状态机起播校准/迟滞/保持/冷却/静音区分、多人排队/同人连点防饿死/切歌取消、端到端 HTTP 同步测试通过。
2. `node scripts/test-karaoke-reactions.js`、`node scripts/test-reaction-loader.js`：既有互动鉴权、速率限制、32 种情绪、生命周期自动事件与加载器回归测试通过。
3. `node scripts/test-karaoke-web-host.js`、`node scripts/test-karaoke-web-bridge.js`、`node scripts/test-karaoke-display.js`、`node scripts/test-karaoke-display-client.js`、`node scripts/test-karaoke-display-preferences.js`、`node scripts/test-karaoke-display-lifecycle.js`：Docker 主副屏与桥接回归测试全部通过。
4. 定向 ESLint、Prettier 格式校验、`git diff --check` 与 `VUE_APP_DOCKER_KTV=true yarn build` 生产构建验证通过。

## 软路由部署记录

- 已配置本机至 `192.168.100.1` 的 ED25519 SSH 免密公钥认证（写入 `/root/.ssh/authorized_keys` 与 `/etc/dropbear/authorized_keys`）。
- 部署前备份：`/mnt/mmc1-4/lumasing-backups/20261027-before-music-reaction-linkage.tgz`（SHA256：`65fc1b9196c7f67bf07664d698117c3e07911bbf823332919b83d01c4a8f93d4`）。
- 保留旧镜像：`lumasing-router-ktv:before-music-reaction-20261027`。
- 静态资源包 SHA256：`0f89ace5a13389556cb5e9fd6c891492251429c5be8f123e421d1565e73758f1`。
- 主页面 `index.html` SHA256：`94b04bd5b7ba0a4804f7ffd2752cf9922d96f0b44d1538c894dc5a170b25e0f2`。
- KTV 服务 `ktv-server.cjs` SHA256：`1019b906a1eb43d817661f53bb2639c1f5d3fbaa33a7934e30f3a3625567f556`。
- 仅重建并重启 `ktv` 容器（`lumasing-ktv-1` 状态为 `healthy`），音乐 API（`lumasing-lumasing-api-1`）与 Nginx（`lumasing-web-1`）保持运行未重启。
