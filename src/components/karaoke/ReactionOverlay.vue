<template>
  <div
    class="reaction-layer"
    :class="settings.position"
    :style="layerSizeStyle"
  >
    <div ref="anchor" class="reaction-anchor">
      <div
        class="reaction-dock"
        :class="[
          'mood-' + dockMoodState,
          {
            'dock-compact': Number(settings.sizePx) <= 104,
            'dock-hidden': !!activeEvent,
            'dock-disabled': !settings.enabled,
          },
        ]"
        :data-mood="dockMoodState"
        :data-emotion="dockEmotion"
        title="右键设置角色"
        @contextmenu.prevent.stop="settingsOpen = !settingsOpen"
      >
        <ReactionActor
          ref="dock"
          :character="settings.character"
          :emotion="dockEmotion"
          :body-color="
            settings.character === 'ball' ? ballBodyColor : settings.bodyColor
          "
          :eye-color="
            settings.character === 'ball' ? ballEyeColor : settings.eyeColor
          "
          :active="settings.enabled && pageVisible && !activeEvent"
        />
        <span
          v-if="dockMoodCaption"
          :key="dockMoodCaption"
          class="dock-mood-caption"
          aria-live="off"
          >{{ dockMoodCaption }}</span
        >
      </div>
      <div v-if="settingsOpen" class="reaction-settings">
        <label
          ><input
            v-model="settings.enabled"
            type="checkbox"
            @change="save"
          />显示互动表情</label
        >
        <label
          ><input
            v-model="settings.automatic"
            type="checkbox"
            @change="save"
          />跟随点歌、播放和切歌状态</label
        >
        <label
          ><input
            v-model="settings.rhythmBounce"
            type="checkbox"
            @change="save"
          />随节奏弹跳</label
        >
        <label
          >角色<select v-model="settings.character" @change="save"
            ><option value="ball">球球</option
            ><option value="nimbo">云宝</option
            ><option value="twinkle">亮亮</option></select
          ></label
        >
        <label v-if="settings.character === 'ball'">
          <input
            v-model="settings.followTheme"
            type="checkbox"
            @change="save"
          />跟随深浅模式
        </label>
        <label class="color-picker-row">
          <span>整体颜色</span>
          <span class="color-picker-controls">
            <input
              :value="effectiveBodyColor"
              type="color"
              aria-label="设置常驻角色整体颜色"
              @input="onBodyColorInput($event.target.value)"
              @change="onBodyColorInput($event.target.value)"
            />
            <button
              v-if="settings.bodyColor"
              type="button"
              class="color-reset-btn"
              title="恢复默认整体颜色"
              @click="resetBodyColor"
            >
              默认
            </button>
          </span>
        </label>
        <label class="color-picker-row">
          <span>眼睛颜色</span>
          <span class="color-picker-controls">
            <input
              :value="effectiveEyeColor"
              type="color"
              aria-label="设置常驻角色眼睛颜色"
              @input="onEyeColorInput($event.target.value)"
              @change="onEyeColorInput($event.target.value)"
            />
            <button
              v-if="settings.eyeColor"
              type="button"
              class="color-reset-btn"
              title="恢复默认眼睛颜色"
              @click="resetEyeColor"
            >
              默认
            </button>
          </span>
        </label>
        <label class="size-slider-row">
          <span>大小 {{ settings.sizePx }}px</span>
          <input
            v-model.number="settings.sizePx"
            type="range"
            min="72"
            max="260"
            step="4"
            aria-label="调整角色大小"
            @input="save"
            @change="save"
          />
        </label>
        <label
          >位置<select v-model="settings.position" @change="save"
            ><option value="bottom-left">左下</option
            ><option value="bottom-right">右下</option
            ><option value="top-left">左上</option
            ><option value="top-right">右上</option></select
          ></label
        >
        <label
          >律动<select v-model="settings.sensitivity" @change="save"
            ><option value="gentle">柔和</option
            ><option value="standard">标准</option
            ><option value="lively">热闹</option></select
          ></label
        >
        <small>角色：Aora Bot</small>
      </div>
    </div>
    <div
      v-if="activeEvent"
      :key="shotKey"
      class="reaction-shot"
      :class="[
        'shot-' + activeEvent.effect,
        { 'shot-automatic': activeEvent.automatic },
        { ready: shotReady, leaving: shotLeaving },
      ]"
      :data-reaction="activeEvent.kind"
      :data-character="activeEvent.character"
      :data-emotion="activeEvent.animation.emotion"
    >
      <div
        class="reaction-motion"
        @contextmenu.prevent.stop="settingsOpen = !settingsOpen"
      >
        <div class="reaction-render"
          ><ReactionActor
            ref="shot"
            :character="activeEvent.character"
            :body-color="activeEvent.character === 'ball' ? ballBodyColor : ''"
            :eye-color="activeEvent.character === 'ball' ? ballEyeColor : ''"
            :emotion="activeEvent.animation.emotion"
            :active="pageVisible"
            @ready="startShot"
            @unavailable="endShot"
        /></div>
        <span aria-live="polite">{{
          activeEvent.customText || activeEvent.animation.label
        }}</span>
      </div>
    </div>
  </div>
