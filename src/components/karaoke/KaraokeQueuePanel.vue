<template>
  <aside class="queue-panel glass-panel">
    <div class="panel-title">
      <div>
        <p class="eyebrow">本机待唱</p>
        <h2>等待队列</h2>
      </div>
      <span class="queue-count">{{ waitingItems.length }} 首待唱</span>
    </div>

    <article v-if="currentItem" class="current-queue-item">
      <span>正在演唱</span>
      <strong>{{ currentItem.trackName }}</strong>
      <small
        >{{ currentItem.artists.join(' / ') }} ·
        {{ currentItem.requesterName }}</small
      >
    </article>

    <ol v-if="waitingItems.length" class="waiting-list">
      <li v-for="(item, index) in waitingItems" :key="item.queueItemId">
        <span class="queue-number">{{
          String(index + 1).padStart(2, '0')
        }}</span>
        <div class="queue-item-copy">
          <strong>{{ item.trackName }}</strong>
          <small
            >{{ item.artists.join(' / ') }} · {{ item.requesterName }}</small
          >
        </div>
        <div class="queue-actions">
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`置顶 ${item.trackName}`"
            @click="$emit('move-queue-item-to-front', item.queueItemId)"
            >置顶</button
          >
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`上移 ${item.trackName}`"
            @click="$emit('move-queue-item', item.queueItemId, index - 1)"
            >↑</button
          >
          <button
            type="button"
            :disabled="index === waitingItems.length - 1"
            :aria-label="`下移 ${item.trackName}`"
            @click="$emit('move-queue-item', item.queueItemId, index + 1)"
            >↓</button
          >
          <button
            type="button"
            :aria-label="`删除 ${item.trackName}`"
            @click="$emit('remove-queue-item', item.queueItemId)"
            >删除</button
          >
        </div>
      </li>
    </ol>
    <div v-else class="queue-empty">
      <strong>{{ isSessionActive ? '还没有待唱歌曲' : 'KTV 尚未开始' }}</strong>
      <span>使用上方按钮把当前播放歌曲加入本机待唱。</span>
    </div>
    <button
      v-if="waitingItems.length"
      type="button"
      class="clear-waiting"
      @click="$emit('clear-waiting-queue')"
      >清空待唱</button
    >
  </aside>
</template>

<script>
export default {
  name: 'KaraokeQueuePanel',
  props: {
    currentItem: { type: Object, default: null },
    waitingItems: { type: Array, default: () => [] },
    isSessionActive: { type: Boolean, default: false },
  },
};
</script>

<style lang="scss" scoped>
.queue-panel {
  min-width: 0;
  padding: 24px;
}
.queue-panel button {
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease,
    border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}
.queue-panel button:not(:disabled):hover {
  border-color: rgba(108, 87, 233, 0.42);
  box-shadow: 0 6px 16px rgba(56, 42, 110, 0.12);
  transform: translateY(-1px);
}
.queue-panel button:not(:disabled):active {
  box-shadow: none;
  transform: translateY(1px) scale(0.97);
}
.queue-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.panel-title .eyebrow {
  margin-top: 0;
}
.eyebrow {
  margin: 18px 0 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.panel-title h2 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 21px;
}
.queue-count {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.current-queue-item {
  padding: 12px;
  border: 1px solid rgba(171, 156, 255, 0.36);
  border-radius: 14px;
  background: var(--ktv-glass-soft);
}
.current-queue-item span,
.current-queue-item strong,
.current-queue-item small {
  display: block;
}
.current-queue-item span {
  margin-bottom: 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
}
.current-queue-item small,
.queue-item-copy small {
  margin-top: 3px;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.waiting-list {
  max-height: 48vh;
  padding: 0;
  margin: 12px 0 0;
  overflow: auto;
  list-style: none;
}
.waiting-list li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 13px 0;
  border-bottom: 1px solid var(--ktv-glass-border);
}
.queue-number {
  color: var(--ktv-accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
.queue-item-copy {
  min-width: 0;
}
.queue-item-copy strong,
.queue-item-copy small {
  display: block;
  overflow-wrap: anywhere;
}
.queue-item-copy strong {
  font-size: 14px;
}
.queue-actions {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.queue-actions button {
  min-width: 26px;
  min-height: 28px;
  padding: 0 5px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.queue-empty {
  display: grid;
  gap: 6px;
  padding: 44px 4px;
  color: var(--ktv-text-muted);
  text-align: center;
  font-size: 13px;
}
.queue-empty strong {
  color: var(--ktv-text-secondary);
}
.clear-waiting {
  min-height: 36px;
  width: 100%;
  margin-top: 14px;
  padding: 0 13px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: var(--ktv-radius-control);
  background: var(--ktv-glass-strong);
  color: var(--ktv-danger);
  font-weight: 700;
}

@media (max-width: 1100px) {
  .waiting-list {
    max-height: 260px;
  }
}

@media (max-width: 760px) {
  .queue-panel {
    order: 2;
  }
}

@media (min-width: 2560px) {
  .queue-panel button {
    transition: background-color 160ms ease, border-color 160ms ease,
      color 160ms ease;
  }
}

@media (prefers-reduced-motion: reduce) {
  .queue-panel *,
  .queue-panel *::before,
  .queue-panel *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
