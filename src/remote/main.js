import './styles.css';

const app = document.querySelector('#remote-app');
const roomCode = window.location.pathname.split('/').pop();

app.innerHTML = `
  <section class="remote-shell">
    <p class="eyebrow">YESPLAYMUSIC · LAN KTV</p>
    <h1>已加入房间 ${roomCode}</h1>
    <p class="copy">这是仅供观看的局域网舞台入口。主机控制播放、队列与点歌；本页面不收集账号、搜索或控制请求。</p>
    <div class="status"><span></span> 正在等待主机歌曲状态</div>
    <p class="note">关闭或结束主机 KTV 后，此链接会立即失效。</p>
  </section>
`;
