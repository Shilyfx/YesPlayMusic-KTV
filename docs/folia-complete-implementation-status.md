# Folia 完整移植执行状态

更新：2026-10-29。代码已进入最终审查；实际画面、设备和 GPU 验收由用户负责。本轮未部署软路由、未提交或推送代码。

Base SHA / 当前 HEAD：252a0f59a1639598725e1c81f55fae3bbb7ebd14。没有新修改提交；当前工作区包含实际新增源码，HEAD 不能代表这批改动。

## 已完成的代码范围

- 固定完整 Folia 源码 7a5f975e337e5ba13f55d72b5bc68983bf41c379；已有三种 PV 仍固定于 aecd330b720eb8fc728e6b10ebcec261b144d683，保留商籁安全边界补丁。三个 vendor 目录保留来源、哈希和适配说明。
- 15 个原版歌词模式＋原有 4 个舞台，共 19 个；6 个原版背景＋旧背景。歌词与背景独立选择；静止模式遵循原版不绘制背景。
- 215 项源码参数字段、按模式保存、随机池、素材上传与副屏独立分组设置；原版没有消费者的强度选项不展示。
- 统一控制板、源码 SVG 缩略图、单项悬浮／键盘焦点真实预览、原版深浅配色；提前／延后和副屏绝对偏移保留。
- 真正 Beat This!／HTDemucs 分析 worker、模型校验与缓存、六项有效智能效果。默认关闭，明确显示加载、分析、缓存、不支持和错误状态；副屏读取主屏时间轴，不重复分析。

## 修改与验证对应

| 文件／模块 | 当前问题与根因 | 修改方式 | 保持不变 | 验证 |
| --- | --- | --- | --- | --- |
| KaraokeControlPanel.vue、KaraokeVisualPreview.vue、visualPreview.js | 控制分散、缺少预览、body 预览被全屏顶层遮挡 | 统一面板、原版 glyph、单个延迟预览、全屏子树挂载、关闭／隐藏释放 | 播放、偏移、字号、跟随权限 | visual-preview、Vue 编译、局部 lint |
| folia/runtime.ts、renderHost.tsx、backgroundHost.tsx、stageLifecycle.js | 原版运行环境耦合；过时创建和旧实例影响新实例 | 原版适配、独立背景、候选就绪后替换、generation、总线所有权 | 单播放器、真实歌词时间 | folia-render、lifecycle、pv、tempera-assets |
| appearanceConfig.js、visualConfig.js、visualCatalog.js、displayPreferences.js | 参数、旧偏好、资源引用和体积缺乏统一边界 | 有界规范化、v1 兼容、分组覆盖、16 KiB 限制；优先保留当前样式和素材 | 副屏独立绝对偏移、原有舞台 | visual-config、display-preferences |
| KaraokeVisualAssetStore.js、visualAssets.js、上传队列 | blob 无法跨屏；取消可能孤立素材或误删共享引用 | 有界认证上传、哈希去重、资源 ID、IndexedDB、两阶段引用提交、lease | 房间权限和单一同步 owner | visual-assets、visual-upload-preflight、tempera-assets |
| displayPoller.js、webRoomBridge.js、KaraokeWebHost.js | 完整配置／歌词／分析结果不能每次轮询重复传输 | generation／revision 缓存、同代 single-flight、过时结果丢弃 | 主屏发声、副屏静音、Guest 切歌、邀请生命周期 | web-host、web-bridge、display-client、display-lifecycle |
| smartBeat/controller.ts、modelLoader.ts、audio.ts、worker、cache | 无 Web 分析接口；换歌取消污染共享模型请求；解码缓冲预算低估 | 原版 WebGPU 模型 worker、独立取消订阅、有界时间轴、按全部实际声道估算解码前后预算 | 不增加可听音频，不以歌词或情绪冒充节拍 | smartbeat-analysis 的 16 项 CPU／数学／哈希／控制流检查 |
| smartBeatRender.ts、Sonnet／Tempera 适配 | 开关未实时传入；凝彩无消费者；暂停误用歌词时钟；旧实例清空新总线 | setter、原版墨染 shader、原始音频时钟、六动效投影、所有权及预览隔离 | 歌词偏移不影响节拍，副屏不重复分析 | smartbeat-integration，含暂停／跳转／重叠实例／真实消费者 |
| preferenceStorage.js 和三个 writer | 相同快照重复 setItem | 比较实际存储后跳过相同值，无延迟 | 立即保存、失败 false、外部覆盖修复、超限保护 | preference-storage：10 次相同输入由 10 次写入降至 1 次 |
| 构建、模型发布、serve-local-ktv.cjs、Docker 持久化目录 | 本机已有模型掩盖新 checkout 缺文件；需要完整本机后端 | 构建校验／发布模型、对应源码包、本机音乐 API＋房间服务、持久化素材目录 | 原有 API、本地增量索引 | 生产构建、server bundle；最终启动状态附后 |

