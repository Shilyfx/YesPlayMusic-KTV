import './styles.css';

const app = document.querySelector('#remote-app');
const apiRoot = '/ktv/api';
const roomCode = window.location.pathname.split('/').filter(Boolean).pop();
const storageKey = `yesplaymusic-ktv:${roomCode}`;
let client;
let state;
let searchTimer;
let searchAbort;
let refreshTimer;
let retryDelay = 2000;

function escape(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[
        char
      ])
  );
}
function api(path, options = {}) {
  return fetch(`${apiRoot}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(client?.clientToken
        ? { Authorization: `Bearer ${client.clientToken}` }
        : {}),
      ...options.headers,
    },
  }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'REMOTE_UNAVAILABLE');
      error.code = body.error;
      throw error;
    }
    return body;
  });
}
function setNotice(message = '', kind = '') {
  const notice = document.querySelector('[data-notice]');
  if (notice) {
    notice.textContent = message;
    notice.dataset.kind = kind;
  }
}
function formatDuration(milliseconds) {
  const total = Math.max(0, Math.round((milliseconds || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function itemMarkup(item, index, own = false) {
  if (!item) return '<div class="empty">主机还没有开始播放</div>';
  const controls =
    own && item.status === 'queued'
      ? `<div class="queue-actions"><button data-front="${escape(
          item.queueItemId
        )}">置顶</button><button class="quiet" data-remove="${escape(
          item.queueItemId
        )}">取消</button></div>`
      : '';
  return `<article class="queue-item ${
    item.priorityRequested ? 'priority' : ''
  }"><span class="queue-index">${index}</span><div><strong>${escape(
    item.name
  )}</strong><p>${escape((item.artists || []).join(' / '))} · ${escape(
    item.requesterName || '主机'
  )}</p></div>${
    item.priorityRequested ? '<span class="tag">优先</span>' : ''
  }${controls}</article>`;
}
function render() {
  const current = state?.current;
  const waiting = state?.waiting || [];
  const theme = localStorage.getItem('yesplaymusic-ktv-theme') || 'auto';
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<main class="remote-page"><header class="topbar"><div><p class="eyebrow">YESPLAYMUSIC · LAN KTV</p><h1>房间 ${escape(
    roomCode || '—'
  )}</h1></div><label class="theme-picker">主题<select data-theme><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></header><p class="notice" data-notice></p><section class="now-playing glass"><p class="section-label">正在演唱</p>${
    current
      ? `<div class="track-title"><div class="record">♫</div><div><h2>${escape(
          current.name
        )}</h2><p>${escape(
          (current.artists || []).join(' / ')
        )}</p><small>由 ${escape(
          current.requesterName || '主机'
        )} 点播</small></div></div>`
      : '<div class="empty">等待主机选择歌曲</div>'
  }</section><section class="search-area"><label class="search-box"><span>⌕</span><input data-search maxlength="80" autocomplete="off" placeholder="搜索歌曲、歌手或专辑" /></label><div class="search-results" data-results><div class="hint">输入关键词后即可点歌，主机负责开始演唱。</div></div></section><section class="queue-grid"><section class="queue-panel glass"><div class="section-heading"><div><p class="section-label">当前队列</p><h2>等待演唱</h2></div><span>${
    waiting.length
  } 首</span></div><div class="queue-list">${
    waiting.length
      ? waiting
          .map((item, index) =>
            itemMarkup(item, index + 1, item.requesterId === client?.clientId)
          )
          .join('')
      : '<div class="empty">还没有待唱歌曲</div>'
  }</div></section><section class="queue-panel guest-card"><p class="section-label">本次加入</p><h2>${escape(
    client?.displayName || '访客'
  )}</h2><p>仅能调整或取消自己尚未开始的点歌。房间结束后，此会话会自动失效。</p></section></section></main>`;
  app.querySelector('[data-theme]').value = theme;
  app.querySelector('[data-theme]').addEventListener('change', event => {
    localStorage.setItem('yesplaymusic-ktv-theme', event.target.value);
    document.documentElement.dataset.theme = event.target.value;
  });
  app
    .querySelector('[data-search]')
    .addEventListener('input', event => scheduleSearch(event.target.value));
  app
    .querySelectorAll('[data-remove]')
    .forEach(button =>
      button.addEventListener('click', () =>
        mutate(`/requests/${button.dataset.remove}`, 'DELETE')
      )
    );
  app
    .querySelectorAll('[data-front]')
    .forEach(button =>
      button.addEventListener('click', () =>
        mutate(`/requests/${button.dataset.front}/front`, 'POST')
      )
    );
}
function renderResults(results) {
  const container = app.querySelector('[data-results]');
  if (!container) return;
  if (!results.length) {
    container.innerHTML = '<div class="hint">没有找到可展示的歌曲。</div>';
    return;
  }
  container.innerHTML = results
    .map(
      track =>
        `<article class="result-card"><div class="result-info"><strong>${escape(
          track.name
        )}</strong><p>${escape(track.artists.join(' / '))} · ${escape(
          track.album || '未知专辑'
        )}</p><small>${escape(track.versionLabel)} · ${formatDuration(
          track.duration
        )} · <b class="availability ${track.playability}">${
          track.playability === 'playable'
            ? '可播'
            : track.playability === 'trial-only'
            ? '试听'
            : '不可播'
        }</b></small></div><div class="request-actions"><button data-request="${escape(
          track.trackId
        )}" ${
          track.playability !== 'playable' ? 'disabled' : ''
        }>点歌</button><button class="priority-button" data-priority="${escape(
          track.trackId
        )}" ${
          track.playability !== 'playable' ? 'disabled' : ''
        }>优先点歌</button></div></article>`
    )
    .join('');
  container
    .querySelectorAll('[data-request]')
    .forEach(button =>
      button.addEventListener('click', () =>
        requestSong(button.dataset.request, false)
      )
    );
  container
    .querySelectorAll('[data-priority]')
    .forEach(button =>
      button.addEventListener('click', () =>
        requestSong(button.dataset.priority, true)
      )
    );
}
function scheduleSearch(query) {
  clearTimeout(searchTimer);
  if (searchAbort) searchAbort.abort();
  const clean = query.trim();
  if (!clean) return renderResults([]);
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    try {
      renderResults(
        (
          await api(`/search?q=${encodeURIComponent(clean)}`, {
            signal: searchAbort.signal,
          })
        ).results
      );
    } catch (error) {
      if (error.name !== 'AbortError')
        setNotice('搜索暂时不可用，请稍后重试。', 'error');
    }
  }, 350);
}
async function requestSong(trackId, priority) {
  try {
    await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ trackId, priority }),
    });
    setNotice(
      priority ? '已优先加入等待队列。' : '已加入等待队列。',
      'success'
    );
    await refresh();
  } catch (error) {
    setNotice(
      error.code === 'TRACK_NOT_PLAYABLE'
        ? '此歌曲当前不可播放。'
        : '点歌失败，请稍后再试。',
      'error'
    );
  }
}
async function mutate(path, method) {
  try {
    await api(path, { method });
    setNotice(
      method === 'DELETE' ? '已取消点歌。' : '已调整到等待队列前列。',
      'success'
    );
    await refresh();
  } catch (_) {
    setNotice('操作未完成，队列可能已发生变化。', 'error');
  }
}
function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}
async function refresh() {
  try {
    state = await api('/state');
    retryDelay = 2000;
    render();
    scheduleRefresh(document.hidden ? 5000 : 1500);
  } catch (error) {
    if (error.code === 'INVALID_CLIENT_TOKEN' || error.code === 'ROOM_ENDED')
      return showEnded();
    scheduleRefresh(retryDelay);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }
}
function showEnded() {
  clearTimeout(refreshTimer);
  sessionStorage.removeItem(storageKey);
  app.innerHTML =
    '<main class="ended"><p class="eyebrow">YESPLAYMUSIC · LAN KTV</p><h1>房间已结束</h1><p>请向主机重新获取新的二维码或加入链接。</p></main>';
}
async function bootstrap() {
  try {
    client = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (!client?.clientToken) {
      const joinToken = new URLSearchParams(window.location.hash.slice(1)).get(
        'token'
      );
      if (!joinToken) return showEnded();
      client = await api('/client-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${joinToken}` },
      });
      sessionStorage.setItem(storageKey, JSON.stringify(client));
      history.replaceState({}, '', window.location.pathname);
    }
    await refresh();
  } catch (_) {
    showEnded();
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && client) refresh();
});
bootstrap();
