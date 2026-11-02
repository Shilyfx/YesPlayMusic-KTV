# 本地歌后在线歌无声：原因排查

本轮仅诊断，未修改生产代码、未部署。

软路由 index.html SHA256：7d6ee5da69a4677daa12d5d0291625a4eda804990611908b7a2de10ac14190de；对应隔离发布目录 D:/VibeCoding/lumasing-reaction-release。

该版本的 musicReactionAnalyzer.js 为本地/同源音频创建 MediaElementAudioSourceNode；Player.js 使用 Howler.unload 后创建 HTML5 Howl。Howler unload 将旧 HTMLMediaElement 放回池中，新 Howl 从池中取回。分析节点的绑定仍然存在。新音源跨域时，即使分析器安全检查拒绝再次接入，也不能撤销已经存在的绑定。

ego-browser 独立合成音频实验（两个本机端口模拟同源与跨域；未操作实际 KTV 房间）：

|条件|本地 RMS|第二首 RMS|同一节点被复用|第二首 paused|进度秒|
|---|---:|---:|---|---|---:|
|同源切跨域|0.257701|0|true|false|0.412154|
|同源切同源对照|0.257588|0.259021|true|false|0.419353|

实验脚本：scratch/audio-cause-20261030/server.cjs 和 round-01.mjs 至 round-03.mjs。与实际播放器相同的已安装 Howler 版本，4 秒合成正弦波。证据证明节点复用可以导致跨域输出为零；没有声称已经在用户的真实网易云曲目和音箱上完成验证。

修复方向：隔离被分析器绑定的 HTML5 音频节点，确保其不被后续跨域音源复用，并检查连接回收及用户手势解锁；保留互动分析功能。需要覆盖在线→本地→在线和暂停恢复，不宜仅强制解除静音或重复调用 play。