## 模型与能力边界

Beat This!：41,102,271 字节，SHA-256 6365ae5ba2e42922772da01fbfd0bde8dd20b7362a679018e78a5f251fe8a967。
HTDemucs：91,838,176 字节，SHA-256 27d5331a74a4e23b18172b3d59d0378e698fd79bc0d0fed3316da77e3a37d8d1。
本机文件已校验；构建在新 checkout 中同样先下载／校验，再发布。

未做真实 GPU 推理验收。需要支持 WebGPU 的安全上下文；本机 http://localhost 可用于检查，普通软路由局域网 HTTP 通常不具备此能力。音源必须允许读取，长曲目可能因 256 MiB 应用缓冲估算预算被拒绝；该估算不构成浏览器内部解码分配的硬上限。不支持时保留基础原版效果并明确显示状态。

## 测试与性能

本轮执行通过：visual-config、visual-assets、visual-upload-preflight、display-preferences、display-client、display-lifecycle、web-host、web-bridge、folia-render、folia-lifecycle、folia-pv、folia-tempera-assets、visual-preview、preference-storage、smartbeat-analysis、smartbeat-integration、lyric-stage-modes；以及既有 domain、player、local-library、server、lifecycle、remote-api、catalog-performance、reactions、music-reaction-linkage、reaction-loader 回归。

生产构建、远程资源隔离和 server bundle 已通过；最终改动后的整包构建与本机服务检查附后。git diff --check 通过。有既有 Browserslist、Sass 和 CSS 顺序提示。

可重复单元计数：三个偏好 writer 各 10 次相同输入，Before 各 10 次 setItem，After 各 1 次；变更仍立即保存。模型／素材／同步 single-flight、revision 与释放有脚本断言。这些不是硬件性能数据；真实 GPU／CPU、帧率、内存、空白帧和加载时延 Before／After 未测量。

## 尚未执行

- 用户真实浏览器视觉、全部组合、长中文、主副屏全屏、实际音频和 GPU 推理验收。
- 软路由新版本部署与 Docker 设备验收。本机版先交用户检查，不能称软路由已更新。
- 新 GitHub Source CI、Windows Packaging CI、macOS x64 CI、macOS arm64 CI：本轮未触发或核验。
- Windows／Mac／手机真机验收和新安装包打包。

Guest 切歌、Remote 第一首自动开唱、本地曲库及后续增量索引保留；相关软件回归通过，不能替代实际设备验收。

## 最终审查与本机服务

最终整体验证发现并修复两项问题：副屏分析数据的暂时失败不再永久锁死同一 revision，重试由已有心跳驱动并采用 1–30 秒退避；开发 serve／lint 不再强制下载可选模型，生产与直接构建仍严格校验并发布模型。新增 display-analysis-retry、folia-build-policy 测试通过，最终定向复审 PASS。

本机服务地址：http://localhost:18081/karaoke。当前启动进程 15980；音乐 API 在本机 18082。页面、房间健康接口、模型清单、音乐 API 状态均返回 HTTP 200，两份模型 HEAD 大小正确。此为服务启动／HTTP 检查，不是浏览器画面或真实音频验收。现有服务持续运行，供用户检查。

最终完整生产构建通过（TEMP/folia-final-verified-build.log），远程资源隔离和 KTV server bundle 通过。构建后再次验证页面、健康接口、音乐 API、PV 入口／CSS／worker、对应源码下载均 HTTP 200；git diff --check 通过。服务仍运行。

## 用户视觉反馈12项修订（2026-10-29）

移除主副屏全屏舞台留白；副屏偏好即使存储失败仍立即应用；设置按钮与下一首对齐，主屏普通模式按钮移入底栏；随机池／展示参数／背景参数默认折叠，输入不超框，设置字号增大10%。Fume 修正 CSS 位移与 Framer Motion 缩放冲突，Monet字1.30、Pendolo字1.20、Cappella场景1.10且字体额外1.10，保留原版歌词；八个拥有原生歌词的模式取消额外通用底部字幕。Cappella字符淡入增加 fill-mode both 防止首帧闪烁。具体根因与路径见本轮三个任务报告。

新增 follower-style、control-panel-ui 及扩展 folia-render 回归通过；定向代码复审通过。生产构建 TEMP/folia-ui12-build.log、远程资源隔离和server bundle通过；本机18081服务未中断，页面／健康／PV清单均200。截图级效果仍由用户验收，未部署软路由。

