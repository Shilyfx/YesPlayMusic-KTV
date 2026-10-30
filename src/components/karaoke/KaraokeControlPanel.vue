<template>
  <transition name="ktv-control-panel" appear>
    <section
      v-if="open"
      id="karaoke-control-panel"
      ref="panel"
      class="ktv-control-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="ktv-control-title"
      tabindex="-1"
    >
      <header class="ktv-control-header">
        <div class="ktv-track-cover">
          <img
            v-if="trackCover"
            :src="trackCover"
            :alt="`${trackTitle} 封面`"
          />
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div class="ktv-track-copy">
          <p class="ktv-eyebrow">正在演唱</p>
          <h2 id="ktv-control-title" :title="trackTitle">{{ trackTitle }}</h2>
          <p :title="trackArtist">{{ trackArtist }}</p>
        </div>
        <button
          ref="closeButton"
          class="ktv-icon-button ktv-close-button"
          type="button"
          aria-label="关闭演唱控制"
          @click="requestClose"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m18 6-12 12M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div class="ktv-control-content">
        <section
          v-if="!isFollower"
          class="ktv-control-section"
          aria-label="音量控制"
        >
          <div class="ktv-volume-row">
            <svg class="ktv-volume-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" />
              <path v-if="volumeValue > 0" d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path v-if="volumeValue > 0.5" d="M18.5 5.5a9 9 0 0 1 0 13" />
              <path v-if="volumeValue === 0" d="m16 9 5 6m0-6-5 6" />
            </svg>
            <label class="ktv-range-label" for="ktv-main-volume">音量</label>
            <input
              id="ktv-main-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="volumeValue"
              :aria-valuetext="`${Math.round(volumeValue * 100)}%`"
              @input="onVolumeInput"
            />
            <output class="ktv-value ktv-volume-value" for="ktv-main-volume">
              {{ Math.round(volumeValue * 100) }}%
            </output>
          </div>
        </section>

        <section
          class="ktv-control-section ktv-lyric-section"
          aria-label="歌词样式"
        >
          <div v-if="modeOptions.length" class="ktv-mode-control">
            <div class="ktv-mode-heading">
              <span class="ktv-field-label">展示方式</span>
              <div class="ktv-stepper">
                <button
                  class="ktv-icon-button ktv-step-button"
                  type="button"
                  aria-label="上一个歌词展示方式"
                  :disabled="modeOptions.length < 2 || isFollowLocked('style')"
                  @click="stepMode(-1)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <button
                  ref="modeTrigger"
                  class="ktv-mode-trigger"
                  type="button"
                  :disabled="isFollowLocked('style')"
                  aria-haspopup="listbox"
                  aria-controls="ktv-mode-listbox"
                  :aria-expanded="openPicker === 'mode' ? 'true' : 'false'"
                  @click="togglePicker('mode')"
                >
                  <span
                    class="ktv-mode-mark ktv-option-thumbnail"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" focusable="false">
                      <component
                        :is="shape.tag"
                        v-for="(shape, shapeIndex) in visualThumbnailShapes(
                          'mode',
                          config.mode
                        )"
                        :key="shapeIndex"
                        v-bind="shape.attrs"
                      />
                    </svg>
                  </span>
                  <span class="ktv-mode-trigger-copy">
                    <span class="ktv-mode-caption">当前方式</span>
                    <span class="ktv-mode-name">{{ modeLabel }}</span>
                  </span>
                  <svg
                    class="ktv-chevron"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <button
                  class="ktv-icon-button ktv-step-button"
                  type="button"
                  aria-label="下一个歌词展示方式"
                  :disabled="modeOptions.length < 2 || isFollowLocked('style')"
                  @click="stepMode(1)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              <div
                v-if="openPicker === 'mode'"
                class="ktv-picker-stack"
                @mouseleave="clearPreviewHover('mode')"
              >
                <div
                  id="ktv-mode-listbox"
                  class="ktv-option-list"
                  role="listbox"
                  aria-label="歌词展示方式"
                  @keydown="onPickerKeyDown($event, 'mode')"
                  @focusout="onPickerFocusOut($event, 'mode')"
                >
                  <button
                    v-for="(option, index) in modeOptions"
                    :key="String(option.value)"
                    ref="modeOptionButtons"
                    class="ktv-option"
                    :class="{ selected: option.value === config.mode }"
                    type="button"
                    role="option"
                    :tabindex="activePickerIndex === index ? 0 : -1"
                    :disabled="isFollowLocked('style')"
                    :aria-selected="
                      option.value === config.mode ? 'true' : 'false'
                    "
                    @mouseenter="setPreviewHover('mode', option.value, $event)"
                    @focus="setPreviewHover('mode', option.value, $event)"
                    @click="selectOption('mode', option.value, 'mode')"
                  >
                    <span class="ktv-option-thumbnail" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <component
                          :is="shape.tag"
                          v-for="(shape, shapeIndex) in visualThumbnailShapes(
                            'mode',
                            option.value
                          )"
                          :key="shapeIndex"
                          v-bind="shape.attrs"
                        />
                      </svg>
                    </span>
                    <span>{{ option.label }}</span>
                    <svg
                      v-if="option.value === config.mode"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="ktv-field-block">
            <span class="ktv-field-label">歌词字效</span>
            <div class="ktv-effect-picker" role="group" aria-label="歌词字效">
              <button
                v-for="option in effectOptions"
                :key="option.value"
                type="button"
                :class="{ selected: effectValue === option.value }"
                :aria-pressed="effectValue === option.value"
                :disabled="!canEditEffect"
                @click="emitChange('effect', option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="ktv-field-block ktv-size-control">
            <div class="ktv-field-heading">
              <label class="ktv-field-label" for="ktv-font-size"
                >歌词字号</label
              >
              <output class="ktv-value" for="ktv-font-size"
                >{{ fontSizeValue }} px</output
              >
            </div>
            <input
              id="ktv-font-size"
              type="range"
              min="16"
              max="64"
              step="1"
              :value="fontSizeValue"
              :aria-valuetext="`${fontSizeValue} 像素`"
              :disabled="!canEditFontSize"
              @input="onFontSizeInput"
            />
          </div>

          <div class="ktv-field-block ktv-offset-control">
            <div class="ktv-offset-copy">
              <label class="ktv-field-label" for="ktv-sync-offset"
                >歌词同步</label
              >
              <p id="ktv-sync-offset-help">正值提前，负值延迟</p>
            </div>
            <div class="ktv-offset-stepper">
              <button
                class="ktv-icon-button ktv-step-button"
                type="button"
                aria-label="歌词延迟 0.1 秒"
                :disabled="offsetValue <= -10 || isFollowLocked('timing')"
                @click="stepOffset(-1)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19 12H5m7 7-7-7 7-7" />
                </svg>
              </button>
              <div class="ktv-offset-input-wrap">
                <input
                  id="ktv-sync-offset"
                  type="number"
                  min="-10"
                  max="10"
                  step="0.1"
                  :value="offsetValue.toFixed(1)"
                  aria-label="歌词同步偏移秒数"
                  aria-describedby="ktv-sync-offset-help"
                  :disabled="isFollowLocked('timing')"
                  @change="commitNumber('offset', $event, -10, 10, 1)"
                />
                <span aria-hidden="true">秒</span>
              </div>
              <button
                class="ktv-icon-button ktv-step-button"
                type="button"
                aria-label="歌词提前 0.1 秒"
                :disabled="offsetValue >= 10 || isFollowLocked('timing')"
                @click="stepOffset(1)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14m-7-7 7 7-7 7" />
                </svg>
              </button>
              <button
                class="ktv-zero-button"
                type="button"
                :disabled="isFollowLocked('timing')"
                @click="emitChange('offset', 0)"
              >
                归零
              </button>
            </div>
          </div>

          <div class="ktv-field-block ktv-theme-control">
            <span class="ktv-field-label">舞台主题</span>
            <div class="ktv-theme-picker" role="group" aria-label="舞台主题">
              <button
                v-for="option in themeOptions"
                :key="option.value"
                type="button"
                :class="{ selected: themeValue === option.value }"
                :aria-pressed="themeValue === option.value"
                :disabled="isFollowLocked('theme')"
                @click="emitChange('theme', option.value)"
              >
                <svg
                  v-if="option.value === 'light'"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path
                    d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"
                  />
                </svg>
                <svg
                  v-else-if="option.value === 'dark'"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
                </svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 3v18a9 9 0 0 0 0-18Z" />
                </svg>
                {{ option.label }}
              </button>
            </div>
            <details class="ktv-custom-theme">
              <summary class="ktv-custom-theme-summary">
                <span class="ktv-field-label">自定义舞台颜色</span>
              </summary>
              <div class="ktv-custom-theme-grid">
                <button
                  class="ktv-custom-theme-reset"
                  type="button"
                  :disabled="isFollowLocked('theme') || !config.customTheme"
                  @click="emitChange('customTheme', null)"
                >
                  使用默认配色
                </button>
                <label
                  v-for="color in customThemeColors"
                  :key="color.key"
                  class="ktv-custom-color"
                >
                  <span>{{ color.label }}</span>
                  <input
                    type="color"
                    :value="customThemeValue(color.key)"
                    :aria-label="color.label"
                    :disabled="isFollowLocked('theme')"
                    @input="onCustomThemeColor(color.key, $event.target.value)"
                  />
                </label>
              </div>
            </details>
          </div>
          <div v-if="supportsIntensity" class="ktv-intensity-row">
            <span class="ktv-field-label">动态强度</span>
            <button
              class="ktv-intensity-button"
              type="button"
              :disabled="isFollowLocked('style')"
              :aria-label="`动态强度：${intensityLabel}，点击切换`"
              @click="cycleAnimationIntensity"
            >
              {{ intensityLabel }}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5" />
                <path d="M5.6 9A7 7 0 0 1 17 6l3 6M4 12l3 6a7 7 0 0 0 11.4-3" />
              </svg>
            </button>
          </div>

          <section
            v-if="!isFollower"
            class="ktv-random-style"
            aria-label="随机歌词样式"
          >
            <div class="ktv-random-heading">
              <label class="ktv-random-toggle">
                <input
                  type="checkbox"
                  :checked="randomEnabled"
                  :disabled="isFollowLocked('style')"
                  @change="setRandomEnabled($event.target.checked)"
                />
                <span class="ktv-field-label">每首歌随机一种样式</span>
              </label>
              <button
                type="button"
                :disabled="
                  !randomEnabled ||
                  !randomPool.length ||
                  isFollowLocked('style')
                "
                @click="emitChange('random.reroll', true)"
              >
                重抽本首
              </button>
            </div>
            <p>按歌曲选择一次；当前样式不会与下一首重复。</p>
            <details class="ktv-random-pool-details">
              <summary class="ktv-collapsible-summary">
                <span>随机样式池</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <div
                class="ktv-random-pool"
                role="group"
                aria-label="随机样式范围"
              >
                <label
                  v-for="option in modeOptions"
                  :key="String(option.value)"
                  class="ktv-random-option"
                >
                  <input
                    type="checkbox"
                    :checked="isInRandomPool(option.value)"
                    :disabled="isFollowLocked('style')"
                    @change="
                      toggleRandomPool(option.value, $event.target.checked)
                    "
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </details>
          </section>

          <details v-if="showModeTuning" class="ktv-mode-tuning">
            <summary class="ktv-collapsible-summary">
              <span>歌词显示调节</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <KaraokeVisualTuning
              :mode="config.mode || 'classic'"
              :config="config"
              :disabled="isFollowLocked('style')"
              @change="handleVisualTuningChange"
              @asset="relayAsset"
            />
          </details>
        </section>

        <section
          v-if="backgroundOptions.length"
          class="ktv-control-section ktv-background-section"
          aria-label="背景设置"
        >
          <div class="ktv-background-heading">
            <span class="ktv-field-label">舞台背景</span>
            <button
              ref="backgroundTrigger"
              class="ktv-background-trigger"
              type="button"
              :disabled="isFollowLocked('background')"
              aria-haspopup="listbox"
              aria-controls="ktv-background-listbox"
              :aria-expanded="openPicker === 'background' ? 'true' : 'false'"
              @click="togglePicker('background')"
            >
              <span class="ktv-option-thumbnail" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <component
                    :is="shape.tag"
                    v-for="(shape, shapeIndex) in visualThumbnailShapes(
                      'background',
                      backgroundMode
                    )"
                    :key="shapeIndex"
                    v-bind="shape.attrs"
                  />
                </svg>
              </span>
              <span>{{ backgroundLabel }}</span>
              <svg class="ktv-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          <div
            v-if="openPicker === 'background'"
            class="ktv-picker-stack"
            @mouseleave="clearPreviewHover('background')"
          >
            <div
              id="ktv-background-listbox"
              class="ktv-option-list"
              role="listbox"
              aria-label="舞台背景"
              @keydown="onPickerKeyDown($event, 'background')"
              @focusout="onPickerFocusOut($event, 'background')"
            >
              <button
                v-for="(option, index) in backgroundOptions"
                :key="String(option.value)"
                ref="backgroundOptionButtons"
                class="ktv-option"
                :class="{ selected: option.value === backgroundMode }"
                type="button"
                role="option"
                :tabindex="activePickerIndex === index ? 0 : -1"
                :disabled="isFollowLocked('background')"
                :aria-selected="
                  option.value === backgroundMode ? 'true' : 'false'
                "
                @mouseenter="
                  setPreviewHover('background', option.value, $event)
                "
                @focus="setPreviewHover('background', option.value, $event)"
                @click="
                  selectOption('background.mode', option.value, 'background')
                "
              >
                <span class="ktv-option-thumbnail" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <component
                      :is="shape.tag"
                      v-for="(shape, shapeIndex) in visualThumbnailShapes(
                        'background',
                        option.value
                      )"
                      :key="shapeIndex"
                      v-bind="shape.attrs"
                    />
                  </svg>
                </span>
                <span>{{ option.label }}</span>
                <svg
                  v-if="option.value === backgroundMode"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </button>
            </div>
          </div>
          <div class="ktv-background-independent">
            <label>
              <span>透明背景</span>
              <input
                type="checkbox"
                :checked="backgroundTransparent"
                :disabled="isFollowLocked('background')"
                @change="
                  emitChange('background.transparent', $event.target.checked)
                "
              />
            </label>
            <div>
              <div class="ktv-background-opacity-heading">
                <label for="ktv-background-opacity">背景不透明度</label>
                <output for="ktv-background-opacity"
                  >{{ Math.round(backgroundOpacity * 100) }}%</output
                >
              </div>
              <input
                id="ktv-background-opacity"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="backgroundOpacity"
                :disabled="isFollowLocked('background')"
                @input="
                  emitChange('background.opacity', Number($event.target.value))
                "
              />
            </div>
          </div>
          <details v-if="showBackgroundTuning" class="ktv-background-tuning">
            <summary class="ktv-collapsible-summary">
              <span>背景高级调节</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <KaraokeVisualTuning
              scope="background"
              :background-mode="backgroundMode || 'legacy'"
              :config="config"
              :disabled="isFollowLocked('background')"
              @change="handleVisualTuningChange"
              @asset="relayAsset"
            />
          </details>
        </section>

        <section
          v-if="isFollower"
          class="ktv-control-section ktv-follow-section"
          aria-label="跟随设置"
        >
          <span class="ktv-field-label">跟随主屏幕</span>
          <button
            class="ktv-follow-option"
            type="button"
            role="switch"
            :aria-checked="
              visibleFollowOptions.every(option => isFollowing(option.key))
                ? 'true'
                : 'false'
            "
            @click="toggleAllFollow"
          >
            <span>全部跟随主屏幕</span>
            <span
              class="ktv-switch"
              :class="{
                active: visibleFollowOptions.every(option =>
                  isFollowing(option.key)
                ),
              }"
              aria-hidden="true"
              ><span></span
            ></span>
          </button>
          <button
            v-for="option in visibleFollowOptions"
            :key="option.key"
            class="ktv-follow-option"
            type="button"
            role="switch"
            :aria-checked="isFollowing(option.key) ? 'true' : 'false'"
            @click="toggleFollow(option.key)"
          >
            <span>{{ option.label }}</span>
            <span
              class="ktv-switch"
              :class="{ active: isFollowing(option.key) }"
              aria-hidden="true"
            >
              <span></span>
            </span>
          </button>
        </section>

        <slot
          name="extra"
          :config="config"
          :track="track"
          :is-follower="isFollower"
        ></slot>
        <slot></slot>
      </div>
      <KaraokeVisualPreview
        v-if="openPicker && hoveredPreview"
        :active="openPicker === hoveredPreview.kind"
        :kind="hoveredPreview.kind"
        :value="hoveredPreview.value"
        :label="previewLabel(hoveredPreview.kind, hoveredPreview.value)"
        :theme="previewTheme"
        :position="previewPosition"
      />
    </section>
  </transition>