</template>
<script>
import ReactionActor from './ReactionActor.vue';
import {
  resolveReaction,
  automaticReactions,
  reactionEffects,
  isValidReactionEffect,
} from '@/karaoke/reactions';
import {
  MUSIC_REACTION_STATES,
  MUSIC_SENSITIVITY_PRESETS,
  normalizeMusicSensitivity,
} from '@/karaoke/musicReactionAnalyzer';
const CHARACTER_DEFAULT_COLORS = {
  ball: { body: '#F3F0EA', eyes: '#1A1A1A' },
  nimbo: { body: '#B4C6EE', eyes: '#2B3550' },
  twinkle: { body: '#F5B93F', eyes: '#7A4E2A' },
};
function normalizeHexColor(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : '';
}
const defaults = {
  enabled: true,
  automatic: true,
  rhythmBounce: false,
  character: 'ball',
  bodyColor: '',
  eyeColor: '',
  followTheme: true,
  sizePx: 160,
  position: 'bottom-left',
  sensitivity: 'standard',
};
const LEGACY_SIZE_PX = {
  small: 72,
  medium: 160,
  large: 220,
};
function normalizeSizePx(value, legacySize) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(72, Math.min(260, Math.round(numeric)));
  }
  if (legacySize && LEGACY_SIZE_PX[legacySize]) {
    return LEGACY_SIZE_PX[legacySize];
  }
  return defaults.sizePx;
}
function readSettings(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      enabled: value.enabled !== false,
      automatic: value.automatic !== false,
      rhythmBounce: value.rhythmBounce === true,
      character: ['ball', 'nimbo', 'twinkle'].includes(value.character)
        ? value.character
        : defaults.character,
      bodyColor: normalizeHexColor(value.bodyColor),
      eyeColor: normalizeHexColor(value.eyeColor),
      followTheme: value.followTheme !== false,
      sizePx: normalizeSizePx(value.sizePx, value.size),
      position: [
        'bottom-left',
        'bottom-right',
        'top-left',
        'top-right',
      ].includes(value.position)
        ? value.position
        : defaults.position,
      sensitivity: normalizeMusicSensitivity(value.sensitivity),
    };
  } catch (_) {
    return { ...defaults };
  }
}
export default {
  name: 'ReactionOverlay',
  components: { ReactionActor },
  props: {
    events: { type: Array, default: () => [] },
    generation: { type: String, default: '' },
    serverTime: { type: Number, default: 0 },
    storageKey: { type: String, required: true },
    theme: { type: String, default: 'light' },
    playing: { type: Boolean, default: false },
    hasTrack: { type: Boolean, default: false },
    musicReaction: { type: Object, default: null },
  },
  data() {
    return {
      settings: readSettings(`lumasing-reactions:${this.storageKey}`),
      settingsOpen: false,
      activeEvent: null,
      shotReady: false,
      shotLeaving: false,
      shotKey: 0,
      lastId: 0,
      seenGeneration: '',
      pageVisible: !document.hidden,
      dockEmotion: '02',
    };
  },
  computed: {
    ballBodyColor() {
      return (
        (!this.settings.followTheme &&
          normalizeHexColor(this.settings.bodyColor)) ||
        (this.theme === 'dark' ? '#000000' : '#ffffff')
      );
    },
    ballEyeColor() {
      return (
        (!this.settings.followTheme &&
          normalizeHexColor(this.settings.eyeColor)) ||
        (this.theme === 'dark' ? '#ffffff' : '#000000')
      );
    },
    effectiveBodyColor() {
      const palette =
        CHARACTER_DEFAULT_COLORS[this.settings.character] ||
        CHARACTER_DEFAULT_COLORS.ball;
      return this.settings.character === 'ball'
        ? this.ballBodyColor
        : normalizeHexColor(this.settings.bodyColor) || palette.body;
    },
    effectiveEyeColor() {
      const palette =
        CHARACTER_DEFAULT_COLORS[this.settings.character] ||
        CHARACTER_DEFAULT_COLORS.ball;
      return this.settings.character === 'ball'
        ? this.ballEyeColor
        : normalizeHexColor(this.settings.eyeColor) || palette.eyes;
    },
    layerSizeStyle() {
      const size = normalizeSizePx(this.settings.sizePx);
      const motionWidth = Math.round(size * 1.2 * 10) / 10;
      return {
        '--reaction-dock-size': `${size}px`,
        '--reaction-shot-width': `${motionWidth}px`,
        '--reaction-shot-zoom-width': `${size}px`,
      };
    },
    dockMoodState() {
      if (!this.settings.automatic) return 'idle';
      if (this.playing) {
        const st = this.musicReaction?.state;
        return MUSIC_REACTION_STATES[st] ? st : 'lively';
      }
      if (this.hasTrack) {
        return this.musicReaction?.state === 'finished' ? 'finished' : 'paused';
      }
      return 'idle';
    },
    dockMoodCaption() {
      if (
        !this.settings.enabled ||
        !this.settings.automatic ||
        this.activeEvent
      )
        return '';
      if (this.dockMoodState === 'idle') return '';
      const dynamicLabel = this.musicReaction?.label;
      if (typeof dynamicLabel === 'string' && dynamicLabel.trim()) {
        return dynamicLabel.trim();
      }
      const def = MUSIC_REACTION_STATES[this.dockMoodState];
      return def?.label || '';
    },
  },
  watch: {
    events: { handler: 'onEventsUpdated', immediate: true },
    serverTime: 'onServerTimeUpdated',
    generation: 'receive',
    playing: 'syncDockState',
    hasTrack: 'onTrackPresenceChanged',
    musicReaction: { handler: 'onMusicReactionUpdated', deep: true },
  },
  beforeCreate() {
    this.eventTimer = null;
    this.exitTimer = null;
    this.queueTimer = null;
    this.eventVersion = 0;
    this.serverTimeAnchor = 0;
    this.serverTimePerfAt = 0;
    this.lastMusicItemKey = '';
    this.lastMusicState = '';
    this.lastBeatSeq = null;
    this.lastBurstSeq = null;
    this.lastDockBeatAt = -Infinity;
    this.lastDockBurstAt = -Infinity;
  },
  mounted() {
    this.$emit('sensitivity-change', this.settings.sensitivity);
    this.syncDockState();
    this.visibilityHandler = () => {
      this.pageVisible = !document.hidden;
      if (!this.pageVisible) {
        clearTimeout(this.queueTimer);
        this.endShot();
      }
    };
    this.outsideHandler = event => {
      if (this.settingsOpen && !this.$refs.anchor?.contains(event.target))
        this.settingsOpen = false;
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    document.addEventListener('pointerdown', this.outsideHandler);
  },
  beforeDestroy() {
    clearTimeout(this.queueTimer);
    this.endShot();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    document.removeEventListener('pointerdown', this.outsideHandler);
  },
  methods: {
    currentNow() {
      if (this.serverTimeAnchor > 0) {
        return (
          this.serverTimeAnchor +
          Math.max(0, performance.now() - this.serverTimePerfAt)
        );
      }
      return this.serverTime || Date.now();
    },
    onServerTimeUpdated(value) {
      if (value > 0) {
        this.serverTimeAnchor = value;
        this.serverTimePerfAt = performance.now();
      }
    },
    onEventsUpdated() {
      if (this.serverTime > 0) {
        this.serverTimeAnchor = this.serverTime;
        this.serverTimePerfAt = performance.now();
      }
      this.receive();
    },
    onTrackPresenceChanged() {
      if (!this.hasTrack && this.activeEvent && !this.activeEvent.isAutomatic) {
        this.endShot();
      }
      this.syncDockState();
    },
    onMusicReactionUpdated(reaction) {
      this.syncDockState();
      if (!reaction || typeof reaction !== 'object') return;
      const itemKey = String(reaction.itemId || '');
      if (itemKey !== this.lastMusicItemKey) {
        this.lastMusicItemKey = itemKey;
        this.lastMusicState = String(reaction.state || '');
        this.lastBeatSeq = Number.isSafeInteger(reaction.beatSeq)
          ? reaction.beatSeq
          : 0;
        this.lastBurstSeq = Number.isSafeInteger(reaction.burstSeq)
          ? reaction.burstSeq
          : 0;
        return;
      }
      const canAnimateDock =
        this.settings.enabled &&
        this.settings.automatic &&
        this.pageVisible &&
        !this.activeEvent;
      const now = performance.now();
      const preset =
        MUSIC_SENSITIVITY_PRESETS[this.settings.sensitivity] ||
        MUSIC_SENSITIVITY_PRESETS.standard;

      const nextState = String(reaction.state || '');
      if (nextState && nextState !== this.lastMusicState) {
        this.lastMusicState = nextState;
        if (canAnimateDock && this.playing && this.settings.rhythmBounce) {
          const stateDef = MUSIC_REACTION_STATES[nextState];
          if (stateDef?.action === 'bounce') {
            this.lastDockBeatAt = now;
            this.$refs.dock?.perform('bounce');
          }
        }
      }

      if (Number.isSafeInteger(reaction.burstSeq)) {
        if (
          this.lastBurstSeq !== null &&
          reaction.burstSeq > this.lastBurstSeq &&
          canAnimateDock &&
          preset.allowPeakBurst &&
          now - this.lastDockBurstAt >= preset.burstCooldownMs
        ) {
          this.lastDockBurstAt = now;
          this.$refs.dock?.perform('burst');
        }
        this.lastBurstSeq = reaction.burstSeq;
      }
      if (Number.isSafeInteger(reaction.beatSeq)) {
        if (
          this.settings.rhythmBounce &&
          this.lastBeatSeq !== null &&
          reaction.beatSeq > this.lastBeatSeq &&
          canAnimateDock &&
          this.playing &&
          now - this.lastDockBeatAt >= preset.beatCooldownMs
        ) {
          this.lastDockBeatAt = now;
          this.$refs.dock?.perform('bounce');
        }
        this.lastBeatSeq = reaction.beatSeq;
      }
    },
    onBodyColorInput(value) {
      this.settings.bodyColor = normalizeHexColor(value);
      this.settings.followTheme = false;
      this.save();
    },
    onEyeColorInput(value) {
      this.settings.eyeColor = normalizeHexColor(value);
      this.settings.followTheme = false;
      this.save();
    },
    resetBodyColor() {
      this.settings.bodyColor = '';
      this.save();
    },
    resetEyeColor() {
      this.settings.eyeColor = '';
      this.save();
    },
    save() {
      this.settings.bodyColor = normalizeHexColor(this.settings.bodyColor);
      this.settings.eyeColor = normalizeHexColor(this.settings.eyeColor);
      this.settings.sizePx = normalizeSizePx(this.settings.sizePx);
      try {
        localStorage.setItem(
          `lumasing-reactions:${this.storageKey}`,
          JSON.stringify(this.settings)
        );
      } catch (_) {
        /* in-memory settings still work */
      }
      this.$emit('sensitivity-change', this.settings.sensitivity);
      if (!this.settings.enabled) {
        clearTimeout(this.queueTimer);
        this.endShot();
      }
      this.syncDockState();
    },
    syncDockState() {
      if (!this.settings.automatic) {
        this.dockEmotion = '02';
        return;
      }
      if (this.playing) {
        this.dockEmotion = this.musicReaction?.emotion || '10';
        return;
      }
      if (this.hasTrack) {
        this.dockEmotion =
          this.musicReaction?.emotion ||
          (this.musicReaction?.state === 'finished' ? '33' : '06');
        return;
      }
      this.dockEmotion = '02';
    },
    endShot(checkNext = false) {
      this.eventVersion++;
      clearTimeout(this.eventTimer);
      clearTimeout(this.exitTimer);
      this.activeEvent = null;
      this.shotReady = false;
      this.shotLeaving = false;
      this.syncDockState();
      if (checkNext && this.pageVisible && this.settings.enabled) {
        this.receive();
      }
    },
    persistCursor() {
      if (!this.generation) return;
      const key = `lumasing-reactions-seen:${this.storageKey}:${this.generation}`;
      try {
        sessionStorage.setItem(key, String(this.lastId));
      } catch (_) {
        /* cursor remains in memory */
      }
    },
    receive() {
      clearTimeout(this.queueTimer);
      if (!this.generation) return;
      const key = `lumasing-reactions-seen:${this.storageKey}:${this.generation}`;
      if (this.seenGeneration !== this.generation) {
        this.endShot();
        this.seenGeneration = this.generation;
        try {
          this.lastId = Number(sessionStorage.getItem(key)) || 0;
        } catch (_) {
          this.lastId = 0;
        }
      }
      const now = this.currentNow();

      if (this.activeEvent) {
        const currentRecord = this.events.find(
          item => item && item.id === this.activeEvent.id
        );
        if (currentRecord && currentRecord.status === 'cancelled') {
          this.endShot();
        }
      }

      const hasPendingUserReaction =
        (this.activeEvent && !this.activeEvent.isAutomatic) ||
        this.events.some(
          item =>
            item &&
            Number.isSafeInteger(item.id) &&
            item.id > this.lastId &&
            !item.automatic &&
            !automaticReactions[item.kind] &&
            item.status !== 'cancelled' &&
            item.status !== 'replaced' &&
            (item.endsAt || item.expiresAt || 0) > now
        );

      let chosen = null;
      let nextWakeDelay = Infinity;

      for (const event of this.events) {
        if (
          !event ||
          !Number.isSafeInteger(event.id) ||
          event.id <= this.lastId
        )
          continue;

        const isAutomatic = Boolean(
          event.automatic || automaticReactions[event.kind]
        );
        const endsAt = Number.isFinite(event.endsAt)
          ? event.endsAt
          : Number.isFinite(event.expiresAt)
          ? Math.min(event.expiresAt, (event.createdAt || now) + 4200)
          : now + 4200;
        const startAt = Number.isFinite(event.startAt)
          ? event.startAt
          : event.createdAt || 0;
        const animation = resolveReaction(event);

        if (
          !animation ||
          !this.settings.enabled ||
          document.hidden ||
          event.status === 'replaced' ||
          event.status === 'cancelled' ||
          event.status === 'completed' ||
          event.status === 'expired' ||
          event.expiresAt <= now ||
          endsAt <= now ||
          (!this.settings.automatic && isAutomatic) ||
          (isAutomatic && hasPendingUserReaction)
        ) {
          this.lastId = Math.max(this.lastId, event.id);
          continue;
        }

        if (event.status === 'queued' && startAt > now + 40) {
          nextWakeDelay = Math.min(nextWakeDelay, startAt - now);
          continue;
        }

        this.lastId = Math.max(this.lastId, event.id);
        const durationMs = Math.min(4200, Math.max(400, endsAt - now));
        chosen = {
          ...event,
          isAutomatic,
          animation,
          character: event.character || this.settings.character,
          effect: isValidReactionEffect(event.effect) ? event.effect : 'bounce',
          durationMs,
          deadline: performance.now() + durationMs,
        };
      }

      this.persistCursor();
      if (chosen) {
        this.showEvent(chosen);
      }
      if (Number.isFinite(nextWakeDelay) && nextWakeDelay < Infinity) {
        this.queueTimer = setTimeout(
          () => this.receive(),
          Math.max(50, Math.min(10000, Math.ceil(nextWakeDelay)))
        );
      }
    },
    showEvent(event) {
      const version = ++this.eventVersion;
      clearTimeout(this.eventTimer);
      clearTimeout(this.exitTimer);
      const begin = async () => {
        if (
          version !== this.eventVersion ||
          event.deadline <= performance.now()
        )
          return;
        this.activeEvent = null;
        this.shotReady = false;
        await this.$nextTick();
        if (
          version !== this.eventVersion ||
          !this.pageVisible ||
          !this.settings.enabled
        )
          return;
        this.shotKey++;
        this.shotLeaving = false;
        this.activeEvent = event;
      };
      if (this.activeEvent) {
        this.shotLeaving = true;
        this.exitTimer = setTimeout(begin, 160);
      } else begin();
    },
    startShot() {
      if (!this.activeEvent || !this.pageVisible) return;
      this.shotReady = true;
      const effectDef = reactionEffects.find(
        item => item.id === this.activeEvent.effect
      );
      const action =
        this.activeEvent.effect === 'firework'
          ? 'firework'
          : this.activeEvent.effect === 'carnival'
          ? 'carnival'
          : effectDef?.action || this.activeEvent.animation.action;
      this.$refs.shot?.perform(action);
      const duration = Number.isFinite(this.activeEvent.durationMs)
        ? this.activeEvent.durationMs
        : 4200;
      this.eventTimer = setTimeout(() => this.endShot(true), duration);
    },
  },
};
</script>
<style scoped>
.reaction-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.reaction-anchor {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}
.bottom-left .reaction-anchor {
  bottom: 56px;
  left: 16px;
}
.bottom-right .reaction-anchor {
  bottom: 64px;
  right: 16px;
  align-items: flex-end;
}
.top-left .reaction-anchor {
  top: 68px;
  left: 16px;
  flex-direction: column-reverse;
}
.top-right .reaction-anchor {
  top: 68px;
  right: 16px;
  align-items: flex-end;
  flex-direction: column-reverse;
}
.reaction-dock {
  position: relative;
  width: var(--reaction-dock-size, 160px);
  height: var(--reaction-dock-size, 160px);
  pointer-events: auto;
  transition: opacity 0.45s ease;
  animation: dock-arrive 0.45s ease both;
}
.reaction-dock.dock-hidden {
  opacity: 0;
  pointer-events: none;
  animation: none;
}
.reaction-dock.dock-disabled {
  opacity: 0.25;
}
.dock-mood-caption {
  position: absolute;
  left: 50%;
  bottom: -26px;
  transform: translateX(-50%);
  padding: 3px 12px;
  border-radius: 999px;
  background: var(--ktv-glass-soft, rgba(20, 16, 50, 0.56));
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.18));
  color: var(--ktv-text-primary, #fff);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(20, 16, 50, 0.18);
  animation: caption-fade-in 0.28s ease both;
}
.reaction-dock.dock-compact .dock-mood-caption {
  font-size: 11px;
  padding: 2px 8px;
  bottom: -22px;
}
.reaction-dock.mood-excited .dock-mood-caption,
.reaction-dock.mood-peak .dock-mood-caption {
  font-weight: 700;
}
@keyframes caption-fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, 4px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@keyframes dock-arrive {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.reaction-shot {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.16s ease;
  visibility: hidden;
}
.reaction-shot.ready {
  visibility: visible;
}
.reaction-shot.shot-automatic {
  align-items: flex-start;
  top: 10%;
}
.reaction-shot.leaving {
  opacity: 0;
}
.reaction-motion {
  width: var(--reaction-shot-width, 192px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--ktv-text-primary);
  opacity: 0;
  pointer-events: auto;
}
.shot-zoom .reaction-motion {
  width: var(--reaction-shot-zoom-width, 160px);
  transform: scale(1.8);
}
.reaction-render {
  width: 100%;
  aspect-ratio: 1;
}
.reaction-motion span {
  font-size: 24px;
  font-weight: 700;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  line-height: 1.45;
  text-shadow: 0 1px 6px var(--ktv-bg-base);
}
.ready .reaction-motion {
  animation: reaction-bounce 4.2s ease both;
}
.ready.shot-fade .reaction-motion {
  animation-name: reaction-fade;
}
.ready.shot-zoom .reaction-motion {
  animation-name: reaction-zoom;
}
.ready.shot-spin .reaction-motion {
  animation-name: reaction-spin;
}
.ready.shot-firework .reaction-motion {
  animation-name: reaction-firework;
}
.ready.shot-meteor .reaction-motion {
  animation-name: reaction-meteor;
}
.ready.shot-spotlight .reaction-motion {
  animation-name: reaction-spotlight;
  filter: drop-shadow(0 0 22px rgba(255, 224, 130, 0.48));
}
.ready.shot-sway .reaction-motion {
  animation-name: reaction-sway;
}
.ready.shot-spring .reaction-motion {
  animation-name: reaction-spring;
}
.ready.shot-carnival .reaction-motion {
  animation-name: reaction-carnival;
}
.ready.shot-peek .reaction-motion {
  animation-name: reaction-peek;
}
.ready.shot-heartbeat .reaction-motion {
  animation-name: reaction-heartbeat;
  filter: drop-shadow(0 0 20px rgba(255, 118, 166, 0.45));
}
.ready.shot-vortex .reaction-motion {
  animation-name: reaction-vortex;
}
@keyframes reaction-bounce {
  0% {
    opacity: 0;
    transform: translateY(18px);
  }
  12% {
    opacity: 1;
    transform: translateY(-20px);
  }
  22%,
  80% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(0);
  }
}
@keyframes reaction-fade {
  0%,
  100% {
    opacity: 0;
  }
  18%,
  78% {
    opacity: 1;
  }
}
@keyframes reaction-zoom {
  0% {
    opacity: 0;
    transform: scale(0.2);
  }
  18%,
  76% {
    opacity: 1;
    transform: scale(1.8);
  }
  100% {
    opacity: 0;
    transform: scale(1.8);
  }
}
@keyframes reaction-spin {
  0% {
    opacity: 0;
    transform: scale(0.32) rotate(-18deg) translateY(24px);
  }
  18% {
    opacity: 1;
    transform: scale(1.12) rotate(6deg) translateY(-8px);
  }
  28%,
  80% {
    opacity: 1;
    transform: scale(1) rotate(0deg) translateY(0);
  }
  100% {
    opacity: 0;
    transform: scale(0.88) rotate(8deg) translateY(-10px);
  }
}
@keyframes reaction-firework {
  0% {
    opacity: 0;
    transform: translateY(150px) scale(0.45);
  }
  15% {
    opacity: 1;
    transform: translateY(-38px) scale(1.18);
  }
  26%,
  80% {
    opacity: 1;
    transform: translateY(0) scale(1.04);
  }
  100% {
    opacity: 0;
    transform: translateY(-18px) scale(1.12);
  }
}
@keyframes reaction-meteor {
  0% {
    opacity: 0;
    transform: translate(-180px, -110px) rotate(-22deg) scale(0.6);
  }
  16% {
    opacity: 1;
    transform: translate(18px, 10px) rotate(6deg) scale(1.06);
  }
  25%,
  80% {
    opacity: 1;
    transform: translate(0, 0) rotate(0deg) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(60px, -24px) rotate(8deg) scale(0.92);
  }
}
@keyframes reaction-spotlight {
  0% {
    opacity: 0;
    transform: translateY(-130px) scale(0.75);
  }
  22% {
    opacity: 1;
    transform: translateY(8px) scale(1.04);
  }
  32%,
  80% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(-20px) scale(0.96);
  }
}
@keyframes reaction-sway {
  0% {
    opacity: 0;
    transform: translateY(20px) rotate(-12deg);
  }
  15% {
    opacity: 1;
    transform: translateY(0) rotate(11deg);
  }
  32% {
    opacity: 1;
    transform: translateY(-4px) rotate(-9deg);
  }
  50% {
    opacity: 1;
    transform: translateY(0) rotate(8deg);
  }
  68% {
    opacity: 1;
    transform: translateY(-3px) rotate(-6deg);
  }
  82% {
    opacity: 1;
    transform: translateY(0) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: translateY(8px) rotate(4deg);
  }
}
@keyframes reaction-spring {
  0% {
    opacity: 0;
    transform: translateX(-160px) scale(1.32, 0.72);
  }
  14% {
    opacity: 1;
    transform: translateX(22px) scale(0.84, 1.18);
  }
  24% {
    opacity: 1;
    transform: translateX(-8px) scale(1.06, 0.95);
  }
  34%,
  80% {
    opacity: 1;
    transform: translateX(0) scale(1, 1);
  }
  100% {
    opacity: 0;
    transform: translateX(30px) scale(0.94, 1.04);
  }
}
@keyframes reaction-carnival {
  0% {
    opacity: 0;
    transform: translateY(50px) scale(0.45);
  }
  14% {
    opacity: 1;
    transform: translateY(-28px) scale(1.16) rotate(-5deg);
  }
  26% {
    opacity: 1;
    transform: translateY(4px) scale(0.95) rotate(5deg);
  }
  38% {
    opacity: 1;
    transform: translateY(-16px) scale(1.08) rotate(-3deg);
  }
  50%,
  80% {
    opacity: 1;
    transform: translateY(0) scale(1.02) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: translateY(-14px) scale(1.08);
  }
}
@keyframes reaction-peek {
  0% {
    opacity: 0;
    transform: translateY(130px) rotate(-10deg) scale(0.86);
  }
  16% {
    opacity: 1;
    transform: translateY(54px) rotate(-8deg) scale(0.92);
  }
  28% {
    opacity: 1;
    transform: translateY(50px) rotate(7deg) scale(0.94);
  }
  42% {
    opacity: 1;
    transform: translateY(-14px) rotate(0deg) scale(1.06);
  }
  52%,
  82% {
    opacity: 1;
    transform: translateY(0) rotate(0deg) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(40px) scale(0.92);
  }
}
@keyframes reaction-heartbeat {
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  14% {
    opacity: 1;
    transform: scale(1.24);
  }
  24% {
    opacity: 1;
    transform: scale(0.94);
  }
  36% {
    opacity: 1;
    transform: scale(1.3);
  }
  48%,
  80% {
    opacity: 1;
    transform: scale(1.05);
  }
  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}
