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
let searchQuery = '';
let searchResults = [];
let searchGeneration = 0;
let playlists = [];
let selectedPlaylistId = '';
let playlistTracks = [];
let playlistQuery = '';
let playlistTrackGeneration = 0;
let playedHistory = [];

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
  const notice = app.querySelector('[data-notice]');
  notice.textContent = message;
  notice.dataset.kind = kind;
}

function formatDuration(milliseconds) {
  const total = Math.max(0, Math.round((milliseconds || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function itemMarkup(item, index, own = false) {
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

function initializeShell() {
  const theme = localStorage.getItem('yesplaymusic-ktv-theme') || 'auto';
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<main class="remote-page"><header class="topbar"><div><p class="eyebrow">YESPLAYMUSIC · LAN KTV</p><h1>房间 ${escape(
    roomCode || '—'
  )}</h1></div><label class="theme-picker">主题<select data-theme><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></header><p class="notice" data-notice></p><section class="now-playing glass" data-now-playing></section><section class="history-area glass"><div class="section-heading"><div><p class="section-label">本场已唱</p><h2>已播放歌曲</h2></div><span data-history-count>0 首</span></div><div class="history-list" data-history-list><div class="empty">本场还没有已唱歌曲</div></div></section><section class="playlist-area glass"><div class="section-heading"><div><p class="section-label">当前账号歌单</p><h2>从歌单点歌</h2></div><button class="quiet playlist-refresh" type="button" data-playlists-refresh>刷新歌单</button></div><div class="playlist-picker"><label>选择歌单<select data-playlist><option value="">正在加载歌单…</option></select></label><label>筛选歌曲<input data-playlist-search maxlength="80" autocomplete="off" placeholder="在当前歌单中筛选" /></label></div><div class="playlist-track-list" data-playlist-tracks><div class="hint">正在加载当前账号的歌单。</div></div></section><section class="search-area"><label class="search-box"><span>⌕</span><input data-search maxlength="80" autocomplete="off" placeholder="搜索歌曲、歌手或专辑" /></label><div class="search-results" data-results><div class="hint">输入关键词后即可点歌，主机负责开始演唱。</div></div></section><section class="queue-grid"><section class="queue-panel glass"><div class="section-heading"><div><p class="section-label">当前队列</p><h2>等待演唱</h2></div><span data-queue-count>0 首</span></div><div class="queue-list" data-queue-list><div class="empty">还没有待唱歌曲</div></div></section><section class="queue-panel guest-card"><p class="section-label">本次加入</p><h2 data-guest-name>访客</h2><p>仅能调整或取消自己尚未开始的点歌。房间结束后，此会话会自动失效。</p></section></section></main>`;
  app.querySelector('[data-theme]').value = theme;
  app.querySelector('[data-theme]').addEventListener('change', event => {
    localStorage.setItem('yesplaymusic-ktv-theme', event.target.value);
    document.documentElement.dataset.theme = event.target.value;
  });
  app
    .querySelector('[data-search]')
    .addEventListener('input', event => scheduleSearch(event.target.value));
  app
    .querySelector('[data-playlist]')
    .addEventListener('change', event => selectPlaylist(event.target.value));
  app
    .querySelector('[data-playlist-search]')
    .addEventListener('input', event => {
      playlistQuery = event.target.value;
      renderPlaylistTracks();
    });
  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.request) requestSong(button.dataset.request, false);
    else if (button.dataset.priority)
      requestSong(button.dataset.priority, true);
    else if (button.dataset.playlistsRefresh) loadPlaylists();
    else if (button.dataset.remove)
      mutate(`/requests/${button.dataset.remove}`, 'DELETE');
    else if (button.dataset.front)
      mutate(`/requests/${button.dataset.front}/front`, 'POST');
  });
}

function renderNowPlaying() {
  const current = state?.current;
  const target = app.querySelector('[data-now-playing]');
  target.innerHTML = `<p class="section-label">正在演唱</p>${
    current
      ? `<div class="track-title"><div class="record">♫</div><div><h2>${escape(
          current.name
        )}</h2><p>${escape(
          (current.artists || []).join(' / ')
        )}</p><small>由 ${escape(
          current.requesterName || '主机'
        )} 点播</small></div></div>`
      : '<div class="empty">等待主机选择歌曲</div>'
  }`;
}

function renderQueue() {
  const waiting = state?.waiting || [];
  app.querySelector('[data-queue-count]').textContent = `${waiting.length} 首`;
  app.querySelector('[data-queue-list]').innerHTML = waiting.length
    ? waiting
        .map((item, index) =>
          itemMarkup(item, index + 1, item.requesterId === client?.clientId)
        )
        .join('')
    : '<div class="empty">还没有待唱歌曲</div>';
  app.querySelector('[data-guest-name]').textContent =
    client?.displayName || '访客';
}

function renderHistory() {
  const count = app.querySelector('[data-history-count]');
  const container = app.querySelector('[data-history-list]');
  if (!count || !container) return;
  count.textContent = `${playedHistory.length} 首`;
  if (!playedHistory.length) {
    container.innerHTML = '<div class="empty">本场还没有已唱歌曲</div>';
    return;
  }
  container.innerHTML = playedHistory
    .map(
      (item, index) =>
        `<article class="result-card history-card"><div class="history-index">${
          index + 1
        }</div><div class="result-info"><strong>${escape(
          item.name
        )}</strong><p>${escape(
          (item.artists || []).join(' / ')
        )}</p><small>已播放 · ${escape(
          item.requesterName || '主机'
        )}</small></div><div class="request-actions"><button data-request="${escape(
          item.trackId
        )}">再唱一次</button><button class="priority-button" data-priority="${escape(
          item.trackId
        )}">优先再唱</button></div></article>`
    )
    .join('');
}

function renderResults(results, { searching = false } = {}) {
  searchResults = results;
  const container = app.querySelector('[data-results]');
  if (searching) {
    container.innerHTML = '<div class="hint">正在搜索…</div>';
    return;
  }
  if (!results.length) {
    container.innerHTML = searchQuery.trim()
      ? '<div class="hint">没有找到可展示的歌曲。</div>'
      : '<div class="hint">输入关键词后即可点歌，主机负责开始演唱。</div>';
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
            ? '可播放'
            : track.playability === 'trial-only'
            ? '仅试听'
            : track.playability === 'error'
            ? '检测失败'
            : '不可播放'
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
}

function renderPlaylistPicker() {
  const select = app.querySelector('[data-playlist]');
  if (!select) return;
  select.innerHTML = playlists.length
    ? playlists
        .map(
          playlist =>
            `<option value="${escape(playlist.id)}">${escape(
              playlist.name
            )} · ${playlist.trackCount} 首</option>`
        )
        .join('')
    : '<option value="">暂无可用歌单</option>';
  select.value = selectedPlaylistId;
  select.disabled = !playlists.length;
}

function renderPlaylistTracks({ loading = false } = {}) {
  const container = app.querySelector('[data-playlist-tracks]');
  if (!container) return;
  if (loading) {
    container.innerHTML = '<div class="hint">正在加载歌单歌曲…</div>';
    return;
  }
  const cleanQuery = playlistQuery.trim().toLowerCase();
  const visibleTracks = cleanQuery
    ? playlistTracks.filter(track =>
        `${track.name} ${(track.artists || []).join(' ')} ${track.album || ''}`
          .toLowerCase()
          .includes(cleanQuery)
      )
    : playlistTracks;
  if (!visibleTracks.length) {
    container.innerHTML = playlistTracks.length
      ? '<div class="hint">这个歌单里没有匹配的歌曲。</div>'
      : '<div class="hint">当前歌单暂无可展示歌曲。</div>';
    return;
  }
  container.innerHTML = visibleTracks
    .map(
      track =>
        `<article class="result-card playlist-track-card"><div class="result-info"><strong>${escape(
          track.name
        )}</strong><p>${escape((track.artists || []).join(' / '))} · ${escape(
          track.album || '未知专辑'
        )}</p><small>${formatDuration(
          track.duration
        )} · <b class="availability ${track.playability || 'unknown'}">${
          track.playability === 'playable'
            ? '可播放'
            : track.playability === 'trial-only'
            ? '仅试听'
            : track.playability === 'unavailable'
            ? '不可播放'
            : '点歌时检测'
        }</b></small></div><div class="request-actions"><button data-request="${escape(
          track.trackId
        )}" ${
          track.playability && track.playability !== 'playable'
            ? 'disabled'
            : ''
        }>点歌</button><button class="priority-button" data-priority="${escape(
          track.trackId
        )}" ${
          track.playability && track.playability !== 'playable'
            ? 'disabled'
            : ''
        }>优先点歌</button></div></article>`
    )
    .join('');
}

async function selectPlaylist(playlistId) {
  selectedPlaylistId = playlistId;
  playlistTracks = [];
  renderPlaylistPicker();
  renderPlaylistTracks({ loading: Boolean(playlistId) });
  if (!playlistId) return;
  const generation = ++playlistTrackGeneration;
  try {
    const response = await api(
      `/playlists/${encodeURIComponent(playlistId)}/tracks`
    );
    if (generation !== playlistTrackGeneration) return;
    playlistTracks = response.tracks || [];
    renderPlaylistTracks();
  } catch (error) {
    if (generation !== playlistTrackGeneration) return;
    renderPlaylistTracks();
    setNotice(
      error.code === 'HOST_NOT_LOGGED_IN'
        ? '主机尚未登录网易云账号，暂时无法读取歌单。'
        : '歌单歌曲暂时无法加载，请稍后重试。',
      'error'
    );
  }
}

async function loadPlaylists() {
  const button = app.querySelector('[data-playlists-refresh]');
  if (button) button.disabled = true;
  try {
    const response = await api('/playlists');
    playlists = response.playlists || [];
    const hasSelected = playlists.some(
      playlist => playlist.id === selectedPlaylistId
    );
    selectedPlaylistId = hasSelected
      ? selectedPlaylistId
      : playlists[0]?.id || '';
    renderPlaylistPicker();
    if (selectedPlaylistId) await selectPlaylist(selectedPlaylistId);
    else {
      renderPlaylistTracks();
      setNotice('主机尚未登录网易云账号，暂时无法读取歌单。', 'error');
    }
  } catch (error) {
    playlists = [];
    selectedPlaylistId = '';
    renderPlaylistPicker();
    renderPlaylistTracks();
    setNotice(
      error.code === 'HOST_NOT_LOGGED_IN'
        ? '请先在 KTV 主机登录网易云账号，再从歌单点歌。'
        : '歌单暂时无法加载，请点击“刷新歌单”重试。',
      'error'
    );
  } finally {
    if (button) button.disabled = false;
  }
}

function scheduleSearch(query) {
  searchQuery = query;
  const generation = ++searchGeneration;
  clearTimeout(searchTimer);
  if (searchAbort) searchAbort.abort();
  const clean = query.trim();
  if (!clean) return renderResults([]);
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    renderResults(searchResults, { searching: true });
    try {
      const response = await api(`/search?q=${encodeURIComponent(clean)}`, {
        signal: searchAbort.signal,
      });
      if (generation === searchGeneration && clean === searchQuery.trim())
        renderResults(response.results);
    } catch (error) {
      if (error.name !== 'AbortError' && generation === searchGeneration) {
        renderResults(searchResults);
        setNotice('搜索暂时不可用，请稍后重试。', 'error');
      }
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
    playedHistory = state?.history || [];
    retryDelay = 2000;
    renderNowPlaying();
    renderHistory();
    renderQueue();
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
    initializeShell();
    await refresh();
    await loadPlaylists();
  } catch (_) {
    showEnded();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && client) refresh();
});
bootstrap();
