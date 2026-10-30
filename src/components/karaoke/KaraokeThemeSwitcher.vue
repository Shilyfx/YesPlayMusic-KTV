<template>
  <div
    class="karaoke-theme-switcher"
    :data-value="value"
    role="group"
    aria-label="KTV 主题"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: value === option.value }"
      :aria-pressed="value === option.value"
      @click="$emit('input', option.value)"
    >
      <svg
        v-if="option.icon === 'sun'"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="4" />
        <path
          d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"
        />
      </svg>
      <svg
        v-else-if="option.icon === 'moon'"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path
          d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.807a6.5 6.5 0 0 0 8.268 8.268c.347-.215.829-.003.803.397"
        />
      </svg>
      <span>{{ option.label }}</span>
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
        { value: 'light', label: '浅色', icon: 'sun' },
        { value: 'dark', label: '深色', icon: 'moon' },
      ],
    };
  },
};
</script>

<style lang="scss" scoped>
.karaoke-theme-switcher {
  position: relative;
  isolation: isolate;
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  padding: 3px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 12px;
  background: var(--ktv-glass-soft);

  &::before {
    position: absolute;
    z-index: 0;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / 3);
    border-radius: 9px;
    background: var(--ktv-glass-strong);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
    content: '';
    opacity: 0;
    pointer-events: none;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
      background-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 120ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  &[data-value='auto']::before {
    opacity: 1;
  }

  &[data-value='light']::before {
    opacity: 1;
    transform: translateX(100%);
  }

  &[data-value='dark']::before {
    opacity: 1;
    transform: translateX(200%);
  }

  button {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    min-width: 0;
    min-height: 32px;
    padding: 0 7px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ktv-text-secondary);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
      background-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
      border-color 120ms cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 120ms cubic-bezier(0.4, 0, 0.2, 1),
      color 120ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  button.active {
    color: var(--ktv-text-primary);
  }

  button:not(:disabled):hover {
    box-shadow: none;
    color: var(--ktv-text-primary);
    transform: none;
  }

  button:not(:disabled):active {
    box-shadow: none;
    transform: none;
  }

  button:focus-visible {
    outline: 2px solid var(--ktv-accent);
    outline-offset: 2px;
  }

  button svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
}
</style>
