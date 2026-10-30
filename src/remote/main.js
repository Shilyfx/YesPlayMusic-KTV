import './styles.css';
import createRefreshScheduler from './refreshScheduler';
import createCatalogPrefetchScheduler from './catalogPrefetchScheduler';
import { loadEmotionBall, loadMoodMates } from '../karaoke/moodMates';
import {
  ktvReactionChoices,
  reactionCharacters,
  reactionEffects,
  normalizeReactionText,
  resolveReaction,
} from '../karaoke/reactions';

const app = document.querySelector('#remote-app');
const apiRoot = '/ktv/api';
const roomCode = window.location.pathname.split('/').filter(Boolean).pop();
const storageKey = `yesplaymusic-ktv:${roomCode}`;
let client;
function shuffleEffects(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const randomizedReactionEffects = shuffleEffects(reactionEffects);
let reactionEffect = randomizedReactionEffects[0]?.id || 'bounce';
let reactionEffectsExpanded = false;
let reactionCharacter = 'ball';
let reactionPreviewVersion = 0;
let state;
let searchTimer;
let searchAbort;
let refreshTimer;
let roomEnded = false;
let lastStateRevision = null;
let renderedNowPlayingKey = null;
let retryDelay = 2000;
let searchQuery = '';
let searchResults = [];
let searchGeneration = 0;
let playlists = [];
let playlistsLoaded = false;
let playlistsPromise;
let selectedPlaylistId = '';
let playlistTracks = [];
let playlistQuery = '';
let playlistTrackGeneration = 0;
let localPlaylists = [];
let selectedLocalPlaylistId = '';
let localPlaylistTracks = [];
let playedHistory = [];
let recommendations = [];
let recommendationsLoaded = false;
let recommendationsPromise;
let selectedRecommendationId = '';
let recommendationTracks = [];
let recommendationTrackGeneration = 0;
let toplists = [];
let selectedToplistId = '';
let toplistTracks = [];
let toplistTrackGeneration = 0;
let toplistsLoaded = false;
let chartMode = 'recommendations';
let chartView = 'lists';
let playlistSource = 'user';
let localPlaylistsLoaded = false;
let localPlaylistsPromise;
let artistSearchTimer;
let artistSearchAbort;
let artistSearchGeneration = 0;
let artistQuery = '';
let artists = [];
const featuredArtistDefaults = [
  {
    id: '6452',
    name: '周杰伦',
    coverUrl: '/artist-portraits/6452.jpg',
    albumCount: 38,
  },
  {
    id: '3684',
    name: '林俊杰',
    coverUrl: '/artist-portraits/3684.jpg',
    albumCount: 42,
  },
  {
    id: '7763',
    name: '邓紫棋',
    coverUrl: '/artist-portraits/7763.jpg',
    albumCount: 35,
  },
  {
    id: '2116',
    name: '陈奕迅',
    coverUrl: '/artist-portraits/2116.jpg',
    albumCount: 96,
  },
  {
    id: '5781',
    name: '薛之谦',
    coverUrl: '/artist-portraits/5781.jpg',
    albumCount: 28,
  },
  {
    id: '6066',
    name: '杨宗纬',
    coverUrl: '/artist-portraits/6066.jpg',
    albumCount: 18,
  },
];
let featuredArtists = featuredArtistDefaults.map(artist => ({ ...artist }));
let selectedArtistId = '';
let artistTracks = [];
let artistTrackGeneration = 0;
let artistSelections = [];
let selectedModule = 'search';
let previewTrackId = '';
let previewGeneration = 0;
let requestToastTimer;
const refreshScheduler = createRefreshScheduler(
  () => performRefresh(),
  () => !roomEnded
);
const catalogPrefetchScheduler = createCatalogPrefetchScheduler({
  isHidden: () => document.hidden,
  shouldRun: () => !roomEnded && Boolean(client?.clientToken),
});

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
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.classList.remove('notice-pop');
  if (kind === 'success') {
    requestAnimationFrame(() => notice.classList.add('notice-pop'));
  }
}

