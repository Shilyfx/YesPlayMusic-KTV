<template>
  <section
    class="karaoke-surface karaoke-remote"
    :data-ktv-theme="resolvedTheme"
  >
    <div class="remote-ambient"></div>
    <header class="remote-header glass-panel">
      <div>
        <p class="room-kicker"
          >KTV Remote · Phase 2 预览 <span>尚未连接局域网房间</span></p
        >
        <h1>今晚，一起唱</h1>
      </div>
      <KaraokeThemeSwitcher v-model="theme" />
    </header>

    <main class="remote-grid">
      <section class="now-playing glass-panel">
        <p class="label">正在播放</p>
        <div class="record-art">♪</div>
        <div>
          <h2>晴天</h2>
          <p>周杰伦 · 叶惠美</p>
        </div>
        <div class="progress"><i></i></div>
        <small>02:17 / 04:29</small>
      </section>

      <section
        class="remote-search glass-panel"
        :class="{ hidden: activeTab !== 'search' }"
      >
        <div class="search-heading">
          <div>
            <p class="label">点一首歌</p>
            <h2>搜索歌名或歌手</h2>
          </div>
          <span class="mock-label">仅为本机预览界面</span>
        </div>
        <label class="search-input">
          <span>⌕</span>
          <input
            v-model.trim="query"
            type="search"
            placeholder="例如：晴天 周杰伦"
          />
          <button
            v-if="query"
            type="button"
            aria-label="清除搜索"
            @click="query = ''"
            >×</button
          >
        </label>
        <div v-if="filteredTracks.length" class="result-list">
          <article
            v-for="track in filteredTracks"
            :key="track.id"
            class="track-result"
          >
            <div class="mini-cover" :class="track.art"></div>
            <div class="result-info">
              <strong>{{ track.name }}</strong>
              <span>{{ track.artist }} · {{ track.album }}</span>
              <small
                >{{ track.duration }} ·
                <b :class="track.playability">{{
                  playabilityText(track.playability)
                }}</b></small
              >
            </div>
            <button
              type="button"
              :disabled="track.playability === 'unavailable'"
              :class="{ requested: track.requested }"
              @click="requestTrack(track)"
            >
              {{
                track.requested
                  ? `已加入 · 第 ${queuePosition(track)} 首`
                  : track.playability === 'unavailable'
                  ? '不可点'
                  : '点歌'
              }}
            </button>
          </article>
        </div>
        <div v-else class="empty-state"
          >没有匹配的演示歌曲。试试搜索“晴天”或“周杰伦”。</div
        >
      </section>

      <section
        class="remote-queue glass-panel"
        :class="{ hidden: activeTab !== 'queue' }"
      >
        <div class="queue-heading"
          ><div><p class="label">等待演唱</p><h2>待唱队列</h2></div
          ><span>{{ queue.length }} 首</span></div
        >
        <ol>
          <li v-for="(item, index) in queue" :key="item.id">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <div
              ><strong>{{ item.name }}</strong
              ><small>{{ item.artist }} · {{ item.by }}</small></div
            >
            <button
              v-if="item.by === '我'"
              type="button"
              @click="removeTrack(item.id)"
              >取消</button
            >
          </li>
        </ol>
        <p class="queue-footnote"
          >队列、搜索与点歌将在 Phase 4 连接真实房间。</p
        >
      </section>
    </main>

    <nav class="mobile-nav glass-panel" aria-label="KTV 导航">
      <button
        type="button"
        :class="{ active: activeTab === 'search' }"
        @click="activeTab = 'search'"
        >点歌</button
      >
      <button
        type="button"
        :class="{ active: activeTab === 'queue' }"
        @click="activeTab = 'queue'"
        >队列 <span>{{ queue.length }}</span></button
      >
      <button
        type="button"
        :class="{ active: activeTab === 'now' }"
        @click="activeTab = 'now'"
        >正在播放</button
      >
    </nav>
  </section>
