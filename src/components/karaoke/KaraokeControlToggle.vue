<template>
  <button
    class="ktv-control-toggle"
    type="button"
    :aria-expanded="open ? 'true' : 'false'"
    aria-controls="karaoke-control-panel"
    :aria-label="open ? '关闭演唱控制' : '打开演唱控制'"
    @click="$emit('toggle', !open)"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 4h-7m-4 0H3m18 8h-9m-4 0H3m18 8h-5m-4 0H3" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="14" cy="20" r="2" />
    </svg>
  </button>
</template>

<script>
export default {
  name: 'KaraokeControlToggle',
  props: {
    open: { type: Boolean, default: false },
  },
};
</script>

<style lang="scss" scoped>
.ktv-control-toggle {
  position: fixed;
  z-index: 1101;
  right: 16px;
  bottom: 16px;
  display: grid;
  width: var(--ktv-control-toggle-size, 52px);
  height: var(--ktv-control-toggle-size, 52px);
  place-items: center;
  padding: 0;
  border: 1px solid var(--ktv-glass-border, rgba(255, 255, 255, 0.2));
  border-radius: 50%;
  background: var(--ktv-glass-strong, rgba(24, 25, 44, 0.8));
  box-shadow: var(--ktv-shadow, 0 12px 34px rgba(0, 0, 0, 0.3));
  color: var(--ktv-text-primary, #fff);
  backdrop-filter: blur(20px) saturate(130%);
  -webkit-backdrop-filter: blur(20px) saturate(130%);
  cursor: pointer;
  transition: transform 180ms ease, background-color 180ms ease;
}
.ktv-control-toggle.karaoke-control-toggle--bar {
  position: absolute;
  right: 16px;
  top: 0;
  bottom: 0;
  margin: auto 0;
}

.ktv-control-toggle svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.ktv-control-toggle:hover {
  background: var(--ktv-glass-bg, rgba(24, 25, 44, 0.76));
  transform: translateY(-2px);
}

.ktv-control-toggle:active {
  transform: scale(0.96);
}

.ktv-control-toggle:focus-visible {
  outline: 2px solid var(--ktv-accent, #ab9cff);
  outline-offset: 3px;
}

@media (max-width: 420px) {
  .ktv-control-toggle {
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .ktv-control-toggle {
    transition-duration: 1ms;
  }
}
</style>
