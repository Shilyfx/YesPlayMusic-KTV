'use strict';

function createPlaybackQueueRenderer({ app, getState, getClient, escape }) {
  let renderedNowPlayingKey = null;

  function renderNowPlaying() {
    const state = getState();
    const current = state && state.current;
    const roomTitle = app.querySelector('[data-room-name]');
    if (roomTitle) {
      roomTitle.textContent =
        (state && state.room && state.room.name) || 'LumaSing KTV';
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
    const coverMarkup =
      current && current.coverUrl
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

  function itemMarkup(item, index, own) {
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

  function renderQueue() {
    const state = getState();
    const waiting = (state && state.waiting) || [];
    const client = getClient();
    const clientId =
      client === null || client === undefined ? undefined : client.clientId;
    app.querySelector(
      '[data-queue-count]'
    ).textContent = `${waiting.length} 首`;
    app.querySelector('[data-queue-list]').innerHTML = waiting.length
      ? waiting
          .map((item, index) =>
            itemMarkup(item, index + 1, item.requesterId === clientId)
          )
          .join('')
      : '<div class="empty">还没有待唱歌曲</div>';
  }

  return { renderNowPlaying, renderQueue };
}

module.exports = { createPlaybackQueueRenderer };
