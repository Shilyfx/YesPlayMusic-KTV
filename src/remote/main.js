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
let localPlaylists = [];
let selectedLocalPlaylistId = '';
let localPlaylistTracks = [];
let playedHistory = [];
let recommendations = [];
let selectedRecommendationId = '';
let recommendationTracks = [];
let recommendationTrackGeneration = 0;
let toplists = [];
let selectedToplistId = '';
let toplistTracks = [];
let toplistTrackGeneration = 0;
let toplistsLoaded = false;
let chartMode = 'recommendations';
let artistSearchTimer;
let artistSearchAbort;
let artistSearchGeneration = 0;
let artistQuery = '';
let artists = [];
const featuredArtistQueries = [
  '周杰伦',
  '林俊杰',
  '邓紫棋',
  '陈奕迅',
  '薛之谦',
  '杨宗纬',
];
let featuredArtists = [];
let selectedArtistId = '';
let artistTracks = [];
let artistTrackGeneration = 0;
let artistSelections = [];
let selectedModule = 'search';
let previewTrackId = '';
let previewGeneration = 0;

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
  notice.classList.remove('notice-pop');
  if (kind === 'success') {
    requestAnimationFrame(() => notice.classList.add('notice-pop'));
  }
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

function initializeModuleTabs() {
  const panels = [...app.querySelectorAll('[data-module-panel]')];
  const tabs = [...app.querySelectorAll('[data-module-tab]')];
  const update = module => {
    selectedModule = module;
    tabs.forEach(tab => {
      const active = tab.dataset.moduleTab === module;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    panels.forEach(panel => {
      panel.hidden = panel.dataset.modulePanel !== module;
    });
  };
  tabs.forEach(tab =>
    tab.addEventListener('click', () => update(tab.dataset.moduleTab))
  );
  update(selectedModule);
}

function initializeShell() {
  const theme = localStorage.getItem('yesplaymusic-ktv-theme') || 'auto';
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<main class="remote-page"><header class="topbar"><div><p class="eyebrow">YESPLAYMUSIC · LAN KTV</p><h1 data-room-name>Shilyfx的KTV</h1></div><label class="theme-picker">主题<select data-theme><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></header><p class="notice" data-notice></p><section class="now-playing glass" data-now-playing></section><section class="history-area glass"><div class="section-heading"><div><p class="section-label">本场已唱</p><h2>已播放歌曲</h2></div><span data-history-count>0 首</span></div><div class="history-list" data-history-list><div class="empty">本场还没有已唱歌曲</div></div></section><section class="playlist-area glass"><div class="section-heading"><div><p class="section-label">当前账号歌单</p><h2>从歌单点歌</h2></div><button class="quiet playlist-refresh" type="button" data-playlists-refresh>刷新歌单</button></div><div class="playlist-picker"><label>选择歌单<select data-playlist><option value="">正在加载歌单…</option></select></label><label>筛选歌曲<input data-playlist-search maxlength="80" autocomplete="off" placeholder="在当前歌单中筛选" /></label></div><div class="playlist-track-list" data-playlist-tracks><div class="hint">正在加载当前账号的歌单。</div></div><div class="local-playlist-block"><div class="section-heading"><div><p class="section-label">主机本地目录</p><h3>本地歌单</h3></div><button class="quiet" type="button" data-local-playlists-refresh>刷新本地歌单</button></div><label>选择本地歌单<select data-local-playlist><option value="">正在加载本地歌单…</option></select></label><div class="playlist-track-list" data-local-playlist-tracks><div class="hint">主机尚未配置本地音乐目录。</div></div></div></section><section class="search-area"><label class="search-box"><span>⌕</span><input data-search maxlength="80" autocomplete="off" placeholder="搜索歌曲、歌手或专辑" /></label><div class="search-results" data-results><div class="hint">输入关键词后即可点歌，主机负责开始演唱。</div></div></section><section class="queue-grid"><section class="queue-panel glass"><div class="section-heading"><div><p class="section-label">当前队列</p><h2>等待演唱</h2></div><span data-queue-count>0 首</span></div><div class="queue-list" data-queue-list><div class="empty">还没有待唱歌曲</div></div></section></section></main>`;
  app.insertAdjacentHTML(
    'beforeend',
    '<div class="preview-float" data-preview-float hidden><button type="button" class="preview-float-toggle" data-preview-toggle="true" aria-label="播放试听" title="播放或暂停试听">▶</button><strong data-preview-title>试听</strong><button type="button" class="preview-float-close" data-preview-stop="true" aria-label="关闭试听" title="关闭试听">×</button><audio data-preview-audio preload="none"></audio></div>'
  );
  const previewAudio = app.querySelector('[data-preview-audio]');
  ['play', 'pause', 'ended'].forEach(eventName =>
    previewAudio?.addEventListener(eventName, () => {
      if (eventName === 'ended') {
        previewTrackId = '';
        const float = app.querySelector('[data-preview-float]');
        if (float) float.hidden = true;
      }
      renderPreviewControls();
      renderResults(searchResults);
      renderPlaylistTracks();
      renderLocalPlaylistTracks();
      renderRecommendationTracks();
      renderArtistTracks();
    })
  );
  app
    .querySelector('.history-area')
    .insertAdjacentHTML(
      'afterend',
      '<section class="recommendation-area glass"><div class="section-heading"><div><p class="section-label">YESPLAYMUSIC 推荐</p><h2 data-chart-title>为你推荐</h2></div><div class="chart-actions"><button class="quiet recommendation-refresh" type="button" data-recommendations-refresh>换一批</button><button class="quiet chart-toggle" type="button" data-chart-toggle>排行榜</button></div></div><div class="recommendation-list" data-recommendations><div class="hint">正在加载推荐歌单…</div></div><div class="recommendation-track-list" data-recommendation-tracks><div class="hint">选择一个歌单查看歌曲。</div></div></section><section class="artist-area glass"><div class="section-heading"><div><p class="section-label">按歌手点歌</p><h2>找歌手</h2></div><span class="section-helper">选择一位歌手后，可继续添加其他歌手</span></div><div class="featured-artist-list" data-featured-artists><div class="hint">正在加载常用歌手…</div></div><label class="artist-search-box"><span>⌕</span><input data-artist-search maxlength="60" autocomplete="off" placeholder="搜索更多歌手，例如：周杰伦" /></label><div class="artist-picker" data-artists></div><div class="selected-artists" data-selected-artists></div><div class="artist-track-list" data-artist-tracks><div class="hint">选择歌手后显示热门歌曲。</div></div></section>'
    );
  const moduleMap = [
    ['.search-area', 'search'],
    ['.recommendation-area', 'recommendations'],
    ['.artist-area', 'artists'],
    ['.playlist-area', 'playlists'],
    ['.history-area', 'history'],
    ['.queue-grid', 'queue'],
  ];
  const firstPanel = app.querySelector('.now-playing');
  moduleMap.forEach(([selector, module]) => {
    const panel = app.querySelector(selector);
    if (panel) {
      panel.dataset.modulePanel = module;
      panel.classList.add('module-panel');
    }
  });
  firstPanel?.insertAdjacentHTML(
    'afterend',
    '<nav class="module-tabs" role="tablist" aria-label="点歌模块"><button type="button" role="tab" data-module-tab="search">搜索歌曲</button><button type="button" role="tab" data-module-tab="recommendations">推荐歌单</button><button type="button" role="tab" data-module-tab="artists">歌手点歌</button><button type="button" role="tab" data-module-tab="playlists">我的歌单</button><button type="button" role="tab" data-module-tab="queue">等待队列</button><button type="button" role="tab" data-module-tab="history">已播放</button></nav>'
  );
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
  app
    .querySelector('[data-local-playlist]')
    .addEventListener('change', event =>
      selectLocalPlaylist(event.target.value)
    );
  app
    .querySelector('[data-artist-search]')
    .addEventListener('input', event =>
      scheduleArtistSearch(event.target.value)
    );
  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.request) requestSong(button.dataset.request, false);
    else if (button.dataset.priority)
      requestSong(button.dataset.priority, true);
    else if (button.dataset.preview) previewTrack(button.dataset.preview);
    else if (button.hasAttribute('data-preview-toggle'))
      togglePreviewPlayback();
    else if (button.hasAttribute('data-preview-stop')) stopPreview();
    else if (button.hasAttribute('data-next-track')) nextTrack();
    else if (button.dataset.recommendation)
      selectRecommendation(button.dataset.recommendation);
    else if (button.dataset.artist) selectArtist(button.dataset.artist);
    else if (button.hasAttribute('data-playlists-refresh')) loadPlaylists();
    else if (button.hasAttribute('data-local-playlists-refresh'))
      loadLocalPlaylists();
    else if (button.hasAttribute('data-recommendations-refresh'))
      refreshCharts();
    else if (button.hasAttribute('data-chart-toggle')) toggleChartMode();
    else if (button.dataset.remove)
      mutate(`/requests/${button.dataset.remove}`, 'DELETE');
    else if (button.dataset.front)
      mutate(`/requests/${button.dataset.front}/front`, 'POST');
  });
  initializeModuleTabs();
}

function renderNowPlaying() {
  const current = state?.current;
  const roomTitle = app.querySelector('[data-room-name]');
  if (roomTitle) {
    roomTitle.textContent = state?.room?.name || 'Shilyfx的KTV';
  }
  const target = app.querySelector('[data-now-playing]');
  const coverMarkup = current?.coverUrl
    ? `<img class="record cover-art" src="${escape(
        current.coverUrl
      )}" alt="" />`
    : '<div class="record">♫</div>';
  target.innerHTML = `<p class="section-label">正在演唱</p>${
    current
      ? `<div class="now-playing-row"><div class="track-title">${coverMarkup}<div><h2>${escape(
          current.name
        )}</h2><p>${escape(
          (current.artists || []).join(' / ')
        )}</p><small>由 ${escape(
          current.requesterName || '主机'
        )} 点播</small></div></div><button type="button" class="next-track-button" data-next-track="true">切歌</button></div>`
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
        )}</small></div><div class="request-actions"><button class="quiet preview-button" data-preview="${escape(
          item.trackId
        )}">试听</button><button data-request="${escape(
          item.trackId
        )}">再唱一次</button><button class="priority-button" data-priority="${escape(
          item.trackId
        )}">优先再唱</button></div></article>`
    )
    .join('');
}

