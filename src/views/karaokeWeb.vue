<template>
  <Karaoke
    v-if="isMaster"
    ref="master"
    :web-host-name="hostName"
    @web-room-lost="releaseMaster"
    @web-host-ended="releaseMaster"
  />
  <section
    v-else
    ref="screen"
    class="karaoke-surface display-screen"
    :class="{
      'is-fullscreen': isFullscreen,
      'controls-idle': controlsIdle,
      'pv-stage': isPvStage,
    }"
    :data-ktv-theme="presentation.theme || 'light'"
    :style="sceneStyle"
    @pointermove="handlePointerActivity"
    @keydown.capture="handlePointerActivity"
  >
    <header class="display-header">
      <button type="button" @click="$router.push('/')">返回音乐</button>
      <div class="display-status"
        ><strong>副屏歌词</strong>
        <small>{{ connectionLabel }} · 本屏静音</small></div
      >
      <div class="screen-actions">
        <KaraokeThemeSwitcher v-model="displayTheme" />
        <SongRequestButton :url="state.joinUrl || ''" />
        <button
          type="button"
          :aria-expanded="showSettings"
          @click="toggleSettings"
          >歌词设置</button
        >
        <button type="button" @click="fullscreen">歌词全屏</button>
      </div>
    </header>
    <KaraokeControlPanel
      ref="settingsPanel"
      :open="showSettings"
      :config="controlConfig"
      :mode-options="stageModeOptions"
      :background-options="controlBackgroundOptions"
      :is-follower="true"
      :volume="1"
      :track="controlTrack"
      :follows="controlFollows"
      :capabilities="controlCapabilities"
      :return-focus-to="$refs.settingsToggle"
      @close="setControlPanelOpen(false)"
      @change="handleControlChange"
      @asset="forwardAssetSelection"
      @follow="handleControlFollow"
    >
      <template #extra>
        <KaraokeSmartBeatControls
          :settings="smartBeatControlSettings"
          :renderer-mode="presentation.mode || ''"
          :status="smartBeatControlStatus"
          @change="onLocalSmartBeatChange"
        />
        <div class="display-preference-footer">
          <p>本屏偏移按歌曲原始时间计算，不叠加主屏偏移。</p>
          <p v-if="isPvStage" class="display-pv-attribution">
            原版 PV 使用自带字效；花火自动排版字号。
            <a href="/pv/source.tgz" download>Folia 源码 · AGPL-3.0</a>
          </p>
          <span role="status">{{
            preferenceMessage || '仅保存在本机浏览器，不影响主屏与其他副屏。'
          }}</span>
          <button type="button" @click="restoreFollow">全部恢复跟随主屏</button>
        </div>
      </template>
    </KaraokeControlPanel>
    <KaraokeControlToggle
      ref="settingsToggle"
      :open="showSettings"
      @toggle="setControlPanelOpen"
    />
    <div v-if="!state.active" class="master-choice glass-panel">
      <h1>让多台电脑，听同一首歌</h1>
      <p
        >请在负责播放声音的电脑上指定主机。其他电脑打开本页面，会自动同步显示歌词。</p
      >
      <label
        >主电脑名称
        <input v-model="hostName" maxlength="40" placeholder="例如：客厅主电脑"
      /></label>
      <button
        type="button"
        :disabled="claiming || !connected"
        @click="chooseMaster"
        >将本机设为主电脑</button
      >
      <p v-if="error" role="status">{{ error }}</p>
    </div>
    <main v-else class="display-stage" aria-label="同步歌词舞台">
      <KaraokeLyricScene
        :mode="presentation.mode || 'classic'"
        :lines="stage"
        :cue-key="stage.cueKey"
        :effect="presentation.effect || 'gradient'"
        :playing="presentation.playing && !stale"
        :fullscreen="true"
        :lyric-document="
          state.pvLyrics && state.pvLyrics.itemId === presentation.itemId
            ? state.pvLyrics
            : null
        "
        :position="pvPosition"
        :raw-position="smartBeatRawPosition"
        :smart-beat-settings="smartBeatControlSettings"
        :smart-beat-track-key="presentation.smartBeat?.trackKey || ''"
        :smart-beat-timeline="followerSmartBeatTimeline"
        :audio-features="presentation.audioFeatures || null"
        :theme="presentation.theme || 'light'"
        :font-size="presentation.fontSize || 45"
        v-bind="sceneAppearanceProps"
      />
      <p v-if="stale" class="connection-warning" role="status"
        >主电脑同步中断，正在等待重连；本屏不会接管播放。</p
      >
    </main>
    <aside
      v-if="state.active && !showSettings"
      class="next-track"
      aria-label="下一首歌曲"
    >
      <span>下一首</span>
      <strong>{{
        state.nextTrack && state.nextTrack.title
          ? state.nextTrack.title
          : '暂无待唱歌曲'
      }}</strong>
      <small v-if="state.nextTrack && state.nextTrack.artists.length">{{
        state.nextTrack.artists.join(' / ')
      }}</small>
    </aside>
    <ReactionOverlay
      v-if="state.active"
      :events="state.reactions || []"
      :generation="state.reactionEpoch || ''"
      :server-time="state.serverTime || 0"
      storage-key="display"
      :theme="presentation.theme || 'light'"
      :playing="!!presentation.playing"
      :has-track="!!presentation.itemId"
      :music-reaction="presentation.musicReaction || null"
    />
  </section>
