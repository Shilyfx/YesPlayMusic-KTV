# 运行性能优化实施与发布记录

## 版本与范围

- 审查旧工作区的起点：`17cf54441e798c79d73ad5eda3cb1ce55dfd0922`。
- 本轮后续优化 Base：`2ec376b190cc91afa700dc59d01467f64a24a26e`，已包含旧未提交改动的审核、播放源切换修复、有界目录缓存和前台优先预热。
- 已发布产品代码与构建记录提交：`1dce319254e646b6dcc43d4ceb5b3d9e0ea69de9`。后续 CI 配置及验收记录不改变产品源码版本。
- 审查并提交了必要代码，没有打包工作区中其他未审核文档、临时媒体、账号数据和个人脚本。
- 保留 Guest 切歌、Remote 首曲自动开唱、本地曲库及增量索引、全部舞台效果、多屏独立设置与互动。没有降低画质、禁用分析或改变静音语义。

## 实施位置与验证

|阶段|文件 / 模块|实际问题与根因|修改与保留能力|验证|
|---|---|---|---|---|
|P1|`remote/main.js`、`catalogPrefetchScheduler.js`、`KaraokeRemoteApi.js`|后台目录并发抢占；缓存仅有 TTL 不足以限制数量|前台动作优先、后台目录并发 1、同请求复用，有界清理；在线/本地及状态来源保持独立|prefetch、catalog performance、Remote API 回归|
|P2|`displayPoller.js`、`karaokeWeb.vue`、`refreshScheduler.js`|时钟更新反复发布同一业务对象；mutation 刷新等待不到在途请求后的补读|稳定对象复用，校时与业务发布分离，等待尾随刷新；保留歌词偏移和隐藏页恢复|display performance/client、Remote polling、浏览器主副屏|
|P3|`KaraokePvScene.vue`、`newKaraokeBackgroundScene.vue`|暂停且位置不变时仍调用暂停设置和单帧绘制|按 runtime 记录暂停状态和位置；暂停 seek 仍绘制，主题/背景更新照常传递|render performance、Folia lifecycle/PV/render、preview|
|P4a|`KaraokeLocalLibrary.js`、`store/plugins/localStorage.js`|空索引被当作未扫描；防抖期间退出缺最终写入|记录完成扫描的配置 generation；失败重试；退出只刷新待写项，保留增量索引与 250ms 防抖|local library、persistence flush、store persistence、safe storage|
|P4b|`webRoomBridge.js`、`KaraokeWebHost.js`、`KaraokeRemoteApi.js`、`remote/main.js`、`catalogEpoch.js`|同房间更换账号后，旧缓存和迟到结果可能继续显示|只传非身份整数 epoch；清在线缓存、拒绝旧命令、阻止迟到写回，Remote 当前模块重载；保留本地列表、播放状态和互动|bridge、host、catalog performance、Remote API/epoch 五项回归|
|P0/P5|`write-ktv-release-manifest.cjs`、阶段记录、部署包|Git SHA 无法单独证明当前部署产物|生成源码提交、构建时间、入口与后端 SHA256；更新前备份，原目录覆盖以保留 bind mount|构建、打包检查、部署指纹与浏览器检查|

对应提交：`2ec376b`、`ca53df7`、`5ea3580`、`84bfd8c`、`55580fb`、`1dce319`。详细测试与根因见 P2、P3、P4a、P4b 独立报告。

## 可复现 Before / After

以下计数来自确定输入的回归测试，不是 20 台设备的网络压测。

|路径|Before|After|边界|
|---|---:|---:|---|
|12 次仅时钟变化的副屏轮询：业务状态发布|12|1|校时仍为 12/12，未减少同步次数|
|暂停同位置的初始更新加 4 次重复更新：暂停设置 / 单帧绘制|5 / 5|1 / 1|暂停 seek、恢复后再暂停仍生效|
|空曲库连续 3 次普通读取：扫描|3|1|配置变化及显式刷新仍扫描；失败仍可重试|
|账号切换后旧响应写回|可能覆盖新缓存|generation 拒绝旧写回|由竞态回归验证，未使用真实账号切换登录|
|在线后台目录预热并发|可同时启动多个|1|用户主动模块加载可优先执行；预热不阻塞内部状态|

浏览器和接口观测：

- Base 单次首开 DOMContentLoaded 306.6ms、21 个资源；普通入口模型请求为 0。
- Base 点歌到 Remote 可见单次 651ms；最终构建单次 1034ms，到副屏 playing 1502ms。样本小、加载状态不同，**不能宣布端到端提速或达到 p95 ≤800ms**。
- Base 本机副屏状态 12 次串行读取 3.9–10.3ms，每次约 2970 字节；这是本机 HTTP，不是软路由全链路。
- 在线搜索单次 Remote 527ms、主屏 `/api/search` 371ms。差额包含桥接/调度，不能精确解释为服务器 CPU；`/api` 耗时也包含代理与上游。
- 临时 10 文件增量扫描 After：首次 21.98ms / 读取 10 次；再次显式扫描 3.02ms / 读取 0 次。Base 对应约 16.29/2.66ms：计时没有改善证据，未改变非空曲库的已存在增量策略。
- Remote gzip 入口由 71530 增至 72974 字节；desktop 由 736284 增至 737490 字节。新增一致性保护带来小幅代码体积增长。

## 复用与未触发的条件方案