function findTrack(trackId) {
  const id = String(trackId);
  return [
    ...searchResults,
    ...playlistTracks,
    ...localPlaylistTracks,
    ...recommendationTracks,
    ...toplistTracks,
    ...artistTracks,
    ...playedHistory,
  ].find(track => String(track.trackId) === id);
}

function stopPreview() {
  previewGeneration += 1;
  previewTrackId = '';
  const audio = app.querySelector('[data-preview-audio]');
  const float = app.querySelector('[data-preview-float]');
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (float) float.hidden = true;
  renderPreviewControls();
  renderResults(searchResults);
  renderPlaylistTracks();
  renderLocalPlaylistTracks();
  renderRecommendationTracks();
  renderArtistTracks();
}

async function previewTrack(trackId) {
  const id = String(trackId);
  const audio = app.querySelector('[data-preview-audio]');
  const float = app.querySelector('[data-preview-float]');
  const title = app.querySelector('[data-preview-title]');
  if (!audio || !float || !title) return;
  if (previewTrackId === id) {
    if (audio.paused) {
      if (audio.src) audio.play().catch(() => {});
    } else audio.pause();
    renderPreviewControls();
    renderResults(searchResults);
    renderPlaylistTracks();
    renderLocalPlaylistTracks();
    renderRecommendationTracks();
    renderArtistTracks();
    return;
  }
  previewTrackId = id;
  const generation = ++previewGeneration;
  const track = findTrack(id);
  title.textContent = track?.name || '歌曲试听';
  float.hidden = false;
  renderPreviewControls();
  renderResults(searchResults);
  renderPlaylistTracks();
  renderLocalPlaylistTracks();
  renderRecommendationTracks();
  renderArtistTracks();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  setNotice('正在加载试听…');
  try {
    const response = await api(`/track/${encodeURIComponent(id)}/preview`);
    if (generation !== previewGeneration) return;
    audio.src = response.url;
    audio.load();
    renderPreviewControls();
    try {
      await audio.play();
      renderPreviewControls();
      setNotice('正在试听，可使用播放器控制音量。', 'success');
    } catch (_) {
      renderPreviewControls();
      setNotice('试听已加载，请点击悬浮按钮开始播放。', 'success');
    }
  } catch (error) {
    if (generation !== previewGeneration) return;
    previewTrackId = '';
    float.hidden = true;
    renderPreviewControls();
    renderResults(searchResults);
    renderPlaylistTracks();
    renderLocalPlaylistTracks();
    renderRecommendationTracks();
    renderArtistTracks();
    setNotice(
      error.code === 'TRACK_NOT_PLAYABLE'
        ? '这首歌暂时没有可用试听音源。'
        : '试听加载失败，请稍后重试。',
      'error'
    );
  }
}