</template>

<script>
import KaraokeVisualPreview from './KaraokeVisualPreview.vue';
import KaraokeVisualTuning from './KaraokeVisualTuning.vue';
import {
  getVisualBackgroundMetadata,
  getVisualModeMetadata,
} from '@/karaoke/visualCatalog';
import { getVisualThumbnailShapes } from '@/karaoke/visualPreview';

const EFFECT_OPTIONS = [
  { value: 'gradient', label: '渐变' },
  { value: 'neon', label: '霓虹' },
  { value: 'outline', label: '描边' },
  { value: 'solid', label: '纯色' },
];

const THEME_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const FOLLOW_OPTIONS = [
  { key: 'style', label: '歌词样式' },
  { key: 'timing', label: '歌词同步' },
  { key: 'background', label: '舞台背景' },
  { key: 'theme', label: '舞台主题' },
];

const CUSTOM_THEME_COLORS = [
  { key: 'background', label: '舞台底色' },
  { key: 'text', label: '歌词文字' },
  { key: 'accent', label: '强调色' },
  { key: 'accentStrong', label: '辅助强调色' },
];

const DEFAULT_THEME_PALETTES = {
  light: {
    background: '#f5f5f4',
    text: '#1c1917',
    accent: '#4b79f1',
    accentStrong: '#44403c',
  },
  dark: {
    background: '#09090b',
    text: '#f4f4f5',
    accent: '#4b79f1',
    accentStrong: '#71717a',
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default {
  name: 'KaraokeControlPanel',
  components: { KaraokeVisualPreview, KaraokeVisualTuning },
  props: {
    open: { type: Boolean, default: false },
    config: { type: Object, default: () => ({}) },
    modeOptions: { type: Array, default: () => [] },
    backgroundOptions: { type: Array, default: () => [] },
    isFollower: { type: Boolean, default: false },
    volume: { type: Number, default: 1 },
    track: { type: Object, default: () => ({}) },
    follows: { type: Object, default: () => ({}) },
    capabilities: { type: Object, default: () => ({}) },
    // DOM element, Vue component ref, or resolver used when mounting already open.
    returnFocusTo: { type: [Object, Function], default: null },
  },
  data() {
    return {
      openPicker: null,
      hoveredPreview: null,
      previewPosition: null,
      activePickerIndex: -1,
      focusOrigin: null,
      documentListenersAttached: false,
      effectOptions: EFFECT_OPTIONS,
      themeOptions: THEME_OPTIONS,
      followOptions: FOLLOW_OPTIONS,
      customThemeColors: CUSTOM_THEME_COLORS,
    };
  },
  computed: {
    trackTitle() {
      return (
        this.track.name ||
        this.track.title ||
        this.track.trackName ||
        '暂无正在播放的歌曲'
      );
    },
    trackArtist() {
      const artists = this.track.ar || this.track.artists;
      if (Array.isArray(artists) && artists.length) {
        return artists
          .map(artist =>
            typeof artist === 'string' ? artist : artist && artist.name
          )
          .filter(Boolean)
          .join(' / ');
      }
      return this.track.artist || this.track.artistName || '准备好开始演唱';
    },
    trackCover() {
      return (
        (this.track.al && this.track.al.picUrl) ||
        this.track.coverUrl ||
        this.track.picUrl ||
        ''
      );
    },
    volumeValue() {
      const value = Number(this.volume);
      return clamp(Number.isFinite(value) ? value : 0, 0, 1);
    },
    modeLabel() {
      const option = this.modeOptions.find(
        item => item.value === this.config.mode
      );
      return option ? option.label : this.config.mode || '选择歌词方式';
    },
    effectValue() {
      return EFFECT_OPTIONS.some(option => option.value === this.config.effect)
        ? this.config.effect
        : 'gradient';
    },
    canEditEffect() {
      return (
        !(this.capabilities && this.capabilities.effect === false) &&
        !this.isFollowLocked('style')
      );
    },
    fontSizeValue() {
      const value = Number(this.config.fontSize);
      return clamp(Number.isFinite(value) ? Math.round(value) : 45, 16, 64);
    },
    canEditFontSize() {
      return (
        !(this.capabilities && this.capabilities.fontSize === false) &&
        !this.isFollowLocked('style')
      );
    },
    offsetValue() {
      const value = Number(this.config.offset);
      return (
        Math.round(clamp(Number.isFinite(value) ? value : 0, -10, 10) * 10) / 10
      );
    },
    themeValue() {
      return THEME_OPTIONS.some(option => option.value === this.config.theme)
        ? this.config.theme
        : 'auto';
    },
    backgroundMode() {
      return this.config.background && this.config.background.mode;
    },
    backgroundLabel() {
      const option = this.backgroundOptions.find(
        item => item.value === this.backgroundMode
      );
      return option ? option.label : this.backgroundMode || '选择背景';
    },
    backgroundOpacity() {
      const value = Number(
        this.config.background && this.config.background.opacity
      );
      return clamp(Number.isFinite(value) ? value : 1, 0, 1);
    },
    backgroundTransparent() {
      return Boolean(
        this.config.background && this.config.background.transparent
      );
    },
    showBackgroundTuning() {
      const metadata = getVisualBackgroundMetadata(this.backgroundMode);
      return Boolean(
        metadata && (metadata.fields.length || metadata.assetActions.length)
      );
    },
    showModeTuning() {
      const metadata = getVisualModeMetadata(this.config.mode || 'classic');
      return Boolean(
        metadata && (metadata.fields.length || metadata.assetActions.length)
      );
    },
    previewTheme() {
      return (
        this.config.resolvedTheme ||
        (this.config.theme === 'dark' ? 'dark' : 'light')
      );
    },
    randomEnabled() {
      return Boolean(this.config.random && this.config.random.enabled);
    },
    randomPool() {
      return this.config.random && Array.isArray(this.config.random.pool)
        ? this.config.random.pool
        : [];
    },
    supportsIntensity() {
      return Boolean(this.capabilities && this.capabilities.intensity === true);
    },
    intensityValue() {
      return ['calm', 'normal', 'chaotic'].includes(
        this.config.animationIntensity
      )
        ? this.config.animationIntensity
        : 'normal';
    },
    intensityLabel() {
      return {
        calm: '舒缓',
        normal: '标准',
        chaotic: '热烈',
      }[this.intensityValue];
    },
    visibleFollowOptions() {
      return this.followOptions.filter(
        option =>
          option.key !== 'background' || this.backgroundOptions.length > 0
      );
    },
  },
  watch: {
    openPicker() {
      this.hoveredPreview = null;
      this.previewPosition = null;
    },
    open(isOpen, wasOpen) {
      if (isOpen) {
        if (!wasOpen) this.rememberFocusOrigin();
        this.$nextTick(() => {
          if (!this.open) return;
          this.addDocumentListeners();
          this.focusCloseButton();
        });
        return;
      }

      this.removeDocumentListeners();
      this.openPicker = null;
      this.hoveredPreview = null;
      this.previewPosition = null;
      this.activePickerIndex = -1;
      if (wasOpen) this.restoreFocusOrigin();
    },
    follows: {
      deep: true,
      handler() {
        this.closePickerIfFollowed();
      },
    },
    isFollower() {
      this.closePickerIfFollowed();
    },
  },
  mounted() {
    if (this.open) {
      this.rememberFocusOrigin(true);
      this.addDocumentListeners();
      this.$nextTick(this.focusCloseButton);
    }
  },
  beforeDestroy() {
    this.removeDocumentListeners();
    if (this.open) this.restoreFocusOrigin();
  },
  methods: {
    emitChange(key, value) {
      const followGroup = {
        mode: 'style',
        effect: 'style',
        fontSize: 'style',
        animationIntensity: 'style',
        random: 'style',
        'random.reroll': 'style',
        'tuning.reset': 'style',
        offset: 'timing',
        theme: 'theme',
        customTheme: 'theme',
        'background.mode': 'background',
        'background.tuning': 'background',
        'background.reset': 'background',
        'background.assetId': 'background',
        'background.transparent': 'background',
        'background.opacity': 'background',
      }[key];
      if (key === 'fontSize' && !this.canEditFontSize) return;
      if (key === 'effect' && !this.canEditEffect) return;
      if (key === 'animationIntensity' && !this.supportsIntensity) return;
      if (followGroup && this.isFollowLocked(followGroup)) return;
      this.$emit('change', { key, value });
    },
    handleVisualTuningChange(change) {
      if (!change) return;
      this.emitChange(change.key, change.value);
    },
    relayAsset(change) {
      if (
        !change ||
        this.isFollowLocked(
          change.scope === 'background' ? 'background' : 'style'
        )
      )
        return;
      this.$emit('asset', change);
    },
    isInRandomPool(mode) {
      return this.randomPool.includes(mode);
    },
    setRandomEnabled(enabled) {
      this.emitChange('random', {
        ...(this.config.random || {}),
        enabled: Boolean(enabled),
      });
    },
    toggleRandomPool(mode, enabled) {
      const pool = this.randomPool.filter(value => value !== mode);
      if (enabled) pool.push(mode);
      this.emitChange('random', {
        ...(this.config.random || {}),
        pool,
      });
    },
    customThemeValue(key) {
      const custom = this.config.customTheme;
      const palette =
        this.config.resolvedTheme === 'dark'
          ? DEFAULT_THEME_PALETTES.dark
          : DEFAULT_THEME_PALETTES.light;
      return custom && /^#[\da-f]{6}$/i.test(custom[key] || '')
        ? custom[key]
        : palette[key];
    },
    onCustomThemeColor(key, color) {
      const next = { ...(this.config.customTheme || {}) };
      const palette =
        this.config.resolvedTheme === 'dark'
          ? DEFAULT_THEME_PALETTES.dark
          : DEFAULT_THEME_PALETTES.light;
      if (color === palette[key]) delete next[key];
      else next[key] = color;
      this.emitChange('customTheme', Object.keys(next).length ? next : null);
    },
    visualThumbnailShapes(kind, value) {
      return getVisualThumbnailShapes(kind, value);
    },
    previewLabel(kind, value) {
      const option = this.pickerOptions(kind).find(
        item => item.value === value
      );
      return option ? option.label : value;
    },
    setPreviewHover(kind, value, event) {
      if (this.openPicker !== kind) return;
      this.hoveredPreview = { kind, value };
      const target = event && event.currentTarget;
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      const rect = target.getBoundingClientRect();
      const width = Math.max(120, Math.min(300, window.innerWidth - 24));
      const height = 190;
      const gap = 10;
      const right = rect.right + gap;
      const left =
        right + width <= window.innerWidth - 12
          ? right
          : Math.max(12, rect.left - width - gap);
      const top = Math.max(
        12,
        Math.min(rect.top, window.innerHeight - height - 12)
      );
      this.previewPosition = {
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
      };
    },
    clearPreviewHover(kind) {
      if (this.openPicker !== kind) return;
      const buttons = this.pickerButtons(kind);
      const focusedIndex = buttons.indexOf(document.activeElement);
      if (focusedIndex >= 0) {
        const option = this.pickerOptions(kind)[focusedIndex];
        if (option)
          this.setPreviewHover(kind, option.value, {
            currentTarget: buttons[focusedIndex],
          });
        else this.hoveredPreview = null;
        return;
      }
      this.hoveredPreview = null;
      this.previewPosition = null;
    },
    requestClose() {
      this.$emit('close');
    },
    rememberFocusOrigin(preferReturnFocus) {
      if (typeof document === 'undefined') return;
      const configured = this.resolveConfiguredFocusReturn();
      if (preferReturnFocus && configured) {
        this.focusOrigin = configured;
        return;
      }
      const active = document.activeElement;
      this.focusOrigin =
        active &&
        active !== document.body &&
        active !== document.documentElement
          ? active
          : this.resolveFocusReturn();
    },
    resolveConfiguredFocusReturn() {
      const configured =
        typeof this.returnFocusTo === 'function'
          ? this.returnFocusTo()
          : this.returnFocusTo;
      const target = configured && configured.$el ? configured.$el : configured;
      return target && typeof target.focus === 'function' ? target : null;
    },
    resolveFocusReturn() {
      const configured = this.resolveConfiguredFocusReturn();
      if (configured) return configured;
      if (typeof document === 'undefined') return null;
      return document.querySelector('[aria-controls="karaoke-control-panel"]');
    },
    focusCloseButton() {
      const button = this.$refs.closeButton;
      if (button && typeof button.focus === 'function') button.focus();
    },
    restoreFocusOrigin() {
      let element = this.focusOrigin;
      this.focusOrigin = null;
      if (typeof document === 'undefined') return;
      if (!element || !document.contains(element))
        element = this.resolveFocusReturn();
      if (!element || !document.contains(element)) return;
      this.$nextTick(() => {
        if (typeof element.focus === 'function') element.focus();
      });
    },
    addDocumentListeners() {
      if (typeof document === 'undefined' || this.documentListenersAttached)
        return;
      document.addEventListener(
        'pointerdown',
        this.onDocumentPointerDown,
        true
      );
      document.addEventListener('keydown', this.onDocumentKeyDown, true);
      this.documentListenersAttached = true;
    },
    removeDocumentListeners() {
      if (typeof document === 'undefined' || !this.documentListenersAttached)
        return;
      document.removeEventListener(
        'pointerdown',
        this.onDocumentPointerDown,
        true
      );
      document.removeEventListener('keydown', this.onDocumentKeyDown, true);
      this.documentListenersAttached = false;
    },
    onDocumentPointerDown(event) {
      const panel = this.$refs.panel;
      const target = event.target;
      if (!target) {
        this.requestClose();
        return;
      }
      if (panel && panel.contains(target)) return;

      const invokers = [this.resolveConfiguredFocusReturn()];
      if (typeof document !== 'undefined') {
        invokers.push(
          document.querySelector('[aria-controls="karaoke-control-panel"]')
        );
      }
      const isInsideInvoker = invoker =>
        invoker &&
        (invoker === target ||
          (typeof invoker.contains === 'function' && invoker.contains(target)));
      if (invokers.some(isInsideInvoker)) return;
      this.requestClose();
    },
    onDocumentKeyDown(event) {
      if (event.key !== 'Escape' || !this.open) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.openPicker) {
        this.closePickerAndFocus(this.openPicker);
        return;
      }
      this.requestClose();
    },
    togglePicker(name) {
      if (this.openPicker === name) {
        this.closePickerAndFocus(name);
        return;
      }
      const group = name === 'mode' ? 'style' : 'background';
      if (this.isFollowLocked(group)) return;
      this.openPicker = name;
      this.activePickerIndex = this.selectedPickerIndex(name);
      this.$nextTick(() =>
        this.focusPickerOption(name, this.activePickerIndex)
      );
    },
    closePickerAndFocus(name, restoreFocus) {
      const picker = name || this.openPicker;
      this.openPicker = null;
      this.activePickerIndex = -1;
      if (restoreFocus === false || !picker) return;
      this.$nextTick(() => {
        const trigger =
          picker === 'mode'
            ? this.$refs.modeTrigger
            : this.$refs.backgroundTrigger;
        if (trigger && !trigger.disabled) trigger.focus();
      });
    },
    pickerOptions(name) {
      return name === 'mode' ? this.modeOptions : this.backgroundOptions;
    },
    pickerButtons(name) {
      const refs =
        name === 'mode'
          ? this.$refs.modeOptionButtons
          : this.$refs.backgroundOptionButtons;
      if (!refs) return [];
      return Array.isArray(refs) ? refs : [refs];
    },
    selectedPickerIndex(name) {
      const options = this.pickerOptions(name);
      const selectedValue =
        name === 'mode' ? this.config.mode : this.backgroundMode;
      const selected = options.findIndex(
        option => option.value === selectedValue
      );
      return selected < 0 ? 0 : selected;
    },
    focusPickerOption(name, index) {
      const buttons = this.pickerButtons(name);
      if (!buttons.length) return;
      const nextIndex =
        ((index % buttons.length) + buttons.length) % buttons.length;
      this.activePickerIndex = nextIndex;
      this.$nextTick(() => {
        if (this.openPicker !== name) return;
        const currentButtons = this.pickerButtons(name);
        if (currentButtons[nextIndex]) currentButtons[nextIndex].focus();
      });
    },
    onPickerKeyDown(event, name) {
      const options = this.pickerOptions(name);
      if (!options.length) return;
      const buttons = this.pickerButtons(name);
      const focusedIndex = buttons.indexOf(event.target);
      const index = focusedIndex >= 0 ? focusedIndex : this.activePickerIndex;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        this.focusPickerOption(name, (index < 0 ? 0 : index) + direction);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        this.focusPickerOption(
          name,
          event.key === 'Home' ? 0 : options.length - 1
        );
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        const option = options[index < 0 ? 0 : index];
        if (option) {
          const key = name === 'mode' ? 'mode' : 'background.mode';
          this.selectOption(key, option.value, name);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closePickerAndFocus(name);
      }
    },
    onPickerFocusOut(event, name) {
      const listbox = event.currentTarget;
      const next = event.relatedTarget;
      if (next && listbox.contains(next)) return;
      this.$nextTick(() => {
        if (
          this.openPicker === name &&
          !listbox.contains(document.activeElement)
        ) {
          this.closePickerAndFocus(name, false);
        }
      });
    },
    selectOption(key, value, picker) {
      const followGroup = key === 'mode' ? 'style' : 'background';
      if (this.isFollowLocked(followGroup)) {
        this.closePickerAndFocus(picker, false);
        return;
      }
      this.emitChange(key, value);
      this.closePickerAndFocus(picker);
    },
    stepMode(direction) {
      const options = this.modeOptions;
      if (options.length < 2 || this.isFollowLocked('style')) return;
      let index = options.findIndex(
        option => option.value === this.config.mode
      );
      if (index < 0) index = direction > 0 ? -1 : 0;
      const nextIndex = (index + direction + options.length) % options.length;
      this.emitChange('mode', options[nextIndex].value);
    },
    onVolumeInput(event) {
      if (this.isFollower) return;
      const value = Number(event.target.value);
      if (Number.isFinite(value)) this.$emit('volume', clamp(value, 0, 1));
    },
    onFontSizeInput(event) {
      const value = Number(event.target.value);
      if (Number.isFinite(value))
        this.emitChange('fontSize', clamp(Math.round(value), 16, 64));
    },
    commitNumber(key, event, min, max, decimals) {
      const input = event.target;
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) {
        input.value = this.offsetValue.toFixed(1);
        return;
      }
      const precision = 10 ** decimals;
      const value = Math.round(clamp(parsed, min, max) * precision) / precision;
      input.value = value.toFixed(decimals);
      this.emitChange(key, value);
    },
    stepOffset(direction) {
      const nextValue =
        Math.round(clamp(this.offsetValue + direction * 0.1, -10, 10) * 10) /
        10;
      this.emitChange('offset', nextValue);
    },
    cycleAnimationIntensity() {
      const intensities = ['calm', 'normal', 'chaotic'];
      const current = intensities.indexOf(this.intensityValue);
      const next = intensities[(current + 1) % intensities.length];
      this.emitChange('animationIntensity', next);
    },
    isFollowing(key) {
      return Boolean(this.follows && this.follows[key] === true);
    },
    isFollowLocked(key) {
      return this.isFollower && this.isFollowing(key);
    },
    closePickerIfFollowed() {
      if (this.openPicker === 'mode' && this.isFollowLocked('style')) {
        this.closePickerAndFocus('mode', false);
      } else if (
        this.openPicker === 'background' &&
        this.isFollowLocked('background')
      ) {
        this.closePickerAndFocus('background', false);
      }
    },
    toggleFollow(key) {
      this.$emit('follow', { key, value: !this.isFollowing(key) });
    },
    toggleAllFollow() {
      const value = !this.visibleFollowOptions.every(option =>
        this.isFollowing(option.key)
      );
      this.visibleFollowOptions.forEach(option =>
        this.$emit('follow', { key: option.key, value })
      );
    },
  },
};
</script>

