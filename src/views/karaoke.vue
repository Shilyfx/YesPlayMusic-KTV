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
          type="button"
          class="session-button fullscreen-button"
          :aria-label="isKtvFullscreen ? '退出全屏' : '全屏 KTV'"
          @click="enterKtvFullscreen"
        >
          {{ isKtvFullscreen ? '退出全屏' : '全屏 KTV' }}
        </button>
        <button
          v-if="lanRoom"
          type="button"
          class="session-button"
          :aria-expanded="showRoomCode"
          @click="showRoomCode = !showRoomCode"
          >{{ showRoomCode ? '收起二维码' : '显示二维码' }}</button
        >
        <button
          v-if="isElectron"
          type="button"
          class="session-button"
          :aria-expanded="showLocalLibraryPanel"
          @click="showLocalLibraryPanel = !showLocalLibraryPanel"
        >
          {{ showLocalLibraryPanel ? '收起本地歌单' : '本地歌单' }}
        </button>
        <button type="button" class="session-button" @click="toggleSession">
          {{ isSessionActive ? '结束 KTV' : '开始本机 KTV' }}
        </button>
        <div
          v-if="isElectron && !isMac"
          class="window-actions"
          aria-label="窗口控制"
        >
          <button
            type="button"
            class="window-action"
            aria-label="最小化窗口"
            title="最小化窗口"
            @click="windowMinimize"
          >
            −
          </button>
          <button
            type="button"
            class="window-action"
            :aria-label="isWindowMaximized ? '还原窗口' : '最大化窗口'"
            :title="isWindowMaximized ? '还原窗口' : '最大化窗口'"
            @click="windowMaxRestore"
          >
            {{ isWindowMaximized ? '❐' : '□' }}
          </button>
          <button
            type="button"
            class="window-action window-action-close"
            aria-label="关闭窗口"
            title="关闭窗口"
            @click="windowClose"
          >
            ×
          </button>
        </div>
      </div>
    </header>

    <section
      v-if="isSessionActive && (!lanRoom || showRoomCode)"
      class="room-access room-access-overlay glass-panel"
      :class="{ 'room-access-pending': !lanRoom }"
    >
      <div v-if="lanRoom" class="room-qr-wrap">
        <img
          v-if="lanRoom.qrDataUrl"
          :src="lanRoom.qrDataUrl"
          alt="局域网 KTV 房间二维码"
        />
        <div v-else class="room-qr-placeholder">二维码暂不可用</div>
      </div>
      <div class="room-access-copy">
        <strong>{{
          lanRoom ? '用同一局域网设备扫码加入' : '选择对外网卡'
        }}</strong>
        <p v-if="lanRoom"
          >房间码 {{ lanRoom.code }}。链接仅在本次 KTV 进行期间有效。</p
        >
        <p v-if="lanRoom && lanRoom.qrError" class="room-warning">
          {{ lanRoom.qrError }}
        </p>
        <div v-if="lanRoom" class="room-link-block">
          <span class="room-link-label">直接加入链接</span>
          <div class="room-link-row">
            <code class="room-link">{{ lanRoom.joinUrl || lanRoom.url }}</code>
            <button type="button" class="room-link-copy" @click="copyLanLink">
              {{ copyLinkLabel }}
            </button>
          </div>
        </div>
        <p v-else>服务会监听全部网络；你选择的网卡只决定二维码中的访问地址。</p>
        <label v-if="lanCandidates.length">
          网卡地址
          <select v-model="selectedLanAddress">
            <option
              v-for="candidate in lanCandidates"
              :key="candidate.address"
              :value="candidate.address"
              >{{ candidate.interfaceName }} · {{ candidate.address }}</option
            >
          </select>
        </label>
        <button
          v-if="!lanRoom"
          type="button"
          class="generate-room"
          :disabled="!selectedLanAddress"
          @click="startLanRoom"
          >生成房间二维码</button
        >
        <button
          v-else
          type="button"
          class="generate-room"
          @click="restartLanRoom"
          >按当前网卡更新二维码</button
        >
        <div v-if="lanRoom" class="room-tools">
          <button type="button" class="room-tool" @click="retryLanQr">
            重试二维码
          </button>
          <button type="button" class="room-tool" @click="selfTestLan">
            {{ lanSelfTest === 'checking' ? '检测中…' : '检测当前网卡' }}
          </button>
        </div>
        <p v-if="lanSelfTest === 'ok'" class="room-success"
          >当前网卡可访问 KTV 服务</p
        >
        <p v-else-if="lanSelfTest === 'error'" class="room-warning">
          当前网卡自检失败，请确认手机与主机处于同一局域网
        </p>
      </div>
    </section>

    <section
      v-if="isElectron && showLocalLibraryPanel"
      class="local-library local-library-overlay glass-panel"
    >
      <div class="local-library-heading">
        <div>
          <p class="eyebrow">LOCAL LIBRARY</p>
          <h2>本地歌单</h2>
          <p class="local-library-note">
            支持递归扫描音频目录；同名 .lrc 会自动作为同步歌词。
          </p>
        </div>
        <div class="local-library-actions">
          <button
            type="button"
            class="room-tool"
            @click="chooseLocalDirectories"
          >
            选择音乐目录
          </button>
          <button
            type="button"
            class="room-tool"
            :disabled="localLoading"
            @click="scanLocalLibrary"
          >
            {{ localLoading ? '扫描中…' : '重新扫描' }}
          </button>
        </div>
      </div>
      <div v-if="localDirectories.length" class="local-directory-list">
        <span
          v-for="directory in localDirectories"
          :key="directory"
          class="local-directory"
        >
          {{ directory }}
          <button
            type="button"
            aria-label="移除本地目录"
            @click="removeLocalDirectory(directory)"
            >×</button
          >
        </span>
      </div>
      <div
        v-if="localLoading"
        class="local-scan-progress"
        role="status"
        aria-live="polite"
      >
        <span class="local-scan-progress-bar" aria-hidden="true"></span>
        <span>正在扫描目录并更新本地索引…</span>
      </div>
      <p v-if="localError" class="room-warning">{{ localError }}</p>
      <p v-else class="local-library-status">
        {{
          localTrackCount
            ? `已发现 ${localTrackCount} 首本地歌曲，可在手机点歌页的“本地歌单”中选择。`
            : '尚未配置本地音乐目录。'
        }}
      </p>
    </section>

    <div class="karaoke-layout" role="main">
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
        :data-lyric-effect="lyricEffect"
        aria-label="KTV 歌词舞台"
        @mousemove="showLyricControls"
        @touchstart="showLyricControls"
      >
        <p class="stage-kicker">LYRIC STAGE</p>
        <div class="stage-lines">
          <p :key="'before-' + stageLyrics.before" class="before-line">
            {{ stageLyrics.before }}
          </p>
          <p :key="'active-' + stageLyrics.active" class="active-line">
            {{ stageLyrics.active }}
          </p>
          <p :key="'after-' + stageLyrics.after" class="after-line">
            {{ stageLyrics.after }}
          </p>
          <p
            :key="'after-second-' + stageLyrics.afterSecond"
            class="after-second-line"
          >
            {{ stageLyrics.afterSecond }}
          </p>
        </div>
        <p v-if="stageLyrics.translation" class="translation">
          {{ stageLyrics.translation }}
        </p>
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
        <div
          v-if="isLyricFullscreen"
          class="lyric-fullscreen-overlay"
          :class="{ visible: lyricControlsVisible }"
        >
          <button type="button" @click="replay">重唱</button>
          <button type="button" @click="playOrPause">
            {{ player.playing ? '暂停' : '播放' }}
          </button>
          <button type="button" @click="nextTrack">切歌</button>
          <button
            type="button"
            class="volume-toggle"
            :aria-pressed="player.volume === 0"
            @click="toggleMute"
          >
            {{ player.volume === 0 ? '取消静音' : '静音' }}
          </button>
          <label class="fullscreen-volume">
            <span>音量 {{ volumePercent }}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="player.volume"
              aria-label="全屏歌词音量"
              @input="setVolume($event.target.value)"
            />
          </label>
          <button type="button" @click.stop="exitFullscreen">退出全屏</button>
        </div>
      </section>

      <aside class="queue-panel glass-panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">本机待唱</p>
            <h2>等待队列</h2>
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
    </div>

    <footer class="karaoke-controls glass-panel">
      <div class="quick-setting">
        <span>歌词同步</span>
        <button
          type="button"
          aria-label="歌词延迟 0.1 秒"
          @click="adjustOffset(-0.1)"
          >−</button
        >
        <input
          v-model="lyricOffsetDraft"
          class="setting-input offset-input"
          type="number"
          min="-10"
          max="10"
          step="0.1"
          aria-label="直接编辑歌词同步偏移秒数"
          title="正数提前，负数延迟"
          @change="commitOffsetDraft"
          @keydown.enter.prevent="$event.target.blur()"
        />
        <span class="setting-unit">s</span>
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
        <input
          v-model="lyricFontSizeDraft"
          class="setting-input font-size-input"
          type="number"
          min="16"
          max="64"
          step="1"
          aria-label="直接编辑歌词字号"
          @change="commitFontSizeDraft"
          @keydown.enter.prevent="$event.target.blur()"
        />
        <span class="setting-unit">px</span>
        <button
          type="button"
          aria-label="增大歌词字号"
          @click="adjustFontSize(1)"
          >+</button
        >
        <label class="lyric-effect-setting">
          <span>歌词字效</span>
          <select v-model="lyricEffect" aria-label="自定义歌词字体效果">
            <option value="gradient">渐变</option>
            <option value="neon">霓虹</option>
            <option value="outline">描边</option>
            <option value="solid">纯色</option>
          </select>
        </label>
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
import findLyricIndex from '@/utils/lyricCursor';
import KaraokeThemeSwitcher from '@/components/karaoke/KaraokeThemeSwitcher.vue';