function renderPreviewControls() {
  const audio = app.querySelector('[data-preview-audio]');
  const toggle = app.querySelector('[data-preview-toggle]');
  if (!audio || !toggle) return;
  const playing = !audio.paused;
  toggle.textContent = playing ? 'Ⅱ' : '▶';
  toggle.setAttribute('aria-label', playing ? '暂停试听' : '播放试听');
}

function togglePreviewPlayback() {
  const audio = app.querySelector('[data-preview-audio]');
  if (!audio || !previewTrackId) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  renderPreviewControls();
}

function trackRequestMarkup(track, className = '') {
  const trackId = String(track.trackId);
  const availability =
    track.source === 'local' ? 'playable' : track.playability || 'unknown';
  const label =
    availability === 'playable'
      ? '可播放'
      : availability === 'trial-only'
      ? '仅试听'
      : availability === 'unavailable'
      ? '不可播放'
      : availability === 'error'
      ? '检测失败'
      : '待检测';
  const disabled = availability !== 'unknown' && availability !== 'playable';
  const previewButton =
    track.source === 'local'
      ? ''
      : `<button class="quiet preview-button" data-preview="${escape(
          trackId
        )}">${previewTrackId === trackId ? '暂停试听' : '试听'}</button>`;
  const sourceLabel = track.source === 'local' ? '本地歌曲 · ' : '';
  return `<article class="result-card ${className}"><div class="result-info"><strong>${escape(
    track.name
  )}</strong><p>${escape((track.artists || []).join(' / '))} · ${escape(
    track.album || '未知专辑'
  )}</p><small>${sourceLabel}${
    track.versionLabel ? `${escape(track.versionLabel)} · ` : ''
  }${formatDuration(
    track.duration
  )} · <b class="availability ${availability}">${label}</b></small></div><div class="request-actions">${previewButton}<button data-request="${escape(
    trackId
  )}" ${
    disabled ? 'disabled' : ''
  }>点歌</button><button class="priority-button" data-priority="${escape(
    trackId
  )}" ${disabled ? 'disabled' : ''}>优先点歌</button></div></article>`;
}