<style lang="scss" scoped>
.ktv-control-panel {
  position: fixed;
  z-index: 1100;
  right: 16px;
  bottom: calc(var(--ktv-control-toggle-size, 52px) + 24px);
  display: flex;
  width: 360px;
  max-width: calc(100vw - 32px);
  max-height: calc(
    100vh - var(--ktv-control-toggle-size, 52px) - 48px -
      env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
  );
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: contain;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.16));
  border-radius: 20px;
  background: var(--ktv-glass-bg, rgba(24, 25, 44, 0.76));
  color: var(--ktv-text-primary, #fff);
  box-shadow: var(--ktv-shadow, 0 22px 60px rgba(0, 0, 0, 0.35));
  backdrop-filter: blur(40px) saturate(130%);
  -webkit-backdrop-filter: blur(40px) saturate(130%);
  pointer-events: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ktv-glass-border, rgba(255, 255, 255, 0.2)) transparent;
}

.ktv-control-panel {
  box-sizing: border-box;
  font-size: 110%;
}

.ktv-control-panel button,
.ktv-control-panel input {
  font-family: inherit;
}

.ktv-control-panel input,
.ktv-control-panel select,
.ktv-control-panel textarea {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.ktv-control-header {
  display: flex;
  flex: 0 0 auto;
  min-height: 76px;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 14px;
}

.ktv-track-cover {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.16));
  border-radius: 12px;
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.12));
  color: var(--ktv-accent, #ab9cff);
}

