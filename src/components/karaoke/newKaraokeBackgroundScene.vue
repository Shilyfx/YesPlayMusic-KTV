<template>
  <div ref="host" class="karaoke-background-stage" aria-hidden="true" />
</template>

<script>
import { createStageLifecycle } from '@/karaoke/folia/stageLifecycle';
import { loadFoliaRuntime } from '@/karaoke/folia/loadRuntime';
import { createStageTheme } from '@/karaoke/folia/stageTheme';

export default {
  name: 'KaraokeBackgroundScene',
  props: {
    lyricMode: { type: String, default: 'classic' },
    background: {
      type: Object,
      default: () => ({
        mode: 'legacy',
        tuning: {},
        assetId: null,
        transparent: false,
        opacity: 1,
      }),
    },
    clock: { type: Object, required: true },
    theme: { type: String, default: 'light' },
    animationIntensity: { type: String, default: 'normal' },
    coverUrl: { type: String, default: '' },
    seed: { type: String, default: '' },
    assets: { type: Object, default: () => ({}) },
    playing: { type: Boolean, default: false },
  },
  data: () => ({ staticMode: false }),
  watch: {
    lyricMode: 'syncStage',
    background: {
      handler: 'syncStage',
      deep: true,
    },
    theme: 'syncStage',
    animationIntensity: 'syncStage',
    coverUrl: 'syncStage',
    seed: 'syncStage',
    assets: 'syncStage',
    playing: 'syncStage',
  },
  created() {
    this.backgroundLifecycle = null;
    this.backgroundRuntime = null;
    this.backgroundMode = 'legacy';
    this.backgroundQueued = false;
    this.backgroundDisposed = false;
    this.backgroundRuntimeModule = null;
    this.backgroundLatestAudioFeatures = null;
    this.motionPreference = null;
    this.motionPreferenceChange = null;
    this.visibilityChange = null;
  },
  mounted() {
    this.motionPreference = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    );
    this.staticMode = Boolean(this.motionPreference.matches);
    this.motionPreferenceChange = event => {
      this.staticMode = Boolean(event.matches);
      this.syncStage();
    };
    if (this.motionPreference.addEventListener)
      this.motionPreference.addEventListener(
        'change',
        this.motionPreferenceChange
      );
    else this.motionPreference.addListener(this.motionPreferenceChange);
    this.visibilityChange = () =>
      this.backgroundRuntime?.setPaused?.(this.isPaused());
    document.addEventListener('visibilitychange', this.visibilityChange);

    const host = this.$refs.host;
    this.backgroundLifecycle = createStageLifecycle({
      createLayer: () => {
        const layer = document.createElement('div');
        layer.className = 'karaoke-background-layer';
        layer.style.cssText =
          'position:absolute;inset:0;overflow:hidden;opacity:0;pointer-events:none';
        host.appendChild(layer);
        return layer;
      },
      createRuntime: options => this.createRuntime(options),
      activate: (next, previous, duration) => {
        next.runtime.setPaused?.(this.isPaused());
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
        this.backgroundRuntime = next.runtime;
        this.backgroundMode = this.effectiveBackgroundMode();
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
    this.syncStage();
  },
  beforeDestroy() {
    this.backgroundDisposed = true;
    this.backgroundLifecycle?.destroy();
    this.backgroundRuntime = null;
    document.removeEventListener('visibilitychange', this.visibilityChange);
    if (this.motionPreference?.removeEventListener)
      this.motionPreference.removeEventListener(
        'change',
        this.motionPreferenceChange
      );
    else this.motionPreference?.removeListener(this.motionPreferenceChange);
  },
  methods: {
    publishAudioFeatures(features) {
      this.backgroundLatestAudioFeatures = features;
      this.backgroundRuntimeModule?.publishAudioFeatures?.(features);
    },
    handleRuntimeError(error) {
      if (this.backgroundDisposed) return;
      console.error('Folia background renderer failed after readiness', error);
      this.backgroundRuntime = null;
    },
    effectiveBackgroundMode() {
      return this.lyricMode === 'still'
        ? 'legacy'
        : this.background?.mode || 'legacy';
    },
    isPaused() {
      return !this.playing || document.hidden;
    },
    stageTheme() {
      return createStageTheme(
        this.$refs.host,
        this.animationIntensity || 'normal'
      );
    },
    runtimeOptions() {
      return {
        lyricMode: this.lyricMode,
        background: this.background || { mode: 'legacy' },
        clock: this.clock,
        theme: this.stageTheme(),
        isDaylight: this.theme !== 'dark',
        coverUrl: this.coverUrl || '',
        seed: this.seed || '',
        assets: this.assets || {},
        paused: this.isPaused(),
        staticMode: this.staticMode,
      };
    },
    async createRuntime(options) {
      const module = await loadFoliaRuntime();
      this.backgroundRuntimeModule = module;
      module.publishAudioFeatures?.(this.backgroundLatestAudioFeatures);
      if (options.signal.aborted) {
        const error = new Error('Background creation cancelled');
        error.name = 'AbortError';
        throw error;
      }
      return module.createBackgroundStage({
        ...options,
        ...this.runtimeOptions(),
      });
    },
    syncStage() {
      if (this.backgroundQueued || this.backgroundDisposed) return;
      this.backgroundQueued = true;
      this.$nextTick(() => {
        this.backgroundQueued = false;
        if (!this.backgroundDisposed) this.updateBackground();
      });
    },
    updateBackground() {
      if (!this.backgroundLifecycle) return;
      const mode = this.effectiveBackgroundMode();
      if (mode === 'legacy') {
        this.backgroundLifecycle.clear();
        this.backgroundRuntime = null;
        this.backgroundMode = 'legacy';
        return;
      }

      const options = this.runtimeOptions();
      if (this.backgroundRuntime && this.backgroundMode === mode) {
        if (this.backgroundLifecycle.hasPending())
          this.backgroundLifecycle.cancelPending();
        const applied = this.backgroundRuntime.update?.(options);
        if (applied !== false) {
          this.backgroundRuntime.setPaused?.(this.isPaused());
          return;
        }
      }
      if (!this.backgroundRuntime) this.backgroundMode = mode;
      this.backgroundLifecycle
        .replace(
          { ...options, mode },
          { transitionMs: this.staticMode || document.hidden ? 0 : 600 }
        )
        .catch(error => {
          if (!this.backgroundDisposed && error.name !== 'AbortError') {
            console.error('Folia background initialization failed', error);
          }
        });
    },
  },
};
</script>

<style scoped>
.karaoke-background-stage {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