function normalizeArtistName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function localTracksForArtist(artistId) {
  const artist = [...artists, ...featuredArtists].find(
    item => String(item.id) === String(artistId)
  );
  const artistName = normalizeArtistName(artist?.name);
  if (!artistName) return [];
  const matches = [];
  const seen = new Set();
  localPlaylists.forEach(playlist => {
    (playlist.tracks || []).forEach(track => {
      const trackId = String(track.trackId || track.id || '');
      if (!trackId || seen.has(trackId)) return;
      const trackArtists = (track.artists || track.ar || []).map(item =>
        typeof item === 'string' ? item : item?.name
      );
      if (!trackArtists.some(name => normalizeArtistName(name) === artistName))
        return;
      seen.add(trackId);
      matches.push({ ...track, source: 'local' });
    });
  });
  return matches;
}

function mergeArtistTracks(remoteTracks, artistId) {
  const merged = [...(remoteTracks || []), ...localTracksForArtist(artistId)];
  const seen = new Set();
  return merged.filter(track => {
    const trackId = String(track.trackId || track.id || '');
    if (!trackId || seen.has(trackId)) return false;
    seen.add(trackId);
    return true;
  });
}

function renderChartHeader() {
  const title = app.querySelector('[data-chart-title]');
  const refresh = app.querySelector('[data-recommendations-refresh]');
  const toggle = app.querySelector('[data-chart-toggle]');
  const isToplist = chartMode === 'toplists';
  if (title) title.textContent = isToplist ? '排行榜' : '为你推荐';
  if (refresh) refresh.textContent = isToplist ? '刷新榜单' : '换一批';
  if (toggle) toggle.textContent = isToplist ? '推荐' : '排行榜';
}

