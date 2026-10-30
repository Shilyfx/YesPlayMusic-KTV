<template>
  <div
    class="lyric-scene pv-scene"
    :data-scene="mode"
    :data-fullscreen="fullscreen"
    :data-pv-status="status"
    aria-label="Folia 歌词 PV"
  >
    <div ref="canvasHost" class="pv-canvas" aria-hidden="true" />
    <div v-if="status !== 'ready'" class="pv-fallback" role="status">
      <p>{{ lines.active }}</p>
      <small>{{ statusLabel }}</small>
      <button v-if="status === 'error'" type="button" @click="queueBuild"
        >重试动画</button
      >
    </div>
    <span v-else class="pv-accessible">{{ lines.active }}</span>
  </div>
</template>

<script>
import { loadFoliaRuntime } from '@/karaoke/folia/loadRuntime';
import { createStageLifecycle } from '@/karaoke/folia/stageLifecycle';
import { createPvClock } from '@/karaoke/folia/timing';
import { supportsRuntimeUpdateMode } from '@/karaoke/folia/rendererContracts';
import { createStageTheme } from '@/karaoke/folia/stageTheme';

export default {
  name: 'KaraokePvScene',
  props: {
    mode: { type: String, required: true },
    lines: { type: Object, required: true },
    lyricDocument: { type: Object, default: null },
    position: { type: Number, default: 0 },
    rawPosition: { type: Number, default: 0 },
    smartBeatSettings: { type: Object, default: () => ({}) },
    smartBeatTrackKey: { type: String, default: '' },
    smartBeatTimeline: { type: Object, default: null },
    audioFeatures: { type: Object, default: null },
    playing: { type: Boolean, default: false },
    theme: { type: String, default: 'light' },
    fontSize: { type: Number, default: 45 },
    fullscreen: { type: Boolean, default: false },
    background: { type: Object, default: () => ({ mode: 'legacy' }) },
    animationIntensity: { type: String, default: 'normal' },
    tuningByMode: { type: Object, default: () => ({}) },
    coverUrl: { type: String, default: '' },
    clock: { type: Object, default: null },
    assets: { type: Object, default: () => ({}) },
    metadata: { type: Object, default: null },
    preview: { type: Boolean, default: false },
  },
  data: () => ({ status: 'waiting' }),
  computed: {
    statusLabel() {
      if (this.status === 'error')
        return '动画加载失败，请检查浏览器兼容性后重试';
      return this.status === 'loading'
        ? '正在准备原版歌词 PV…'
        : '等待完整歌词同步…';
    },
  },
  watch: {
    lyricDocument: 'queueBuild',
    mode: 'queueBuild',
    theme: 'appearanceChanged',
    fontSize: 'appearanceChanged',
    animationIntensity: 'updateAppearance',
    tuningByMode: {
      handler: 'updateTuning',
      deep: true,
    },
    assets: {
      handler: 'updateAssets',
      deep: true,
    },
    metadata: {
      handler: 'updateMetadata',
      deep: true,
    },
    coverUrl: 'updateAppearance',
    clock: 'queueBuild',
    position: 'updateTime',
    playing: 'updateTime',
    smartBeatSettings: { handler: 'updateSmartBeat', deep: true },
    smartBeatTrackKey: 'updateSmartBeat',
    smartBeatTimeline: 'updateSmartBeat',
    audioFeatures: 'publishAudioFeatures',
  },
  created() {
    this.pvClock = this.clock || createPvClock();
    this.pvTemperaAssetsKey = this.temperaAssetsKey();
    this.pvRuntime = null;
    this.pvRuntimeModule = null;
    this.pvLatestAudioFeatures = this.audioFeatures;
    this.pvSmartBeat = null;
    this.pvLifecycle = null;
    this.pvDisposed = false;
    this.pvQueued = false;
  },
  mounted() {
    this.pvMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.pvLifecycle = createStageLifecycle({
      createLayer: () => {
        const layer = document.createElement('div');
        layer.className = 'pv-stage-layer';
        layer.style.cssText =
          'position:absolute;inset:0;opacity:0;overflow:hidden;transition:opacity 520ms cubic-bezier(0.22,1,0.36,1) 80ms';
        this.$refs.canvasHost.appendChild(layer);
        return layer;
      },
      createRuntime: options => this.createRuntime(options),
      activate: (next, previous, duration) => {
        const paused = this.isPaused();
        next.runtime.setPaused?.(paused);
        if (paused) next.runtime.renderOnce?.();

        if (previous) {
          previous.layer.style.transition = duration
            ? 'opacity 360ms cubic-bezier(0.22,1,0.36,1)'
            : 'none';
          previous.layer.style.opacity = '0';
        }
        next.layer.style.transition = duration
          ? 'opacity 520ms cubic-bezier(0.22,1,0.36,1) 80ms'
          : 'none';
        next.layer.style.opacity = '1';
        this.pvRuntime = next.runtime;
        this.status = 'ready';
      },
      settle: stage => {
        stage.layer.style.transition = 'none';
        stage.layer.style.opacity = '1';
      },
      removeLayer: layer => {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      },
      onRuntimeError: error => this.handleRuntimeError(error),
    });
    this.pvVisibility = () => this.updateTime();
    this.pvMotionChange = () => this.queueBuild();
    document.addEventListener('visibilitychange', this.pvVisibility);
    if (this.pvMotion.addEventListener)
      this.pvMotion.addEventListener('change', this.pvMotionChange);
    else this.pvMotion.addListener(this.pvMotionChange);
    this.queueBuild();
  },
  beforeDestroy() {
    this.pvDisposed = true;
    this.pvLifecycle?.destroy();
    this.pvRuntime = null;
    document.removeEventListener('visibilitychange', this.pvVisibility);
    if (this.pvMotion?.removeEventListener)
      this.pvMotion.removeEventListener('change', this.pvMotionChange);
    else this.pvMotion?.removeListener(this.pvMotionChange);
  },
  methods: {
    isPaused() {
      // Reduced motion controls camera/effects through staticMode, not the song clock.
      return !this.playing || document.hidden;
    },
    updateTime() {
      if (!this.clock)
        this.pvClock.set(this.position, this.playing && !document.hidden);
      const paused = this.isPaused();
      this.pvRuntime?.setPaused(paused);
      if (paused) this.pvRuntime?.renderOnce();
    },
    queueBuild() {
      if (this.pvQueued || this.pvDisposed) return;
      this.pvQueued = true;
      this.$nextTick(() => {
        this.pvQueued = false;
        if (!this.pvDisposed) this.buildStage();
      });
    },
    stageTheme() {
      return createStageTheme(this.$el, this.animationIntensity || 'normal');
    },
    runtimeUpdatePatch() {
      return {
        theme: this.stageTheme(),
        fontSize: this.fontSize,
        animationIntensity: this.animationIntensity || 'normal',
        tuningByMode: this.tuningByMode || {},
        coverUrl: this.coverUrl || '',
        assets: this.assets || {},
        metadata: this.runtimeMetadata(),
        preview: this.preview,
        isDaylight: this.theme !== 'dark',
        paused: this.isPaused(),
        staticMode: Boolean(this.pvMotion?.matches),
        smartBeat: this.smartBeatPatch(),
        rawAudioClock: () => this.rawPosition,
        smartBeatPlaying: () =>
          this.playing && !document.hidden && !this.pvMotion?.matches,
      };
    },
    smartBeatPatch() {
      return {
        mode: this.mode,
        trackKey: this.smartBeatTrackKey,
        settings: this.smartBeatSettings,
        timeline: this.smartBeatTimeline,
        playing: this.playing,
      };
    },
    updateSmartBeat(patch) {
      this.pvSmartBeat = patch || this.smartBeatPatch();
      this.pvRuntime?.update?.({ smartBeat: this.pvSmartBeat });
      if (!this.pvRuntime && this.pvLifecycle?.hasPending()) this.queueBuild();
    },
    publishAudioFeatures(features = this.audioFeatures) {
      this.pvLatestAudioFeatures = features;
      this.pvRuntimeModule?.publishAudioFeatures?.(features);
    },
    runtimeMetadata() {
      if (this.metadata) return this.metadata;
      const document = this.lyricDocument || {};
      return {
        title: document.songTitle || document.title || null,
        artist: document.songArtist || document.artist || null,
        album: document.songAlbum || document.album || null,
      };
    },
    temperaAssetsKey() {
      const assets = this.assets?.temperaLayerImageAssets;
      return JSON.stringify(
        Array.isArray(assets) ? assets.map(({ id, url }) => [id, url]) : []
      );
    },
    handleRuntimeError(error) {
      if (this.pvDisposed) return;
      console.error('Folia PV renderer failed after readiness', error);
      this.pvRuntime = null;
      this.status = 'error';
    },
    appearanceChanged() {
      if (supportsRuntimeUpdateMode(this.mode)) this.updateAppearance();
      else this.queueBuild();
    },
    updateAppearance() {
      if (!supportsRuntimeUpdateMode(this.mode)) return;
      const applied = this.pvRuntime?.update?.(this.runtimeUpdatePatch());
      if (applied === false) this.queueBuild();
      if (this.pvLifecycle?.hasPending()) this.queueBuild();
    },
    updateAssets() {
      // The independent background host owns the selected background image. React lyric modes
      // update their resolved assets in place; the old Tempera Pixi API needs a stage rebuild.
      if (supportsRuntimeUpdateMode(this.mode)) this.updateAppearance();
      else if (this.mode === 'tempera') {
        const nextKey = this.temperaAssetsKey();
        if (nextKey !== this.pvTemperaAssetsKey) {
          this.pvTemperaAssetsKey = nextKey;
          this.queueBuild();
        }
      }
    },
    updateTuning() {
      const applied = this.pvRuntime?.update?.({
        tuningByMode: this.tuningByMode || {},
      });
      if (applied === false) this.queueBuild();
      if (this.pvLifecycle?.hasPending()) this.queueBuild();
    },
    updateMetadata() {
      const applied = this.pvRuntime?.update?.({
        metadata: this.runtimeMetadata(),
      });
      if (applied === false) this.queueBuild();
      if (this.pvLifecycle?.hasPending()) this.queueBuild();
    },
    async createRuntime(options) {
      const module = await loadFoliaRuntime();
      this.pvRuntimeModule = module;
      module.publishAudioFeatures?.(this.pvLatestAudioFeatures);
      if (options.signal.aborted) {
        const error = new Error('PV creation cancelled');
        error.name = 'AbortError';
        throw error;
      }
      const runtime = await module.createStage({ ...options, paused: true });
      if (options.signal.aborted) {
        runtime.destroy();
        const error = new Error('PV creation cancelled');
        error.name = 'AbortError';
        throw error;
      }
      try {
        if (supportsRuntimeUpdateMode(options.mode))
          runtime.update?.({ ...this.runtimeUpdatePatch(), paused: true });
        runtime.setPaused?.(true);
        runtime.renderOnce?.();
        return runtime;
      } catch (error) {
        try {
          runtime.destroy();
        } catch (_) {
          // Preserve the priming error so the lifecycle can report it.
        }
        throw error;
      }
    },
    async buildStage() {
      const host = this.$refs.canvasHost;
      if (!host || !this.pvLifecycle) return;
      if (!this.lyricDocument?.lines.length) {
        this.pvLifecycle.clear();
        this.pvRuntime = null;
        this.status = 'waiting';
        return;
      }
      if (!this.pvRuntime) this.status = 'loading';
      this.updateTime();
      try {
        const ready = await this.pvLifecycle.replace(
          {
            mode: this.mode,
            document: this.lyricDocument,
            clock: this.pvClock,
            ...this.runtimeUpdatePatch(),
          },
          { transitionMs: this.pvMotion?.matches || document.hidden ? 0 : 600 }
        );
        if (ready) this.updateTime();
      } catch (error) {
        if (!this.pvDisposed && error.name !== 'AbortError') {
          console.error('Folia PV initialization failed', error);
          this.status = this.pvRuntime ? 'ready' : 'error';
        }
      }
    },
  },
};
</script>

<style scoped>
.lyric-scene.pv-scene {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: 0;
}
.pv-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.pv-fallback {
  position: relative;
  text-align: center;
  padding: 24px;
  color: var(--ktv-text-primary);
}
.pv-fallback p {
  font-size: var(--ktv-active-lyric-size);
  overflow-wrap: anywhere;
}
.pv-fallback small {
  display: block;
  margin-top: 12px;
  color: var(--ktv-text-muted);
}
.pv-fallback button {
  margin-top: 16px;
  padding: 8px 16px;
  border-radius: 10px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
}
.pv-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