.ktv-track-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ktv-track-cover svg,
.ktv-icon-button svg,
.ktv-chevron,
.ktv-option > svg,
.ktv-intensity-button svg,
.ktv-theme-picker svg,
.ktv-volume-icon {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.ktv-track-copy {
  min-width: 0;
  flex: 1;
}

.ktv-track-copy p,
.ktv-track-copy h2 {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ktv-track-copy .ktv-eyebrow {
  margin-bottom: 3px;
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.52));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.ktv-track-copy h2 {
  font-size: 15.4px;
  font-weight: 700;
  line-height: 1.4;
}

.ktv-track-copy p:last-child {
  margin-top: 2px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.66));
  font-size: 12.1px;
}

.ktv-icon-button {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
  cursor: pointer;
}

.ktv-icon-button:hover:not(:disabled) {
  border-color: var(--ktv-glass-border, rgba(255, 255, 255, 0.16));
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.12));
  color: var(--ktv-text-primary, #fff);
}

.ktv-icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.ktv-control-panel button:disabled,
.ktv-control-panel input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ktv-control-panel button:focus-visible,
.ktv-control-panel input:focus-visible {
  outline: 2px solid var(--ktv-accent, #ab9cff);
  outline-offset: 2px;
}

.ktv-close-button {
  align-self: flex-start;
}

.ktv-control-content {
  min-height: 0;
  flex: 0 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 16px 24px;
}

.ktv-control-section {
  padding: 12px 0;
  border-top: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.13));
}