function activeChartItems() {
  return chartMode === 'toplists' ? toplists : recommendations;
}

function activeChartSelectedId() {
  return chartMode === 'toplists'
    ? selectedToplistId
    : selectedRecommendationId;
}

function activeChartTracks() {
  return chartMode === 'toplists' ? toplistTracks : recommendationTracks;
}

function renderRecommendations() {
  const container = app.querySelector('[data-recommendations]');
  if (!container) return;
  renderChartHeader();
  const items = activeChartItems();
  const selectedId = activeChartSelectedId();
  if (!items.length) {
    container.innerHTML =
      chartMode === 'toplists'
        ? '<div class="hint">暂时没有可展示的排行榜。</div>'
        : '<div class="hint">暂时没有可展示的推荐歌单。</div>';
    return;
  }
  container.innerHTML = items
    .map(
      playlist =>
        `<article class="recommendation-card ${
          String(playlist.id) === String(selectedId) ? 'selected' : ''
        }"><button type="button" data-recommendation="${escape(playlist.id)}">${
          playlist.coverUrl
            ? `<img src="${escape(playlist.coverUrl)}" alt="" loading="lazy" />`
            : '<span class="recommendation-placeholder">♫</span>'
        }<span class="recommendation-copy"><strong>${escape(
          playlist.name
        )}</strong><small>${
          playlist.trackCount || '多'
        } 首 · 查看歌单</small></span></button></article>`
    )
    .join('');
}

function renderRecommendationTracks({ loading = false } = {}) {
  const container = app.querySelector('[data-recommendation-tracks]');
  if (!container) return;
  const isToplist = chartMode === 'toplists';
  const selectedId = activeChartSelectedId();
  const tracks = activeChartTracks();
  if (loading) {
    container.innerHTML = `<div class="hint">正在加载${
      isToplist ? '排行榜' : '推荐歌单'
    }歌曲…</div>`;
    return;
  }
  if (!selectedId) {
    container.innerHTML = `<div class="hint">选择一个${
      isToplist ? '排行榜' : '歌单'
    }查看歌曲。</div>`;
    return;
  }
  if (!tracks.length) {
    container.innerHTML = `<div class="hint">这个${
      isToplist ? '排行榜' : '推荐歌单'
    }暂无可展示歌曲。</div>`;
    return;
  }
  container.innerHTML = tracks
    .slice(0, 30)
    .map(track => trackRequestMarkup(track, 'recommendation-track-card'))
    .join('');
}

function renderArtists() {
  const container = app.querySelector('[data-artists]');
  if (!container) return;
  renderSelectedArtists();
  if (!artistQuery.trim()) {
    container.innerHTML = '';
    return;
  }
  if (!artists.length) {
    container.innerHTML = '<div class="hint">没有找到匹配的歌手。</div>';
    return;
  }
  container.innerHTML = artists
    .map(
      artist =>
        `<button type="button" class="artist-chip ${
          artist.id === selectedArtistId ? 'selected' : ''
        }" data-artist="${escape(artist.id)}">${
          artist.coverUrl
            ? `<img src="${escape(artist.coverUrl)}" alt="" loading="lazy" />`
            : '<span class="artist-placeholder">♪</span>'
        }<span><strong>${escape(artist.name)}</strong><small>${
          artist.albumCount ? `${artist.albumCount} 张专辑` : '热门歌曲'
        }</small></span></button>`
    )
    .join('');
}