- 既有 Player 250ms 保存防抖、100ms IPC 防抖、约 5 秒进度检查点继续复用；Vuex 按 mutation 分流，Axios 在 store 创建时接入内存设置 provider。没有为了优化重复重写这些路径。
- 生命周期已有旧 generation 取消、引擎销毁、后台暂停；模型默认按需加载，worker 有空闲退出。新增修复只针对暂停重复调用。
- 当前软路由本地列表约 46KB、13 首；单次读取 17ms。没有测出必须分页或虚拟列表的瓶颈，未引入新协议。
- 不实施 SSE/长轮询替换、大规模重构、降低渲染分辨率/粒子数。单次同步样本不足以证明需要这些架构或质量变化，也未证明拟定延迟目标已达成。
- 压力测试继续按用户要求暂缓；已有内存级状态额度测试不等于 20 台实机验收。

## 验证与发布 Gate

- 完整回归：42 项脚本，0 失败；补跑歌词模式兼容与角色 loader 两项均通过。
- P4b 源码和测试 ESLint、各阶段定向 lint、`git diff --check`：通过。
- `NODE_OPTIONS=--openssl-legacy-provider node scripts/build-local-ktv.cjs`：成功；随后 `node scripts/build-ktv-server.js`：成功。
- 仍有既有 Sass legacy API、Browserslist 数据过期及构建体积/样式顺序提示，没有将提示当成测试失败或予以隐瞒。
- 浏览器：ego task space 28，使用专用 18111/18112 本机服务。临时合成音频、主屏、副屏和点歌页用于功能验证，不能证明实际扬声器声音或跨设备音频兼容。
- 最终构建连续运行 10 分钟，11 个整分钟采样，三次暂停/恢复及 Sonnet、Tempera、流光切换，主副屏全部采样 playing，稳定采样均 1 个引擎层；DOM 模式没有 canvas 属正常实现。主屏 heap 60.62–92.51MB、末次 70.25MB；副屏 60.19–77.81MB、末次 68.71MB。未手动 GC，不能据此证明无泄漏，也没有取得 GPU/worker 进程内存。
- 该 10 分钟内捕获页面 error/unhandledrejection 为 0；主屏长任务 4 次、最长 103ms，副屏 3 次、最长 76ms，仍存在切换长任务，不能称为无卡顿。
- 浏览器实测副屏取消跟随、改诗页及 offset 1.2，主屏仍原模式且 offset 0；恢复副屏原偏好。Remote 应援实际出现在副屏。
- 首次短音频人为启用 Howler loop 的测试因循环 end 事件归档曲目而中断，已废弃；10 分钟结果改用 900 秒独立文件正常播放，不修改产品循环语义。临时媒体不发布。
- 补查本地→在线：在线曲目未起播，HTML5 audio 报错误码 4；同一媒体地址独立请求返回 HTTP 200 **text/html** 而非音频，主机支持 MP3。该外部媒体响应不能用于验证播放器声音恢复，不将这项浏览器检查记作通过；没有用强制解除静音等手段掩盖问题。物理声音及有效在线音频仍需真实使用验收。
- 软路由已原位更新静态资源并仅重启 KTV 后端；音乐 API 和曲库数据未迁移。容器健康，运行镜像完整 ID `b3c1fbf8795a0f4a301eab142703054ef1a5325af18bb763be75b955fc5eb9f4`；容器内后端与线上 manifest 校验均一致。Docker 提示宿主机不支持 swap limit，内存限制仍有效，未改变配置。
- 部署后 ego-browser 在实际 `192.168.100.1:18080` 检查：主屏指定成功，同链接进入副屏；点歌页本地 13 首正常；Remote 首次点《一路向北》后播放器 loaded/playing，副屏同步标题及歌词。请求至副屏 playing 单次 1130ms（含媒体起播，非 p95）；暂停和应援同步成功。物理声音未监听，不能据此宣布真实音箱验证通过。

## 发布指纹与 CI

- 入口 SHA256：`1d51df8f5e7fbd315b18681011e6c7a3b76d99acce68366dd96661a5615abfd7`。
- 后端 SHA256：`d7c9695f192004a2a2e29a19eaa10c22179795f4eb4853360167eb3a3879af87`。
- 上传包 SHA256：`949f0727bbd4973f0b8b36789ec7e13fdcee08cdca13c93d473e53377fe4f0ce`，上传后远端核对一致。
- 更新前备份：`/mnt/mmc1-4/lumasing-backups/20261031-before-performance.tgz`，旧镜像标签 `lumasing-router-ktv:before-performance-20261031`。
- 已切换新镜像：`lumasing-router-ktv:performance-20261031`，当前 `0.4.10` 标签指向相同镜像。
- 经 7890 HTTP 代理推送至 `fix/ktv-release-stabilization`。GitHub 应用仅返回空状态，公开 Actions API 限流，改由 ego-browser 查看实际 Actions 页面并按提交核对。
- **Source CI：成功**，[KTV Phase Validation #73](https://github.com/Shilyfx/YesPlayMusic-KTV/actions/runs/41104280045)，提交 `2e9a6ac17cc6ace41cd422d1987084f6df5b58aa`，页面显示用时 4m57s；包含新增九项性能回归。
- **macOS arm64 CI：取消**，[KTV Packaging Validation #37](https://github.com/Shilyfx/YesPlayMusic-KTV/actions/runs/41104280084)，同一提交，页面显示 cancelled / 1m24s；没有生成或验收新的安装包，不推测取消原因。
- **Windows Packaging、macOS x64 CI：未执行**，本轮不在该 Packaging workflow 的 matrix 中。
- 真实手机/Mac/音箱、20 设备容量、30–60 分钟长期运行、真实账号登录切换尚未完成实机验收。