UI4修订：开关滑块改为轨道内边缘锚定，文案跟随主屏幕；反应层在主副屏全屏子树中高于歌词层，手动互动保持居中；群唱气泡高光节点常驻、非活动暂停隐藏、平滑显隐，扫光亮带由约22%缩至8%，保留原动画。control-panel-ui/reaction-overlay/folia-render回归通过，代码复审无确认缺陷，生产构建TEMP/folia-ui4-build.log通过。本机18081持续运行，实际闪烁和层级画面仍由用户验收，未部署路由。

## 2026-10-30 最终本机修订

协调者通过 ego 实际打开本机页面，确认页面进入本机模式且后端 active:false。错误原因是普通网页构建覆盖了 Docker 产物，导致房间未建立、主副屏分流和点歌互动状态链路失效。现使用 build:local-ktv 明确构建身份，并加服务启动身份校验；最终dist标记为docker-ktv、/api、webKtvDisplayOnly:true。构建通过 TEMP/folia-final-live-build.log，页面／健康／PV清单／remote均200。本机服务持续运行。需重新指定主屏以建立新房间。

按用户最新要求由协调者接手检查与收尾。群唱取消循环白色扫光，改静态柔和高光；取消emoji无限摆动，保留入场／退场和尺寸动画。重复未变化的setPaused不再提交React状态。群唱内容列80%居中，左右各10%，额外字体倍率1.05。对应源码、copier和哈希同步，source.tgz包含新增本机构建辅助脚本。

local-ktv-build、folia-render、folia-lifecycle、web-host、web-bridge、display、reactions、reaction-overlay回归通过；git diff --check通过。浏览器会话消失后用户明确选择只做代码排查，因此本轮最终验收是代码／构建／HTTP验收，没有声称实际画面闪烁已通过浏览器复验。未部署软路由、未触发CI、未打包新安装包。

## 2026-10-30 互动消失真实浏览器定位与修复

协调者使用 ego-browser 空间8复现：副屏待机角色SVG实际存在，点歌页应援模块和正在演唱信息正常；发送互动时中央shot.ready已挂载但opacity=0。实际浏览器prefers-reduced-motion:true，全局animation-duration:0.01ms!important使reaction-zoom结束于透明帧，dock同时因activeEvent隐藏，导致两处均看不见。修复ReactionOverlay减少动态模式：animation:none!important、opacity:1、transform:none，继续由既有事件timer控制展示/恢复；保留正常动态模式出场动画。

新增源码回归通过、生产构建TEMP/folia-reaction-visible-build.log通过。重新加载最终产物后，通过实际点歌页发送“唱得太棒了”，副屏中央opacity=1、animation=none、SVG可见；中心约(1091.7,553.1)，视口(2183,1106)，截图reaction-fixed.png确认可见。事件结束后待机角色opacity=1且SVG存在，显示“唱累了先喝口水”。未操作主电脑播放按钮以免打断当前用户歌曲；本次验证了现有暂停状态的显示和手动应援完整链路。ego空间已正常finish关闭。共享主副屏组件修复；没有宣称主屏另做完整视觉验收。服务持续运行，未部署软路由。

## 2026-10-30 五项显示修订

由协调者直接修改：KaraokePvScene.isPaused不再把prefers-reduced-motion当作暂停音频时钟，原有staticMode仍控制镜头／装饰；原生全屏lyric-scene禁止纵向滚动；Folia Classic（中文流光）字体以舞台cqw和当前行字符数上限约束，保留原版排版和字效，非Lumiere（绘光）。新增变换可由vendor copier复现并更新来源哈希。默认六歌手照片从当前音乐API歌手详情取得240x240图并本地发布，默认卡片优先固定本地图像，搜索结果不再覆盖头像。开关border-box，滑块垂直50%位移居中，并增加全部跟随主屏幕开关。

Ego空间9已实测：修复前轨道content-box导致实际39x25而预期34x20；修复后滑块上下约2.76px等距。总开关开启四项全部true、关闭四项全部false（第二次高层点击被dialog拦截后用已定位DOM点击验证）。六张照片均naturalWidth/Height240，来自本地artist-portraits，object-fit:cover。纵深overflow-y:hidden。浮名的减少动态播放判定playing:true => paused:false；用户主屏当前暂停，未切换其播放状态，因此没有声称完整歌曲播放实机验收。流光最终runtime ready、舞台container-type:inline-size；长句完整视觉矩阵尚未覆盖。

control-panel-ui、folia-render、folia-lifecycle、display-preferences回归及git diff --check通过；最终Docker构建TEMP/folia-five-correct-build.log通过。之前试验的Lumiere边界hook已全部撤回，最终无此修改。服务持续运行，Ego空间正常关闭，未更新软路由。