</template>

<script>
import KaraokeThemeSwitcher from '@/components/karaoke/KaraokeThemeSwitcher.vue';

const remoteThemeKey = 'yesplaymusic-karaoke-remote-theme';

export default {
  name: 'KaraokeRemote',
  components: { KaraokeThemeSwitcher },
  data() {
    return {
      theme: localStorage.getItem(remoteThemeKey) || 'auto',
      activeTab: 'search',
      query: '',
      systemTheme: 'light',
      themeMedia: null,
      tracks: [
        {
          id: 1,
          name: '晴天',
          artist: '周杰伦',
          album: '叶惠美',
          duration: '04:29',
          playability: 'playable',
          art: 'violet',
          requested: false,
        },
        {
          id: 2,
          name: '晴天（Live）',
          artist: '周杰伦',
          album: '地表最强',
          duration: '04:51',
          playability: 'trial',
          art: 'orange',
          requested: false,
        },
        {
          id: 3,
          name: '晴天（伴奏）',
          artist: '纯音乐',
          album: 'KTV 练习室',
          duration: '04:29',
          playability: 'unavailable',
          art: 'blue',
          requested: false,
        },
        {
          id: 4,
          name: '小幸运',
          artist: '田馥甄',
          album: '我的少女时代',
          duration: '04:25',
          playability: 'playable',
          art: 'pink',
          requested: false,
        },
      ],
      queue: [
        {
          id: 'queue-1',
          name: '夜空中最亮的星',
          artist: '逃跑计划',
          by: '小林',
        },
        { id: 'queue-2', name: '小幸运', artist: '田馥甄', by: '朋友 A' },
        { id: 'queue-3', name: '稻香', artist: '周杰伦', by: '我' },
      ],
    };
  },
  computed: {
    resolvedTheme() {
      if (this.theme !== 'auto') return this.theme;
      return this.systemTheme;
    },
    filteredTracks() {
      const keyword = this.query.toLowerCase();
      if (!keyword) return this.tracks;
      return this.tracks.filter(track =>
        `${track.name} ${track.artist}`.toLowerCase().includes(keyword)
      );
    },
  },
  watch: {
    theme(value) {
      localStorage.setItem(remoteThemeKey, value);
    },
  },
  created() {
    document.documentElement.classList.add('karaoke-remote-route');
    this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    this.syncSystemTheme();
    if (this.themeMedia.addEventListener) {
      this.themeMedia.addEventListener('change', this.syncSystemTheme);
    } else {
      this.themeMedia.addListener(this.syncSystemTheme);
    }
  },
  beforeDestroy() {
    document.documentElement.classList.remove('karaoke-remote-route');
    if (this.themeMedia && this.themeMedia.removeEventListener) {
      this.themeMedia.removeEventListener('change', this.syncSystemTheme);
    } else if (this.themeMedia) {
      this.themeMedia.removeListener(this.syncSystemTheme);
    }
  },
  methods: {
    syncSystemTheme() {
      this.systemTheme =
        this.themeMedia && this.themeMedia.matches ? 'dark' : 'light';
    },
    playabilityText(value) {
      return {
        playable: '✓ 可播放',
        trial: '◐ 仅试听',
        unavailable: '× 不可播放',
      }[value];
    },
    requestTrack(track) {
      if (track.requested || track.playability === 'unavailable') return;
      track.requested = true;
      this.queue.push({
        id: `mock-${track.id}`,
        trackId: track.id,
        name: track.name,
        artist: track.artist,
        by: '我',
      });
    },
    removeTrack(id) {
      const item = this.queue.find(queueItem => queueItem.id === id);
      const track = item
        ? this.tracks.find(candidate => candidate.id === item.trackId)
        : null;
      if (track) track.requested = false;
      this.queue = this.queue.filter(item => item.id !== id);
    },
    queuePosition(track) {
      const index = this.queue.findIndex(item => item.trackId === track.id);
      return index === -1 ? 0 : index + 1;
    },
  },
};
</script>

