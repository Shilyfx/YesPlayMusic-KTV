<template>
  <section
    ref="karaokeSurface"
    class="karaoke-surface karaoke-desktop"
    :data-ktv-theme="resolvedTheme"
    :style="stageStyle"
  >
    <div class="ambient" :style="coverStyle"></div>
    <div class="ambient-overlay"></div>

    <header class="karaoke-header glass-panel">
      <button type="button" class="back" @click="$router.push('/')">
        ← 返回音乐
      </button>
      <div class="room-label">
        <span class="live-dot" :class="{ active: isSessionActive }"></span>
        <div>
          <strong>{{ sessionLabel }}</strong>
          <small>{{
            lanRoom ? `房间 ${lanRoom.code} · 局域网已开启` : '本机模式'
          }}</small>
        </div>
      </div>
      <div class="header-actions">
        <KaraokeThemeSwitcher v-model="karaokeTheme" />
        <button
          v-if="lanRoom"
          type="button"
          class="session-button"
          @click="showRoomCode = !showRoomCode"
          >{{ showRoomCode ? '收起二维码' : '房间二维码' }}</button
        >
        <button type="button" class="session-button" @click="toggleSession">
          {{ isSessionActive ? '结束 KTV' : '开始本机 KTV' }}
        </button>
      </div>
    </header>

    <section v-if="lanRoom && showRoomCode" class="room-access glass-panel">
      <img :src="lanRoom.qrDataUrl" alt="局域网 KTV 房间二维码" />
      <div>
        <strong>用同一局域网设备扫码加入</strong>
        <p>房间码 {{ lanRoom.code }}。链接仅在本次 KTV 进行期间有效。</p>
      </div>
    </section>

    <main class="karaoke-layout">
      <aside class="track-identity glass-panel">
        <div class="cover-wrap">
          <img v-if="cover" :src="cover" :alt="`${track.name} 封面`" />
          <div v-else class="cover-fallback">♪</div>
        </div>
        <p class="eyebrow">{{ currentItem ? '正在演唱' : statusEyebrow }}</p>
        <h1 :title="track.name">{{ track.name }}</h1>
        <p class="artist">{{ artist }}</p>
        <p class="album">{{ albumName }}</p>
        <button
          type="button"
          class="enqueue-current"
          :disabled="!isSessionActive || !track.id"
          @click="enqueueCurrentTrack"
        >
          将当前播放歌曲加入待唱
        </button>
        <p v-if="!isSessionActive" class="local-note">
          先开始本机 KTV，才可建立临时待唱队列。
        </p>
      </aside>

      <section
        ref="lyricStage"
        class="stage glass-panel"
        :data-lyric-state="stageLyrics.state"
        aria-label="KTV 歌词舞台"
      >
        <p class="stage-kicker">LYRIC STAGE</p>
        <div class="stage-lines">
          <p class="before-line">{{ stageLyrics.before }}</p>
          <p class="active-line">{{ stageLyrics.active }}</p>
          <p class="after-line">{{ stageLyrics.after }}</p>
        </div>
        <p class="translation">{{ stageLyrics.translation }}</p>
        <div class="stage-footer">
          <span>{{
            isSessionActive ? '本机队列由主机控制' : '开始本机 KTV 以管理待唱'
          }}</span>
          <span>{{ lyricOffsetLabel }} · {{ lyricFontSize }}px</span>
        </div>
        <div class="fullscreen-actions">
          <button type="button" @click="enterKtvFullscreen">全屏 KTV</button>
          <button type="button" @click="enterLyricFullscreen">只看歌词</button>
        </div>
      </section>

      <aside class="queue-panel glass-panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">本机待唱</p>
            <h2>真实临时队列</h2>
          </div>
          <span class="queue-count">{{ waitingItems.length }} 首待唱</span>
        </div>

        <article v-if="currentItem" class="current-queue-item">
          <span>正在演唱</span>
          <strong>{{ currentItem.trackName }}</strong>
          <small
            >{{ currentItem.artists.join(' / ') }} ·
            {{ currentItem.requesterName }}</small
          >
        </article>

        <ol v-if="waitingItems.length" class="waiting-list">
          <li v-for="(item, index) in waitingItems" :key="item.queueItemId">
            <span class="queue-number">{{
              String(index + 1).padStart(2, '0')
            }}</span>
            <div class="queue-item-copy">
              <strong>{{ item.trackName }}</strong>
              <small
                >{{ item.artists.join(' / ') }} ·
                {{ item.requesterName }}</small
              >
            </div>
            <div class="queue-actions">
              <button
                type="button"
                :disabled="index === 0"
                :aria-label="`置顶 ${item.trackName}`"
                @click="moveQueueItemToFront(item.queueItemId)"
                >置顶</button
              >
              <button
                type="button"
                :disabled="index === 0"
                :aria-label="`上移 ${item.trackName}`"
                @click="moveQueueItem(item.queueItemId, index - 1)"
                >↑</button
              >
              <button
                type="button"
                :disabled="index === waitingItems.length - 1"
                :aria-label="`下移 ${item.trackName}`"
                @click="moveQueueItem(item.queueItemId, index + 1)"
                >↓</button
              >
              <button
                type="button"
                :aria-label="`删除 ${item.trackName}`"
                @click="removeQueueItem(item.queueItemId)"
                >删除</button
              >
            </div>
          </li>
        </ol>
        <div v-else class="queue-empty">
          <strong>{{
            isSessionActive ? '还没有待唱歌曲' : 'KTV 尚未开始'
          }}</strong>
          <span>使用左侧按钮把当前真实歌曲加入本机待唱。</span>
        </div>
        <button
          v-if="waitingItems.length"
          type="button"
          class="clear-waiting"
          @click="clearWaitingQueue"
          >清空待唱</button
        >
      </aside>
    </main>

    <footer class="karaoke-controls glass-panel">
      <div class="quick-setting">
        <span>歌词同步</span>
        <button
          type="button"
          aria-label="歌词延迟 0.1 秒"
          @click="adjustOffset(-0.1)"
          >−</button
        >
        <strong>{{ lyricOffsetLabel }}</strong>
        <button
          type="button"
          aria-label="歌词提前 0.1 秒"
          @click="adjustOffset(0.1)"
          >+</button
        >
        <button type="button" class="text-button" @click="setOffset(0)"
          >归零</button
        >
      </div>
      <div class="player-actions">
        <button type="button" :disabled="!currentItem" @click="replay"
          >重唱</button
        >
        <button
          type="button"
          class="primary"
          :disabled="!currentItem"
          @click="playOrPause"
        >
          {{ player.playing ? '暂停' : '播放' }}
        </button>
        <button type="button" :disabled="!isSessionActive" @click="nextTrack">
          {{ currentItem ? '切歌' : '开始待唱' }}
        </button>
      </div>
      <div class="quick-setting font-setting">
        <span>舞台字号</span>
        <button
          type="button"
          aria-label="减小歌词字号"
          @click="adjustFontSize(-1)"
          >−</button
        >
        <strong>{{ lyricFontSize }}px</strong>
        <button
          type="button"
          aria-label="增大歌词字号"
          @click="adjustFontSize(1)"
          >+</button
        >
      </div>
    </footer>
  </section>