function renderFeaturedArtists({ loading = false } = {}) {
  const container = app.querySelector('[data-featured-artists]');
  if (!container) return;
  if (loading) {
    container.innerHTML = '<div class="hint">正在加载常用歌手…</div>';
    return;
  }
  if (!featuredArtists.length) {
    container.innerHTML =
      '<div class="hint">常用歌手暂时无法加载，可使用下方搜索。</div>';
    return;
  }
  container.innerHTML = featuredArtists
    .map(
      artist =>
        `<button type="button" class="featured-artist-card ${
          artist.id === selectedArtistId ? 'selected' : ''
        }" data-artist="${escape(artist.id)}">${
          artist.coverUrl
            ? `<img src="${escape(artist.coverUrl)}" alt="" loading="lazy" />`
            : '<span class="artist-placeholder">♪</span>'
        }<strong>${escape(
          artist.name
        )}</strong><small>热门歌曲</small></button>`
    )
    .join('');
}

async function loadFeaturedArtists() {
  renderFeaturedArtists({ loading: true });
  try {
    const results = await Promise.all(
      featuredArtistQueries.map(async query => {
        try {
          const response = await api(
            `/artists/search?q=${encodeURIComponent(query)}`
          );
          return response.artists?.[0] || null;
        } catch (_) {
          return null;
        }
      })
    );
    featuredArtists = results
      .filter(Boolean)
      .filter(
        (artist, index, list) =>
          list.findIndex(item => item.id === artist.id) === index
      );
    renderFeaturedArtists();
  } catch (_) {
    featuredArtists = [];
    renderFeaturedArtists();
  }
}

function renderSelectedArtists() {
  const container = app.querySelector('[data-selected-artists]');
  if (!container) return;
  container.innerHTML = artistSelections.length
    ? `<span>已选歌手</span>${artistSelections
        .map(
          artist =>
            `<button type="button" class="selected-artist ${
              artist.id === selectedArtistId ? 'selected' : ''
            }" data-artist="${escape(artist.id)}">${escape(
              artist.name
            )}</button>`
        )
        .join('')}`
    : '';
}

function renderArtistTracks({ loading = false } = {}) {
  const container = app.querySelector('[data-artist-tracks]');
  if (!container) return;
  if (loading) {
    container.innerHTML = '<div class="hint">正在加载歌手热门歌曲…</div>';
    return;
  }
  if (!selectedArtistId) {
    container.innerHTML = '<div class="hint">选择歌手后显示热门歌曲。</div>';
    return;
  }
  if (!artistTracks.length) {
    container.innerHTML = '<div class="hint">这个歌手暂无可展示歌曲。</div>';
    return;
  }
  container.innerHTML = artistTracks
    .slice(0, 30)
    .map(track => trackRequestMarkup(track, 'artist-track-card'))
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
    .map(track => trackRequestMarkup(track, 'search-track-card'))
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
    .map(track => trackRequestMarkup(track, 'playlist-track-card'))
    .join('');
}

function renderLocalPlaylistPicker() {
  const select = app.querySelector('[data-local-playlist]');
  if (!select) return;
  select.innerHTML = localPlaylists.length
    ? localPlaylists
        .map(
          playlist =>
            `<option value="${escape(playlist.id)}">${escape(
              playlist.name
            )} · ${
              playlist.trackCount || playlist.tracks?.length || 0
            } 首</option>`
        )
        .join('')
    : '<option value="">主机尚未配置本地音乐目录</option>';
  select.value = selectedLocalPlaylistId;
  select.disabled = !localPlaylists.length;
}

function renderLocalPlaylistTracks() {
  const container = app.querySelector('[data-local-playlist-tracks]');
  if (!container) return;
  if (!selectedLocalPlaylistId) {
    container.innerHTML = '<div class="hint">主机尚未配置本地音乐目录。</div>';
    return;
  }
  if (!localPlaylistTracks.length) {
    container.innerHTML = '<div class="hint">这个本地歌单暂无歌曲。</div>';
    return;
  }
  container.innerHTML = localPlaylistTracks
    .map(track => trackRequestMarkup(track, 'local-track-card'))
    .join('');
}

function selectLocalPlaylist(playlistId) {
  selectedLocalPlaylistId = playlistId;
  const playlist = localPlaylists.find(
    item => String(item.id) === String(playlistId)
  );
  localPlaylistTracks = playlist?.tracks || [];
  renderLocalPlaylistPicker();
  renderLocalPlaylistTracks();
}