.ktv-field-label {
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
  font-size: 12.1px;
  font-weight: 600;
  line-height: 1.4;
}

.ktv-volume-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 10px;
}

.ktv-volume-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
}

.ktv-range-label {
  width: 34px;
  flex: 0 0 34px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
  font-size: 12.1px;
}

.ktv-volume-row input[type='range'],
.ktv-size-control input[type='range'] {
  width: 100%;
  min-width: 0;
  height: 20px;
  margin: 0;
  accent-color: var(--ktv-accent, #ab9cff);
  cursor: pointer;
}

.ktv-value {
  color: var(--ktv-text-primary, #fff);
  font-size: 12.1px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
}

.ktv-volume-value {
  width: 36px;
  text-align: right;
}

.ktv-mode-heading,
.ktv-field-block,
.ktv-intensity-row {
  position: relative;
}

.ktv-mode-heading > .ktv-field-label,
.ktv-background-heading > .ktv-field-label {
  display: block;
  margin-bottom: 7px;
}

.ktv-stepper {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ktv-step-button {
  border-color: var(--ktv-glass-border, rgba(255, 255, 255, 0.13));
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
}

.ktv-step-button svg {
  width: 16px;
  height: 16px;
}

.ktv-mode-trigger {
  display: flex;
  min-width: 0;
  min-height: 46px;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 12px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ktv-mode-trigger:hover,
.ktv-background-trigger:hover {
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.12));
}

.ktv-mode-mark,
.ktv-option-thumbnail {
  display: grid;
  width: 36px;
  height: 30px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 8px;
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.12));
  color: var(--ktv-accent-strong, #d0c8ff);
  color: var(--ktv-accent-strong, #d0c8ff);
}

.ktv-mode-mark svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ktv-option-thumbnail svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ktv-mode-trigger-copy {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 1px;
}

.ktv-mode-caption {
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.52));
  font-size: 9.9px;
}