</template>

<script>
import { mapState } from 'vuex';
import { getLyric } from '@/api/track';
import { lyricParser } from '@/utils/lyrics';
import {
  normalizeLyricFontSize,
  normalizeLyricOffset,
} from '@/utils/lyricsSettings';
import KaraokeThemeSwitcher from '@/components/karaoke/KaraokeThemeSwitcher.vue';

export default {
  name: 'Karaoke',
  components: { KaraokeThemeSwitcher },
  data() {
    return {
      lyrics: [],
      now: 0,
      clock: null,
      systemTheme: 'light',
      themeMedia: null,
      lanRoom: null,
      showRoomCode: false,
    };
  },
  computed: {
    ...mapState(['player', 'settings', 'karaoke']),
    karaokeManager() {
      return this.$store.$karaokeManager;
    },
    session() {
      return this.karaoke.session || { status: 'idle' };
    },
    isSessionActive() {
      return this.session.status === 'active';
    },
    sessionLabel() {
      if (this.isSessionActive) return '本机 KTV 进行中';
      return this.session.status === 'ended'
        ? '本机 KTV 已结束'
        : 'KTV 尚未开始';
    },
    statusEyebrow() {
      return this.isSessionActive ? '等待下一首' : '准备开始';
    },
    currentItem() {
      return this.karaoke.currentItem;
    },
    waitingItems() {
      return this.karaoke.waitingItems || [];
    },
    track() {
      return this.player.currentTrack || { name: '还没有正在播放的歌曲' };
    },
    trackId() {
      return this.track.id;
    },
    artist() {
      return this.track.ar?.length
        ? this.track.ar.map(item => item.name).join(' / ')
        : '准备好开始演唱';
    },
    albumName() {
      return this.track.al?.name || '临时 KTV 队列不会修改网易云歌单';
    },
    cover() {
      return this.track.al?.picUrl
        ? `${this.track.al.picUrl}?param=640y640`
        : '';
    },
    coverStyle() {
      return this.cover ? { backgroundImage: `url(${this.cover})` } : {};
    },
    karaokeTheme: {
      get() {
        return ['auto', 'light', 'dark'].includes(this.settings.karaokeTheme)
          ? this.settings.karaokeTheme
          : 'auto';
      },
      set(value) {
        this.$store.commit('updateSettings', { key: 'karaokeTheme', value });
      },
    },
    resolvedTheme() {
      return this.karaokeTheme === 'auto'
        ? this.systemTheme
        : this.karaokeTheme;
    },
    lyricFontSize() {
      return normalizeLyricFontSize(this.settings.lyricFontSize);
    },
    lyricOffset() {
      return normalizeLyricOffset(this.settings.lyricOffsetSeconds);
    },
    stageStyle() {
      return { '--ktv-active-lyric-size': `${this.lyricFontSize}px` };
    },
    lyricOffsetLabel() {
      if (this.lyricOffset === 0) return '同步';
      return `${this.lyricOffset > 0 ? '提前' : '延迟'} ${Math.abs(
        this.lyricOffset
      ).toFixed(1)}s`;
    },
    stageLyrics() {
      const progress = this.now + this.lyricOffset;
      if (!this.lyrics.length) {
        return {
          state: 'waiting',
          before: '♪',
          active: '等待歌词加载',
          after: '播放带歌词的歌曲后，主舞台会在这里同步显示。',
          translation: '歌词时间轴始终保留原始数据。',
        };
      }
      if (progress < this.lyrics[0].time) {
        return {
          state: 'before-first',
          before: '♪',
          active: '等待第一句歌词',
          after: this.lyrics[0].content,
          translation: '歌词将在原始时间轴到达时高亮。',
        };
      }
      const activeIndex = this.lyrics.findIndex((line, index) => {
        const next = this.lyrics[index + 1];
        return progress >= line.time && (!next || progress < next.time);
      });
      if (activeIndex === -1) {
        return {
          state: 'after-final',
          before: this.lyrics[this.lyrics.length - 1].content,
          active: '本首歌词已结束',
          after: '♪',
          translation: '等待下一首待唱歌曲。',
        };
      }
      return {
        state: activeIndex === this.lyrics.length - 1 ? 'final' : 'active',
        before: this.lyrics[activeIndex - 1]?.content || '♪',
        active: this.lyrics[activeIndex].content,
        after: this.lyrics[activeIndex + 1]?.content || '♪',
        translation:
          '歌词时间轴保持原始数据，点击歌词页仍会定位到原始播放时间。',
      };
    },
  },
  watch: {
    trackId() {
      this.loadLyrics();
    },
  },
  created() {
    this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    this.syncSystemTheme();
    if (this.themeMedia.addEventListener)
      this.themeMedia.addEventListener('change', this.syncSystemTheme);
    else this.themeMedia.addListener(this.syncSystemTheme);
    this.loadLyrics();
    this.loadLanRoom();
    this.clock = window.setInterval(() => {
      this.now = this.player.seek(null, false) || 0;
    }, 100);
  },
  beforeDestroy() {
    window.clearInterval(this.clock);
    if (this.themeMedia?.removeEventListener)
      this.themeMedia.removeEventListener('change', this.syncSystemTheme);
    else if (this.themeMedia)
      this.themeMedia.removeListener(this.syncSystemTheme);
  },
  methods: {
    syncSystemTheme() {
      this.systemTheme = this.themeMedia?.matches ? 'dark' : 'light';
    },
    loadLyrics() {
      if (!this.trackId) {
        this.lyrics = [];
        return;
      }
      getLyric(this.trackId)
        .then(data => {
          const parsed = data?.lrc?.lyric ? lyricParser(data).lyric : [];
          this.lyrics = parsed.filter(line => line.content);
        })
        .catch(() => {
          this.lyrics = [];
        });
    },
    toggleSession() {
      if (!this.isSessionActive) {
        this.karaokeManager.startSession();
        this.startLanRoom();
        this.$store.dispatch('showToast', '本机 KTV 已开始，临时队列已就绪');
        return;
      }
      if (this.currentItem || this.waitingItems.length) {
        const confirmed = window.confirm(
          '结束本次 KTV？当前与待唱列表将被清空，网易云歌单不会受到影响。'
        );
        if (!confirmed) return;
      }
      this.karaokeManager.endSession();
      this.stopLanRoom();
      this.$store.dispatch('showToast', '本机 KTV 已结束，临时队列已清空');
    },
    electronIpc() {
      if (!process.env.IS_ELECTRON || !window.require) return null;
      return window.require('electron').ipcRenderer;
    },
    async loadLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke('karaoke:lan:status');
      this.lanRoom = result.room;
    },
    async startLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke('karaoke:lan:start');
      if (result.ok) {
        this.lanRoom = result.room;
        this.showRoomCode = true;
      } else {
        this.$store.dispatch('showToast', `局域网房间未开启：${result.error}`);
      }
    },
    async stopLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer) await ipcRenderer.invoke('karaoke:lan:stop');
      this.lanRoom = null;
      this.showRoomCode = false;
    },
    enterKtvFullscreen() {
      this.$refs.karaokeSurface.requestFullscreen();
    },
    enterLyricFullscreen() {
      this.$refs.lyricStage.requestFullscreen();
    },
    enqueueCurrentTrack() {
      const item = this.karaokeManager.enqueueTrack(this.track);
      if (item)
        this.$store.dispatch('showToast', `已加入 KTV 待唱：${item.trackName}`);
    },
    removeQueueItem(queueItemId) {
      this.karaokeManager.removeQueueItem(queueItemId);
    },
    moveQueueItem(queueItemId, targetIndex) {
      this.karaokeManager.moveQueueItem(queueItemId, targetIndex);
    },
    moveQueueItemToFront(queueItemId) {
      this.karaokeManager.moveQueueItemToFront(queueItemId);
    },
    clearWaitingQueue() {
      if (!window.confirm('清空所有待唱歌曲？正在演唱的歌曲不会被删除。'))
        return;
      this.karaokeManager.clearWaitingQueue();
    },
    setOffset(value) {
      this.$store.commit('updateSettings', {
        key: 'lyricOffsetSeconds',
        value: normalizeLyricOffset(value),
      });
    },
    adjustOffset(amount) {
      this.setOffset(this.lyricOffset + amount);
    },
    adjustFontSize(amount) {
      this.$store.commit(
        'changeLyricFontSize',
        normalizeLyricFontSize(this.lyricFontSize + amount)
      );
    },
    replay() {
      this.karaokeManager.replay();
    },
    playOrPause() {
      this.karaokeManager.playOrPause();
    },
    nextTrack() {
      this.karaokeManager.next();
    },
  },
};
</script>