@keyframes reaction-vortex {
  0% {
    opacity: 0;
    transform: scale(1.75) rotate(-180deg);
  }
  18% {
    opacity: 1;
    transform: scale(0.88) rotate(12deg);
  }
  28%,
  80% {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: scale(0.3) rotate(120deg);
  }
}
.reaction-settings {
  display: grid;
  gap: 8px;
  width: 230px;
  padding: 14px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 14px;
  background: var(--ktv-bg-base);
  color: var(--ktv-text-primary);
  box-shadow: 0 8px 28px #14103233;
  font-size: 12px;
  pointer-events: auto;
}
.reaction-settings label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.reaction-settings input {
  margin: 0;
}
.reaction-settings select {
  min-width: 90px;
  padding: 4px;
  color: inherit;
  background: var(--ktv-glass-soft);
  border: 1px solid var(--ktv-glass-border);
  border-radius: 6px;
}
.reaction-settings .size-slider-row input[type='range'] {
  width: 108px;
  cursor: pointer;
}
.reaction-settings .color-picker-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.reaction-settings input[type='color'] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.reaction-settings .color-reset-btn {
  padding: 2px 6px;
  font-size: 11px;
  line-height: 1.3;
  color: inherit;
  background: var(--ktv-glass-soft);
  border: 1px solid var(--ktv-glass-border);
  border-radius: 5px;
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .reaction-shot.ready .reaction-motion {
    /* Global reduced-motion rules shorten animations to their transparent end
       frame. Keep the shot visible until its existing event timer removes it. */
    animation: none !important;
    opacity: 1;
    transform: none;
  }
  .reaction-dock {
    animation: none;
  }
}
</style>