.ktv-mode-name {
  overflow: hidden;
  font-size: 13.2px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ktv-chevron {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.58));
}

.ktv-option-list {
  display: grid;
  max-height: 210px;
  gap: 3px;
  margin-top: 7px;
  padding: 5px;
  overflow: auto;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 13px;
  background: var(--ktv-bg-base, rgba(12, 14, 27, 0.94));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.ktv-picker-stack {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.ktv-picker-stack .ktv-option-list {
  margin-top: 7px;
}

.ktv-option {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 9px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
  font-size: 12.1px;
  text-align: left;
  cursor: pointer;
}

.ktv-option:hover,
.ktv-option.selected {
  border-color: var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.11));
  color: var(--ktv-text-primary, #fff);
}

.ktv-option > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.ktv-option > svg {
  width: 15px;
  height: 15px;
  color: var(--ktv-accent, #ab9cff);
}

.ktv-option-thumbnail {
  width: 30px;
  height: 26px;
  flex-basis: 30px;
}

.ktv-option-thumbnail svg {
  width: 20px;
  height: 20px;
}

.ktv-field-block + .ktv-field-block,
.ktv-field-block + .ktv-intensity-row {
  margin-top: 13px;
}

.ktv-effect-picker,
.ktv-theme-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 3px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.13));
  border-radius: 11px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.07));
}

