<template>
  <section
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
        <span class="live-dot"></span>
        <span>KTV 舞台 · Phase 1</span>
        <small>房间将在局域网服务完成后开启</small>
      </div>
      <KaraokeThemeSwitcher v-model="karaokeTheme" />
    </header>

    <main class="karaoke-layout">
      <aside class="track-identity glass-panel">
        <div class="cover-wrap">
          <img v-if="cover" :src="cover" :alt="`${track.name} 封面`" />
          <div v-else class="cover-fallback">♪</div>
        </div>
        <p class="eyebrow">正在演唱</p>
        <h1 :title="track.name">{{ track.name }}</h1>
        <p class="artist">{{ artist }}</p>
        <p class="album">{{
          track.al && track.al.name ? track.al.name : '选择一首歌，舞台即刻开始'
        }}</p>
      </aside>

      <section
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
          <span>歌词与现有播放器保持同步</span>
          <span>{{ lyricOffsetLabel }}</span>
        </div>
      </section>

      <aside class="queue-panel glass-panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">临时待唱</p>
            <h2>队列预览</h2>
          </div>
          <span class="mock-badge">演示数据</span>
        </div>
        <ol>
          <li v-for="item in mockQueue" :key="item.id">
            <span class="queue-number">{{ item.position }}</span>
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.artist }} · {{ item.requester }}</small>
            </div>
          </li>
        </ol>
        <p class="queue-note">真实临时队列会在 Phase 2 接入。</p>
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
        <button type="button" @click="replay">重唱</button>
        <button type="button" class="primary" @click="player.playOrPause()">
          {{ player.playing ? '暂停' : '播放' }}
        </button>
        <button type="button" @click="nextTrack">下一首</button>
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
      mockQueue: [
        {
          id: 'mock-1',
          position: '01',
          name: '夜空中最亮的星',
          artist: '逃跑计划',
          requester: '客人 A',
        },
        {
          id: 'mock-2',
          position: '02',
          name: '小幸运',
          artist: '田馥甄',
          requester: '客人 B',
        },
        {
          id: 'mock-3',
          position: '03',
          name: '一路向北',
          artist: '周杰伦',
          requester: '客人 C',
        },
      ],
    };
  },
  computed: {
    ...mapState(['player', 'settings']),
    track() {
      return this.player.currentTrack || { name: '还没有正在播放的歌曲' };
    },
    trackId() {
      return this.track.id;
    },
    artist() {
      return this.track.ar && this.track.ar.length
        ? this.track.ar.map(item => item.name).join(' / ')
        : '准备好开始演唱';
    },
    cover() {
      return this.track.al && this.track.al.picUrl
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
      if (this.karaokeTheme !== 'auto') return this.karaokeTheme;
      return this.systemTheme;
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
        const last = this.lyrics[this.lyrics.length - 1];
        return {
          state: 'after-final',
          before: last.content,
          active: '本首歌词已结束',
          after: '♪',
          translation: '等待下一首待唱歌曲。',
        };
      }
      const index = activeIndex;
      return {
        state: index === this.lyrics.length - 1 ? 'final' : 'active',
        before: this.lyrics[index - 1] ? this.lyrics[index - 1].content : '♪',
        active: this.lyrics[index]
          ? this.lyrics[index].content
          : '等待歌词加载',
        after: this.lyrics[index + 1] ? this.lyrics[index + 1].content : '♪',
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
    if (this.themeMedia.addEventListener) {
      this.themeMedia.addEventListener('change', this.syncSystemTheme);
    } else {
      this.themeMedia.addListener(this.syncSystemTheme);
    }
    this.loadLyrics();
    this.clock = window.setInterval(() => {
      this.now = this.player.seek(null, false) || 0;
    }, 100);
  },
  beforeDestroy() {
    window.clearInterval(this.clock);
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
    loadLyrics() {
      if (!this.trackId) {
        this.lyrics = [];
        return;
      }
      getLyric(this.trackId)
        .then(data => {
          const parsed =
            data && data.lrc && data.lrc.lyric ? lyricParser(data).lyric : [];
          this.lyrics = parsed.filter(line => line.content);
        })
        .catch(() => {
          this.lyrics = [];
        });
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
      this.player.seek(0);
      this.player.play();
    },
    nextTrack() {
      if (this.player.isPersonalFM) this.player.playNextFMTrack();
      else this.player.playNextTrack();
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
.karaoke-controls {
  position: relative;
  z-index: 1;
}
.karaoke-header {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.back {
  color: var(--ktv-text-secondary);
  font-weight: 600;
}
.room-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ktv-text-primary);
  font-size: 14px;
  font-weight: 700;
}
.room-label small {
  color: var(--ktv-text-muted);
  font-weight: 500;
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--ktv-accent);
  box-shadow: 0 0 0 5px rgba(108, 87, 233, 0.16);
}
.karaoke-layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(210px, 0.78fr) minmax(420px, 1.8fr) minmax(
      250px,
      0.92fr
    );
  gap: 18px;
  min-height: 480px;
}
.track-identity,
.queue-panel {
  padding: 24px;
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
  color: white;
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
.album {
  color: var(--ktv-text-muted);
  font-size: 13px;
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
.stage-lines {
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
  position: relative;
  z-index: 1;
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
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.panel-title .eyebrow {
  margin-top: 0;
}
.panel-title h2 {
  margin-bottom: 16px;
  font-size: 21px;
}
.mock-badge {
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-muted);
  font-size: 10px;
}
ol {
  padding: 0;
  margin: 0;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid var(--ktv-glass-border);
}
li:last-child {
  border: 0;
}
.queue-number {
  color: var(--ktv-accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
li strong,
li small {
  display: block;
}
li strong {
  font-size: 14px;
}
li small,
.queue-note {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.queue-note {
  margin: 12px 0 0;
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
  .queue-panel ol {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .queue-panel li {
    border-top: 1px solid var(--ktv-glass-border);
  }
}
@media (max-width: 760px) {
  .karaoke-desktop {
    padding: 12px;
  }
  .karaoke-header {
    flex-wrap: wrap;
    gap: 10px;
    padding: 12px;
  }
  .room-label small {
    display: none;
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
    grid-row: span 4;
  }
  .track-identity .eyebrow {
    margin-top: 4px;
  }
  .track-identity h1 {
    font-size: 24px;
  }
  .stage {
    min-height: 380px;
  }
  .queue-panel ol {
    display: block;
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
