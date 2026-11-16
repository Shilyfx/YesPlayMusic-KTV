'use strict';

const previewPlayerMarkup =
  '<div class="preview-float" data-preview-float hidden><button type="button" class="preview-float-toggle" data-preview-toggle="true" aria-label="播放试听" title="播放或暂停试听">▶</button><strong data-preview-title>试听</strong><button type="button" class="preview-float-close" data-preview-stop="true" aria-label="关闭试听" title="关闭试听">×</button><audio data-preview-audio preload="none"></audio></div>';

function createPreviewController({ app, api, findTrack, escape, setNotice }) {
  let previewTrackId = '';
  let previewGeneration = 0;

  const getAudio = () => app.querySelector('[data-preview-audio]');

  function renderControls() {
    const audio = getAudio();
    const toggle = app.querySelector('[data-preview-toggle]');
    if (!audio || !toggle) return;
    const playing = !audio.paused;
    toggle.textContent = playing ? 'Ⅱ' : '▶';
    toggle.setAttribute('aria-label', playing ? '暂停试听' : '播放试听');
  }

  function updateButtons() {
    app.querySelectorAll('[data-preview]').forEach(button => {
      const active = String(button.dataset.preview) === String(previewTrackId);
      button.textContent = active ? '暂停试听' : '试听';
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
  }

  function bind() {
    const audio = getAudio();
    if (!audio) return;
    ['play', 'pause', 'ended'].forEach(eventName =>
      audio.addEventListener(eventName, () => {
        if (eventName === 'ended') {
          previewTrackId = '';
          const player = app.querySelector('[data-preview-float]');
          if (player) player.hidden = true;
        }
        renderControls();
        updateButtons();
      })
    );
  }

  function stopPreview() {
    previewGeneration += 1;
    previewTrackId = '';
    const audio = getAudio();
    const player = app.querySelector('[data-preview-float]');
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (player) player.hidden = true;
    renderControls();
    updateButtons();
  }

  async function previewTrack(trackId) {
    const id = String(trackId);
    const audio = getAudio();
    const player = app.querySelector('[data-preview-float]');
    const title = app.querySelector('[data-preview-title]');
    if (!audio || !player || !title) return;
    if (previewTrackId === id) {
      if (audio.paused) {
        if (audio.src) audio.play().catch(() => {});
      } else audio.pause();
      renderControls();
      updateButtons();
      return;
    }
    previewTrackId = id;
    const generation = ++previewGeneration;
    const track = findTrack(id);
    title.textContent = (track && track.name) || '歌曲试听';
    player.hidden = false;
    renderControls();
    updateButtons();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setNotice('正在加载试听…');
    try {
      const response = await api(`/track/${encodeURIComponent(id)}/preview`);
      if (generation !== previewGeneration) return;
      audio.src = response.url;
      audio.load();
      renderControls();
      try {
        await audio.play();
        renderControls();
        setNotice('正在试听，可使用播放器控制音量。', 'success');
      } catch (_) {
        renderControls();
        setNotice('试听已加载，请点击悬浮按钮开始播放。', 'success');
      }
    } catch (error) {
      if (generation !== previewGeneration) return;
      previewTrackId = '';
      player.hidden = true;
      renderControls();
      updateButtons();
      setNotice(
        error.code === 'TRACK_NOT_PLAYABLE'
          ? '这首歌暂时没有可用试听音源。'
          : '试听加载失败，请稍后重试。',
        'error'
      );
    }
  }

  function togglePlayback() {
    const audio = getAudio();
    if (!audio || !previewTrackId) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    renderControls();
  }

  function trackButtonMarkup(trackId) {
    const id = String(trackId);
    const active = id === previewTrackId;
    return `<button class="quiet preview-button" data-preview="${escape(
      id
    )}" aria-pressed="${active}">${active ? '暂停试听' : '试听'}</button>`;
  }

  return {
    bind,
    previewTrack,
    stopPreview,
    togglePlayback,
    trackButtonMarkup,
  };
}

module.exports = { createPreviewController, previewPlayerMarkup };