.ktv-effect-picker button,
.ktv-theme-picker button {
  display: inline-flex;
  min-width: 0;
  min-height: 31px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.68));
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.ktv-effect-picker button:hover,
.ktv-theme-picker button:hover {
  color: var(--ktv-text-primary, #fff);
}

.ktv-effect-picker button.selected,
.ktv-theme-picker button.selected {
  border-color: var(--ktv-glass-border, rgba(255, 255, 255, 0.12));
  background: var(--ktv-glass-strong, rgba(255, 255, 255, 0.13));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  color: var(--ktv-text-primary, #fff);
}

.ktv-field-heading,
.ktv-background-heading,
.ktv-intensity-row,
.ktv-offset-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ktv-size-control input[type='range'] {
  display: block;
  margin-top: 5px;
}

.ktv-offset-stepper {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ktv-offset-copy {
  display: grid;
  gap: 3px;
}

.ktv-offset-copy p {
  margin: 0;
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.52));
  font-size: 9.9px;
}

.ktv-offset-input-wrap {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 9px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.58));
  font-size: 11px;
}

.ktv-offset-input-wrap input {
  width: 48px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ktv-text-primary, #fff);
  font-size: 12.1px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.ktv-offset-input-wrap input:focus-visible {
  outline: 0;
}

.ktv-zero-button {
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.72));
  font-size: 11px;
  cursor: pointer;
}