</template>

<script>
import { Howler } from 'howler';
import Karaoke from './karaoke.vue';
import KaraokeControlPanel from '@/components/karaoke/KaraokeControlPanel.vue';
import KaraokeControlToggle from '@/components/karaoke/KaraokeControlToggle.vue';
import KaraokeSmartBeatControls from '@/components/karaoke/KaraokeSmartBeatControls.vue';
import KaraokeLyricScene from '@/components/karaoke/KaraokeLyricScene.vue';
import KaraokeThemeSwitcher from '@/components/karaoke/KaraokeThemeSwitcher.vue';
import ReactionOverlay from '@/components/karaoke/ReactionOverlay.vue';
import SongRequestButton from '@/components/karaoke/SongRequestButton.vue';
import createDisplayPoller from '@/karaoke/displayPoller';
import { projectPresentation } from '@/karaoke/lyricDisplay';
import {
  normalizeSmartBeatPreferences,
  readSmartBeatPreferences,
  writeSmartBeatPreferences,
  getSmartBeatSourceRequirements,
} from '@/karaoke/smartBeatPreferences';

import {
  stageModeOptions,
  isPvStageMode,
  supportsAnimationIntensity,
} from '@/utils/lyricStageModes';
import {
  backgroundOptionsForMode,
  normalizeAppearanceConfig,
  createVisualAssetUploadQueue,
} from '@/karaoke/appearanceConfig';
import { sparseVisualTuning } from '@/karaoke/visualConfig';
import {
  resolveLocalVisualAssets,
  resolveVisualAssets,
  uploadLocalVisualAsset,
} from '@/karaoke/visualAssets';
import { getVisualModeMetadata } from '@/karaoke/visualCatalog';
import {
  readDisplayPreferences,
  writeDisplayPreferences,
  normalizeDisplayPreferences,
  effectiveDisplayPresentation,
} from '@/karaoke/displayPreferences';

const DISPLAY_SMART_BEAT_KEY = 'lumasing.ktv.smartbeat.display.v1';