async function loadLocalPlaylists() {
  const button = app.querySelector('[data-local-playlists-refresh]');
  if (button) button.disabled = true;
  try {
    const response = await api('/local-playlists');
    localPlaylists = response.playlists || [];
    const hasSelected = localPlaylists.some(
      playlist => String(playlist.id) === String(selectedLocalPlaylistId)
    );
    selectedLocalPlaylistId = hasSelected
      ? selectedLocalPlaylistId
      : localPlaylists[0]?.id || '';
    renderLocalPlaylistPicker();
    selectLocalPlaylist(selectedLocalPlaylistId);
    if (selectedArtistId) {
      artistTracks = mergeArtistTracks(artistTracks, selectedArtistId);
      renderArtistTracks();
    }
  } catch (_) {
    localPlaylists = [];
    selectedLocalPlaylistId = '';
    localPlaylistTracks = [];
    renderLocalPlaylistPicker();
    renderLocalPlaylistTracks();
  } finally {
    if (button) button.disabled = false;
  }
}

async function selectRecommendation(playlistId) {
  if (chartMode === 'toplists') return selectToplist(playlistId);
  selectedRecommendationId = playlistId;
  recommendationTracks = [];
  renderRecommendations();
  renderRecommendationTracks({ loading: Boolean(playlistId) });
  if (!playlistId) return;
  const generation = ++recommendationTrackGeneration;
  try {
    const response = await api(
      `/recommendations/${encodeURIComponent(playlistId)}/tracks`
    );
    if (
      generation !== recommendationTrackGeneration ||
      chartMode !== 'recommendations'
    )
      return;
    recommendationTracks = response.tracks || [];
    renderRecommendationTracks();
  } catch (_) {
    if (
      generation !== recommendationTrackGeneration ||
      chartMode !== 'recommendations'
    )
      return;
    renderRecommendationTracks();
    setNotice('推荐歌单歌曲暂时无法加载，请稍后重试。', 'error');
  }
}

async function selectToplist(playlistId) {
  selectedToplistId = playlistId;
  toplistTracks = [];
  renderRecommendations();
  renderRecommendationTracks({ loading: Boolean(playlistId) });
  if (!playlistId) return;
  const generation = ++toplistTrackGeneration;
  try {
    const response = await api(
      `/toplists/${encodeURIComponent(playlistId)}/tracks`
    );
    if (generation !== toplistTrackGeneration || chartMode !== 'toplists')
      return;
    toplistTracks = response.tracks || [];
    renderRecommendationTracks();
  } catch (_) {
    if (generation !== toplistTrackGeneration || chartMode !== 'toplists')
      return;
    renderRecommendationTracks();
    setNotice('排行榜歌曲暂时无法加载，请稍后重试。', 'error');
  }
}