export default {
  name: 'Karaoke',
  components: { KaraokeThemeSwitcher },
  data() {
    return {
      lyrics: [],
      now: 0,
      clock: null,
      lyricVisibilityListener: null,
      lyricLoadGeneration: 0,
      lyricRequestKeyValue: '',
      activeLyricIndex: -1,
      lastLyricProgress: null,
      systemTheme: 'light',
      themeMedia: null,
      lanRoom: null,
      lanCandidates: [],
      showRoomCode: false,
      selectedLanAddress: '',
      lanSelfTest: 'idle',
      copyLinkState: 'idle',
      copyLinkTimer: null,
      lyricFontSizeDraft: '45',
      lyricOffsetDraft: '0.0',
      isElectron: process.env.IS_ELECTRON === true,
      isWindowMaximized: false,
      windowStateListener: null,
      isKtvFullscreen: false,
      isLyricFullscreen: false,
      isExitingFullscreen: false,
      lyricControlsVisible: false,
      lyricControlsTimer: null,
      lastVolumeBeforeMute: 1,
      showLocalLibraryPanel: false,
      localDirectories: [],
      localPlaylists: [],
      localTrackCount: 0,
      localLoading: false,
      localError: '',
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
      return `${this.roomName}${this.isSessionActive ? ' · 进行中' : ''}`;
    },
    roomName() {
      return this.lanRoom?.name || 'Shilyfx的KTV';
    },
    statusEyebrow() {
      return this.isSessionActive ? '等待下一首' : '准备开始';
    },
    currentItem() {
      return this.karaoke.currentItem;
    },
    isMac() {
      return /macintosh|mac os x/i.test(navigator.userAgent);
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
    lyricRequestKey() {
      return `${this.currentItem?.queueItemId || 'player'}:${
        this.trackId || ''
      }`;
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
      const coverUrl = this.track.al?.picUrl || '';
      if (!coverUrl) return '';
      if (this.track.source === 'local') return coverUrl;
      return `${coverUrl}${coverUrl.includes('?') ? '&' : '?'}param=640y640`;
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
    lyricEffect: {
      get() {
        return ['gradient', 'neon', 'outline', 'solid'].includes(
          this.settings.karaokeLyricEffect
        )
          ? this.settings.karaokeLyricEffect
          : 'gradient';
      },
      set(value) {
        const effect = ['gradient', 'neon', 'outline', 'solid'].includes(value)
          ? value
          : 'gradient';
        this.$store.commit('updateSettings', {
          key: 'karaokeLyricEffect',
          value: effect,
        });
      },
    },
    volumePercent() {
      const volume = Number(this.player.volume);
      return Math.round(
        Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0)) * 100
      );
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
    copyLinkLabel() {
      return this.copyLinkState === 'copied' ? '已复制' : '一键复制';
    },
    stageLyrics() {
      const activeIndex = this.activeLyricIndex;
      if (!this.lyrics.length) {
        return {
          state: 'waiting',
          before: '♪',
          active: '等待歌词加载',
          after: '播放带歌词的歌曲后，主舞台会在这里同步显示。',
          afterSecond: '♪',
          translation: '',
        };
      }
      if (activeIndex < 0) {
        return {
          state: 'before-first',
          before: '♪',
          active: '等待第一句歌词',
          after: this.lyrics[0].content,
          afterSecond: this.lyrics[1]?.content || '♪',
          translation: '即将开始演唱。',
        };
      }
      if (activeIndex >= this.lyrics.length) {
        return {
          state: 'after-final',
          before: this.lyrics[this.lyrics.length - 1].content,
          active: '本首歌词已结束',
          after: '♪',
          afterSecond: '♪',
          translation: '等待下一首待唱歌曲。',
        };
      }
      return {
        state: activeIndex === this.lyrics.length - 1 ? 'final' : 'active',
        before: this.lyrics[activeIndex - 1]?.content || '♪',
        active: this.lyrics[activeIndex].content,
        after: this.lyrics[activeIndex + 1]?.content || '♪',
        afterSecond: this.lyrics[activeIndex + 2]?.content || '♪',
        translation: '',
      };
    },
  },
  watch: {
    lyricRequestKey(value) {
      this.lyricRequestKeyValue = value;
      this.loadLyrics();
    },
    lyricFontSize(value) {
      this.lyricFontSizeDraft = String(value);
    },
    lyricOffset(value) {
      this.lyricOffsetDraft = Number(value).toFixed(1);
      this.syncLyricCursor(this.now + Number(value), true);
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
    if (!this.isSessionActive) this.startDefaultSession();
    if (this.isElectron) this.loadLocalLibrarySummary();
    this.lyricFontSizeDraft = String(this.lyricFontSize);
    this.lyricOffsetDraft = this.lyricOffset.toFixed(1);
    const ipcRenderer = this.electronIpc();
    if (ipcRenderer) {
      this.windowStateListener = (_, value) => {
        this.isWindowMaximized = Boolean(value);
      };
      ipcRenderer.on('isMaximized', this.windowStateListener);
      ipcRenderer
        .invoke('window:state')
        .then(state => {
          this.isWindowMaximized = Boolean(state && state.maximized);
        })
        .catch(() => {});
    }
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener(
      'webkitfullscreenchange',
      this.handleFullscreenChange
    );
    document.addEventListener(
      'mozfullscreenchange',
      this.handleFullscreenChange
    );
    document.addEventListener(
      'MSFullscreenChange',
      this.handleFullscreenChange
    );
    this.lyricRequestKeyValue = this.lyricRequestKey;
    this.startLyricClock();
    this.lyricVisibilityListener = () => {
      if (document.hidden) window.clearInterval(this.clock);
      else this.startLyricClock();
    };
    document.addEventListener('visibilitychange', this.lyricVisibilityListener);
  },
  beforeDestroy() {
    window.clearInterval(this.clock);
    if (this.themeMedia?.removeEventListener)
      this.themeMedia.removeEventListener('change', this.syncSystemTheme);
    else if (this.themeMedia)
      this.themeMedia.removeListener(this.syncSystemTheme);
    document.removeEventListener(
      'fullscreenchange',
      this.handleFullscreenChange
    );
    document.removeEventListener(
      'webkitfullscreenchange',
      this.handleFullscreenChange
    );
    document.removeEventListener(
      'mozfullscreenchange',
      this.handleFullscreenChange
    );
    document.removeEventListener(
      'MSFullscreenChange',
      this.handleFullscreenChange
    );
    const ipcRenderer = this.electronIpc();
    if (ipcRenderer && this.windowStateListener)
      ipcRenderer.removeListener('isMaximized', this.windowStateListener);
    window.clearTimeout(this.copyLinkTimer);
    window.clearTimeout(this.lyricControlsTimer);
    document.removeEventListener(
      'visibilitychange',
      this.lyricVisibilityListener
    );
  },
  methods: {
    async startDefaultSession() {
      if (this.isSessionActive) return;
      this.karaokeManager.startSession();
      try {
        await this.setLanSessionActive(true);
        await this.loadLanCandidates();
      } catch (error) {
        console.warn('[karaoke] default session startup failed', error);
      }
    },
    syncSystemTheme() {
      this.systemTheme = this.themeMedia?.matches ? 'dark' : 'light';
    },
    syncLyricCursor(progress = this.now + this.lyricOffset, force = false) {
      if (!this.lyrics.length) {
        this.activeLyricIndex = -1;
        this.lastLyricProgress = progress;
        return;
      }
      const previousIndex = force ? -1 : this.activeLyricIndex;
      this.activeLyricIndex = findLyricIndex(
        this.lyrics,
        progress,
        previousIndex
      );
      this.lastLyricProgress = progress;
    },
    startLyricClock() {
      window.clearInterval(this.clock);
      if (document.hidden) return;
      const tick = () => {
        this.now = this.player.seek(null, false) || 0;
        this.syncLyricCursor(this.now + this.lyricOffset);
      };
      tick();
      this.clock = window.setInterval(tick, 100);
    },
    loadLyrics() {
      const requestedKey = this.lyricRequestKey;
      const requestedTrackId = this.trackId;
      const generation = ++this.lyricLoadGeneration;
      this.lyricRequestKeyValue = requestedKey;
      this.activeLyricIndex = -1;
      this.lastLyricProgress = null;
      if (!this.trackId) {
        this.lyrics = [];
        return;
      }
      if (
        this.currentItem?.source === 'local' &&
        Array.isArray(this.currentItem.lyrics)
      ) {
        this.lyrics = this.currentItem.lyrics.filter(line => line.content);
        this.syncLyricCursor(this.now + this.lyricOffset, true);
        return;
      }
      getLyric(this.trackId)
        .then(data => {
          if (
            generation !== this.lyricLoadGeneration ||
            requestedKey !== this.lyricRequestKey ||
            requestedTrackId !== this.trackId
          )
            return;
          const parsed = data?.lrc?.lyric ? lyricParser(data).lyric : [];
          this.lyrics = parsed.filter(line => line.content);
          this.syncLyricCursor(this.now + this.lyricOffset, true);
        })
        .catch(() => {
          if (
            generation !== this.lyricLoadGeneration ||
            requestedKey !== this.lyricRequestKey ||
            requestedTrackId !== this.trackId
          )
            return;
          this.lyrics = [];
          this.syncLyricCursor();
        });
    },
    toggleSession() {
      if (!this.isSessionActive) {
        this.karaokeManager.startSession();
        this.setLanSessionActive(true).then(() => this.loadLanCandidates());
        this.$store.dispatch(
          'showToast',
          '本机 KTV 已开始。选择对外网卡后即可生成房间二维码'
        );
        return;
      }
      if (this.currentItem || this.waitingItems.length) {
        const confirmed = window.confirm(
          '结束本次 KTV？当前与待唱列表将被清空，网易云歌单不会受到影响。'
        );
        if (!confirmed) return;
      }
      this.setLanSessionActive(false);
      this.karaokeManager.endSession();
      this.$store.dispatch('showToast', '本机 KTV 已结束，临时队列已清空');
    },
    electronIpc() {
      if (!process.env.IS_ELECTRON || !window.require) return null;
      return window.require('electron').ipcRenderer;
    },
    async loadLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:status');
        this.lanRoom = result.room;
        this.showRoomCode = Boolean(result.room);
        this.selectedLanAddress = result.room?.selectedAddress || '';
        this.lanCandidates = result.room?.candidates || [];
        if (!this.lanCandidates.length) await this.loadLanCandidates();
        if (this.lanRoom) this.selfTestLan();
      } catch (error) {
        console.warn('[karaoke] LAN status unavailable', error);
      }
    },
    applyLocalLibraryResult(result) {
      this.localDirectories = result?.directories || [];
      this.localPlaylists = result?.playlists || [];
      this.localTrackCount = this.localPlaylists.reduce(
        (count, playlist) => count + Number(playlist.trackCount || 0),
        0
      );
    },
    async loadLocalLibrarySummary() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      this.localError = '';
      try {
        const result = await ipcRenderer.invoke('karaoke:local:list');
        this.applyLocalLibraryResult(result);
      } catch (error) {
        this.localError = error.message || '本地歌单读取失败';
      }
    },
    async scanLocalLibrary() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      this.localLoading = true;
      this.localError = '';
      try {
        const result = await ipcRenderer.invoke('karaoke:local:scan');
        this.applyLocalLibraryResult(result);
      } catch (error) {
        this.localError = error.message || '本地歌单扫描失败';
      } finally {
        this.localLoading = false;
      }
    },
    async chooseLocalDirectories() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      const result = await ipcRenderer.invoke(
        'karaoke:local:choose-directories'
      );
      if (result?.ok) await this.scanLocalLibrary();
    },
    async removeLocalDirectory(directory) {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      await ipcRenderer.invoke('karaoke:local:remove-directory', directory);
      await this.scanLocalLibrary();
    },
    async loadLanCandidates() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:candidates');
        this.lanCandidates = result.candidates || [];
        if (!this.selectedLanAddress && this.lanCandidates.length)
          this.selectedLanAddress = this.lanCandidates[0].address;
      } catch (error) {
        console.warn('[karaoke] LAN candidates unavailable', error);
      }
    },
    async setLanSessionActive(active) {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer)
        await ipcRenderer.invoke('karaoke:lan:set-session-active', active);
    },
    async startLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer) return;
      if (!this.selectedLanAddress) {
        this.$store.dispatch('showToast', '请先选择用于生成二维码的网卡');
        return;
      }
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:start', {
          lanAddress: this.selectedLanAddress,
        });
        if (result.ok) {
          this.lanRoom = result.room;
          this.lanCandidates = result.room.candidates || this.lanCandidates;
          this.selectedLanAddress = result.room.selectedAddress;
          this.showRoomCode = true;
          this.selfTestLan();
        } else {
          this.$store.dispatch(
            'showToast',
            `局域网房间未开启：${result.error}`
          );
        }
      } catch (error) {
        this.$store.dispatch('showToast', `局域网房间未开启：${error.message}`);
      }
    },
    async stopLanRoom() {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer) {
        try {
          await ipcRenderer.invoke('karaoke:lan:stop');
        } catch (error) {
          console.warn('[karaoke] LAN stop failed', error);
        }
      }
      this.lanRoom = null;
      this.showRoomCode = false;
      this.lanSelfTest = 'idle';
      this.copyLinkState = 'idle';
    },
    async restartLanRoom() {
      await this.stopLanRoom();
      await this.startLanRoom();
    },
    async retryLanQr() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer || !this.lanRoom) return;
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:refresh-qr');
        if (result.ok) this.lanRoom = result.room;
      } catch (error) {
        console.warn('[karaoke] QR retry failed', error);
      }
    },
    async selfTestLan() {
      const ipcRenderer = this.electronIpc();
      if (!ipcRenderer || !this.lanRoom) return;
      this.lanSelfTest = 'checking';
      try {
        const result = await ipcRenderer.invoke(
          'karaoke:lan:self-test',
          this.lanRoom.selectedAddress
        );
        this.lanSelfTest = result.ok ? 'ok' : 'error';
      } catch (error) {
        this.lanSelfTest = 'error';
        console.warn('[karaoke] LAN self-test failed', error);
      }
    },
    async copyLanLink() {
      if (!this.lanRoom) return;
      const value = this.lanRoom.joinUrl || this.lanRoom.url;
      try {
        await navigator.clipboard.writeText(value);
      } catch (_) {
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      this.$store.dispatch('showToast', 'KTV 加入链接已复制');
      this.copyLinkState = 'copied';
      window.clearTimeout(this.copyLinkTimer);
      this.copyLinkTimer = window.setTimeout(() => {
        this.copyLinkState = 'idle';
      }, 1800);
    },
    async enterKtvFullscreen() {
      const target = this.$refs.karaokeSurface;
      const request =
        target &&
        (target.requestFullscreen ||
          target.webkitRequestFullscreen ||
          target.mozRequestFullScreen ||
          target.msRequestFullscreen);
      if (!request) return;
      try {
        const fullscreenElement = this.getFullscreenElement();
        if (fullscreenElement === target) {
          await this.exitFullscreen();
          return;
        }
        if (fullscreenElement) await this.exitFullscreen();
        await request.call(target);
      } catch (error) {
        this.$store.dispatch('showToast', '无法进入全屏：' + error.message);
      }
    },
    async enterLyricFullscreen() {
      const target = this.$refs.lyricStage;
      const request =
        target &&
        (target.requestFullscreen ||
          target.webkitRequestFullscreen ||
          target.mozRequestFullScreen ||
          target.msRequestFullscreen);
      if (!request) return;
      try {
        const fullscreenElement = this.getFullscreenElement();
        if (fullscreenElement === target) {
          await this.exitFullscreen();
          return;
        }
        if (fullscreenElement) await this.exitFullscreen();
        await request.call(target);
      } catch (error) {
        this.$store.dispatch('showToast', '无法进入歌词全屏：' + error.message);
      }
    },
    getFullscreenElement() {
      return (
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement ||
        null
      );
    },
    handleFullscreenChange() {
      const fullscreenElement = this.getFullscreenElement();
      this.isKtvFullscreen = fullscreenElement === this.$refs.karaokeSurface;
      this.isLyricFullscreen = fullscreenElement === this.$refs.lyricStage;
      if (this.isLyricFullscreen) this.showLyricControls();
      else this.lyricControlsVisible = false;
    },
    showLyricControls() {
      this.lyricControlsVisible = true;
      window.clearTimeout(this.lyricControlsTimer);
      this.lyricControlsTimer = window.setTimeout(() => {
        this.lyricControlsVisible = false;
      }, 4000);
    },
    async exitFullscreen() {
      if (this.isExitingFullscreen) return;
      this.isExitingFullscreen = true;
      const exits = [
        document.exitFullscreen,
        document.webkitExitFullscreen,
        document.mozCancelFullScreen,
        document.msExitFullscreen,
      ].filter((method, index, methods) =>
        typeof method === 'function' ? methods.indexOf(method) === index : false
      );
      try {
        for (const exit of exits) {
          try {
            const result = exit.call(document);
            if (result && typeof result.then === 'function') await result;
            if (!this.getFullscreenElement()) break;
          } catch (error) {
            console.warn('[karaoke] fullscreen exit method failed', error);
          }
        }
        if (this.getFullscreenElement()) {
          const ipcRenderer = this.electronIpc();
          if (ipcRenderer?.invoke) {
            try {
              await ipcRenderer.invoke('window:exit-fullscreen');
            } catch (error) {
              console.warn('[karaoke] native fullscreen exit failed', error);
            }
          }
        }
      } catch (error) {
        console.warn('[karaoke] fullscreen exit failed', error);
      } finally {
        this.handleFullscreenChange();
        this.isExitingFullscreen = false;
      }
    },
    commitFontSizeDraft() {
      const value = normalizeLyricFontSize(this.lyricFontSizeDraft);
      this.$store.commit('changeLyricFontSize', value);
      this.lyricFontSizeDraft = String(value);
    },
    commitOffsetDraft() {
      const value = normalizeLyricOffset(this.lyricOffsetDraft);
      this.setOffset(value);
      this.lyricOffsetDraft = value.toFixed(1);
    },
    windowMinimize() {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer) ipcRenderer.send('minimize');
    },
    windowMaxRestore() {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer) ipcRenderer.send('maximizeOrUnmaximize');
    },
    windowClose() {
      const ipcRenderer = this.electronIpc();
      if (ipcRenderer) ipcRenderer.send('close');
    },
    enqueueCurrentTrack() {
      const item = this.karaokeManager.enqueueTrack(this.track);
      if (item) {
        if (!this.karaokeManager.queue.currentItem)
          this.karaokeManager.startQueue();
        this.$store.dispatch('showToast', `已加入 KTV 待唱：${item.trackName}`);
      }
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
    setVolume(value) {
      const volume = Number(value);
      if (!Number.isFinite(volume)) return;
      const normalized = Math.min(1, Math.max(0, volume));
      if (normalized > 0) this.lastVolumeBeforeMute = normalized;
      this.player.volume = normalized;
    },
    toggleMute() {
      if (this.player.volume === 0) {
        this.setVolume(this.lastVolumeBeforeMute || 0.7);
      } else {
        this.lastVolumeBeforeMute = this.player.volume;
        this.setVolume(0);
      }
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
  -webkit-app-region: drag;
}
.karaoke-header button,
.karaoke-header select,
.karaoke-header .header-actions {
  -webkit-app-region: no-drag;
}
.karaoke-desktop button {
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease,
    border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}
.karaoke-desktop button:not(:disabled):hover {
  border-color: rgba(108, 87, 233, 0.42);
  box-shadow: 0 6px 16px rgba(56, 42, 110, 0.12);
  transform: translateY(-1px);
}
.karaoke-desktop button:not(:disabled):active {
  box-shadow: none;
  transform: translateY(1px) scale(0.97);
}
.karaoke-desktop button:disabled {
  cursor: not-allowed;
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
.header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
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
.fullscreen-button {
  border-color: rgba(108, 87, 233, 0.28);
}
.window-actions {
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
}
.window-action {
  width: 34px;
  min-height: 32px;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--ktv-glass-border);
  color: var(--ktv-text-secondary);
  font-size: 16px;
  line-height: 1;
}
.window-action:first-child {
  border-left: 0;
}
.window-action:hover {
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-primary);
}
.window-action-close:hover {
  background: #c94c5f;
  color: #fff;
}
.room-access {
  display: grid;
  grid-template-columns: minmax(190px, 240px) minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  width: min(720px, calc(100% - 32px));
  margin: 14px auto 0;
  padding: 12px;
  box-sizing: border-box;
}
@media (min-width: 761px) {
  .room-access-overlay,
  .local-library-overlay {
    position: fixed;
    top: 92px;
    left: 50%;
    z-index: 20;
    max-height: calc(100vh - 112px);
    overflow: auto;
    margin: 0;
    transform: translateX(-50%);
    box-shadow: 0 24px 60px rgba(24, 15, 65, 0.24);
  }
}
.local-library {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 16px 20px;
  box-sizing: border-box;
}
.local-library-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.local-library h2 {
  margin: 2px 0 0;
  color: var(--ktv-text-primary);
  font-size: 20px;
}
.local-library-note,
.local-library-status {
  margin: 4px 0 0;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.local-scan-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.local-scan-progress-bar {
  display: block;
  width: 72px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ktv-glass-border);
}
.local-scan-progress-bar::after {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: var(--ktv-accent);
  content: '';
  animation: ktv-local-scan 1.2s ease-in-out infinite;
}
@keyframes ktv-local-scan {
  0% {
    transform: translateX(-150%);
  }
  100% {
    transform: translateX(340%);
  }
}
.local-library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.local-directory-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.local-directory {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  gap: 6px;
  padding: 6px 10px;
  overflow: hidden;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 999px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local-directory button {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ktv-text-muted);
  font-size: 16px;
  line-height: 1;
}
.room-access-pending .room-access-copy {
  grid-column: 1 / -1;
}
.room-access-copy {
  min-width: 0;
}
.room-qr-wrap {
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
}
.room-access img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 10px;
  background: #fff;
}
.room-qr-placeholder {
  padding: 16px;
  color: #777;
  font-size: 12px;
  text-align: center;
}
.room-access strong,
.room-access p {
  display: block;
  margin: 0;
}
.room-link {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--ktv-text-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1.45;
}
.room-link-block {
  min-width: 0;
  margin-top: 8px;
}
.room-link-label {
  display: block;
  margin-bottom: 5px;
  color: var(--ktv-text-muted);
  font-size: 11px;
}
.room-link-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}
.room-link {
  flex: 1 1 auto;
  padding: 8px 9px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-glass-soft);
}
.room-link-copy {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(108, 87, 233, 0.3);
  border-radius: 8px;
  background: var(--ktv-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.room-link-copy:hover {
  background: var(--ktv-accent-strong);
}
.room-access .room-link {
  overflow-wrap: anywhere;
}
.room-warning {
  color: #f2b56b !important;
}
.room-success {
  color: var(--ktv-success) !important;
}
.room-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.room-tool {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 7px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font-size: 11px;
}
.room-access p {
  margin-top: 6px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.room-access label {
  display: block;
  margin-top: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.room-access select {
  max-width: 100%;
  margin-left: 8px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
}
.generate-room {
  display: block;
  min-height: 32px;
  margin-top: 10px;
  padding: 0 11px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-accent);
  color: #fff;
  font-weight: 700;
}
.karaoke-layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(460px, 3.8fr) minmax(
      180px,
      0.8fr
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
  isolation: isolate;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: clamp(28px, 4vw, 72px);
  overflow: hidden;
  text-align: center;
}
.stage::before {
  position: absolute;
  inset: 18% 22%;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(108, 87, 233, 0.2),
    rgba(194, 78, 155, 0.08) 45%,
    transparent 72%
  );
  content: '';
  filter: blur(42px);
  opacity: 0.72;
  pointer-events: none;
  z-index: 0;
  animation: ktv-stage-glow 8s ease-in-out infinite;
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
  pointer-events: none;
  z-index: 0;
}
@keyframes ktv-stage-glow {
  0%,
  100% {
    opacity: 0.52;
    transform: translate3d(-4%, 0, 0) scale(0.94);
  }
  50% {
    opacity: 0.82;
    transform: translate3d(4%, -2%, 0) scale(1.08);
  }
}
@keyframes ktv-active-lyric {
  0%,
  100% {
    filter: drop-shadow(0 10px 24px rgba(81, 58, 180, 0.2));
    transform: translateY(0);
  }
  50% {
    filter: drop-shadow(0 14px 36px rgba(171, 156, 255, 0.42));
    transform: translateY(-2px);
  }
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
.stage-lines {
  width: min(100%, 1100px);
  margin: 0 auto;
  padding: 52px 0 74px;
}
.stage-lines p {
  overflow-wrap: anywhere;
  text-rendering: optimizeLegibility;
}
.before-line,
.after-line {
  color: var(--ktv-text-muted);
  font-size: clamp(12px, calc(var(--ktv-active-lyric-size) * 0.58), 38px);
  font-weight: 600;
  letter-spacing: 0.015em;
  transition: color 220ms ease, opacity 220ms ease, transform 220ms ease;
}
.after-second-line {
  margin: 14px 0 0;
  color: var(--ktv-text-muted);
  font-size: clamp(10px, calc(var(--ktv-active-lyric-size) * 0.42), 28px);
  font-weight: 500;
  letter-spacing: 0.04em;
  opacity: 0.58;
  transition: color 220ms ease, opacity 220ms ease, transform 220ms ease;
}
.active-line {
  margin: 22px 0;
  background: linear-gradient(
    105deg,
    var(--ktv-accent-strong) 0%,
    var(--ktv-text-primary) 42%,
    var(--ktv-accent) 72%,
    #d86aaf 100%
  );
  background-clip: text;
  font-size: var(--ktv-active-lyric-size);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.18;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 0.35px rgba(255, 255, 255, 0.14);
  filter: drop-shadow(0 10px 24px rgba(81, 58, 180, 0.2));
  animation: ktv-active-lyric 3.6s ease-in-out infinite;
}
.stage[data-lyric-state='before-first'] .active-line,
.stage[data-lyric-state='waiting'] .active-line,
.stage[data-lyric-state='after-final'] .active-line {
  color: var(--ktv-text-secondary);
  background: none;
  filter: none;
  -webkit-text-fill-color: currentColor;
  animation: none;
}
.stage[data-lyric-effect='neon'] .active-line {
  background: none;
  color: #f7d8ff;
  -webkit-text-fill-color: currentColor;
  -webkit-text-stroke: 0.5px rgba(255, 255, 255, 0.3);
  text-shadow: 0 0 8px rgba(237, 164, 255, 0.8),
    0 0 26px rgba(162, 103, 255, 0.72), 0 12px 34px rgba(75, 40, 151, 0.42);
  filter: none;
}
.stage[data-lyric-effect='outline'] .active-line {
  background: none;
  color: transparent;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 1.5px var(--ktv-accent-strong);
  text-shadow: 0 0 18px rgba(171, 156, 255, 0.46);
  filter: none;
}
.stage[data-lyric-effect='solid'] .active-line {
  background: none;
  color: var(--ktv-text-primary);
  -webkit-text-fill-color: currentColor;
  -webkit-text-stroke: 0;
  text-shadow: 0 12px 28px rgba(52, 37, 124, 0.2);
  filter: none;
}
.stage[data-lyric-state='before-first'][data-lyric-effect] .active-line,
.stage[data-lyric-state='waiting'][data-lyric-effect] .active-line,
.stage[data-lyric-state='after-final'][data-lyric-effect] .active-line {
  color: var(--ktv-text-secondary);
  background: none;
  -webkit-text-fill-color: currentColor;
  -webkit-text-stroke: 0;
  text-shadow: none;
  filter: none;
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
.karaoke-desktop:-webkit-full-screen {
  overflow: auto;
  padding: 24px;
  background: var(--ktv-bg-base);
}
.stage:fullscreen,
.stage:-webkit-full-screen,
.stage:-moz-full-screen,
.stage:-ms-fullscreen {
  display: grid;
  place-content: center;
  min-width: 100vw;
  min-height: 100vh;
  padding: 48px;
  background: var(--ktv-bg-base);
}
.stage:fullscreen .fullscreen-actions,
.stage:-webkit-full-screen .fullscreen-actions,
.stage:-moz-full-screen .fullscreen-actions,
.stage:-ms-fullscreen .fullscreen-actions,
.stage:fullscreen .stage-kicker,
.stage:-webkit-full-screen .stage-kicker,
.stage:-moz-full-screen .stage-kicker,
.stage:-ms-fullscreen .stage-kicker,
.stage:fullscreen .stage-footer {
  display: none;
}
.stage:-webkit-full-screen .stage-footer,
.stage:-moz-full-screen .stage-footer,
.stage:-ms-fullscreen .stage-footer {
  display: none;
}
.stage:fullscreen .active-line {
  font-size: clamp(48px, calc(var(--ktv-active-lyric-size) + 3vw), 132px);
}
.stage:-webkit-full-screen .active-line,
.stage:-moz-full-screen .active-line,
.stage:-ms-fullscreen .active-line {
  font-size: clamp(48px, calc(var(--ktv-active-lyric-size) + 3vw), 132px);
}
.stage:fullscreen .stage-lines {
  padding-bottom: 104px;
}
.stage:-webkit-full-screen .stage-lines,
.stage:-moz-full-screen .stage-lines,
.stage:-ms-fullscreen .stage-lines {
  padding-bottom: 104px;
}
.stage:fullscreen .before-line,
.stage:fullscreen .after-line {
  font-size: clamp(20px, calc(var(--ktv-active-lyric-size) * 0.52 + 1vw), 58px);
}
.stage:-webkit-full-screen .before-line,
.stage:-webkit-full-screen .after-line,
.stage:-moz-full-screen .before-line,
.stage:-moz-full-screen .after-line,
.stage:-ms-fullscreen .before-line,
.stage:-ms-fullscreen .after-line {
  font-size: clamp(20px, calc(var(--ktv-active-lyric-size) * 0.52 + 1vw), 58px);
}
.stage:fullscreen .after-second-line {
  font-size: clamp(
    16px,
    calc(var(--ktv-active-lyric-size) * 0.38 + 0.6vw),
    42px
  );
  opacity: 0.5;
}
.stage:-webkit-full-screen .after-second-line,
.stage:-moz-full-screen .after-second-line,
.stage:-ms-fullscreen .after-second-line {
  font-size: clamp(
    16px,
    calc(var(--ktv-active-lyric-size) * 0.38 + 0.6vw),
    42px
  );
  opacity: 0.5;
}
.stage:fullscreen .translation {
  font-size: clamp(
    14px,
    calc(var(--ktv-active-lyric-size) * 0.34 + 0.5vw),
    34px
  );
}
.stage:-webkit-full-screen .translation,
.stage:-moz-full-screen .translation,
.stage:-ms-fullscreen .translation {
  font-size: clamp(
    14px,
    calc(var(--ktv-active-lyric-size) * 0.34 + 0.5vw),
    34px
  );
}
.lyric-fullscreen-overlay {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 48px);
  padding: 8px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 16px;
  background: var(--ktv-glass-strong);
  box-shadow: 0 14px 36px rgba(18, 11, 55, 0.22);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}
.lyric-fullscreen-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}
.lyric-fullscreen-overlay button {
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 12px;
  background: var(--ktv-glass-strong);
  color: var(--ktv-text-primary);
  font-weight: 700;
}
.lyric-fullscreen-overlay button:focus-visible,
.fullscreen-volume input:focus-visible {
  outline: 2px solid var(--ktv-accent);
  outline-offset: 2px;
}
.fullscreen-volume {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 150px;
  padding: 0 5px;
  color: var(--ktv-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.fullscreen-volume input {
  width: 90px;
  accent-color: var(--ktv-accent);
  cursor: pointer;
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
.lyric-effect-setting {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.lyric-effect-setting select {
  min-height: 34px;
  padding: 0 8px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 9px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
  cursor: pointer;
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
.setting-input {
  width: 58px;
  min-height: 34px;
  padding: 0 7px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 9px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.offset-input {
  width: 58px;
}
.font-size-input {
  width: 58px;
}
.setting-unit {
  margin-left: -4px;
  color: var(--ktv-text-muted);
  font-size: 12px;
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
  .room-access {
    grid-template-columns: 1fr;
    align-items: flex-start;
    width: min(520px, calc(100% - 24px));
  }
  .room-qr-wrap {
    width: min(240px, 100%);
    justify-self: center;
  }
  .room-access-copy,
  .room-access-pending .room-access-copy {
    grid-column: 1;
    width: 100%;
  }
  .header-actions {
    width: 100%;
    flex-wrap: wrap;
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
  .lyric-fullscreen-overlay {
    right: 12px;
    bottom: 12px;
    left: 12px;
    max-width: none;
    flex-wrap: wrap;
    justify-content: center;
  }
  .fullscreen-volume {
    flex: 1 1 100%;
    justify-content: center;
  }
  .lyric-effect-setting {
    margin-left: 0;
  }
}
@media (min-width: 2560px) {
  .ambient {
    filter: blur(28px) saturate(1.1);
    opacity: 0.34;
  }
  .stage::before {
    filter: blur(26px);
    animation: none;
  }
  .active-line {
    animation: none;
  }
  .karaoke-desktop button {
    transition: background-color 160ms ease, border-color 160ms ease,
      color 160ms ease;
  }
}
@media (prefers-reduced-motion: reduce) {
  .karaoke-desktop *,
  .karaoke-desktop *::before,
  .karaoke-desktop *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