function showRequestToast(message = '点歌成功', kind = 'success') {
  const toast = app.querySelector('[data-request-toast]');
  if (!toast) return;
  clearTimeout(requestToastTimer);
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.hidden = false;
  toast.classList.remove('toast-active');
  void toast.offsetWidth;
  toast.classList.add('toast-active');
  requestToastTimer = setTimeout(() => {
    toast.classList.remove('toast-active');
    toast.hidden = true;
  }, 950);
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
  const update = tabId => {
    const module = tabId === 'local-playlists' ? 'playlists' : tabId;
    selectedModule = module;
    if (tabId === 'local-playlists') {
      playlistSource = 'local';
      renderPlaylistSource();
    } else if (tabId === 'playlists') {
      playlistSource = 'user';
      renderPlaylistSource();
    }
    tabs.forEach(tab => {
      const isPlaylistTab =
        tab.dataset.moduleTab === 'playlists' ||
        tab.dataset.moduleTab === 'local-playlists';
      const active = isPlaylistTab
        ? module === 'playlists' &&
          ((tab.dataset.moduleTab === 'local-playlists' &&
            playlistSource === 'local') ||
            (tab.dataset.moduleTab === 'playlists' &&
              playlistSource === 'user'))
        : tab.dataset.moduleTab === module;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    panels.forEach(panel => {
      panel.hidden = panel.dataset.modulePanel !== module;
    });
    ensureModuleLoaded(module);
  };
  tabs.forEach(tab =>
    tab.addEventListener('click', () => update(tab.dataset.moduleTab))
  );
  update(selectedModule);
}

function initializeShell() {
  const theme = localStorage.getItem('yesplaymusic-ktv-theme') || 'auto';
  document.documentElement.dataset.theme = theme;
  app.innerHTML = `<main class="remote-page"><header class="topbar"><div><p class="eyebrow">LUMASING · LAN KTV</p><h1 data-room-name>LumaSing KTV</h1></div><div class="theme-picker" data-theme-picker role="group" aria-label="KTV 主题"><button type="button" data-theme-option="auto">自动</button><button type="button" data-theme-option="light"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>浅色</button><button type="button" data-theme-option="dark"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.807a6.5 6.5 0 0 0 8.268 8.268c.347-.215.829-.003.803.397"/></svg>深色</button></div></header><p class="notice" data-notice></p><section class="now-playing glass" data-now-playing></section><section class="history-area glass"><div class="section-heading"><div><p class="section-label">本场已唱</p><h2>已播放歌曲</h2></div><span data-history-count>0 首</span></div><div class="history-list" data-history-list><div class="empty">本场还没有已唱歌曲</div></div></section><section class="playlist-area glass"><div class="section-heading"><div><p class="section-label">当前账号歌单</p><h2>从歌单点歌</h2></div><button class="quiet playlist-refresh" type="button" data-playlists-refresh>刷新歌单</button></div><div class="playlist-picker"><label>选择歌单<select data-playlist><option value="">正在加载歌单…</option></select></label><label>筛选歌曲<input data-playlist-search maxlength="80" autocomplete="off" placeholder="在当前歌单中筛选" /></label></div><div class="playlist-track-list" data-playlist-tracks><div class="hint">正在加载当前账号的歌单。</div></div><div class="local-playlist-block"><div class="section-heading"><div><p class="section-label">主机本地目录</p><h3>本地歌单</h3></div><button class="quiet" type="button" data-local-playlists-refresh>刷新本地歌单</button></div><label>选择本地歌单<select data-local-playlist><option value="">正在加载本地歌单…</option></select></label><div class="playlist-track-list" data-local-playlist-tracks><div class="hint">主机尚未配置本地音乐目录。</div></div></div></section><section class="search-area"><label class="search-box"><span>⌕</span><input data-search maxlength="80" autocomplete="off" placeholder="搜索歌曲、歌手或专辑" /></label><div class="search-results" data-results><div class="hint">输入关键词后即可点歌，主机负责开始演唱。</div></div></section><section class="queue-grid"><section class="queue-panel glass"><div class="section-heading"><div><p class="section-label">当前队列</p><h2>等待演唱</h2></div><span data-queue-count>0 首</span></div><div class="queue-list" data-queue-list><div class="empty">还没有待唱歌曲</div></div></section></section></main>`;
  app.insertAdjacentHTML(
    'beforeend',
    '<div class="request-toast" data-request-toast role="status" aria-live="polite" hidden>点歌成功</div><div class="preview-float" data-preview-float hidden><button type="button" class="preview-float-toggle" data-preview-toggle="true" aria-label="播放试听" title="播放或暂停试听">▶</button><strong data-preview-title>试听</strong><button type="button" class="preview-float-close" data-preview-stop="true" aria-label="关闭试听" title="关闭试听">×</button><audio data-preview-audio preload="none"></audio></div>'
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
      updatePreviewButtons();
    })
  );
  app
    .querySelector('.history-area')
    .insertAdjacentHTML(
      'afterend',
      '<section class="recommendation-area glass"><div class="section-heading"><div><p class="section-label">LUMASING 推荐</p><h2 data-chart-title>为你推荐</h2></div><div class="chart-actions"><button class="quiet chart-toggle" type="button" data-chart-toggle>排行榜</button></div></div><div class="recommendation-list" data-recommendations><div class="hint">正在加载推荐歌单…</div></div><div class="recommendation-track-list" data-recommendation-tracks><div class="hint">选择一个歌单查看歌曲。</div></div></section><section class="artist-area glass"><div class="section-heading"><div><p class="section-label">按歌手点歌</p><h2>找歌手</h2></div><span class="section-helper">选择一位歌手后，可继续添加其他歌手</span></div><div class="featured-artist-list" data-featured-artists><div class="hint">正在加载常用歌手…</div></div><label class="artist-search-box"><span>⌕</span><input data-artist-search maxlength="60" autocomplete="off" placeholder="搜索更多歌手，例如：周杰伦" /></label><div class="artist-picker" data-artists></div><div class="selected-artists" data-selected-artists></div><div class="artist-track-list" data-artist-tracks><div class="hint">选择歌手后显示热门歌曲。</div></div></section>'
    );
  const playlistArea = app.querySelector('.playlist-area');
  const playlistHeading = playlistArea?.querySelector('.section-heading');
  const playlistLabel = playlistHeading?.querySelector('.section-label');
  const playlistTitle = playlistHeading?.querySelector('h2');
  const playlistRefresh = playlistHeading?.querySelector(
    '[data-playlists-refresh]'
  );
  const playlistPicker = playlistArea?.querySelector('.playlist-picker');
  const playlistTracks = playlistArea?.querySelector('[data-playlist-tracks]');
  if (playlistLabel) playlistLabel.dataset.playlistLabel = '';
  if (playlistTitle) playlistTitle.dataset.playlistTitle = '';
  if (playlistPicker) playlistPicker.dataset.userPlaylistPanel = '';
  if (playlistTracks) playlistTracks.dataset.userPlaylistPanel = '';
  if (playlistHeading && playlistRefresh) {
    const playlistActions = document.createElement('div');
    playlistActions.className = 'playlist-actions';
    playlistRefresh.replaceWith(playlistActions);
    playlistActions.append(playlistRefresh);
    playlistActions.insertAdjacentHTML(
      'beforeend',
      '<button class="quiet playlist-source-toggle" type="button" data-playlist-source-toggle>本地歌单</button>'
    );
  }
  const localBlock = playlistArea?.querySelector('.local-playlist-block');
  if (localBlock) {
    const localView = document.createElement('div');
    localView.className = 'local-playlist-view';
    localView.dataset.localPlaylistPanel = '';
    localView.hidden = true;
    const localLabel = [...localBlock.children].find(child =>
      child.matches('label')
    );
    const localTracks = localBlock.querySelector(
      '[data-local-playlist-tracks]'
    );
    if (localLabel) localView.append(localLabel);
    if (localTracks) localView.append(localTracks);
    localBlock.replaceWith(localView);

    const playlistContent = document.createElement('div');
    playlistContent.className = 'playlist-content';
    playlistContent.dataset.playlistContent = '';
    const firstView = playlistPicker || playlistTracks || localView;
    firstView?.before(playlistContent);
    if (playlistPicker) playlistContent.append(playlistPicker);
    if (playlistTracks) playlistContent.append(playlistTracks);
    playlistContent.append(localView);
  }
  const recommendationArea = app.querySelector('.recommendation-area');
  const chartActions = recommendationArea?.querySelector('.chart-actions');
  const chartLists = recommendationArea?.querySelector(
    '[data-recommendations]'
  );
  const chartTracks = recommendationArea?.querySelector(
    '[data-recommendation-tracks]'
  );
  if (chartActions) {
    chartActions.insertAdjacentHTML(
      'beforeend',
      '<button class="quiet chart-back" type="button" data-chart-back hidden>返回歌单</button>'
    );
  }
  if (chartLists && chartTracks) {
    const chartContent = document.createElement('div');
    chartContent.className = 'chart-content';
    chartContent.dataset.chartContent = '';
    chartLists.parentNode.insertBefore(chartContent, chartLists);
    chartContent.append(chartLists, chartTracks);
    chartTracks.hidden = true;
  }
  renderPlaylistSource();
  renderChartHeader();
  const moduleMap = [
    ['.search-area', 'search'],
    ['.recommendation-area', 'recommendations'],
    ['.artist-area', 'artists'],
    ['.playlist-area', 'playlists'],
    ['.history-area', 'history'],
    ['.queue-grid', 'queue'],
    ['.reaction-studio', 'reactions'],
  ];
  const firstPanel = app.querySelector('.now-playing');
  if (process.env.VUE_APP_DOCKER_KTV === 'true') {
    firstPanel?.insertAdjacentHTML('afterend', reactionStudioMarkup());
  }
  moduleMap.forEach(([selector, module]) => {
    const panel = app.querySelector(selector);
    if (panel) {
      panel.dataset.modulePanel = module;
      panel.classList.add('module-panel');
    }
  });
  firstPanel?.insertAdjacentHTML(
    'afterend',
    '<nav class="module-tabs" role="tablist" aria-label="点歌模块"><button type="button" role="tab" data-module-tab="search">搜索歌曲</button><button type="button" role="tab" data-module-tab="recommendations">推荐歌单</button><button type="button" role="tab" data-module-tab="artists">歌手点歌</button><button type="button" role="tab" data-module-tab="local-playlists">本地歌单</button><button type="button" role="tab" data-module-tab="playlists">我的歌单</button><button type="button" role="tab" data-module-tab="queue">等待队列</button><button type="button" role="tab" data-module-tab="history">已播放</button></nav>'
  );
  if (process.env.VUE_APP_DOCKER_KTV === 'true')
    app
      .querySelector('.module-tabs')
      ?.insertAdjacentHTML(
        'beforeend',
        '<button type="button" role="tab" data-module-tab="reactions">互动应援</button>'
      );
  const themePicker = app.querySelector('[data-theme-picker]');
  const selectTheme = value => {
    const selected = ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
    themePicker.dataset.value = selected;
    document.documentElement.dataset.theme = selected;
    themePicker.querySelectorAll('[data-theme-option]').forEach(button => {
      const active = button.dataset.themeOption === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  selectTheme(theme);
  themePicker.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-option]');
    if (!button || !themePicker.contains(button)) return;
    const value = button.dataset.themeOption;
    localStorage.setItem('yesplaymusic-ktv-theme', value);
    selectTheme(value);
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
    if (button.dataset.characterChoice) {
      reactionCharacter = button.dataset.characterChoice;
      app
        .querySelectorAll('[data-character-choice]')
        .forEach(item =>
          item.setAttribute('aria-pressed', String(item === button))
        );
      renderReactionGrid();
    } else if (button.hasAttribute('data-custom-reaction')) {
      const editor = app.querySelector('[data-reaction-custom-editor]');
      editor.hidden = !editor.hidden;
      button.setAttribute('aria-expanded', String(!editor.hidden));
      if (!editor.hidden)
        app.querySelector('[data-reaction-custom-text]').focus();
    } else if (button.hasAttribute('data-clear-reaction-text')) {
      app.querySelector('[data-reaction-custom-text]').value = '';
      updateReactionCustomText();
    } else if (button.hasAttribute('data-toggle-more-effects')) {
      reactionEffectsExpanded = !reactionEffectsExpanded;
      const moreContainer = app.querySelector('[data-more-reaction-effects]');
      if (moreContainer) moreContainer.hidden = !reactionEffectsExpanded;
      button.setAttribute('aria-expanded', String(reactionEffectsExpanded));
      const hiddenCount = Math.max(0, randomizedReactionEffects.length - 6);
      button.textContent = reactionEffectsExpanded
        ? '收起更多登场方式'
        : `展开更多登场方式（${hiddenCount}）`;
    } else if (button.dataset.effectChoice) {
      reactionEffect = button.dataset.effectChoice;
      app
        .querySelectorAll('[data-effect-choice]')
        .forEach(item =>
          item.setAttribute('aria-pressed', String(item === button))
        );
    } else if (button.dataset.reaction)
      sendReaction(button.dataset.reaction, button);
    else if (button.dataset.request)
      requestSong(button.dataset.request, false, button);
    else if (button.dataset.priority)
      requestSong(button.dataset.priority, true, button);
    else if (button.dataset.preview) previewTrack(button.dataset.preview);
    else if (button.hasAttribute('data-preview-toggle'))
      togglePreviewPlayback();
    else if (button.hasAttribute('data-preview-stop')) stopPreview();
    else if (button.hasAttribute('data-next-track')) nextTrack();
    else if (button.dataset.recommendation)
      selectRecommendation(button.dataset.recommendation);
    else if (button.dataset.artist) selectArtist(button.dataset.artist);
    else if (button.hasAttribute('data-playlists-refresh'))
      refreshPlaylistSource();
    else if (button.hasAttribute('data-playlist-source-toggle'))
      togglePlaylistSource();
    else if (button.hasAttribute('data-chart-toggle')) toggleChartMode();
    else if (button.hasAttribute('data-chart-back')) returnChartToLists();
    else if (button.dataset.remove)
      mutate(`/requests/${button.dataset.remove}`, 'DELETE');
    else if (button.dataset.front)
      mutate(`/requests/${button.dataset.front}/front`, 'POST');
  });
  app
    .querySelector('[data-reaction-custom-text]')
    ?.addEventListener('input', updateReactionCustomText);
  initializeModuleTabs();
}