<style lang="scss" scoped>
.karaoke-desktop {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
  padding: 20px;
  background: var(--ktv-bg-base);
  box-sizing: border-box;
}
.ambient,
.ambient-overlay {
  position: fixed;
  inset: -8%;
  pointer-events: none;
}
.ambient {
  background: radial-gradient(circle at 18% 20%, #6552b8, transparent 37%),
    radial-gradient(circle at 82% 75%, #c24e9b, transparent 35%);
  background-position: center;
  background-size: cover;
  filter: blur(48px) saturate(1.2);
  opacity: 0.48;
  transform: scale(1.1);
}
.ambient-overlay {
  background: var(--ktv-bg-overlay);
}
.karaoke-header,
.karaoke-layout,
.karaoke-controls,
.room-access {
  position: relative;
  z-index: 1;
}
.karaoke-header {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
}
.back {
  color: var(--ktv-text-secondary);
  font-weight: 600;
}
.room-label,
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.room-label strong,
.room-label small {
  display: block;
}
.room-label strong {
  color: var(--ktv-text-primary);
  font-size: 14px;
}
.room-label small {
  margin-top: 2px;
  color: var(--ktv-text-muted);
  font-size: 11px;
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ktv-text-muted);
}
.live-dot.active {
  background: var(--ktv-success);
  box-shadow: 0 0 0 5px rgba(97, 214, 167, 0.16);
}
.session-button,
.enqueue-current,
.clear-waiting {
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: var(--ktv-radius-control);
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-primary);
  font-weight: 700;
}
.room-access {
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(460px, calc(100% - 32px));
  margin: 14px auto 0;
  padding: 12px;
}
.room-access img {
  width: 104px;
  height: 104px;
  border-radius: 10px;
  background: #fff;
}
.room-access strong,
.room-access p {
  display: block;
  margin: 0;
}
.room-access p {
  margin-top: 6px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.karaoke-layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(180px, 0.6fr) minmax(460px, 2.4fr) minmax(
      220px,
      0.7fr
    );
  gap: 18px;
  min-height: 480px;
}
.track-identity,
.queue-panel {
  padding: 24px;
  min-width: 0;
}
.cover-wrap {
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 16px;
  background: linear-gradient(135deg, #5845c9, #bd5b9f);
  box-shadow: 0 16px 32px rgba(45, 27, 101, 0.24);
}
.cover-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-fallback {
  display: grid;
  height: 100%;
  place-items: center;
  color: #fff;
  font-size: 80px;
}
.eyebrow,
.stage-kicker {
  margin: 18px 0 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
h1,
h2,
p {
  margin-top: 0;
}
h1 {
  margin-bottom: 6px;
  font-size: clamp(24px, 2.2vw, 38px);
  line-height: 1.08;
}
.artist {
  margin-bottom: 4px;
  color: var(--ktv-text-secondary);
}
.album,
.local-note {
  color: var(--ktv-text-muted);
  font-size: 13px;
}
.enqueue-current {
  width: 100%;
  margin-top: 18px;
  background: var(--ktv-accent);
  color: #fff;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.stage {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: clamp(28px, 4vw, 72px);
  overflow: hidden;
  text-align: center;
}
.stage::after {
  position: absolute;
  right: -11%;
  bottom: -20%;
  width: 56%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(171, 156, 255, 0.36),
    transparent 67%
  );
  content: '';
}
.stage-kicker {
  position: absolute;
  top: 26px;
  left: 32px;
  margin: 0;
}
.stage-lines,
.translation {
  position: relative;
  z-index: 1;
}
.stage-lines p {
  overflow-wrap: anywhere;
}
.before-line,
.after-line {
  color: var(--ktv-text-muted);
  font-size: clamp(12px, calc(var(--ktv-active-lyric-size) * 0.58), 38px);
  font-weight: 600;
}
.active-line {
  margin: 22px 0;
  color: var(--ktv-text-primary);
  font-size: var(--ktv-active-lyric-size);
  font-weight: 800;
  line-height: 1.18;
  text-shadow: 0 0 28px rgba(162, 146, 255, 0.28);
}
.stage[data-lyric-state='before-first'] .active-line,
.stage[data-lyric-state='waiting'] .active-line,
.stage[data-lyric-state='after-final'] .active-line {
  color: var(--ktv-text-secondary);
  text-shadow: none;
}
.translation {
  margin: 4px auto 0;
  max-width: 540px;
  color: var(--ktv-text-secondary);
  font-size: 13px;
}
.stage-footer {
  position: absolute;
  right: 28px;
  bottom: 24px;
  left: 28px;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.fullscreen-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
}
.fullscreen-actions button {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 9px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.karaoke-desktop:fullscreen {
  overflow: auto;
  padding: 24px;
  background: var(--ktv-bg-base);
}
.stage:fullscreen {
  display: grid;
  place-content: center;
  min-width: 100vw;
  min-height: 100vh;
  padding: 48px;
  background: var(--ktv-bg-base);
}
.stage:fullscreen .fullscreen-actions,
.stage:fullscreen .stage-kicker,
.stage:fullscreen .stage-footer {
  display: none;
}
.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.panel-title .eyebrow {
  margin-top: 0;
}
.panel-title h2 {
  margin-bottom: 16px;
  font-size: 21px;
}
.queue-count {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.current-queue-item {
  padding: 12px;
  border: 1px solid rgba(171, 156, 255, 0.36);
  border-radius: 14px;
  background: var(--ktv-glass-soft);
}
.current-queue-item span,
.current-queue-item strong,
.current-queue-item small {
  display: block;
}
.current-queue-item span {
  margin-bottom: 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
}
.current-queue-item small,
.queue-item-copy small {
  margin-top: 3px;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.waiting-list {
  max-height: 48vh;
  padding: 0;
  margin: 12px 0 0;
  overflow: auto;
  list-style: none;
}
.waiting-list li {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 13px 0;
  border-bottom: 1px solid var(--ktv-glass-border);
}
.queue-number {
  color: var(--ktv-accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
.queue-item-copy {
  min-width: 0;
}
.queue-item-copy strong,
.queue-item-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-item-copy strong {
  font-size: 14px;
}
.queue-actions {
  display: flex;
  gap: 4px;
}
.queue-actions button {
  min-width: 26px;
  min-height: 28px;
  padding: 0 5px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.queue-empty {
  display: grid;
  gap: 6px;
  padding: 44px 4px;
  color: var(--ktv-text-muted);
  text-align: center;
  font-size: 13px;
}
.queue-empty strong {
  color: var(--ktv-text-secondary);
}
.clear-waiting {
  width: 100%;
  margin-top: 14px;
  color: var(--ktv-danger);
}
.karaoke-controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 18px;
  min-height: 68px;
  padding: 10px 18px;
}
.quick-setting {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ktv-text-secondary);
  font-size: 13px;
}
.font-setting {
  justify-content: flex-end;
}
.quick-setting strong {
  min-width: 62px;
  color: var(--ktv-text-primary);
  font-size: 12px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.quick-setting button,
.player-actions button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: var(--ktv-radius-control);
  color: var(--ktv-text-primary);
  background: var(--ktv-glass-soft);
  font-weight: 700;
}
.quick-setting button {
  min-width: 30px;
  padding: 0 8px;
}
.quick-setting .text-button {
  font-size: 12px;
}
.player-actions {
  display: flex;
  gap: 8px;
}
.player-actions .primary {
  border-color: transparent;
  background: var(--ktv-accent);
  color: #fff;
}
@media (max-width: 1100px) {
  .karaoke-layout {
    grid-template-columns: minmax(190px, 0.8fr) 1.6fr;
  }
  .queue-panel {
    grid-column: 1 / -1;
  }
  .waiting-list {
    max-height: 260px;
  }
}
@media (max-width: 760px) {
  .karaoke-desktop {
    padding: 12px;
  }
  .karaoke-header {
    flex-wrap: wrap;
    padding: 12px;
  }
  .header-actions {
    width: 100%;
    justify-content: space-between;
  }
  .karaoke-layout {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .track-identity {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 0 16px;
  }
  .cover-wrap {
    grid-row: span 5;
  }
  .track-identity .eyebrow {
    margin-top: 4px;
  }
  .enqueue-current,
  .local-note {
    grid-column: 1 / -1;
  }
  .stage {
    min-height: 380px;
  }
  .karaoke-controls {
    grid-template-columns: 1fr;
    justify-items: center;
  }
  .font-setting {
    justify-content: center;
  }
  .stage-footer {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
