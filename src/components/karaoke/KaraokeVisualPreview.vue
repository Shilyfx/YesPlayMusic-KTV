<template>
  <section
    class="ktv-visual-preview"
    :style="position"
    :aria-label="`实时预览：${label || value}`"
  >
    <div class="ktv-visual-preview-stage" :data-preview-kind="kind">
      <div
        v-if="isRuntimePreview"
        ref="runtimeHost"
        class="ktv-visual-preview-runtime"
        aria-hidden="true"
      />
      <KaraokeLyricScene
        v-if="isLocalScenePreview && previewStatus === 'ready'"
        class="ktv-visual-preview-local"
        :mode="localSceneMode"
        :lines="localLines"
        :cue-key="`visual-preview-${localLines.index}`"
        :playing="true"
        :lyric-document="previewDocument"
        :position="previewPosition"
        :raw-position="previewPosition"
        theme="dark"
        :font-size="25"
        :background="legacyBackground"
        :preview="true"
      />
      <p
        v-if="kind === 'background' && previewStatus === 'ready'"
        class="ktv-visual-preview-lyric"
        aria-hidden="true"
      >
        夜风沿着海岸
      </p>
      <p
        v-if="previewStatus === 'waiting' || previewStatus === 'loading'"
        class="ktv-visual-preview-status"
        role="status"
      >
        正在准备实时预览…
      </p>
      <p
        v-else-if="previewStatus === 'error'"
        class="ktv-visual-preview-status"
        role="status"
      >
        此样式暂不可预览
      </p>
    </div>
    <div class="ktv-visual-preview-caption">
      <span>实时效果</span>
      <strong>{{ label || value }}</strong>
    </div>
  </section>
</template>

<script>
import KaraokeLyricScene from './KaraokeLyricScene.vue';
import { loadFoliaRuntime } from '@/karaoke/folia/loadRuntime';
import { createStageTheme } from '@/karaoke/folia/stageTheme';
import {
  buildVisualPreviewRuntimeOptions,
  createPreviewDemoClock,
  createFullscreenPreviewMount,
  createVisualPreviewController,
  isFoliaPreviewMode,
  getPreviewLyricState,
  VISUAL_PREVIEW_DOCUMENT,
} from '@/karaoke/visualPreview';

const PREVIEW_DURATION = VISUAL_PREVIEW_DOCUMENT.duration;

