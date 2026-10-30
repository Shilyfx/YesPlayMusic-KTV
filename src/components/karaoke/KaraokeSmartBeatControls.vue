<template>
  <section class="smart-beat-controls" aria-label="SmartBeat 节拍效果">
    <div class="smart-beat-heading">
      <div>
        <span class="smart-beat-eyebrow">SMARTBEAT</span>
        <h3>节拍效果</h3>
      </div>
      <span class="smart-beat-status" role="status" :data-state="status.state">
        {{ statusText }}
      </span>
    </div>

    <p v-if="status.detail" class="smart-beat-detail">{{ status.detail }}</p>
    <progress
      v-if="Number.isFinite(status.progress)"
      class="smart-beat-progress"
      :value="status.progress"
      max="1"
      aria-label="SmartBeat 实际处理进度"
    />

    <div class="smart-beat-modes" role="group" aria-label="SmartBeat 模式">
      <button
        v-for="option in modeOptions"
        :key="option.value"
        type="button"
        :disabled="readOnly"
        :aria-pressed="normalizedSettings.mode === option.value"
        :class="{ selected: normalizedSettings.mode === option.value }"
        @click="setMode(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <template v-if="normalizedSettings.mode !== 'off'">
      <div class="smart-beat-strengths">
        <label>
          <span
            >节拍强度
            <output>{{
              normalizedSettings.beatStrength.toFixed(1)
            }}</output></span
          >
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            :value="normalizedSettings.beatStrength"
            :disabled="readOnly"
            @input="setGlobalStrength('beatStrength', $event.target.value)"
          />
        </label>
        <label>
          <span
            >重拍强度
            <output>{{
              normalizedSettings.downbeatStrength.toFixed(1)
            }}</output></span
          >
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            :value="normalizedSettings.downbeatStrength"
            :disabled="readOnly"
            @input="setGlobalStrength('downbeatStrength', $event.target.value)"
          />
        </label>
      </div>

      <div v-if="applicableEffects.length" class="smart-beat-effects">
        <label
          v-for="effect in applicableEffects"
          :key="effect.id"
          class="smart-beat-effect"
        >
          <input
            type="checkbox"
            :checked="normalizedSettings.effects[effect.id].enabled"
            :disabled="readOnly"
            @change="setEffect(effect.id, { enabled: $event.target.checked })"
          />
          <span>{{ effect.label }}</span>
          <input
            class="smart-beat-effect-strength"
            type="range"
            min="0"
            max="2"
            step="0.1"
            :aria-label="`${effect.label} 强度`"
            :value="normalizedSettings.effects[effect.id].strength"
            :disabled="
              readOnly || !normalizedSettings.effects[effect.id].enabled
            "
            @input="setEffect(effect.id, { strength: $event.target.value })"
          />
          <output>{{
            normalizedSettings.effects[effect.id].strength.toFixed(1)
          }}</output>
        </label>
      </div>
      <p v-else class="smart-beat-detail">当前歌词样式没有对应的节拍效果。</p>
    </template>
  </section>
</template>

<script>
import {
  normalizeSmartBeatPreferences,
  SMART_BEAT_EFFECTS,
} from '@/karaoke/smartBeatPreferences';

const STATUS_TEXT = {
  unsupported: '此设备暂不可用',
  'loading-model': '正在加载模型',
  'fetching-audio': '正在读取歌曲音频',
  analysing: '正在分析音频',
  ready: '分析完成',
  cached: '使用本机缓存',
  error: '分析失败',
  cancelled: '分析已取消',
  waiting: '等待正在播放的歌曲',
  idle: '未启用',
};

export default {
  name: 'KaraokeSmartBeatControls',
  props: {
    settings: { type: Object, default: () => ({}) },
    rendererMode: { type: String, default: '' },
    status: { type: Object, default: () => ({ state: 'idle', detail: '' }) },
    readOnly: { type: Boolean, default: false },
  },
  computed: {
    normalizedSettings() {
      return normalizeSmartBeatPreferences(this.settings);
    },
    applicableEffects() {
      return Object.entries(SMART_BEAT_EFFECTS)
        .filter(([, definition]) => definition.mode === this.rendererMode)
        .map(([id, definition]) => ({ id, ...definition }));
    },
    statusText() {
      if (this.status.state === 'cached' && this.status.cacheHit === false)
        return '本机没有可用缓存';
      return STATUS_TEXT[this.status.state] || '等待分析';
    },
  },
  methods: {
    publish(patch) {
      this.$emit(
        'change',
        normalizeSmartBeatPreferences({ ...this.normalizedSettings, ...patch })
      );
    },
    setMode(mode) {
      this.publish({ mode });
    },
    setGlobalStrength(key, value) {
      this.publish({ [key]: Number(value) });
    },
    setEffect(id, patch) {
      this.publish({
        effects: {
          ...this.normalizedSettings.effects,
          [id]: { ...this.normalizedSettings.effects[id], ...patch },
        },
      });
    },
  },
};
</script>

<style scoped>
.smart-beat-controls {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(120, 120, 150, 0.18);
}
.smart-beat-heading,
.smart-beat-effect,
.smart-beat-strengths label span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.smart-beat-heading h3 {
  margin: 2px 0 0;
  font-size: 15px;
}
.smart-beat-eyebrow {
  color: #7969dc;
  font-size: 10px;
  letter-spacing: 0.14em;
}
.smart-beat-status {
  color: #6558b2;
  font-size: 12px;
}
.smart-beat-status[data-state='unsupported'],
.smart-beat-status[data-state='error'] {
  color: #a43e4d;
}
.smart-beat-progress {
  width: 100%;
  height: 4px;
  accent-color: #7969dc;
}
.smart-beat-detail {
  margin: 0;
  color: var(--ktv-text-muted, #73738a);
  font-size: 12px;
  line-height: 1.5;
}
.smart-beat-modes {
  display: flex;
  gap: 8px;
}
.smart-beat-modes button {
  flex: 1;
}
.smart-beat-modes .selected {
  border-color: #7969dc;
  color: #5544ba;
}
.smart-beat-strengths {
  display: grid;
  gap: 10px;
}
.smart-beat-strengths label,
.smart-beat-effect {
  color: var(--ktv-text-secondary, #55556b);
  font-size: 12px;
}
.smart-beat-strengths input,
.smart-beat-effect-strength {
  width: 100%;
}
.smart-beat-effect {
  display: grid;
  grid-template-columns: auto minmax(90px, 1fr) minmax(72px, 0.8fr) 2.5em;
}
output {
  font-variant-numeric: tabular-nums;
}
</style>