export default {
  components: {
    Karaoke,
    KaraokeControlPanel,
    KaraokeControlToggle,
    KaraokeSmartBeatControls,
    KaraokeLyricScene,
    KaraokeThemeSwitcher,
    ReactionOverlay,
    SongRequestButton,
  },
  data() {
    return {
      isMaster: false,
      claiming: false,
      hostName: '主电脑',
      state: { active: false },
      connected: false,
      error: '',
      receivedAt: 0,
      clockNow: 0,
      clock: null,
      claimEpoch: 0,
      showSettings: false,
      settingsCloseTimer: null,
      isFullscreen: false,
      controlsIdle: false,
      controlsIdleTimer: null,
      controlsIdleDelay: 2400,
      fullscreenStageShift: 0,
      fullscreenShiftFrame: null,
      preferences: readDisplayPreferences(undefined, {
        onTrim: () =>
          this.$store.dispatch(
            'showToast',
            '配置达到 16 KiB，已精简可选参数或未选中的背景地址；当前样式与素材已保留'
          ),
        onInvalid: error => this.$store.dispatch('showToast', error.message),
      }),
      preferenceMessage: '',
      remoteAppearance: null,
      localVisualAssetSet: null,
      localAssetResolveGeneration: 0,
      localSmartBeatSettings: readSmartBeatPreferences(
        undefined,
        DISPLAY_SMART_BEAT_KEY
      ),
    };
  },
  computed: {
    isPvStage() {
      return isPvStageMode(this.presentation.mode);
    },
    presentation() {
      return effectiveDisplayPresentation(
        this.state.presentation || {},
        this.preferences,
        this.remoteAppearance
      );
    },
    localAssetReferenceKey() {
      const tuning = this.presentation.tuningByMode || {};
      const cappella = tuning.cappella || {};
      const tempera = tuning.tempera || {};
      return JSON.stringify([
        this.presentation.background && this.presentation.background.assetId,
        tuning.monet && tuning.monet.portraitAssetId,
        cappella.emojiAssetIds || [],
        cappella.avatarAssetIds || [],
        tempera.layerImageAssetIds || [],
        (tempera.layerImages || []).map(image => [image.id, image.name]),
        tempera.layerImageNames || [],
      ]);
    },
    displayTheme: {
      get() {
        return this.preferences.theme;
      },
      set(value) {
        this.updatePreference('theme', value);
      },
    },
    stageModeOptions() {
      return stageModeOptions;
    },
    controlBackgroundOptions() {
      return backgroundOptionsForMode(this.presentation.mode);
    },
    sceneAppearanceProps() {
      const remoteAssets = resolveVisualAssets(this.presentation);
      const localAssets =
        this.localVisualAssetSet && this.localVisualAssetSet.assets;
      return {
        background: this.presentation.background,
        animationIntensity: this.presentation.animationIntensity,
        tuningByMode: this.presentation.tuningByMode || {},
        coverUrl: this.presentation.coverUrl || '',
        assets: localAssets
          ? {
              backgroundImage:
                localAssets.backgroundImage || remoteAssets.backgroundImage,
              monetPortraitImage:
                localAssets.monetPortraitImage ||
                remoteAssets.monetPortraitImage,
              cappellaCustomEmojiImages: localAssets.cappellaCustomEmojiImages
                .length
                ? localAssets.cappellaCustomEmojiImages
                : remoteAssets.cappellaCustomEmojiImages,
              cappellaCustomAvatarImages: localAssets.cappellaCustomAvatarImages
                .length
                ? localAssets.cappellaCustomAvatarImages
                : remoteAssets.cappellaCustomAvatarImages,
              temperaLayerImageAssets: localAssets.temperaLayerImageAssets
                ?.length
                ? localAssets.temperaLayerImageAssets
                : remoteAssets.temperaLayerImageAssets || [],
            }
          : remoteAssets,
      };
    },
    controlConfig() {
      return {
        ...this.presentation,
        theme: this.preferences.theme,
        resolvedTheme: this.presentation.theme || 'light',
      };
    },
    controlTrack() {
      const presentation = this.state.presentation || {};
      const title =
        typeof presentation.title === 'string'
          ? presentation.title.slice(0, 300)
          : '';
      if (!title.trim()) return {};
      return {
        title,
        artist:
          typeof presentation.artists === 'string'
            ? presentation.artists.slice(0, 300)
            : '',
      };
    },
    controlFollows() {
      return {
        style: this.preferences.followStyle,
        timing: this.preferences.followTiming,
        background: this.preferences.followBackground,
        theme: this.preferences.theme === 'auto',
      };
    },
    controlCapabilities() {
      return {
        fontSize: this.presentation.mode !== 'hanabi',
        effect: !this.isPvStage,
        intensity: supportsAnimationIntensity(this.presentation.mode),
      };
    },
    stale() {
      return (
        !this.connected ||
        this.state.stale ||
        this.clockNow - this.receivedAt > 5000
      );
    },
    connectionLabel() {
      if (!this.connected) return '连接服务中';
      return this.state.active
        ? this.stale
          ? '等待主电脑重连'
          : '与主电脑同步'
        : '尚未指定主电脑';
    },
    stage() {
      const age =
        Math.max(
          0,
          (this.state.serverTime || 0) - (this.state.updatedAt || 0)
        ) / 1000;
      return projectPresentation(
        this.presentation,
        age + Math.max(0, this.clockNow - this.receivedAt) / 1000
      );
    },
    pvPosition() {
      const age =
        Math.max(
          0,
          (this.state.serverTime || 0) - (this.state.updatedAt || 0)
        ) / 1000;
      const elapsed = age + Math.max(0, this.clockNow - this.receivedAt) / 1000;
      return Math.max(
        0,
        (this.presentation.position || 0) +
          (this.presentation.offset || 0) +
          (this.presentation.playing ? Math.min(3, elapsed) : 0)
      );
    },
    smartBeatRawPosition() {
      const age =
        Math.max(
          0,
          (this.state.serverTime || 0) - (this.state.updatedAt || 0)
        ) / 1000;
      const elapsed = age + Math.max(0, this.clockNow - this.receivedAt) / 1000;
      return Math.max(
        0,
        (this.presentation.position || 0) +
          (this.presentation.playing ? Math.min(3, elapsed) : 0)
      );
    },
    smartBeatControlSettings() {
      return this.localSmartBeatSettings;
    },
    smartBeatControlStatus() {
      if (this.localSmartBeatSettings.mode === 'off')
        return { state: 'idle', detail: '' };
      const required = getSmartBeatSourceRequirements(
        this.localSmartBeatSettings,
        this.presentation.mode
      );
      if (!required.beats && !required.drums)
        return { state: 'idle', detail: '' };
      const timeline = this.followerSmartBeatTimeline;
      if (
        !timeline ||
        (required.beats && !timeline.beats) ||
        (required.drums && !timeline.drums)
      )
        return {
          state: 'waiting',
          detail:
            '等待主屏提供该效果所需的节拍分析数据；主屏未分析时副屏暂无法独立生成。',
        };
      return { state: 'ready', detail: '正在使用主屏同步的分析数据。' };
    },
    followerSmartBeatTimeline() {
      const timeline = this.state.smartBeatTimeline;
      return timeline &&
        timeline.trackKey === this.presentation.smartBeat?.trackKey
        ? timeline
        : null;
    },
    sceneStyle() {
      const colors = this.presentation.customTheme || {};
      const style = {
        '--ktv-active-lyric-size': `${this.presentation.fontSize || 45}px`,
        '--ktv-fullscreen-stage-shift': `${this.fullscreenStageShift}px`,
      };
      if (colors.background) style['--ktv-bg-base'] = colors.background;
      if (colors.text) style['--ktv-text-primary'] = colors.text;
      if (colors.accent) style['--ktv-accent'] = colors.accent;
      if (colors.accentStrong)
        style['--ktv-accent-strong'] = colors.accentStrong;
      return style;
    },
  },
  watch: {
    'stage.cueKey': 'scheduleFullscreenStageShift',
    'presentation.mode': 'scheduleFullscreenStageShift',
    'presentation.fontSize': 'scheduleFullscreenStageShift',
    localAssetReferenceKey() {
      this.refreshLocalVisualAssets();
    },
  },
  created() {
    this.previousMuted = Howler._muted;
    this.silenceDisplay();
    this.poller = createDisplayPoller({
      onState: state => {
        this.state = state;
        this.connected = true;
        this.receivedAt = this.clockNow = performance.now();
        this.restartClock();
      },
      onAppearance: snapshot => {
        if (!this.leaving)
          this.remoteAppearance = snapshot ? snapshot.config : null;
      },
      onError: () => {
        this.connected = false;
        this.error = '无法连接 Docker KTV 服务';
      },
    });
    this.visibilityHandler = () => {
      clearInterval(this.clock);
      if (document.hidden || this.isMaster) {
        this.poller.stop();
      } else {
        this.poller.start();
        this.restartClock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.fullscreenHandler = () => this.handleFullscreenChange();
    document.addEventListener('fullscreenchange', this.fullscreenHandler);
    this.fullscreenResizeHandler = () => this.scheduleFullscreenStageShift();
    window.addEventListener('resize', this.fullscreenResizeHandler);
    this.pageHideHandler = () => {
      this.visualAssetUploads?.invalidate();
      if (this.isMaster) this.releaseMaster();
    };
    window.addEventListener('pagehide', this.pageHideHandler);
    this.refreshLocalVisualAssets();
    this.visibilityHandler();
  },
  beforeDestroy() {
    this.visualAssetUploads?.dispose();
    this.leaving = true;
    this.claimEpoch++;
    this.localAssetResolveGeneration++;
    this.localVisualAssetSet?.release?.();
    this.localVisualAssetSet = null;
    if (this.isMaster) this.$store.$karaokeManager.endSession();
    this.poller.stop();
    clearInterval(this.clock);
    clearTimeout(this.settingsCloseTimer);
    clearTimeout(this.controlsIdleTimer);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    window.removeEventListener('resize', this.fullscreenResizeHandler);
    if (this.fullscreenShiftFrame !== null)
      cancelAnimationFrame(this.fullscreenShiftFrame);
    window.removeEventListener('pagehide', this.pageHideHandler);
    Howler.mute(this.previousMuted);
    this.$store.state.webKtvDisplayOnly = true;
    if (this.$route.name !== 'karaoke') this.$store.$initializePlayerOnce();
  },
  methods: {
    onLocalSmartBeatChange(value) {
      this.localSmartBeatSettings = normalizeSmartBeatPreferences(value);
      writeSmartBeatPreferences(
        this.localSmartBeatSettings,
        undefined,
        DISPLAY_SMART_BEAT_KEY
      );
    },
    setControlPanelOpen(open) {
      this.showSettings = Boolean(open);
      clearTimeout(this.settingsCloseTimer);
      this.settingsCloseTimer = null;
      if (this.showSettings) this.preferenceMessage = '';
      this.handlePointerActivity();
    },
    handleControlChange(change) {
      if (
        !change ||
        ![
          'mode',
          'effect',
          'fontSize',
          'offset',
          'theme',
          'customTheme',
          'background.mode',
          'background.tuning',
          'background.reset',
          'background.transparent',
          'background.opacity',
          'animationIntensity',
          'tuning',
          'tuning.reset',
        ].includes(change.key)
      )
        return;
      if (change.key === 'background.mode') {
        this.updatePreference('background', {
          ...this.preferences.background,
          mode: change.value,
        });
        return;
      }
      if (
        change.key === 'background.transparent' ||
        change.key === 'background.opacity'
      ) {
        this.updatePreference('background', {
          ...this.preferences.background,
          [change.key.slice('background.'.length)]: change.value,
        });
        return;
      }
      if (change.key === 'background.reset') {
        this.updatePreference('background', {
          ...this.preferences.background,
          tuning: {},
          assetId: null,
          transparent: false,
          opacity: 1,
        });
        return;
      }
      if (change.key === 'background.tuning') {
        this.updatePreference('background', {
          ...this.preferences.background,
          tuning: sparseVisualTuning(
            'background',
            this.preferences.background.mode,
            change.value
          ),
        });
        return;
      }
      if (change.key === 'tuning') {
        const sparse = sparseVisualTuning(
          'mode',
          this.presentation.mode,
          change.value
        );
        const tuningByMode = { ...this.preferences.tuningByMode };
        if (Object.keys(sparse).length)
          tuningByMode[this.presentation.mode] = sparse;
        else delete tuningByMode[this.presentation.mode];
        this.updatePreference('tuningByMode', {
          ...tuningByMode,
        });
        return;
      }
      if (change.key === 'tuning.reset') {
        const tuningByMode = { ...this.preferences.tuningByMode };
        delete tuningByMode[change.value || this.presentation.mode];
        this.updatePreference('tuningByMode', tuningByMode);
        return;
      }
      this.updatePreference(change.key, change.value);
    },
    async refreshLocalVisualAssets() {
      const generation = ++this.localAssetResolveGeneration;
      let resolved;
      try {
        resolved = await resolveLocalVisualAssets(this.presentation);
      } catch (_) {
        if (generation === this.localAssetResolveGeneration && !this.leaving) {
          this.localVisualAssetSet?.release?.();
          this.localVisualAssetSet = null;
        }
        return;
      }
      const assetView = asset =>
        asset
          ? {
              id: asset.id,
              name: asset.name,
              url: asset.url,
              mime: asset.mime,
            }
          : null;
      const next = {
        assets: {
          backgroundImage: assetView(resolved.backgroundImage),
          monetPortraitImage: assetView(resolved.monetPortraitImage),
          cappellaCustomEmojiImages: resolved.cappellaCustomEmojiImages
            .map(assetView)
            .filter(Boolean),
          cappellaCustomAvatarImages: resolved.cappellaCustomAvatarImages
            .map(assetView)
            .filter(Boolean),
          temperaLayerImageAssets: (resolved.temperaLayerImageAssets || [])
            .map(assetView)
            .filter(Boolean),
        },
        release: () => resolved.release(),
      };
      if (generation !== this.localAssetResolveGeneration || this.leaving) {
        next.release();
        return;
      }
      const previous = this.localVisualAssetSet;
      this.localVisualAssetSet = next;
      previous?.release?.();
    },
    forwardAssetSelection(change) {
      if (!change) return Promise.resolve([]);
      if (!this.visualAssetUploads) {
        this.visualAssetUploads = createVisualAssetUploadQueue({
          maxBytes: 16 * 1024 - 128,
          getConfig: () => normalizeAppearanceConfig(this.preferences),
          getGeneration: selection => {
            if (
              this.leaving ||
              this.isMaster ||
              (selection.role === 'background'
                ? this.preferences.followBackground
                : this.preferences.followStyle)
            )
              return null;
            return String(this.state.generation || '') + ':' + this.claimEpoch;
          },
          upload: (file, role, options) =>
            uploadLocalVisualAsset(file, role, options),
          commit: (next, selection) => {
            const key =
              selection.role === 'background' ? 'background' : 'tuningByMode';
            return this.updatePreference(key, next[key]);
          },
          notify: message =>
            this.$store.dispatch(
              'showToast',
              {
                INVALID_IMAGE: '请选择有效的 PNG、JPEG、WebP 或 GIF 图片',
                LOCAL_ASSET_TOO_LARGE: '单张图片不能超过 4 MiB',
                LOCAL_ASSET_STORE_FULL:
                  '本机图片素材空间已满，请先移除一些素材',
                LOCAL_ASSET_STORAGE_UNAVAILABLE: '此浏览器暂不支持本地图片素材',
              }[message] || message
            ),
        });
      }
      return this.visualAssetUploads.run(change);
    },
    updateLocalModeTuning(mode, patch) {
      const metadata = getVisualModeMetadata(mode);
      if (!metadata) return;
      const current = this.preferences.tuningByMode[mode] || {};
      const full = { ...metadata.tuningDefaults, ...current, ...patch };
      const sparse = sparseVisualTuning('mode', mode, full);
      const tuningByMode = { ...this.preferences.tuningByMode };
      if (Object.keys(sparse).length) tuningByMode[mode] = sparse;
      else delete tuningByMode[mode];
      this.updatePreference('tuningByMode', tuningByMode);
    },
    handleControlFollow(change) {
      if (!change) return;
      if (change.key === 'style')
        this.updatePreference('followStyle', change.value);
      else if (change.key === 'timing')
        this.updatePreference('followTiming', change.value);
      else if (change.key === 'background')
        this.updatePreference('followBackground', change.value);
      else if (change.key === 'theme') {
        const resolvedTheme =
          this.presentation.theme === 'dark' ? 'dark' : 'light';
        this.updatePreference('theme', change.value ? 'auto' : resolvedTheme);
      }
    },
    updatePreference(key, value) {
      if (
        ![
          'followStyle',
          'followTiming',
          'followBackground',
          'mode',
          'effect',
          'fontSize',
          'offset',
          'theme',
          'customTheme',
          'animationIntensity',
          'background',
          'tuningByMode',
        ].includes(key)
      )
        return;
      try {
        let trimmed = false;
        const next = normalizeDisplayPreferences(
          {
            ...this.preferences,
            [key]: value,
          },
          {
            onTrim: () => {
              trimmed = true;
            },
          }
        );
        if (
          key === 'followStyle' ||
          key === 'followBackground' ||
          next.background.mode !== this.preferences.background.mode
        )
          this.visualAssetUploads?.invalidate();
        this.visualAssetUploads?.assertFits(next);
        this.preferences = next;
        const saved = writeDisplayPreferences(next);
        this.preferenceMessage = saved
          ? ''
          : '浏览器不允许保存；本次设置仍然生效';
        if (trimmed)
          this.$store.dispatch(
            'showToast',
            '配置达到 16 KiB，已精简可选参数或未选中的背景地址；当前样式与素材已保留'
          );
      } catch (error) {
        this.$store.dispatch('showToast', error.message);
        return false;
      }
      clearTimeout(this.settingsCloseTimer);
      this.settingsCloseTimer = null;
      return true;
    },
    toggleSettings() {
      this.setControlPanelOpen(!this.showSettings);
    },
    handlePointerActivity(event) {
      if (
        event?.type === 'pointermove' &&
        !event.target.closest?.('.display-header') &&
        document.activeElement?.closest?.('.display-header')
      )
        document.activeElement.blur();
      if (!this.isFullscreen) return;
      this.controlsIdle = false;
      clearTimeout(this.controlsIdleTimer);
      if (this.showSettings) return;
      this.controlsIdleTimer = setTimeout(() => {
        if (!this.showSettings) this.controlsIdle = true;
      }, this.controlsIdleDelay);
    },
    handleFullscreenChange() {
      this.isFullscreen = document.fullscreenElement === this.$refs.screen;
      this.scheduleFullscreenStageShift();
      if (this.isFullscreen) this.handlePointerActivity();
      else {
        clearTimeout(this.controlsIdleTimer);
        this.controlsIdle = false;
      }
    },
    scheduleFullscreenStageShift() {
      if (this.fullscreenShiftFrame !== null) {
        cancelAnimationFrame(this.fullscreenShiftFrame);
        this.fullscreenShiftFrame = null;
      }
      if (!this.isFullscreen) {
        this.fullscreenStageShift = 0;
        return;
      }
      this.fullscreenShiftFrame = requestAnimationFrame(() => {
        this.fullscreenShiftFrame = null;
        const screen = this.$refs.screen;
        const copy = screen?.querySelector('.scene-copy');
        if (!screen || !copy || !this.isFullscreen) {
          this.fullscreenStageShift = 0;
          return;
        }
        const currentGap =
          screen.getBoundingClientRect().bottom -
          copy.getBoundingClientRect().bottom;
        const unshiftedGap = currentGap + this.fullscreenStageShift;
        this.fullscreenStageShift = Math.max(
          0,
          Math.round(unshiftedGap * 0.3 * 10) / 10
        );
      });
    },
    savePreferences() {
      this.preferenceMessage = writeDisplayPreferences(this.preferences)
        ? '本屏设置已保存'
        : '浏览器不允许保存；本次设置仍然生效';
    },
    restoreFollow() {
      this.preferences = {
        ...this.preferences,
        followStyle: true,
        followTiming: true,
        followBackground: true,
        theme: 'auto',
      };
      this.savePreferences();
    },
    silenceDisplay() {
      if (this.isMaster) return;
      this.$store.state.webKtvDisplayOnly = true;
      Howler.mute(true);
      this.$store.state.player.pause();
    },
    restartClock() {
      clearInterval(this.clock);
      if (
        document.hidden ||
        this.isMaster ||
        !this.state.active ||
        !this.presentation.playing
      )
        return;
      this.clock = setInterval(() => {
        this.clockNow = performance.now();
        if (this.clockNow - this.receivedAt > 5000) clearInterval(this.clock);
      }, 100);
    },
    async chooseMaster() {
      if (this.claiming || this.state.active) return;
      const claim = ++this.claimEpoch;
      this.claiming = true;
      this.error = '';
      this.poller.stop();
      clearInterval(this.clock);
      this.$store.state.webKtvDisplayOnly = false;
      Howler.mute(this.previousMuted);
      this.isMaster = true;
      await this.$nextTick();
      try {
        if (this.leaving || claim !== this.claimEpoch) return;
        const master = this.$refs.master;
        master.enableBrowserAudio();
        this.$store.state.player._initMediaSession();
        await master.loadLanCandidates();
        if (this.leaving || claim !== this.claimEpoch) return;
        const result = await master.startLanRoom();
        if (this.leaving || claim !== this.claimEpoch) {
          await master.webRoomBridge.dispose();
          return;
        }
        if (!result?.ok)
          throw new Error('未能取得主电脑资格，可能已有另一台主电脑');
      } catch (error) {
        if (this.leaving || claim !== this.claimEpoch) return;
        this.error = error.message;
        await this.releaseMaster();
      } finally {
        if (claim === this.claimEpoch) this.claiming = false;
      }
    },
    async releaseMaster() {
      const release = ++this.claimEpoch;
      this.claiming = false;
      const master = this.$refs.master;
      if (master) {
        this.$store.$karaokeManager.endSession();
        await master.webRoomBridge.dispose();
      }
      if (this.leaving || release !== this.claimEpoch) return;
      this.isMaster = false;
      this.silenceDisplay();
      this.state = { active: false };
      this.visibilityHandler();
    },
    fullscreen() {
      this.handlePointerActivity();
      if (document.fullscreenElement) document.exitFullscreen();
      else this.$refs.screen.requestFullscreen?.().catch(() => {});
    },
  },
};
</script>

<style scoped>
.display-screen {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--ktv-bg-base);
}
.display-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12.8px;
  min-height: 40px;
  flex-shrink: 0;
  font-size: 80%;
  transition: opacity 600ms ease;
}
.display-header div {
  display: flex;
  flex-direction: column;
  gap: 4.8px;
  text-align: center;
}
.display-header .display-status {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
small,
footer,
.track-caption span {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
button,
input,
select {
  padding: 10px 16px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
}
.display-header button {
  padding: 8px 12.8px;
}
.display-header .screen-actions {
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6.4px;
}
.display-header .screen-actions > .karaoke-theme-switcher {
  flex-direction: row;
}
.next-track {
  position: absolute;
  z-index: 2;
  right: 84px;
  bottom: 16px;
  display: flex;
  max-width: min(360px, 38vw);
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  padding: 10px 14px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 14px;
  background: var(--ktv-glass-soft);
  box-shadow: 0 8px 24px rgba(16, 20, 40, 0.08);
  text-align: right;
  pointer-events: none;
}
.next-track span {
  color: var(--ktv-text-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.next-track strong {
  max-width: 100%;
  overflow: hidden;
  color: var(--ktv-text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next-track small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.display-preference-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  color: var(--ktv-text-muted);
  font-size: 12px;
  margin-top: auto;
}
.display-preference-footer button {
  padding: 8px 10px;
  font-size: 11px;
}
.display-preference-footer p {
  margin: 0;
  color: var(--ktv-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
.display-preference-footer .display-pv-attribution {
  text-align: center;
}
.master-choice {
  margin: auto;
  padding: 36px;
  max-width: 640px;
  line-height: 1.8;
}
.master-choice label {
  display: block;
  margin: 24px 0;
}
.master-choice button {
  background: var(--ktv-accent);
  color: white;
}
.master-choice button:disabled {
  opacity: 0.4;
}
.display-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  position: relative;
  z-index: 1;
  overflow: hidden;
  /* Reset the app-wide main padding; the lyric canvas owns its composition. */
  padding: 0;
}
.track-caption {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 14px;
  margin-bottom: 16px;
}
.connection-warning {
  position: absolute;
  bottom: 0;
  color: var(--ktv-warning);
  font-size: 13px;
}
footer {
  text-align: center;
  flex-shrink: 0;
}
.display-screen.is-fullscreen {
  padding: 0;
  gap: 0;
}
.display-screen ::v-deep .ktv-control-toggle {
  right: 16px;
  bottom: 16px;
}
.is-fullscreen .display-header {
  position: absolute;
  z-index: 5;
  top: 16px;
  right: 24px;
  left: 24px;
}
.is-fullscreen.controls-idle .display-header {
  opacity: 0;
}
.is-fullscreen .display-header:hover,
.is-fullscreen .display-header:focus-within {
  opacity: 1;
}
.is-fullscreen .display-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  transform: none;
}
.is-fullscreen .display-stage ::v-deep .pv-scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
}
@media (max-width: 700px) {
  .display-screen {
    padding: 14px;
    gap: 12px;
  }
  .next-track {
    right: 70px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    max-width: min(60vw, calc(100vw - 100px));
  }
  .display-screen ::v-deep .ktv-control-toggle {
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
  .display-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas: 'back back' 'actions actions' 'status status';
    gap: 8px;
  }
  .display-header > button:first-child {
    grid-area: back;
    justify-self: start;
  }
  .display-header .display-status {
    position: static;
    grid-area: status;
    width: 100%;
    transform: none;
  }
  .display-header .screen-actions {
    grid-area: actions;
    width: 100%;
    min-width: 0;
    justify-self: stretch;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .screen-actions {
    width: auto;
    justify-content: flex-end;
  }
  .display-header button {
    font-size: 12px;
    padding: 6px 8px;
  }
  .master-choice {
    padding: 20px;
  }
  h1 {
    font-size: 24px;
  }
  .track-caption {
    flex-direction: column;
    align-items: center;
  }
  .display-screen.is-fullscreen {
    padding: 0;
  }
  .is-fullscreen .display-header {
    top: 10px;
    right: 10px;
    left: 10px;
  }
}
</style>