.ktv-zero-button:hover,
.ktv-intensity-button:hover,
.ktv-background-trigger:hover {
  color: var(--ktv-text-primary, #fff);
}

.ktv-theme-picker button {
  min-height: 33px;
}

.ktv-intensity-button {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 9px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  color: var(--ktv-text-primary, #fff);
  font-size: 11px;
  cursor: pointer;
}

.ktv-intensity-button svg {
  width: 14px;
  height: 14px;
  color: var(--ktv-accent, #ab9cff);
}

.ktv-theme-picker svg {
  width: 14px;
  height: 14px;
}

.ktv-custom-theme {
  margin-top: 11px;
}
.ktv-custom-theme-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  list-style: none;
}
.ktv-custom-theme-summary::-webkit-details-marker {
  display: none;
}
.ktv-custom-theme-summary::after {
  content: '⌄';
  font-size: 18px;
}
.ktv-custom-theme[open] .ktv-custom-theme-summary::after {
  transform: rotate(180deg);
}
.ktv-custom-theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 8px;
  margin-top: 8px;
}
.ktv-custom-theme-reset {
  grid-column: 1 / -1;
  justify-self: end;
  border: 0;
  background: transparent;
  color: var(--ktv-accent, #ab9cff);
  font: inherit;
  font-size: 9.9px;
  cursor: pointer;
}
.ktv-custom-color {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.72));
  font-size: 12px;
}
.ktv-custom-color input {
  width: 34px;
  height: 27px;
  padding: 2px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.16));
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.ktv-random-style,
.ktv-background-independent {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.13));
  border-radius: 12px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.06));
}
.ktv-random-heading,
.ktv-random-toggle,
.ktv-background-independent > label,
.ktv-background-opacity-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}
.ktv-random-toggle {
  justify-content: flex-start;
}
.ktv-random-toggle input,
.ktv-background-independent input[type='checkbox'] {
  accent-color: var(--ktv-accent, #ab9cff);
}
.ktv-random-heading button {
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  background: transparent;
  color: var(--ktv-text-primary, #fff);
  font: inherit;
  font-size: 9.9px;
  cursor: pointer;
}
.ktv-random-style > p {
  margin: 0;
  color: var(--ktv-text-muted, rgba(255, 255, 255, 0.56));
  font-size: 9.9px;
  line-height: 1.45;
}
.ktv-random-pool {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 8px;
  margin-top: 8px;
}
.ktv-random-pool-details,
.ktv-mode-tuning {
  min-width: 0;
}
.ktv-mode-tuning {
  margin-top: 12px;
}
.ktv-random-option {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.72));
  font-size: 9.9px;
}
.ktv-random-option input {
  flex: 0 0 auto;
  accent-color: var(--ktv-accent, #ab9cff);
}
.ktv-random-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ktv-background-independent > label,
.ktv-background-opacity-heading {
  color: var(--ktv-text-primary, #fff);
  font-size: 11px;
}
.ktv-background-opacity-heading output {
  color: var(--ktv-accent-strong, #d0c8ff);
  font-variant-numeric: tabular-nums;
}
.ktv-background-independent input[type='range'] {
  width: 100%;
  margin-top: 5px;
  accent-color: var(--ktv-accent, #ab9cff);
}

.ktv-background-trigger {
  display: inline-flex;
  min-width: 150px;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 10px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  color: var(--ktv-text-primary, #fff);
  font-size: 12.1px;
  text-align: left;
  cursor: pointer;
}

.ktv-background-section .ktv-option-list {
  margin-top: 0;
}

.ktv-background-tuning {
  margin-top: 12px;
}

.ktv-collapsible-summary {
  display: flex;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.14));
  border-radius: 10px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.07));
  color: var(--ktv-text-secondary, rgba(255, 255, 255, 0.74));
  font-size: 12.1px;
  cursor: pointer;
  list-style: none;
}

.ktv-collapsible-summary::-webkit-details-marker {
  display: none;
}

.ktv-collapsible-summary > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.ktv-collapsible-summary svg {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transition: transform 160ms ease;
}

.ktv-control-panel details[open] .ktv-collapsible-summary svg {
  transform: rotate(180deg);
}

.ktv-collapsible-summary:focus-visible {
  outline: 2px solid var(--ktv-accent, #ab9cff);
  outline-offset: 2px;
}

.ktv-background-section .ktv-picker-stack {
  margin-top: 7px;
}

.ktv-background-section .ktv-option-thumbnail {
  width: 26px;
  height: 22px;
  flex-basis: 26px;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.17));
  border-radius: 6px;
}

.ktv-background-trigger .ktv-option-thumbnail {
  width: 26px;
  height: 22px;
  flex-basis: 26px;
}

.ktv-background-section .ktv-option-thumbnail svg {
  width: 17px;
  height: 17px;
}

.ktv-follow-section > .ktv-field-label {
  display: block;
  margin-bottom: 7px;
}

.ktv-follow-option {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--ktv-text-primary, #fff);
  font-size: 12.1px;
  text-align: left;
  cursor: pointer;
}

.ktv-switch {
  box-sizing: border-box;
  --ktv-switch-inset: 2px;
  --ktv-switch-thumb-size: 14px;
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 20px;
  flex: 0 0 34px;
  align-items: center;
  padding: var(--ktv-switch-inset);
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.19));
  border-radius: 999px;
  background: var(--ktv-glass-soft, rgba(255, 255, 255, 0.08));
  transition: background-color 160ms ease;
}

.ktv-switch > span {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  right: calc(100% - var(--ktv-switch-thumb-size) - var(--ktv-switch-inset));
  width: var(--ktv-switch-thumb-size);
  height: var(--ktv-switch-thumb-size);
  border-radius: 50%;
  background: var(--ktv-text-muted, rgba(255, 255, 255, 0.62));
  transition: right 160ms ease, background-color 160ms ease;
}

.ktv-switch.active {
  border-color: var(--ktv-accent, #ab9cff);
  background: var(--ktv-accent, #ab9cff);
}

.ktv-switch.active > span {
  background: var(--ktv-bg-base, #17192a);
  right: var(--ktv-switch-inset);
}

.ktv-control-panel-enter-active,
.ktv-control-panel-leave-active {
  transition: opacity 300ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: bottom right;
  will-change: opacity, transform;
}

.ktv-control-panel-enter,
.ktv-control-panel-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.ktv-control-panel-enter-to,
.ktv-control-panel-leave {
  opacity: 1;
  transform: scale(1);
}

@supports (height: 100dvh) {
  .ktv-control-panel {
    max-height: calc(
      100dvh - var(--ktv-control-toggle-size, 52px) - 48px -
        env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    );
  }
}

@media (max-width: 420px) {
  .ktv-control-panel {
    right: 12px;
    bottom: calc(
      var(--ktv-control-toggle-size, 52px) + 24px +
        env(safe-area-inset-bottom, 0px)
    );
    max-width: calc(100vw - 24px);
    padding-right: 12px;
    padding-left: 12px;
  }

  .ktv-control-header {
    padding-right: 12px;
    padding-left: 12px;
  }

  .ktv-control-content {
    padding-right: 12px;
    padding-left: 12px;
  }

  .ktv-effect-picker button,
  .ktv-theme-picker button {
    padding-right: 3px;
    padding-left: 3px;
    font-size: 9.9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ktv-control-panel-enter-active,
  .ktv-control-panel-leave-active,
  .ktv-switch,
  .ktv-switch > span,
  .ktv-collapsible-summary svg {
    transition-duration: 1ms;
  }
}
</style>
