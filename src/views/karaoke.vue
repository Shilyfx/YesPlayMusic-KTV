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
        <slot name="docker-controls" />
        <KaraokeThemeSwitcher v-model="karaokeTheme" />
        <button
          v-if="!isElectron"
          type="button"
          class="session-button"
          @click="enableBrowserAudio"
          >点击启用声音 / 播放</button
        >
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
          @click="toggleRoomCode"
          >{{ showRoomCode ? '收起二维码' : '显示二维码' }}</button
        >
        <button
          type="button"
          class="session-button"
          :aria-expanded="showLocalLibraryPanel"
          @click="toggleLocalLibrary"
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
      v-if="
        isSessionActive && (!lanRoom || showRoomCode) && !showLocalLibraryPanel
      "
      ref="roomAccessPanel"
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
      v-if="showLocalLibraryPanel"
      ref="localLibraryPanel"
      class="local-library local-library-overlay glass-panel"
    >
      <div class="local-library-heading">
        <div>
          <p class="eyebrow">LOCAL LIBRARY</p>
          <h2>本地歌单</h2>
          <p class="local-library-note">
            支持递归扫描音频目录；同名 .lrc 与封面图片会自动加载。
          </p>
        </div>
        <div class="local-library-actions">
          <button
            v-if="isElectron"
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
      <div v-if="!isElectron" class="local-directory-add">
        <input
          v-model="localDirectoryInput"
          type="text"
          class="setting-input local-directory-input"
          placeholder="输入服务器本地歌单目录，如 /music/周杰伦"
          @keydown.enter.prevent="addLocalDirectoryByPath"
        />
        <button
          type="button"
          class="room-tool"
          :disabled="localLoading || !localDirectoryInput.trim()"
          @click="addLocalDirectoryByPath"
        >
          添加目录
        </button>
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
            ? `已发现 ${localTrackCount} 首本地歌曲，可在下方直接点歌，也可在手机点歌页的“我的歌单 -> 本地歌单”中选择。`
            : '尚未配置本地音乐目录。'
        }}
      </p>
      <div v-if="localPlaylists.length" class="local-playlist-browser">
        <div
          v-for="playlist in localPlaylists"
          :key="playlist.id"
          class="local-playlist-section"
        >
          <div class="local-playlist-header">
            <strong>{{ playlist.name }}</strong>
            <span>{{ playlist.trackCount || playlist.tracks.length }} 首</span>
          </div>
          <div class="local-track-grid">
            <article
              v-for="item in playlist.tracks"
              :key="item.localId || item.id"
              class="local-track-item"
            >
              <img
                v-if="item.coverUrl"
                :src="item.coverUrl"
                :alt="item.name"
                class="local-track-cover"
                loading="lazy"
              />
              <div v-else class="local-track-cover local-track-cover-fallback">
                ♪
              </div>
              <div class="local-track-meta">
                <strong :title="item.name">{{ item.name }}</strong>
                <small>{{
                  (item.artists || []).map(a => a.name || a).join(' / ') ||
                  '未知歌手'
                }}</small>
              </div>
              <div class="local-track-buttons">
                <button
                  type="button"
                  class="room-tool"
                  @click="enqueueLocalTrack(item, false)"
                >
                  点歌
                </button>
                <button
                  type="button"
                  class="room-tool"
                  @click="enqueueLocalTrack(item, true)"
                >
                  优先
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
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
        :class="{ 'pv-stage': isPvStage }"
        :data-lyric-state="stageLyrics.state"
        :data-lyric-effect="lyricEffect"
        :data-stage-mode="lyricStageMode"
        aria-label="KTV 歌词舞台"
        @mousemove="showLyricControls"
        @touchstart="showLyricControls"
      >
        <p class="stage-kicker">LYRIC STAGE</p>
        <ReactionOverlay
          v-if="reactionFeatureEnabled && !isElectron && lanRoom"
          :events="reactionEvents"
          :generation="reactionGeneration"
          :server-time="reactionServerTime"
          storage-key="master"
          :theme="resolvedTheme"
          :playing="Boolean(currentItem && player.playing)"
          :has-track="!!currentItem"
          :music-reaction="musicReaction"
          @sensitivity-change="onMusicSensitivityChange"
        />
        <KaraokeLyricScene
          ref="lyricScene"
          :mode="lyricStageMode"
          :lines="stageLyrics"
          :cue-key="lyricRequestKey + ':' + activeLyricIndex"
          :playing="player.playing"
          :effect="lyricEffect"
          :fullscreen="isLyricFullscreen"
          :lyric-document="pvLyricDocument"
          :position="Math.max(0, now + lyricOffset)"
          :raw-position="Math.max(0, now)"
          :smart-beat-settings="smartBeatSettings"
          :smart-beat-track-key="smartBeatTrackKey"
          :smart-beat-timeline="smartBeatTimeline"
          :theme="resolvedTheme"
          :font-size="lyricFontSize"
          v-bind="sceneAppearanceProps"
        />
        <p v-if="stageLyrics.translation" class="translation">
          {{ stageLyrics.translation }}
        </p>
        <div class="stage-footer">
          <span>{{ lyricOffsetLabel }} · {{ lyricFontSize }}px</span>
        </div>
        <div v-if="!isLyricFullscreen" class="fullscreen-actions">
          <button type="button" @click="enterKtvFullscreen">全屏 KTV</button>
          <button type="button" @click="enterLyricFullscreen">歌词全屏</button>
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
          <SongRequestButton
            v-if="!isElectron && lanRoom"
            :url="lanRoom.joinUrl || lanRoom.url || ''"
            :qr-data-url="lanRoom.qrDataUrl || ''"
            placement="above"
          />
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
        <div v-if="isLyricFullscreen" class="lyric-fullscreen-control-dock">
          <KaraokeControlToggle
            ref="lyricControlToggle"
            :open="controlPanelOpen"
            @toggle="setControlPanelOpen"
          />
          <KaraokeControlPanel
            :open="controlPanelOpen"
            :config="controlPanelConfig"
            :mode-options="stageModeOptions"
            :background-options="controlPanelBackgroundOptions"
            :is-follower="false"
            :volume="player.volume"
            :track="track"
            :follows="controlPanelFollows"
            :capabilities="controlPanelCapabilities"
            :return-focus-to="getControlPanelToggle"
            @close="setControlPanelOpen(false)"
            @change="handleControlPanelChange"
            @asset="handleVisualAsset"
            @volume="setVolume"
          >
            <template #extra>
              <KaraokeSmartBeatControls
                :settings="smartBeatSettings"
                :renderer-mode="lyricStageMode"
                :status="smartBeatStatus"
                @change="onSmartBeatPreferencesChange"
              />
            </template>
          </KaraokeControlPanel>
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
          <span>使用上方按钮把当前播放歌曲加入本机待唱。</span>
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
      <div class="player-actions">
        <SongRequestButton
          v-if="isKtvFullscreen && !isElectron && lanRoom"
          :url="lanRoom.joinUrl || lanRoom.url || ''"
          :qr-data-url="lanRoom.qrDataUrl || ''"
          placement="above"
        />
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
      <KaraokeControlToggle
        v-if="!isLyricFullscreen"
        ref="karaokeControlToggle"
        class="karaoke-control-toggle--bar"
        :open="controlPanelOpen"
        @toggle="setControlPanelOpen"
      />
    </footer>

    <KaraokeControlPanel
      v-if="!isLyricFullscreen"
      class="karaoke-control-panel--bar"
      :open="controlPanelOpen"
      :config="controlPanelConfig"
      :mode-options="stageModeOptions"
      :background-options="controlPanelBackgroundOptions"
      :is-follower="false"
      :volume="player.volume"
      :track="track"
      :follows="controlPanelFollows"
      :capabilities="controlPanelCapabilities"
      :return-focus-to="getControlPanelToggle"
      @close="setControlPanelOpen(false)"
      @change="handleControlPanelChange"
      @asset="handleVisualAsset"
      @volume="setVolume"
    >
      <template #extra>
        <KaraokeSmartBeatControls
          :settings="smartBeatSettings"
          :renderer-mode="lyricStageMode"
          :status="smartBeatStatus"
          @change="onSmartBeatPreferencesChange"
        />
      </template>
    </KaraokeControlPanel>
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
import {
  normalizeStageMode,
  stageModeOptions,
  isPvStageMode,
  supportsAnimationIntensity,
} from '@/utils/lyricStageModes';
import KaraokeLyricScene from '@/components/karaoke/KaraokeLyricScene.vue';
import KaraokeThemeSwitcher from '@/components/karaoke/KaraokeThemeSwitcher.vue';
import KaraokeControlPanel from '@/components/karaoke/KaraokeControlPanel.vue';
import KaraokeControlToggle from '@/components/karaoke/KaraokeControlToggle.vue';
import KaraokeSmartBeatControls from '@/components/karaoke/KaraokeSmartBeatControls.vue';
import ReactionOverlay from '@/components/karaoke/ReactionOverlay.vue';
import SongRequestButton from '@/components/karaoke/SongRequestButton.vue';
import createWebRoomBridge from '@/karaoke/webRoomBridge';
import {
  buildLyricContext,
  sanitizeCoverReference,
} from '@/karaoke/lyricDisplay';
import {
  backgroundOptionsForMode,
  createVisualAssetUploadQueue,
  normalizeAppearanceConfig,
  normalizeAppearancePatch,
  normalizeAppearancePreferences,
  readMasterAppearancePreferences,
  writeMasterAppearancePreferences,
} from '@/karaoke/appearanceConfig';
import { sparseVisualTuning } from '@/karaoke/visualConfig';
import {
  chooseRandomStyle,
  resolveRandomStyleForTrack,
} from '@/karaoke/randomStylePool';
import { resolveVisualAssets } from '@/karaoke/visualAssets';
import { createPlayerMusicAnalyzer } from '@/karaoke/musicReactionAnalyzer';
import {
  normalizeSmartBeatPreferences,
  readSmartBeatPreferences,
  writeSmartBeatPreferences,
  getSmartBeatSourceRequirements,
} from '@/karaoke/smartBeatPreferences';
import { sanitizeSmartBeatTimeline } from '@/karaoke/smartBeatTimeline';
import { loadFoliaRuntime } from '@/karaoke/folia/loadRuntime';
import { memoizedPvDocument } from '@/karaoke/folia/timing';
import { executeKaraokeCommand } from '@/electron/ipcRenderer';
import { Howl, Howler } from 'howler';

