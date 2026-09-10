<template>
  <div class="karaoke-theme-switcher" role="group" aria-label="KTV 主题">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: value === option.value }"
      :aria-pressed="value === option.value"
      @click="$emit('input', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script>
export default {
  name: 'KaraokeThemeSwitcher',
  props: {
    value: {
      type: String,
      default: 'auto',
    },
  },
  data() {
    return {
      options: [
        { value: 'auto', label: '自动' },
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' },
      ],
    };
  },
};
</script>

<style lang="scss" scoped>
.karaoke-theme-switcher {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 12px;
  background: var(--ktv-glass-soft);

  button {
    min-height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    color: var(--ktv-text-secondary);
    font-size: 12px;
    font-weight: 600;
    transition: transform 160ms ease, background-color 160ms ease,
      box-shadow 160ms ease, color 160ms ease;
  }

  button:not(.active):hover {
    background: var(--ktv-glass-strong);
    color: var(--ktv-text-primary);
    transform: translateY(-1px);
  }

  button:not(.active):active {
    transform: translateY(1px) scale(0.97);
  }

  button.active {
    background: var(--ktv-glass-strong);
    box-shadow: 0 2px 10px rgba(9, 12, 30, 0.14);
    color: var(--ktv-text-primary);
  }

  button:focus-visible {
    outline: 2px solid var(--ktv-accent);
    outline-offset: 2px;
  }
}
</style>