async function loadRecommendations() {
  const button = app.querySelector('[data-recommendations-refresh]');
  if (button) button.disabled = true;
  try {
    const response = await api('/recommendations');
    recommendations = response.playlists || [];
    const hasSelected = recommendations.some(
      playlist => playlist.id === selectedRecommendationId
    );
    selectedRecommendationId = hasSelected
      ? selectedRecommendationId
      : recommendations[0]?.id || '';
    renderRecommendations();
    if (selectedRecommendationId)
      await selectRecommendation(selectedRecommendationId);
    else renderRecommendationTracks();
  } catch (_) {
    recommendations = [];
    selectedRecommendationId = '';
    renderRecommendations();
    renderRecommendationTracks();
    setNotice('推荐歌单暂时无法加载，请点击“换一批”重试。', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadToplists() {
  const button = app.querySelector('[data-recommendations-refresh]');
  if (button) button.disabled = true;
  try {
    const response = await api('/toplists');
    toplists = response.playlists || [];
    toplistsLoaded = true;
    const hasSelected = toplists.some(
      playlist => String(playlist.id) === String(selectedToplistId)
    );
    selectedToplistId = hasSelected ? selectedToplistId : toplists[0]?.id || '';
    renderRecommendations();
    if (selectedToplistId) await selectToplist(selectedToplistId);
    else renderRecommendationTracks();
  } catch (_) {
    toplists = [];
    toplistsLoaded = true;
    selectedToplistId = '';
    renderRecommendations();
    renderRecommendationTracks();
    setNotice('排行榜暂时无法加载，请稍后重试。', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function refreshCharts() {
  return chartMode === 'toplists' ? loadToplists() : loadRecommendations();
}

async function toggleChartMode() {
  recommendationTrackGeneration += 1;
  toplistTrackGeneration += 1;
  chartMode = chartMode === 'toplists' ? 'recommendations' : 'toplists';
  renderRecommendations();
  renderRecommendationTracks({ loading: true });
  if (chartMode === 'toplists') {
    if (!toplistsLoaded) return loadToplists();
    if (selectedToplistId) return selectToplist(selectedToplistId);
    return renderRecommendationTracks();
  }
  if (selectedRecommendationId)
    return selectRecommendation(selectedRecommendationId);
  return renderRecommendationTracks();
}

function scheduleArtistSearch(query) {
  artistQuery = query;
  const generation = ++artistSearchGeneration;
  clearTimeout(artistSearchTimer);
  if (artistSearchAbort) artistSearchAbort.abort();
  const clean = query.trim();
  artists = [];
  selectedArtistId = '';
  artistTracks = [];
  renderFeaturedArtists();
  renderArtists();
  renderArtistTracks();
  if (!clean) return;
  artistSearchTimer = setTimeout(async () => {
    artistSearchAbort = new AbortController();
    const container = app.querySelector('[data-artists]');
    if (container)
      container.innerHTML = '<div class="hint">正在查找歌手…</div>';
    try {
      const response = await api(
        `/artists/search?q=${encodeURIComponent(clean)}`,
        {
          signal: artistSearchAbort.signal,
        }
      );
      if (generation !== artistSearchGeneration || clean !== artistQuery.trim())
        return;
      artists = response.artists || [];
      renderArtists();
    } catch (error) {
      if (
        error.name !== 'AbortError' &&
        generation === artistSearchGeneration
      ) {
        artists = [];
        renderArtists();
        setNotice('歌手搜索暂时不可用，请稍后重试。', 'error');
      }
    }
  }, 300);
}

async function selectArtist(artistId) {
  selectedArtistId = artistId;
  const selected = [...artists, ...featuredArtists].find(
    artist => artist.id === String(artistId)
  );
  if (selected && !artistSelections.some(artist => artist.id === selected.id))
    artistSelections.push(selected);
  renderSelectedArtists();
  artistTracks = [];
  renderFeaturedArtists();
  renderArtists();
  renderArtistTracks({ loading: Boolean(artistId) });
  if (!artistId) return;
  const generation = ++artistTrackGeneration;
  try {
    const response = await api(
      `/artists/${encodeURIComponent(artistId)}/tracks`
    );
    if (generation !== artistTrackGeneration) return;
    artistTracks = mergeArtistTracks(response.tracks || [], artistId);
    renderArtistTracks();
  } catch (_) {
    if (generation !== artistTrackGeneration) return;
    renderArtistTracks();
    setNotice('歌手歌曲暂时无法加载，请稍后重试。', 'error');
  }
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
    const track = findTrack(trackId);
    await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ trackId, priority }),
    });
    const name = track?.name || '歌曲';
    setNotice(
      priority ? `${name}点歌成功，已优先加入等待队列` : `${name}点歌成功`,
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

async function nextTrack() {
  try {
    const response = await api('/next', { method: 'POST' });
    setNotice(
      response.item
        ? `已切歌，开始播放${response.item.name}`
        : '已切歌，等待下一首歌曲。',
      'success'
    );
    await refresh();
  } catch (_) {
    setNotice('切歌未完成，队列可能已发生变化。', 'error');
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
    await Promise.all([
      loadRecommendations(),
      loadPlaylists(),
      loadLocalPlaylists(),
      loadFeaturedArtists(),
    ]);
  } catch (_) {
    showEnded();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && client) refresh();
});
bootstrap();