async function sendReaction(kind, button) {
  if (!client?.clientToken) {
    setNotice('正在连接房间，请稍后再试', 'error');
    return;
  }
  button.disabled = true;
  try {
    const effect = reactionEffect;
    const customText = normalizeReactionText(
      app.querySelector('[data-reaction-custom-text]')?.value
    );
    const result = await api('/reactions', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        effect,
        character: reactionCharacter,
        ...(kind === 'emotion' ? { emotionId: button.dataset.emotionId } : {}),
        ...(customText ? { customText } : {}),
      }),
    });
    const labelText =
      customText ||
      resolveReaction({ kind, emotionId: button.dataset.emotionId })?.label ||
      '应援';
    const isQueued = result?.status === 'queued';
    const isReplaced = result?.status === 'replaced';
    setNotice(
      isQueued
        ? `已加入排队（第 ${result.queuePosition || 1} 位），即将登场`
        : isReplaced
        ? '已更新当前登场表情'
        : '表情已送出',
      'success'
    );
    const feedback = app.querySelector('[data-reaction-feedback]');
    if (feedback)
      feedback.textContent = isQueued
        ? `排队中「${labelText}」· 第 ${result.queuePosition || 1} 位等待登场`
        : `已送出「${labelText}」· 看看舞台上的角色`;
  } catch (error) {
    setNotice(
      (error.code || error.message) === 'INVALID_REACTION_TEXT'
        ? '自定义内容最多40个字符，请缩短后发送'
        : error.code === 'REACTION_QUEUE_FULL'
        ? '当前舞台互动较多，请稍后再试'
        : error.code === 'RATE_LIMIT'
        ? '发送太快，请稍后再试'
        : '表情发送失败，请稍后重试',
      'error'
    );
  } finally {
    setTimeout(() => {
      if (button.isConnected) button.disabled = false;
    }, 500);
  }
}