export default {
  name: 'KaraokeVisualPreview',
  components: { KaraokeLyricScene },
  props: {
    active: { type: Boolean, default: false },
    kind: { type: String, required: true },
    value: { type: String, required: true },
    label: { type: String, default: '' },
    theme: { type: String, default: 'light' },
    position: { type: Object, default: () => ({}) },
  },
  data: () => ({ previewStatus: 'idle', previewPosition: 0 }),
  computed: {
    isLocalScenePreview() {
      return (
        (this.kind === 'mode' && !isFoliaPreviewMode(this.value)) ||
        (this.kind === 'background' && this.value === 'legacy')
      );
    },
    isRuntimePreview() {
      return !this.isLocalScenePreview;
    },
    localSceneMode() {
      return this.kind === 'mode' ? this.value : 'classic';
    },
    localLines() {
      return getPreviewLyricState(this.previewPosition);
    },
    previewDocument() {
      return VISUAL_PREVIEW_DOCUMENT;
    },
    legacyBackground() {
      return {
        mode: 'legacy',
        tuning: {},
        assetId: null,
        transparent: false,
        opacity: 1,
      };
    },
  },
  watch: {
    active: 'syncPreview',
    kind: 'syncPreview',
    value: 'syncPreview',
    theme: 'syncPreview',
  },
  created() {
    this.previewController = null;
    this.previewVisibilityChange = null;
    this.previewDemoClock = null;
    this.previewMount = null;
    this.previewSourceParent = null;
  },
  mounted() {
    this.previewSourceParent = this.$el.parentNode;
    this.syncThemeVariables();
    this.previewMount = createFullscreenPreviewMount(this.$el, document);
    this.previewDemoClock = createPreviewDemoClock({
      onTick: position => {
        this.previewPosition = position;
      },
    });
    this.previewController = createVisualPreviewController({
      createRuntime: (request, context) =>
        this.createPreviewRuntime(request, context),
      onState: state => {
        this.previewStatus = state.status;
      },
    });
    this.previewVisibilityChange = () => this.syncPreview();
    document.addEventListener('visibilitychange', this.previewVisibilityChange);
    this.syncPreview();
  },
  beforeDestroy() {
    document.removeEventListener(
      'visibilitychange',
      this.previewVisibilityChange
    );
    this.previewController?.destroy();
    this.previewController = null;
    this.previewDemoClock?.destroy();
    this.previewDemoClock = null;
    this.previewMount?.destroy();
    this.previewMount = null;
  },
  methods: {
    syncThemeVariables() {
      if (!this.previewSourceParent) return;
      const sourceStyle = getComputedStyle(this.previewSourceParent);
      [
        '--ktv-bg-base',
        '--ktv-glass-border',
        '--ktv-glass-soft',
        '--ktv-text-primary',
        '--ktv-text-secondary',
        '--ktv-accent',
        '--ktv-accent-strong',
        '--ktv-shadow',
      ].forEach(variable => {
        const value = sourceStyle.getPropertyValue(variable).trim();
        if (value) this.$el.style.setProperty(variable, value);
        else this.$el.style.removeProperty(variable);
      });
    },
    syncPreview() {
      if (!this.previewController) return;
      this.syncThemeVariables();
      const visible =
        this.active &&
        typeof document !== 'undefined' &&
        document.visibilityState !== 'hidden' &&
        !document.hidden;
      if (visible && this.isLocalScenePreview) this.startLocalPreviewClock();
      else this.stopLocalPreviewClock();
      this.previewController.show(
        visible
          ? {
              kind: this.kind,
              value: this.value,
              theme: this.theme,
              visible: true,
            }
          : null
      );
    },
    startLocalPreviewClock() {
      this.previewDemoClock?.start();
    },
    stopLocalPreviewClock() {
      this.previewDemoClock?.stop();
    },
    async createPreviewRuntime(request, { signal }) {
      if (request.kind === 'mode' && !isFoliaPreviewMode(request.value))
        return { destroy() {} };
      if (request.kind === 'background' && request.value === 'legacy')
        return { destroy() {} };

      const host = this.$refs.runtimeHost;
      if (!host) throw new Error('VISUAL_PREVIEW_HOST_UNAVAILABLE');

      const module = await loadFoliaRuntime();
      if (signal.aborted) {
        const error = new Error('Visual preview creation cancelled');
        error.name = 'AbortError';
        throw error;
      }
      const startedAt = performance.now();
      const clock = {
        get: () => ((performance.now() - startedAt) / 1000) % PREVIEW_DURATION,
      };
      const options = buildVisualPreviewRuntimeOptions({
        kind: request.kind,
        value: request.value,
        host,
        signal,
        clock,
        theme: createStageTheme(this.$el, 'normal'),
        isDaylight: request.theme !== 'dark',
      });

      if (request.kind === 'background')
        return module.createBackgroundStage(options);
      return module.createStage(options);
    },
  },
};
</script>

<style scoped>
.ktv-visual-preview {
  position: fixed;
  z-index: 1400;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 12px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.06));
}

.ktv-visual-preview-stage {
  position: relative;
  height: 132px;
  overflow: hidden;
  background: radial-gradient(
      circle at 72% 24%,
      rgba(181, 155, 255, 0.28),
      transparent 43%
    ),
    linear-gradient(135deg, #171525, #08090f 78%);
  color: #f4f4f5;
}

.ktv-visual-preview-runtime {
  position: absolute;
  inset: 0;
}

.ktv-visual-preview-local,
.ktv-visual-preview-lyric {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.ktv-visual-preview-lyric {
  margin: 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 22px;
  font-weight: 600;
  text-shadow: 0 2px 18px rgba(147, 125, 255, 0.48);
}

.ktv-visual-preview-status {
  position: absolute;
  z-index: 3;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  background: rgba(10, 10, 15, 0.35);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  pointer-events: none;
}

.ktv-visual-preview-caption {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.62));
  font-size: 10px;
}

.ktv-visual-preview-caption strong {
  overflow: hidden;
  color: var(--ktv-text-primary, #fff);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ktv-visual-preview-local >>> .lyric-stage-shell {
  width: 100%;
  min-height: 0;
  height: 100%;
}

.ktv-visual-preview-local >>> .lyric-scene {
  width: 100%;
  min-height: 0;
  height: 100%;
  padding: 12px;
}

.ktv-visual-preview-local >>> .scene-past,
.ktv-visual-preview-local >>> .scene-next,
.ktv-visual-preview-local >>> .scene-later {
  font-size: 12px;
}

.ktv-visual-preview-local >>> .scene-now {
  font-size: 22px;
}
</style>