<style lang="scss" scoped>
.karaoke-remote {
  position: fixed;
  inset: 0;
  overflow: auto;
  padding: clamp(16px, 3vw, 40px);
  background: var(--ktv-bg-base);
  box-sizing: border-box;
}
.remote-ambient {
  position: fixed;
  inset: -20%;
  background: radial-gradient(
      circle at 8% 12%,
      rgba(114, 93, 226, 0.82),
      transparent 30%
    ),
    radial-gradient(
      circle at 86% 76%,
      rgba(230, 100, 168, 0.62),
      transparent 29%
    ),
    linear-gradient(145deg, #181044, #233361);
  filter: blur(48px);
  opacity: 0.55;
  pointer-events: none;
}
.remote-header,
.remote-grid,
.mobile-nav {
  position: relative;
  z-index: 1;
}
.remote-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1440px;
  margin: 0 auto 18px;
  padding: 18px 22px;
}
.room-kicker,
.label {
  margin: 0 0 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.room-kicker span,
.mock-label {
  color: var(--ktv-text-muted);
  font-weight: 600;
  letter-spacing: 0;
}
.remote-header h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 38px);
  letter-spacing: -0.04em;
}
.remote-grid {
  display: grid;
  grid-template-columns: minmax(210px, 0.72fr) minmax(400px, 1.4fr) minmax(
      250px,
      0.78fr
    );
  gap: 18px;
  max-width: 1440px;
  margin: auto;
}
.now-playing,
.remote-search,
.remote-queue {
  padding: 24px;
  min-width: 0;
}
.now-playing {
  align-self: start;
}
.record-art {
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  margin: 16px 0;
  border-radius: 50%;
  background: conic-gradient(from 30deg, #a292ff, #ed7fb8, #ffce77, #a292ff);
  box-shadow: inset 0 0 0 22px rgba(15, 14, 38, 0.65),
    0 16px 30px rgba(38, 24, 101, 0.24);
  color: #fff;
  font-size: 42px;
}
.now-playing h2,
.remote-search h2,
.remote-queue h2 {
  margin: 0;
  font-size: 21px;
}
.now-playing p:not(.label) {
  margin: 5px 0 16px;
  color: var(--ktv-text-secondary);
}
.progress {
  height: 5px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--ktv-glass-strong);
}
.progress i {
  display: block;
  width: 51%;
  height: 100%;
  border-radius: inherit;
  background: var(--ktv-accent);
}
.now-playing small {
  display: block;
  margin-top: 7px;
  color: var(--ktv-text-muted);
  font-size: 11px;
  text-align: right;
}
.search-heading,
.queue-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}
.search-input {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  margin: 24px 0 14px;
  padding: 0 14px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 16px;
  background: var(--ktv-glass-soft);
}
.search-input span {
  color: var(--ktv-text-muted);
  font-size: 25px;
  transform: rotate(-20deg);
}
.search-input input {
  flex: 1;
  width: 100%;
  border: 0;
  outline: 0;
  background: none;
  color: var(--ktv-text-primary);
  font: inherit;
  font-size: 16px;
}
.search-input input::placeholder {
  color: var(--ktv-text-muted);
}
.search-input button {
  color: var(--ktv-text-secondary);
  font-size: 23px;
}
.track-result {
  display: grid;
  grid-template-columns: 54px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--ktv-glass-border);
}
.mini-cover {
  width: 54px;
  height: 54px;
  border-radius: 12px;
}
.mini-cover.violet {
  background: linear-gradient(135deg, #5a50c9, #bb8df5);
}
.mini-cover.orange {
  background: linear-gradient(135deg, #e27352, #ffd178);
}
.mini-cover.blue {
  background: linear-gradient(135deg, #3683b8, #8ed7e8);
}
.mini-cover.pink {
  background: linear-gradient(135deg, #c6579d, #f8a8cb);
}
.result-info {
  min-width: 0;
}
.result-info strong,
.result-info span,
.result-info small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-info strong {
  margin-bottom: 3px;
  font-size: 15px;
}
.result-info span,
.result-info small {
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.result-info small {
  margin-top: 4px;
}
.result-info b {
  font-weight: 700;
}
.playable {
  color: var(--ktv-success);
}
.trial {
  color: var(--ktv-warning);
}
.unavailable {
  color: var(--ktv-danger);
}
.track-result > button {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--ktv-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.track-result > button.requested {
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-secondary);
}
.track-result > button:disabled {
  cursor: not-allowed;
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-muted);
}
.empty-state {
  padding: 44px 18px;
  color: var(--ktv-text-secondary);
  text-align: center;
}
.queue-heading > span {
  color: var(--ktv-text-muted);
  font-size: 13px;
}
.remote-queue ol {
  padding: 0;
  margin: 18px 0 0;
  list-style: none;
}
.remote-queue li {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--ktv-glass-border);
}
.remote-queue li > span {
  color: var(--ktv-accent);
  font-size: 12px;
  font-weight: 800;
}
.remote-queue strong,
.remote-queue small {
  display: block;
}
.remote-queue strong {
  font-size: 14px;
}
.remote-queue small,
.queue-footnote {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.remote-queue li button {
  color: var(--ktv-accent);
  font-size: 12px;
  font-weight: 700;
}
.queue-footnote {
  margin: 14px 0 0;
}
.mobile-nav {
  display: none;
}
@media (min-width: 768px) and (max-width: 1199px) {
  .remote-grid {
    grid-template-columns: minmax(0, 1.5fr) minmax(240px, 1fr);
  }

  .now-playing {
    grid-column: 2;
    grid-row: 1;
  }

  .remote-search {
    grid-column: 1;
    grid-row: 1 / span 2;
  }

  .remote-queue {
    grid-column: 2;
    grid-row: 2;
  }
}
@media (max-width: 767px) {
  .karaoke-remote {
    position: absolute;
    min-height: 100%;
    padding: 14px 14px 86px;
  }
  .remote-header {
    align-items: flex-start;
    padding: 16px;
  }
  .remote-header h1 {
    font-size: 25px;
  }
  .karaoke-theme-switcher {
    transform: scale(0.92);
    transform-origin: top right;
  }
  .remote-grid {
    display: block;
  }
  .now-playing {
    display: grid;
    grid-template-columns: 68px 1fr;
    gap: 0 14px;
    margin-bottom: 14px;
    padding: 16px;
  }
  .now-playing .label {
    grid-column: 1 / -1;
  }
  .record-art {
    grid-row: span 4;
    width: 68px;
    margin: 5px 0 0;
    font-size: 22px;
  }
  .now-playing h2 {
    margin-top: 5px;
  }
  .now-playing p:not(.label) {
    margin: 3px 0 8px;
  }
  .now-playing .progress,
  .now-playing small {
    grid-column: 2;
  }
  .remote-search,
  .remote-queue {
    padding: 18px;
  }
  .remote-search.hidden,
  .remote-queue.hidden {
    display: none;
  }
  .remote-queue ol {
    display: block;
  }
  .mobile-nav {
    position: fixed;
    right: 12px;
    bottom: max(10px, env(safe-area-inset-bottom));
    left: 12px;
    z-index: 3;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 5px;
  }
  .mobile-nav button {
    min-height: 44px;
    border-radius: 12px;
    color: var(--ktv-text-secondary);
    font-size: 12px;
    font-weight: 700;
  }
  .mobile-nav button.active {
    background: var(--ktv-glass-strong);
    color: var(--ktv-text-primary);
  }
  .mobile-nav span {
    display: inline-grid;
    min-width: 17px;
    height: 17px;
    place-items: center;
    border-radius: 99px;
    background: var(--ktv-accent);
    color: #fff;
    font-size: 10px;
  }
}
</style>