function renderNowPlaying() {
  const current = state?.current;
  const roomTitle = app.querySelector('[data-room-name]');
  if (roomTitle) {
    roomTitle.textContent = state?.room?.name || 'LumaSing KTV';
  }
  const currentKey = current
    ? JSON.stringify([
        current.queueItemId,
        current.trackId,
        current.status,
        current.requesterId,
        current.name,
        current.artists,
        current.coverUrl,
        current.requesterName,
      ])
    : 'empty';
  if (currentKey === renderedNowPlayingKey) return;
  renderedNowPlayingKey = currentKey;
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
  updatePreviewButtons();
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
    updatePreviewButtons();
    return;
  }
  previewTrackId = id;
  const generation = ++previewGeneration;
  const track = findTrack(id);
  title.textContent = track?.name || '歌曲试听';
  float.hidden = false;
  renderPreviewControls();
  updatePreviewButtons();
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
    updatePreviewButtons();
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

function updatePreviewButtons() {
  app.querySelectorAll('[data-preview]').forEach(button => {
    const active = String(button.dataset.preview) === String(previewTrackId);
    button.textContent = active ? '暂停试听' : '试听';
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
  });
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
      : '';
  const availabilityMarkup = label
    ? ` · <b class="availability ${availability}">${label}</b>`
    : '';
  const disabled = availability !== 'unknown' && availability !== 'playable';
  const previewButton =
    track.source === 'local'
      ? ''
      : `<button class="quiet preview-button" data-preview="${escape(
          trackId
        )}" aria-pressed="${previewTrackId === trackId}">${
          previewTrackId === trackId ? '暂停试听' : '试听'
        }</button>`;
  const sourceLabel = track.source === 'local' ? '本地歌曲 · ' : '';
  const coverThumb =
    track.source === 'local' && track.coverUrl
      ? `<img class="result-cover" src="${escape(
          track.coverUrl
        )}" alt="" loading="lazy" />`
      : '';
  return `<article class="result-card ${className}">${coverThumb}<div class="result-info"><strong>${escape(
    track.name
  )}</strong><p>${escape((track.artists || []).join(' / '))} · ${escape(
    track.album || '未知专辑'
  )}</p><small>${sourceLabel}${
    track.versionLabel ? `${escape(track.versionLabel)} · ` : ''
  }${formatDuration(
    track.duration
  )}${availabilityMarkup}</small></div><div class="request-actions">${previewButton}<button data-request="${escape(
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
  const toggle = app.querySelector('[data-chart-toggle]');
  const back = app.querySelector('[data-chart-back]');
  const isToplist = chartMode === 'toplists';
  const selected = activeChartItems().find(
    playlist => String(playlist.id) === String(activeChartSelectedId())
  );
  if (title)
    title.textContent =
      chartView === 'tracks'
        ? selected?.name || '歌曲列表'
        : isToplist
        ? '排行榜'
        : '为你推荐';
  if (toggle) toggle.textContent = isToplist ? '推荐' : '排行榜';
  if (back) {
    back.hidden = chartView !== 'tracks';
    back.textContent = isToplist ? '返回榜单' : '返回歌单';
  }
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

function renderChartView() {
  const lists = app.querySelector('[data-recommendations]');
  const tracks = app.querySelector('[data-recommendation-tracks]');
  const content = app.querySelector('[data-chart-content]');
  const showingTracks = chartView === 'tracks';
  if (lists) lists.hidden = showingTracks;
  if (tracks) tracks.hidden = !showingTracks;
  if (content) content.dataset.view = showingTracks ? 'tracks' : 'lists';
  renderChartHeader();
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
    renderChartView();
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
  renderChartView();
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
    renderChartView();
    return;
  }
  if (!selectedId) {
    container.innerHTML = `<div class="hint">选择一个${
      isToplist ? '排行榜' : '歌单'
    }查看歌曲。</div>`;
    renderChartView();
    return;
  }
  if (!tracks.length) {
    container.innerHTML = `<div class="hint">这个${
      isToplist ? '排行榜' : '推荐歌单'
    }暂无可展示歌曲。</div>`;
    renderChartView();
    return;
  }
  container.innerHTML = tracks
    .slice(0, 30)
    .map(track => trackRequestMarkup(track, 'recommendation-track-card'))
    .join('');
  renderChartView();
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

function loadFeaturedArtists() {
  // The featured cards already have verified local IDs, names and portraits.
  // Fetch the selected artist's songs only when the user selects that artist.
  renderFeaturedArtists();
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

function renderPlaylistSource() {
  const isLocal = playlistSource === 'local';
  const playlistArea = app.querySelector('.playlist-area');
  const playlistContent = app.querySelector('[data-playlist-content]');
  const label = app.querySelector('[data-playlist-label]');
  const title = app.querySelector('[data-playlist-title]');
  const refresh = app.querySelector('[data-playlists-refresh]');
  const toggle = app.querySelector('[data-playlist-source-toggle]');
  if (label) label.textContent = isLocal ? '主机本地目录' : '当前账号歌单';
  if (title) title.textContent = isLocal ? '本地歌单' : '从歌单点歌';
  if (refresh) refresh.textContent = isLocal ? '刷新本地歌单' : '刷新歌单';
  if (toggle) toggle.textContent = isLocal ? '用户歌单' : '本地歌单';
  if (playlistContent)
    playlistContent.dataset.view = isLocal ? 'local' : 'user';
  if (playlistArea) playlistArea.dataset.source = isLocal ? 'local' : 'user';
  app.querySelectorAll('[data-user-playlist-panel]').forEach(panel => {
    panel.hidden = isLocal;
  });
  const localPanel = app.querySelector('[data-local-playlist-panel]');
  if (localPanel) localPanel.hidden = !isLocal;
}

function togglePlaylistSource() {
  playlistSource = playlistSource === 'local' ? 'user' : 'local';
  renderPlaylistSource();
  app.querySelectorAll('[data-module-tab]').forEach(tab => {
    const isPlaylistTab =
      tab.dataset.moduleTab === 'playlists' ||
      tab.dataset.moduleTab === 'local-playlists';
    if (!isPlaylistTab) return;
    const active =
      selectedModule === 'playlists' &&
      ((tab.dataset.moduleTab === 'local-playlists' &&
        playlistSource === 'local') ||
        (tab.dataset.moduleTab === 'playlists' && playlistSource === 'user'));
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ensureModuleLoaded('playlists');
}

function refreshPlaylistSource() {
  const key = playlistSource === 'local' ? 'local-playlists' : 'user-playlists';
  return catalogPrefetchScheduler.runPriority(key, () =>
    playlistSource === 'local'
      ? loadLocalPlaylists({ force: true })
      : loadPlaylists({ force: true })
  );
}

function ensureModuleLoaded(module) {
  if (module === 'reactions') return loadReactionPreviews();
  if (!client?.clientToken) {
    if (module === 'artists') renderFeaturedArtists();
    return Promise.resolve();
  }
  if (module === 'recommendations')
    return catalogPrefetchScheduler.runPriority('recommendations', () =>
      loadRecommendations()
    );
  if (module === 'artists') return loadFeaturedArtists();
  if (module === 'playlists') {
    const key =
      playlistSource === 'local' ? 'local-playlists' : 'user-playlists';
    return catalogPrefetchScheduler.runPriority(key, () =>
      playlistSource === 'local' ? loadLocalPlaylists() : loadPlaylists()
    );
  }
  return Promise.resolve();
}

function prefetchCatalogModules() {
  if (!client?.clientToken) return;
  loadFeaturedArtists();
  const currentCatalog =
    selectedModule === 'recommendations'
      ? 'recommendations'
      : selectedModule === 'playlists'
      ? playlistSource === 'local'
        ? 'local-playlists'
        : 'user-playlists'
      : '';
  catalogPrefetchScheduler.enqueue(
    [
      { key: 'recommendations', run: () => loadRecommendations() },
      { key: 'local-playlists', run: () => loadLocalPlaylists() },
      { key: 'user-playlists', run: () => loadPlaylists() },
    ].filter(task => task.key !== currentCatalog)
  );
}

function reactionCardsMarkup() {
  return ktvReactionChoices
    .map(
      item =>
        `<button type="button" class="reaction-card" data-reaction="${item.kind}" data-emotion-id="${item.emotion}"><span class="reaction-preview" data-reaction-preview="${item.emotion}" aria-hidden="true"></span><strong>${item.label}</strong><small>${item.caption}</small></button>`
    )
    .join('');
}

function effectButtonMarkup(item) {
  return `<button type="button" data-effect-choice="${escape(
    item.id
  )}" aria-pressed="${
    item.id === reactionEffect
  }"><span class="effect-sketch ${escape(item.sketch)}"></span><strong>${escape(
    item.label
  )}</strong><small>${escape(item.caption)}</small></button>`;
}

function reactionEffectsMarkup() {
  const primary = randomizedReactionEffects.slice(0, 6);
  const extra = randomizedReactionEffects.slice(6);
  const primaryHtml = `<div class="reaction-effects" role="group" aria-label="出场方式">${primary
    .map(effectButtonMarkup)
    .join('')}</div>`;
  if (!extra.length) return primaryHtml;
  const extraHtml = `<div class="reaction-effects reaction-effects-extra" data-more-reaction-effects role="group" aria-label="更多出场方式" ${
    reactionEffectsExpanded ? '' : 'hidden'
  }>${extra
    .map(effectButtonMarkup)
    .join(
      ''
    )}</div><div class="reaction-effects-more-wrap"><button type="button" class="quiet reaction-effects-toggle" data-toggle-more-effects aria-expanded="${reactionEffectsExpanded}">${
    reactionEffectsExpanded
      ? '收起更多登场方式'
      : `展开更多登场方式（${extra.length}）`
  }</button></div>`;
  return primaryHtml + extraHtml;
}

function reactionStudioMarkup() {
  return `<section class="reaction-studio glass" aria-label="互动应援"><div class="section-heading"><div><p class="section-label">把气氛送上舞台</p><h2>互动应援站</h2></div><span class="reaction-hint">选角色、选出场方式，再把表情送上舞台</span></div><div class="reaction-characters" role="group" aria-label="选择角色">${reactionCharacters
    .map(
      item =>
        `<button type="button" data-character-choice="${
          item.id
        }" aria-pressed="${
          item.id === reactionCharacter
        }"><span class="reaction-preview" data-reaction-preview="10" data-preview-character="${
          item.id
        }" aria-hidden="true"></span><strong>${item.label}</strong></button>`
    )
    .join(
      ''
    )}</div>${reactionEffectsMarkup()}<div class="reaction-custom"><button type="button" data-custom-reaction aria-expanded="false" aria-controls="reaction-custom-editor">自定义内容</button><div id="reaction-custom-editor" data-reaction-custom-editor hidden><label>这次想说的话<input type="text" data-reaction-custom-text maxlength="80" autocomplete="off" placeholder="例如：这首唱给今晚的你" /></label><div class="reaction-custom-actions"><small data-reaction-text-count>0 / 40</small><button type="button" data-clear-reaction-text>恢复默认文字</button></div><p>填写后替换应援文字，留空使用默认内容。</p></div></div><p class="reaction-instruction">选一个表情，把应援送上舞台</p><div class="reaction-grid">${reactionCardsMarkup()}</div><p class="reaction-feedback" role="status" data-reaction-feedback>你的应援将出现在主屏和副屏</p></section>`;
}

function updateReactionCustomText() {
  const input = app.querySelector('[data-reaction-custom-text]');
  if (!input) return;
  const length = Array.from(input.value).length;
  const count = app.querySelector('[data-reaction-text-count]');
  count.textContent = `${length} / 40`;
  count.classList.toggle('over-limit', length > 40);
  app.querySelector('[data-custom-reaction]').textContent = input.value.trim()
    ? '自定义内容 · 使用中'
    : '自定义内容';
}

function renderReactionGrid() {
  const grid = app.querySelector('.reaction-grid');
  if (grid) grid.innerHTML = reactionCardsMarkup();
  loadReactionPreviews();
}

async function loadReactionPreviews() {
  const version = ++reactionPreviewVersion;
  try {
    const [ball, mates] = await Promise.all([
      loadEmotionBall(),
      loadMoodMates(),
    ]);
    if (version !== reactionPreviewVersion) return;
    app.querySelectorAll('[data-reaction-preview]').forEach(node => {
      const character = node.dataset.previewCharacter || reactionCharacter;
      const key = `${character}:${node.dataset.reactionPreview}`;
      if (node.dataset.rendered === key) return;
      const library = character === 'ball' ? ball : mates;
      node.innerHTML = '';
      const instance = library.create(node, {
        character,
        emotion: node.dataset.reactionPreview,
        autostart: false,
        idle: false,
        lite: true,
      });
      const markup = node.innerHTML;
      instance.destroy();
      node.innerHTML = markup;
      node.dataset.rendered = key;
    });
  } catch (_) {
    if (version === reactionPreviewVersion)
      setNotice('角色预览加载失败，请重新打开互动应援', 'error');
  }
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

async function loadLocalPlaylists({ force = false } = {}) {
  if (localPlaylistsPromise) return localPlaylistsPromise;
  if (localPlaylistsLoaded && !force) return;
  const button = app.querySelector('[data-playlists-refresh]');
  if (button) button.disabled = true;
  localPlaylistsPromise = (async () => {
    try {
      const response = await api('/local-playlists');
      localPlaylists = response.playlists || [];
      localPlaylistsLoaded = true;
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
      localPlaylistsLoaded = false;
      renderLocalPlaylistPicker();
      renderLocalPlaylistTracks();
      if (selectedModule === 'playlists' && playlistSource === 'local')
        setNotice('本地歌单暂时无法加载，请稍后重试。', 'error');
    } finally {
      renderPlaylistSource();
      if (button) button.disabled = false;
      localPlaylistsPromise = null;
    }
  })();
  return localPlaylistsPromise;
}

async function selectRecommendation(playlistId) {
  if (chartMode === 'toplists') return selectToplist(playlistId);
  chartView = 'tracks';
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
  chartView = 'tracks';
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

async function loadRecommendations({ force = false, silent = false } = {}) {
  if (!client?.clientToken) return;
  if (recommendationsPromise) return recommendationsPromise;
  if (recommendationsLoaded && !force) return;
  recommendationsPromise = (async () => {
    try {
      const response = await api('/recommendations');
      recommendations = response.playlists || [];
      recommendationsLoaded = recommendations.length > 0;
      const hasSelected = recommendations.some(
        playlist => playlist.id === selectedRecommendationId
      );
      selectedRecommendationId = hasSelected
        ? selectedRecommendationId
        : recommendations[0]?.id || '';
      chartView = 'lists';
      recommendationTracks = [];
      renderRecommendations();
      renderRecommendationTracks();
    } catch (_) {
      recommendations = [];
      selectedRecommendationId = '';
      renderRecommendations();
      renderRecommendationTracks();
      if (!silent && selectedModule === 'recommendations') {
        setNotice('推荐歌单暂时无法加载，请稍后重试。', 'error');
      }
    } finally {
      recommendationsPromise = null;
    }
  })();
  return recommendationsPromise;
}

async function loadToplists() {
  try {
    const response = await api('/toplists');
    toplists = (response.playlists || []).slice(0, 10);
    toplistsLoaded = true;
    const hasSelected = toplists.some(
      playlist => String(playlist.id) === String(selectedToplistId)
    );
    selectedToplistId = hasSelected ? selectedToplistId : toplists[0]?.id || '';
    chartView = 'lists';
    toplistTracks = [];
    renderRecommendations();
    renderRecommendationTracks();
  } catch (_) {
    toplists = [];
    toplistsLoaded = true;
    selectedToplistId = '';
    renderRecommendations();
    renderRecommendationTracks();
    setNotice('排行榜暂时无法加载，请稍后重试。', 'error');
  }
}

async function toggleChartMode() {
  recommendationTrackGeneration += 1;
  toplistTrackGeneration += 1;
  chartMode = chartMode === 'toplists' ? 'recommendations' : 'toplists';
  chartView = 'lists';
  renderRecommendations();
  if (chartMode === 'toplists') {
    if (!toplistsLoaded) return loadToplists();
    return renderRecommendationTracks();
  }
  return renderRecommendationTracks();
}

function returnChartToLists() {
  chartView = 'lists';
  renderRecommendations();
  renderRecommendationTracks();
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

async function loadPlaylists({ force = false, silent = false } = {}) {
  if (!client?.clientToken) return;
  if (playlistsPromise) return playlistsPromise;
  if (playlistsLoaded && !force) return;
  const button = app.querySelector('[data-playlists-refresh]');
  if (button) button.disabled = true;
  playlistsPromise = (async () => {
    try {
      const response = await api(force ? '/playlists?force=1' : '/playlists');
      playlists = response.playlists || [];
      playlistsLoaded = playlists.length > 0;
      const hasSelected = playlists.some(
        playlist => playlist.id === selectedPlaylistId
      );
      selectedPlaylistId = hasSelected
        ? selectedPlaylistId
        : playlists[0]?.id || '';
      renderPlaylistPicker();
      renderPlaylistSource();
      if (selectedPlaylistId) await selectPlaylist(selectedPlaylistId);
      else {
        renderPlaylistTracks();
        if (!silent && selectedModule === 'playlists') {
          setNotice('主机尚未登录网易云账号，暂时无法读取歌单。', 'error');
        }
      }
    } catch (error) {
      playlists = [];
      selectedPlaylistId = '';
      renderPlaylistPicker();
      renderPlaylistTracks();
      renderPlaylistSource();
      if (!silent && selectedModule === 'playlists') {
        setNotice(
          error.code === 'HOST_NOT_LOGGED_IN'
            ? '请先在 KTV 主机登录网易云账号，再从歌单点歌。'
            : '歌单暂时无法加载，请点击“刷新歌单”重试。',
          'error'
        );
      }
    } finally {
      if (button) button.disabled = false;
      playlistsPromise = null;
    }
  })();
  return playlistsPromise;
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

async function requestSong(trackId, priority, button) {
  if (!client?.clientToken) {
    setNotice('正在连接房间，请稍后再试', 'error');
    showRequestToast('正在连接房间', 'error');
    return;
  }
  const track = findTrack(trackId);
  const name = track?.name || '歌曲';
  showRequestToast(priority ? '优先点歌成功' : '点歌成功', 'success');
  setNotice(
    priority ? `${name}点歌成功，已优先加入等待队列` : `${name}点歌成功`,
    'success'
  );
  if (button) {
    button.classList.add('request-ack');
    setTimeout(() => {
      if (button.isConnected) button.classList.remove('request-ack');
    }, 650);
  }
  try {
    await api('/requests', {
      method: 'POST',
      body: JSON.stringify({ trackId, priority }),
    });
    await requestRefresh();
  } catch (error) {
    const errorMsg =
      error.code === 'TRACK_NOT_PLAYABLE'
        ? '此歌曲当前不可播放。'
        : '点歌失败，请稍后再试。';
    setNotice(errorMsg, 'error');
    showRequestToast(
      error.code === 'TRACK_NOT_PLAYABLE' ? '此歌曲不可播放' : '点歌失败',
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
    await requestRefresh();
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
    await requestRefresh();
  } catch (_) {
    setNotice('切歌未完成，队列可能已发生变化。', 'error');
  }
}

function scheduleRefresh(delay) {
  clearTimeout(refreshTimer);
  if (roomEnded) return;
  refreshTimer = setTimeout(() => requestRefresh(), delay);
}

async function performRefresh() {
  try {
    state = await api('/state');
    retryDelay = 2000;
    const revision = state?.revision;
    const changed = revision == null || revision !== lastStateRevision;
    lastStateRevision = revision == null ? lastStateRevision : revision;
    renderNowPlaying();
    if (changed) {
      playedHistory = state?.history || [];
      renderHistory();
      renderQueue();
    }
    scheduleRefresh(document.hidden ? 5000 : 500);
  } catch (error) {
    if (error.code === 'ROOM_ENDED') return showEnded();
    if (error.code === 'INVALID_CLIENT_TOKEN') {
      try {
        if (!(await joinRoom())) return showEnded();
        lastStateRevision = null;
        scheduleRefresh(0);
        return;
      } catch (joinError) {
        if (['INVALID_JOIN_TOKEN', 'ROOM_ENDED'].includes(joinError.code))
          return showEnded();
      }
    }
    scheduleRefresh(retryDelay);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }
}

function requestRefresh() {
  return refreshScheduler();
}

function showEnded() {
  roomEnded = true;
  catalogPrefetchScheduler.stop();
  clearTimeout(refreshTimer);
  sessionStorage.removeItem(storageKey);
  app.innerHTML =
    '<main class="ended"><p class="eyebrow">LUMASING · LAN KTV</p><h1>房间已结束</h1><p>请向主机重新获取新的二维码或加入链接。</p></main>';
}

async function joinRoom() {
  const joinToken = new URLSearchParams(window.location.hash.slice(1)).get(
    'token'
  );
  if (!joinToken) return false;
  client = await api('/client-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${joinToken}` },
  });
  sessionStorage.setItem(storageKey, JSON.stringify(client));
  return true;
}

async function bootstrap() {
  // Render the shell before exchanging the join token. A transient LAN/API
  // failure must not leave the remote page as an empty gradient background;
  // the user should still see the room controls and a useful status notice.
  initializeShell();
  try {
    client = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (!client?.clientToken) {
      if (!(await joinRoom())) return showEnded();
      // Keep this room's complete invitation in the address bar so copying or
      // reloading the joined page retains the same link until the room ends.
    }
    ensureModuleLoaded(selectedModule);
    prefetchCatalogModules();
    await requestRefresh();
  } catch (error) {
    if (
      error?.code === 'INVALID_CLIENT_TOKEN' ||
      error?.code === 'INVALID_JOIN_TOKEN' ||
      error?.code === 'ROOM_ENDED'
    ) {
      showEnded();
      return;
    }
    setNotice('连接 KTV 服务失败，请刷新页面或重新扫描二维码。', 'error');
    scheduleRefresh(retryDelay);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    catalogPrefetchScheduler.resume();
    if (client) requestRefresh();
  }
});
bootstrap();