function replaceAsciiControlCharacters(value) {
  let result = '';
  for (const character of value) {
    result += character.charCodeAt(0) <= 0x1f ? ' ' : character;
  }
  return result;
}

export default {
  name: 'Karaoke',
  components: {
    KaraokeThemeSwitcher,
    KaraokeControlPanel,
    KaraokeControlToggle,
    KaraokeSmartBeatControls,
    KaraokeLyricScene,
    ReactionOverlay,
    SongRequestButton,
  },
  props: { webHostName: { type: String, default: '主电脑' } },
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
      webRoomBridge: null,
      lanCandidates: [],
      showRoomCode: false,
      selectedLanAddress: '',
      lanSelfTest: 'idle',
      copyLinkState: 'idle',
      copyLinkTimer: null,
      lyricFontSizeDraft: '45',
      lyricOffsetDraft: '0.0',
      appearancePreferences: readMasterAppearancePreferences(undefined, {
        onTrim: () =>
          this.$store.dispatch(
            'showToast',
            '配置达到 16 KiB，已精简可选参数或未选中的背景地址；当前样式与素材已保留'
          ),
        onInvalid: error => this.$store.dispatch('showToast', error.message),
      }),
      isElectron: process.env.IS_ELECTRON === true,
      isWindowMaximized: false,
      windowStateListener: null,
      isKtvFullscreen: false,
      isLyricFullscreen: false,
      controlPanelOpen: false,
      controlPanelFollows: {},
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
      localDirectoryInput: '',
      reactionEvents: [],
      reactionFeatureEnabled: process.env.VUE_APP_DOCKER_KTV === 'true',
      reactionGeneration: '',
      reactionServerTime: 0,
      musicReaction: null,
      smartBeatSettings: readSmartBeatPreferences(),
      smartBeatStatus: { state: 'idle', detail: '' },
      smartBeatTimeline: null,
      smartBeatAnalysisRevision: 0,
    };
  },
  computed: {
    isPvStage() {
      return isPvStageMode(this.lyricStageMode);
    },
    pvLyricDocument() {
      const itemId =
        this.currentItem?.queueItemId ||
        (this.trackId ? `player:${this.trackId}` : '');
      if (!itemId || this.lyricRequestKeyValue !== this.lyricRequestKey)
        return null;
      const lines = this.lyrics;
      const duration = Math.max(
        Number(this.track.dt || 0) / 1000,
        (lines[lines.length - 1]?.time || 0) + 5
      );
      return memoizedPvDocument(itemId, duration, lines);
    },
    stageModeOptions() {
      return stageModeOptions;
    },
    appearanceConfig() {
      return normalizeAppearanceConfig({
        mode: this.lyricStageMode,
        effect: this.lyricEffect,
        fontSize: this.lyricFontSize,
        offset: this.lyricOffset,
        theme: this.karaokeTheme,
        ...this.appearancePreferences,
      });
    },
    controlPanelConfig() {
      return { ...this.appearanceConfig, resolvedTheme: this.resolvedTheme };
    },
    controlPanelBackgroundOptions() {
      return backgroundOptionsForMode(this.lyricStageMode);
    },
    sceneAppearanceProps() {
      return {
        background: this.appearanceConfig.background,
        animationIntensity: this.appearanceConfig.animationIntensity,
        tuningByMode: this.appearanceConfig.tuningByMode,
        coverUrl: this.cover,
        assets: resolveVisualAssets(this.appearanceConfig),
      };
    },
    controlPanelCapabilities() {
      return {
        fontSize: this.lyricStageMode !== 'hanabi',
        effect: !this.isPvStage,
        intensity: supportsAnimationIntensity(this.lyricStageMode),
      };
    },
    lyricStageMode: {
      get() {
        return normalizeStageMode(this.settings.karaokeLyricStageMode);
      },
      set(value) {
        this.$store.commit('updateSettings', {
          key: 'karaokeLyricStageMode',
          value: normalizeStageMode(value),
        });
      },
    },
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
      return this.lanRoom?.name || 'LumaSing KTV';
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
    randomTrackKey() {
      if (this.currentItem && this.currentItem.queueItemId)
        return `queue:${this.currentItem.queueItemId}`;
      return this.trackId ? `track:${this.trackId}` : '';
    },
    smartBeatTrackKey() {
      if (this.currentItem?.queueItemId)
        return `${this.currentItem.queueItemId}:${this.trackId || ''}`.slice(
          0,
          320
        );
      return this.trackId ? `player:${this.trackId}`.slice(0, 320) : '';
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
      const colors = this.appearanceConfig.customTheme || {};
      const style = { '--ktv-active-lyric-size': `${this.lyricFontSize}px` };
      if (colors.background) style['--ktv-bg-base'] = colors.background;
      if (colors.text) style['--ktv-text-primary'] = colors.text;
      if (colors.accent) style['--ktv-accent'] = colors.accent;
      if (colors.accentStrong)
        style['--ktv-accent-strong'] = colors.accentStrong;
      return style;
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
    controlPanelOpen() {
      if (this.isLyricFullscreen) this.showLyricControls();
    },
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
    randomTrackKey(value, previous) {
      if (value && value !== previous)
        this.resolveRandomStyleForCurrentTrack(value);
      this.updateSmartBeatTrack();
    },
    smartBeatSettings: {
      deep: true,
      handler() {
        writeSmartBeatPreferences(this.smartBeatSettings);
        this.updateSmartBeatRuntime();
        this.syncSmartBeatAnalyzer();
      },
    },
    lyricStageMode() {
      this.updateSmartBeatRuntime();
      this.syncSmartBeatAnalyzer();
    },
  },
  created() {
    if (!this.isElectron) {
      this.webRoomBridge = createWebRoomBridge({
        manager: this.karaokeManager,
        execute: command => executeKaraokeCommand(command, this.$store),
        hostName: this.webHostName,
        getPresentation: () => this.getWebPresentation(),
        getPvLyrics: () => this.pvLyricDocument,
        getAppearance: () => this.getWebAppearance(),
        getSmartBeatState: () => ({
          revision: this.smartBeatAnalysisRevision,
          timeline: this.smartBeatTimeline,
        }),
        onReactions: (events, generation, serverTime) => {
          this.reactionEvents = events;
          this.reactionGeneration = generation || '';
          this.reactionServerTime = serverTime || 0;
        },
        onError: error => {
          this.visualAssetUploads?.invalidate();
          this.lanRoom = null;
          this.$store.dispatch('showToast', error.message);
          this.$emit('web-room-lost');
        },
      });
      this.webRoomPageHide = () => {
        this.visualAssetUploads?.invalidate();
        this.webRoomBridge.dispose();
      };
      window.addEventListener('pagehide', this.webRoomPageHide);
      if (this.reactionFeatureEnabled) this.ensureMusicAnalyzer();
    }
    this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    this.syncSystemTheme();
    if (this.themeMedia.addEventListener)
      this.themeMedia.addEventListener('change', this.syncSystemTheme);
    else this.themeMedia.addListener(this.syncSystemTheme);
    this.loadLyrics();
    this.loadLanRoom();
    if (!this.isSessionActive) this.startDefaultSession();
    this.loadLocalLibrarySummary();
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
    this.resolveRandomStyleForCurrentTrack();
    this._smartBeatTimelineTrackKey = this.smartBeatTrackKey;
    this.syncSmartBeatAnalyzer();
    this.startLyricClock();
    this.lyricVisibilityListener = () => {
      if (document.hidden) {
        window.clearInterval(this.clock);
        this.musicAnalyzer?.tick();
        this.musicAnalyzer?.stop();
      } else {
        this.startLyricClock();
        this.musicAnalyzer?.start();
      }
    };
    document.addEventListener('visibilitychange', this.lyricVisibilityListener);
    document.addEventListener('click', this.handleOverlayOutsideClick);
  },
  beforeDestroy() {
    this.visualAssetUploads?.dispose();
    if (this.unsubscribeMusicEnded) this.unsubscribeMusicEnded();
    if (this.musicAnalyzer) this.musicAnalyzer.dispose();
    this._smartBeatSetupGeneration = (this._smartBeatSetupGeneration || 0) + 1;
    this._smartBeatAnalyzer?.dispose?.();
    if (this.webRoomBridge) this.webRoomBridge.dispose();
    if (this.browserUnlockSound) this.browserUnlockSound.unload();
    if (this.webRoomPageHide)
      window.removeEventListener('pagehide', this.webRoomPageHide);
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
    document.removeEventListener('click', this.handleOverlayOutsideClick);
  },
  methods: {
    setControlPanelOpen(isOpen) {
      this.controlPanelOpen = Boolean(isOpen);
    },
    getControlPanelToggle() {
      const toggle = this.isLyricFullscreen
        ? this.$refs.lyricControlToggle
        : this.$refs.karaokeControlToggle;
      return toggle || null;
    },
    handleControlPanelChange(change) {
      if (!change) return;
      const { key, value } = change;
      switch (key) {
        case 'mode':
          this.lyricStageMode = value;
          if (this.appearanceConfig.random.enabled && this.randomTrackKey) {
            this.updateAppearance({
              random: {
                ...this.appearanceConfig.random,
                lastTrackKey: this.randomTrackKey,
              },
            });
          }
          break;
        case 'effect':
          this.lyricEffect = value;
          break;
        case 'fontSize':
          this.lyricFontSizeDraft = String(value);
          this.commitFontSizeDraft();
          break;
        case 'offset':
          this.setOffset(value);
          break;
        case 'theme':
          this.karaokeTheme = value;
          break;
        case 'customTheme':
          this.updateAppearance({ customTheme: value });
          break;
        case 'animationIntensity':
          this.updateAppearance({ animationIntensity: value });
          break;
        case 'random':
          this.updateAppearance({ random: value });
          if (value && value.enabled) this.resolveRandomStyleForCurrentTrack();
          break;
        case 'random.reroll':
          this.rerollCurrentRandomStyle();
          break;
        case 'background.mode':
          this.updateAppearance({ background: { mode: value } });
          break;
        case 'background.transparent':
        case 'background.opacity':
          this.updateAppearance({
            background: { [key.slice('background.'.length)]: value },
          });
          break;
        case 'background.tuning': {
          const sparse = sparseVisualTuning(
            'background',
            this.appearanceConfig.background.mode,
            value
          );
          this.updateAppearance({ background: { tuning: sparse } });
          break;
        }
        case 'background.reset':
          this.updateAppearance({
            background: {
              tuning: {},
              assetId: null,
              transparent: false,
              opacity: 1,
            },
          });
          break;
        case 'tuning':
          this.saveModeTuning(this.lyricStageMode, value);
          break;
        case 'tuning.reset':
          this.resetModeTuning(value || this.lyricStageMode);
          break;
        default:
          break;
      }
    },
    updateAppearance(patch) {
      try {
        let trimmed = false;
        const next = normalizeAppearancePatch(this.appearanceConfig, patch, {
          onTrim: () => {
            trimmed = true;
          },
        });
        if (next.background.mode !== this.appearanceConfig.background.mode)
          this.visualAssetUploads?.invalidate();
        this.visualAssetUploads?.assertFits(next);
        const preferences = normalizeAppearancePreferences(next);
        if (!writeMasterAppearancePreferences(preferences))
          throw new Error('外观设置保存失败');
        this.appearancePreferences = preferences;
        if (trimmed)
          this.$store.dispatch(
            'showToast',
            '配置达到 16 KiB，已精简可选参数或未选中的背景地址；当前样式与素材已保留'
          );
        return true;
      } catch (error) {
        this.$store.dispatch('showToast', error.message);
        return false;
      }
    },
    saveModeTuning(mode, fullTuning) {
      const tuningByMode = { ...this.appearanceConfig.tuningByMode };
      const sparse = sparseVisualTuning('mode', mode, fullTuning);
      if (Object.keys(sparse).length) tuningByMode[mode] = sparse;
      else delete tuningByMode[mode];
      this.updateAppearance({ tuningByMode });
    },
    resetModeTuning(mode) {
      const tuningByMode = { ...this.appearanceConfig.tuningByMode };
      delete tuningByMode[mode];
      this.updateAppearance({ tuningByMode });
    },
    resolveRandomStyleForCurrentTrack(trackKey = this.randomTrackKey) {
      const result = resolveRandomStyleForTrack(
        this.appearanceConfig.random,
        trackKey,
        this.lyricStageMode
      );
      if (!result.changed) return false;
      if (result.mode !== this.lyricStageMode)
        this.lyricStageMode = result.mode;
      this.updateAppearance({ random: result.settings });
      return true;
    },
    rerollCurrentRandomStyle() {
      const random = this.appearanceConfig.random;
      const mode = chooseRandomStyle(random.pool, this.lyricStageMode);
      if (!mode) return;
      this.lyricStageMode = mode;
      this.updateAppearance({
        random: { ...random, lastTrackKey: this.randomTrackKey },
      });
    },
    handleVisualAsset(change) {
      if (!change || !this.webRoomBridge?.uploadVisualAsset) {
        this.$store.dispatch('showToast', '图片上传服务暂不可用');
        return Promise.resolve([]);
      }
      if (!this.visualAssetUploads) {
        this.visualAssetUploads = createVisualAssetUploadQueue({
          getConfig: () => this.appearanceConfig,
          getGeneration: () =>
            this._isBeingDestroyed || this._isDestroyed
              ? null
              : this.lanRoom || null,
          upload: (file, role) =>
            this.webRoomBridge.uploadVisualAsset(file, role),
          commit: next => this.updateAppearance(next),
          notify: message => this.$store.dispatch('showToast', message),
        });
      }
      return this.visualAssetUploads.run(change);
    },
    ensureMusicAnalyzer() {
      if (this.musicAnalyzer) return this.musicAnalyzer;
      this.musicAnalyzer = createPlayerMusicAnalyzer({
        getPlayer: () => this.player,
        getCurrentItem: () => this.currentItem,
        getLyrics: () => this.lyrics,
        getOutputDevice: () => this.settings?.outputDevice || '',
        onUpdate: state => {
          if (this.reactionFeatureEnabled) this.musicReaction = state;
          this.updateSmartBeatTrack();
        },
        onAudioFeatures: features => {
          this._smartBeatAudioFeatures = features;
          this.$refs.lyricScene?.publishAudioFeatures?.(features);
        },
      });
      this.unsubscribeMusicEnded = this.player?.onPlaybackEnded?.(() => {
        if (this.currentItem) {
          this.musicAnalyzer?.markFinished({
            itemId: this.currentItem.queueItemId || '',
            trackId: this.trackId || '',
          });
        }
      });
      if (
        !document.hidden &&
        (this.reactionFeatureEnabled || this.smartBeatSettings.mode !== 'off')
      )
        this.musicAnalyzer.start();
      return this.musicAnalyzer;
    },
    smartBeatSourceUrl() {
      const player = this.player;
      const howl = player?._howler;
      const sound = howl?._sounds?.[0];
      const node = sound?._node;
      const source = Array.isArray(howl?._src) ? howl._src[0] : howl?._src;
      return (
        (typeof node?.currentSrc === 'string' && node.currentSrc) ||
        (typeof node?.src === 'string' && node.src) ||
        (typeof source === 'string' && source) ||
        null
      );
    },
    updateSmartBeatTrack() {
      const trackKey = this.smartBeatTrackKey;
      if (trackKey !== this._smartBeatTimelineTrackKey) {
        this._smartBeatTimelineTrackKey = trackKey;
        this.smartBeatTimeline = null;
        this.smartBeatAnalysisRevision += 1;
        this._smartBeatRequestSignature = '';
        this.updateSmartBeatRuntime();
      }
      const analyzer = this._smartBeatAnalyzer;
      if (!trackKey) {
        analyzer?.updateTrack({
          key: '',
          cacheKey: '',
          sourceUrl: null,
          duration: 0,
          playing: false,
        });
        this._smartBeatTrackSignature = '';
        const sources = getSmartBeatSourceRequirements(
          this.smartBeatSettings,
          this.lyricStageMode
        );
        if (
          this.smartBeatSettings.mode !== 'off' &&
          (sources.beats || sources.drums)
        ) {
          this.smartBeatStatus = {
            state: 'waiting',
            detail: '等待正在播放的歌曲。',
          };
        }
        return;
      }
      if (!analyzer) return;
      const sourceUrl = this.smartBeatSourceUrl();
      const trackId = String(this.trackId || this.currentItem?.localId || '');
      const cacheKey = `ktv:${trackId}:${Math.max(
        0,
        Number(this.track.dt || 0)
      )}`.slice(0, 320);
      const duration = Math.max(
        0,
        Number(this.track.dt || this.currentItem?.duration || 0) / 1000
      );
      const playing = Boolean(this.currentItem && this.player.playing);
      const track = { key: trackKey, cacheKey, sourceUrl, duration, playing };
      const signature = JSON.stringify(track);
      if (
        signature === this._smartBeatTrackSignature &&
        !this._smartBeatForceTrackUpdate
      )
        return;
      this._smartBeatForceTrackUpdate = false;
      this._smartBeatTrackSignature = signature;
      analyzer.updateTrack(track);
      if (this.smartBeatSettings.mode === 'off') return;
      const sources = getSmartBeatSourceRequirements(
        this.smartBeatSettings,
        this.lyricStageMode
      );
      if (!sources.beats && !sources.drums) return;
      const currentTimeline = this.smartBeatTimeline;
      if (
        currentTimeline?.trackKey === trackKey &&
        (!sources.beats || currentTimeline.beats) &&
        (!sources.drums || currentTimeline.drums)
      )
        return;
      // The controller can use its verified cache without a source URL. For a new
      // analysis, wait until Howler exposes the actual playing source.
      if (!sourceUrl && this.smartBeatSettings.mode !== 'cached') {
        this.setSmartBeatStatus({
          stage: 'unsupported',
          trackKey,
          message: '播放器暂未提供可读取的歌曲音频地址。',
        });
        return;
      }
      this.requestSmartBeatSources(analyzer, sources, trackKey);
    },
    async requestSmartBeatSources(analyzer, sources, trackKey) {
      const requestSignature = JSON.stringify([
        trackKey,
        this.smartBeatSettings.mode,
        this.lyricStageMode,
        sources,
        this.smartBeatSourceUrl(),
      ]);
      if (requestSignature === this._smartBeatRequestSignature) return;
      this._smartBeatRequestSignature = requestSignature;
      try {
        await analyzer.ensureSources(sources);
      } catch (error) {
        this.setSmartBeatStatus({
          stage: 'error',
          trackKey,
          message: error?.message || String(error),
        });
      }
    },
    setSmartBeatStatus(status) {
      if (status?.trackKey && status.trackKey !== this.smartBeatTrackKey)
        return;
      const stage = status?.stage === 'analysing' ? 'analysing' : status?.stage;
      const rawMessage = String(status?.message || status?.error || '');
      const knownMessages = {
        'WebGPU requires a secure context':
          '需要 HTTPS 或 localhost 安全上下文。',
        'WebGPU is unavailable in this browser': '此浏览器未提供 WebGPU。',
        'Dedicated workers are unavailable': '此浏览器不支持专用 Worker。',
        'No readable source URL is available for this track.':
          '播放器暂未提供可读取的歌曲音频地址。',
        'No complete cached analysis exists for the requested sources.':
          '本机没有满足当前效果所需的完整缓存。',
      };
      const message = replaceAsciiControlCharacters(
        String(knownMessages[rawMessage] || rawMessage)
      ).slice(0, 180);
      this.smartBeatStatus = {
        state: stage || 'error',
        detail: message,
        ...(Number.isFinite(status?.progress)
          ? { progress: Math.max(0, Math.min(1, status.progress)) }
          : {}),
        ...(typeof status?.cacheHit === 'boolean'
          ? { cacheHit: status.cacheHit }
          : {}),
      };
    },
    onSmartBeatPreferencesChange(preferences) {
      this.smartBeatSettings = normalizeSmartBeatPreferences(preferences);
    },
    updateSmartBeatRuntime() {
      this.$nextTick(() => {
        this.$refs.lyricScene?.updateSmartBeat?.({
          mode: this.lyricStageMode,
          trackKey: this.smartBeatTrackKey,
          settings: this.smartBeatSettings,
          timeline: this.smartBeatTimeline,
          playing: Boolean(this.currentItem && this.player.playing),
        });
      });
    },
    async syncSmartBeatAnalyzer() {
      const preferences = normalizeSmartBeatPreferences(this.smartBeatSettings);
      this._smartBeatRequestSignature = '';
      if (preferences.mode === 'off') {
        this._smartBeatAnalyzer?.setMode('off');
        this.smartBeatStatus = { state: 'idle', detail: '' };
        this.updateSmartBeatRuntime();
        return;
      }
      const sources = getSmartBeatSourceRequirements(
        preferences,
        this.lyricStageMode
      );
      if (!sources.beats && !sources.drums) {
        this._smartBeatAnalyzer?.setMode('off');
        this.smartBeatStatus = {
          state: 'idle',
          detail: '当前歌词样式没有可用的节拍效果。',
        };
        return;
      }
      const trackKey = this.smartBeatTrackKey;
      if (!trackKey) {
        this.smartBeatStatus = {
          state: 'waiting',
          detail: '等待正在播放的歌曲。',
        };
        return;
      }
      this.ensureMusicAnalyzer();
      if (!document.hidden) this.musicAnalyzer?.start();
      try {
        if (!this._smartBeatAnalyzer) {
          if (!this._smartBeatAnalyzerPromise) {
            this._smartBeatAnalyzerPromise = loadFoliaRuntime()
              .then(async module => {
                if (typeof module.createSmartBeatAnalyzer !== 'function')
                  throw new Error('SMART_BEAT_FACTORY_UNAVAILABLE');
                const analyzer = await module.createSmartBeatAnalyzer({
                  onStatus: status => this.setSmartBeatStatus(status),
                  onResult: result => {
                    let timeline;
                    try {
                      timeline = sanitizeSmartBeatTimeline(result);
                    } catch (error) {
                      this.setSmartBeatStatus({
                        stage: 'error',
                        trackKey: this.smartBeatTrackKey,
                        message: error.message,
                      });
                      return;
                    }
                    if (timeline.trackKey !== this.smartBeatTrackKey) return;
                    const previous = this.smartBeatTimeline;
                    const compatible =
                      previous?.trackKey === timeline.trackKey &&
                      previous.audioHash === timeline.audioHash &&
                      JSON.stringify(previous.modelVersions) ===
                        JSON.stringify(timeline.modelVersions);
                    this.smartBeatTimeline = Object.freeze(
                      compatible
                        ? sanitizeSmartBeatTimeline({
                            ...timeline,
                            beats: timeline.beats || previous.beats,
                            drums: timeline.drums || previous.drums,
                          })
                        : timeline
                    );
                    this.smartBeatAnalysisRevision += 1;
                    this.smartBeatStatus = {
                      state:
                        this.smartBeatSettings.mode === 'cached'
                          ? 'cached'
                          : 'ready',
                      detail:
                        this.smartBeatSettings.mode === 'cached'
                          ? '已载入本机验证过的分析缓存。'
                          : '分析完成。',
                      cacheHit: this.smartBeatSettings.mode === 'cached',
                    };
                    this.updateSmartBeatRuntime();
                  },
                });
                if (this._isBeingDestroyed || this._isDestroyed) {
                  analyzer?.dispose?.();
                  return null;
                }
                this._smartBeatAnalyzer = analyzer;
                return analyzer;
              })
              .catch(error => {
                const reason = String(error?.message || error);
                const detail = reason.includes('ANALYSIS_WORKER_UNAVAILABLE')
                  ? '当前 PV 清单没有提供 SmartBeat 分析 Worker。'
                  : reason.includes('SMART_BEAT_FACTORY_UNAVAILABLE')
                  ? '当前 PV 模块没有提供 SmartBeat 分析器。'
                  : reason.includes('WebGPU') ||
                    reason.includes('secure context')
                  ? reason
                  : `SmartBeat 暂不可用：${reason}`;
                this.setSmartBeatStatus({
                  stage: 'unsupported',
                  trackKey,
                  message: detail,
                });
                this._smartBeatAnalyzerPromise = null;
                return null;
              });
          }
          await this._smartBeatAnalyzerPromise;
        }
        const analyzer = this._smartBeatAnalyzer;
        if (!analyzer) return;
        analyzer.setMode(preferences.mode);
        this._smartBeatRequestSignature = '';
        this._smartBeatForceTrackUpdate = true;
        this.updateSmartBeatTrack();
        // updateSmartBeatTrack owns the single source request for this track.
      } catch (error) {
        this.setSmartBeatStatus({
          stage: 'unsupported',
          trackKey,
          message: error?.message || String(error),
        });
      }
    },
    onMusicSensitivityChange(value) {
      this.musicAnalyzer?.setSensitivity(value);
    },
    getWebPresentation() {
      if (document.hidden && this.musicAnalyzer) {
        this.musicAnalyzer.tick();
      }
      const item = this.currentItem;
      const position = item
        ? Math.max(0, Number(this.player.seek(null, false)) || 0)
        : 0;
      return {
        itemId: item?.queueItemId || '',
        title: item?.trackName || '',
        artists: item?.artists?.join(' / ') || '',
        coverUrl: sanitizeCoverReference(this.cover),
        position,
        playing: Boolean(item && this.player.playing),
        offset: this.lyricOffset,
        smartBeat: {
          settings: this.smartBeatSettings,
          status: this.smartBeatStatus.state,
          detail: this.smartBeatStatus.detail,
          ...(Number.isFinite(this.smartBeatStatus.progress)
            ? { progress: this.smartBeatStatus.progress }
            : {}),
          ...(typeof this.smartBeatStatus.cacheHit === 'boolean'
            ? { cacheHit: this.smartBeatStatus.cacheHit }
            : {}),
          trackKey: this.smartBeatTrackKey,
          analysisRevision: this.smartBeatAnalysisRevision,
        },
        audioFeatures: this._smartBeatAudioFeatures,
        mode: this.lyricStageMode,
        effect: this.lyricEffect,
        theme: this.resolvedTheme,
        fontSize: this.lyricFontSize,
        ...(this.musicReaction ? { musicReaction: this.musicReaction } : {}),
        ...(item
          ? buildLyricContext(this.lyrics, position, this.lyricOffset)
          : { lines: [], contextFrom: 0, contextUntil: null }),
      };
    },
    getWebAppearance() {
      return this.appearanceConfig;
    },
    enableBrowserAudio() {
      Howler.mute(false);
      if (Howler.ctx && Howler.ctx.state === 'suspended') Howler.ctx.resume();
      // Request browser audio unlock with a silent sound in the user's gesture.
      if (!this.browserUnlockSound) {
        this.browserUnlockSound = new Howl({
          src: [
            'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA',
          ],
          format: ['wav'],
          html5: true,
          volume: 0,
          onend: () => {
            this.browserUnlockSound?.unload();
            this.browserUnlockSound = null;
          },
        });
      }
      this.browserUnlockSound.play();
      if (this.currentItem) this.player.play();
      this.$store.dispatch(
        'showToast',
        '请保持此 KTV 页面打开；若无声音，请再点击播放'
      );
    },
    roomIpc() {
      return this.electronIpc() || this.webRoomBridge;
    },
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
      this.lyrics = [];
      if (!this.trackId) {
        this.lyrics = [];
        return;
      }
      if (
        this.currentItem?.source === 'local' ||
        this.track.source === 'local'
      ) {
        const inlineLyrics = this.currentItem?.lyrics;
        if (Array.isArray(inlineLyrics) && inlineLyrics.length) {
          this.lyrics = inlineLyrics.filter(line => line.content);
          this.syncLyricCursor(this.now + this.lyricOffset, true);
          return;
        }
        const localId =
          this.currentItem?.localId ||
          this.currentItem?.trackId ||
          this.trackId;
        const ipcRenderer = this.roomIpc();
        if (ipcRenderer && localId) {
          ipcRenderer
            .invoke('karaoke:local:resolve', localId)
            .then(resolved => {
              if (
                generation !== this.lyricLoadGeneration ||
                requestedKey !== this.lyricRequestKey ||
                requestedTrackId !== this.trackId
              )
                return;
              const resolvedLyrics = Array.isArray(resolved?.lyrics)
                ? resolved.lyrics
                : [];
              this.lyrics = resolvedLyrics.filter(line => line.content);
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
          return;
        }
        this.lyrics = [];
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
      this.$emit('web-host-ended');
      this.showRoomCode = false;
      this.showLocalLibraryPanel = false;
      this.$store.dispatch('showToast', '本机 KTV 已结束，临时队列已清空');
    },
    electronIpc() {
      if (!process.env.IS_ELECTRON || !window.require) return null;
      return window.require('electron').ipcRenderer;
    },
    toggleRoomCode() {
      const nextVisible = !this.showRoomCode;
      this.showRoomCode = nextVisible;
      // Both controls share one floating panel slot; opening one always
      // closes the other, including when an async LAN status update is pending.
      this.showLocalLibraryPanel = false;
    },
    toggleLocalLibrary() {
      const nextVisible = !this.showLocalLibraryPanel;
      this.showLocalLibraryPanel = nextVisible;
      this.showRoomCode = false;
      if (nextVisible) this.loadLocalLibrarySummary();
    },
    handleOverlayOutsideClick(event) {
      if (!this.showRoomCode && !this.showLocalLibraryPanel) return;
      const target = event.target;
      const roomPanel = this.$refs.roomAccessPanel;
      const localPanel = this.$refs.localLibraryPanel;
      if (roomPanel?.contains(target) || localPanel?.contains(target)) return;
      // The matching header toggle already handles its own close/open state.
      // Ignore its bubbling document click so opening a panel is not undone.
      if (target.closest?.('.header-actions .session-button')) return;
      this.showRoomCode = false;
      this.showLocalLibraryPanel = false;
    },
    async loadLanRoom() {
      const ipcRenderer = this.roomIpc();
      if (!ipcRenderer) return;
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:status');
        this.lanRoom = result.room;
        this.showRoomCode = Boolean(result.room) && !this.showLocalLibraryPanel;
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
      const ipcRenderer = this.roomIpc();
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
      const ipcRenderer = this.roomIpc();
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
    async addLocalDirectoryByPath() {
      const directory = this.localDirectoryInput.trim();
      const ipcRenderer = this.roomIpc();
      if (!directory || !ipcRenderer) return;
      this.localLoading = true;
      this.localError = '';
      try {
        const result = await ipcRenderer.invoke(
          'karaoke:local:add-directory',
          directory
        );
        this.localDirectoryInput = '';
        this.applyLocalLibraryResult(result);
      } catch (error) {
        this.localError = error.message || '添加本地音乐目录失败';
      } finally {
        this.localLoading = false;
      }
    },
    async removeLocalDirectory(directory) {
      const ipcRenderer = this.roomIpc();
      if (!ipcRenderer) return;
      this.localLoading = true;
      this.localError = '';
      try {
        const result = await ipcRenderer.invoke(
          'karaoke:local:remove-directory',
          directory
        );
        if (result?.playlists) {
          this.applyLocalLibraryResult(result);
        } else {
          await this.scanLocalLibrary();
        }
      } catch (error) {
        this.localError = error.message || '移除本地音乐目录失败';
      } finally {
        this.localLoading = false;
      }
    },
    enqueueLocalTrack(track, priority = false) {
      if (!this.isSessionActive) {
        this.karaokeManager.startSession();
      }
      if (!this.isElectron) {
        this.enableBrowserAudio();
      }
      const normalizedTrack = {
        id: track.trackId || track.localId || track.id,
        localId: track.localId || track.trackId || track.id,
        name: track.name,
        ar: (track.ar || track.artists || []).map(a => ({
          name: a.name || a,
        })),
        al: {
          name: track.al?.name || track.album?.name || track.album || '',
          picUrl:
            track.coverUrl || track.al?.picUrl || track.album?.picUrl || '',
        },
        coverUrl:
          track.coverUrl || track.al?.picUrl || track.album?.picUrl || '',
        dt: track.dt || track.duration || 0,
        source: 'local',
        lyrics: Array.isArray(track.lyrics) ? track.lyrics : [],
      };
      const item = this.karaokeManager.enqueueTrack(normalizedTrack, {
        id: 'host',
        name: '主机',
        type: 'host',
        priorityRequested: Boolean(priority),
      });
      if (item) {
        if (priority) {
          this.karaokeManager.moveQueueItemToFront(item.queueItemId);
        }
        if (
          !this.karaokeManager.queue.currentItem &&
          !this.karaokeManager.transitionPromise
        ) {
          this.karaokeManager.startQueue();
        }
        this.$store.dispatch(
          'showToast',
          priority
            ? `已优先加入待唱：${item.trackName}`
            : `已加入待唱：${item.trackName}`
        );
      }
    },
    async loadLanCandidates() {
      const ipcRenderer = this.roomIpc();
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
      if (!active) {
        this.lanRoom = null;
        this.lanSelfTest = 'idle';
      }
      const ipcRenderer = this.roomIpc();
      if (ipcRenderer)
        await ipcRenderer.invoke('karaoke:lan:set-session-active', active);
    },
    async startLanRoom() {
      const ipcRenderer = this.roomIpc();
      if (!ipcRenderer) return;
      if (!this.isElectron) this.enableBrowserAudio();
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
          this.showLocalLibraryPanel = false;
          this.selfTestLan();
          return result;
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
      const ipcRenderer = this.roomIpc();
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
      const ipcRenderer = this.roomIpc();
      if (!ipcRenderer || !this.lanRoom) return;
      try {
        const result = await ipcRenderer.invoke('karaoke:lan:refresh-qr');
        if (result.ok) this.lanRoom = result.room;
      } catch (error) {
        console.warn('[karaoke] QR retry failed', error);
      }
    },
    async selfTestLan() {
      const ipcRenderer = this.roomIpc();
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
        if (!this.controlPanelOpen) this.lyricControlsVisible = false;
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
/* Scale the panel and its QR code, typography and controls together. */
.karaoke-desktop .room-access-overlay {
  transform-origin: top center;
}
@media (min-width: 761px) {
  .karaoke-desktop .room-access-overlay,
  .karaoke-desktop .local-library-overlay {
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
  .karaoke-desktop .local-library-overlay {
    width: min(720px, calc(100% - 32px));
    padding: 12px;
  }
  .karaoke-desktop .room-access-overlay {
    transform: translateX(-50%) scale(0.8);
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
.local-directory-add {
  display: flex;
  align-items: center;
  gap: 8px;
}
.local-directory-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 7px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font-size: 12px;
}
.local-playlist-browser {
  display: grid;
  gap: 12px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}
.local-playlist-section {
  display: grid;
  gap: 8px;
}
.local-playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ktv-text-secondary);
  font-size: 13px;
}
.local-track-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.local-track-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
}
.local-track-cover {
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--ktv-glass-strong);
}
.local-track-cover-fallback {
  display: grid;
  place-items: center;
  color: var(--ktv-text-muted);
  font-size: 18px;
}
.local-track-meta {
  flex: 1 1 auto;
  min-width: 0;
}
.local-track-meta strong,
.local-track-meta small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local-track-meta strong {
  color: var(--ktv-text-primary);
  font-size: 13px;
}
.local-track-meta small {
  margin-top: 2px;
  color: var(--ktv-text-muted);
  font-size: 11px;
}
.local-track-buttons {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
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
  grid-template-columns: minmax(0, 1fr) minmax(210px, 0.22fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 18px;
  min-height: 480px;
}
.karaoke-layout > .stage {
  grid-column: 1;
  grid-row: 1 / 3;
}
.karaoke-layout > .track-identity {
  grid-column: 2;
  grid-row: 1;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  column-gap: 12px;
  align-content: start;
}
.track-identity .cover-wrap {
  grid-row: span 4;
}
.track-identity .eyebrow {
  margin-top: 0;
}
.track-identity h1 {
  font-size: clamp(20px, 1.5vw, 28px);
  overflow-wrap: anywhere;
}
.track-identity .enqueue-current,
.track-identity .local-note {
  grid-column: 1 / -1;
}
.karaoke-layout > .queue-panel {
  grid-column: 2;
  grid-row: 2;
  overflow-y: auto;
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
.stage ::v-deep .lyric-stage-shell {
  z-index: 1;
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
  justify-content: flex-end;
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
.stage:not([data-stage-mode='classic']) .fullscreen-actions {
  margin-bottom: 48px;
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
/* Keep the standard selector separate: unsupported vendor selectors in the old
   selector list can invalidate the entire rule in Chromium. */
.stage:fullscreen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  padding: 0;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: var(--ktv-bg-base);
}
.stage:fullscreen .stage-footer,
.stage:fullscreen .stage-kicker,
.stage:fullscreen .fullscreen-actions {
  display: none;
}
.stage:fullscreen.pv-stage ::v-deep .pv-scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
}
.stage:-webkit-full-screen.pv-stage ::v-deep .pv-scene,
.stage:-moz-full-screen.pv-stage ::v-deep .pv-scene,
.stage:-ms-fullscreen.pv-stage ::v-deep .pv-scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
}
.stage:fullscreen,
.stage:-webkit-full-screen,
.stage:-moz-full-screen,
.stage:-ms-fullscreen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  min-width: 100vw;
  min-height: 100vh;
  padding: 0;
  box-sizing: border-box;
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
.lyric-fullscreen-control-dock {
  display: contents;
}
.lyric-fullscreen-control-dock ::v-deep .ktv-control-toggle {
  bottom: calc(112px + env(safe-area-inset-bottom, 0px));
}
.lyric-fullscreen-control-dock ::v-deep .ktv-control-panel {
  bottom: calc(
    112px + var(--ktv-control-toggle-size, 52px) + 24px +
      env(safe-area-inset-bottom, 0px)
  );
  max-height: calc(
    100dvh - 112px - var(--ktv-control-toggle-size, 52px) - 48px -
      env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
  );
}
.lyric-fullscreen-overlay.visible,
.lyric-fullscreen-overlay:hover {
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  box-sizing: border-box;
  flex: 0 0 calc(var(--ktv-control-toggle-size, 52px) * 1.2);
  min-height: calc(var(--ktv-control-toggle-size, 52px) * 1.2);
  padding: 4px 18px;
}
.karaoke-desktop ::v-deep .karaoke-control-panel--bar {
  right: 40px;
  bottom: calc(var(--ktv-control-toggle-size, 52px) + 40px);
}
.lyric-effect-setting {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  flex-shrink: 0;
  white-space: nowrap;
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
  flex-wrap: wrap;
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
.player-actions button {
  min-height: 35.2px;
  padding: 0 16px;
  font-size: 12px;
}
.player-actions .primary {
  border-color: transparent;
  background: var(--ktv-accent);
  color: #fff;
}
@media (max-width: 1100px) {
  .karaoke-layout {
    grid-template-columns: minmax(0, 1fr) minmax(190px, 0.3fr);
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
  .karaoke-desktop .room-access-overlay,
  .karaoke-desktop .local-library-overlay {
    position: fixed;
    top: 72px;
    left: 50%;
    z-index: 20;
    width: min(520px, calc(100% - 24px));
    max-height: calc(100vh - 84px);
    overflow: auto;
    margin: 0;
    transform: translateX(-50%);
    box-shadow: 0 20px 48px rgba(24, 15, 65, 0.3);
  }
  .karaoke-desktop .local-library-overlay {
    width: min(520px, calc(100% - 24px));
    margin: 0;
    padding: 12px;
  }
  .karaoke-desktop .room-access-overlay {
    transform: translateX(-50%) scale(0.8);
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
    flex: none;
  }
  .track-identity {
    order: 0;
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
    order: 1;
    min-height: 380px;
  }
  .queue-panel {
    order: 2;
  }
  .karaoke-controls {
    grid-template-columns: 1fr;
    justify-items: center;
    flex-shrink: 0;
  }
  .karaoke-desktop ::v-deep .karaoke-control-panel--bar {
    right: 24px;
    bottom: calc(
      var(--ktv-control-toggle-size, 52px) + 28px +
        env(safe-area-inset-bottom, 0px)
    );
  }
  .font-setting {
    justify-content: center;
    flex-wrap: wrap;
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
