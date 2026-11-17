<template>
  <section class="local-library local-library-overlay glass-panel">
    <div class="local-library-heading">
      <div>
        <p class="eyebrow">LOCAL LIBRARY</p>
        <h2>本地歌单</h2>
        <p class="local-library-note">
          支持递归扫描音频目录；同名 .lrc 与封面图片会自动加载。
        </p>
      </div>
      <div class="local-library-actions">
        <button
          v-if="isElectron"
          type="button"
          class="room-tool"
          @click="$emit('choose-directories')"
        >
          选择音乐目录
        </button>
        <button
          type="button"
          class="room-tool"
          :disabled="loading"
          @click="$emit('scan')"
        >
          {{ loading ? '扫描中…' : '重新扫描' }}
        </button>
      </div>
    </div>
    <div v-if="!isElectron" class="local-directory-add">
      <input
        :value="directoryInput"
        type="text"
        class="setting-input local-directory-input"
        placeholder="输入服务器本地歌单目录，如 /music/周杰伦"
        @input="$emit('update-directory-input', $event.target.value)"
        @keydown.enter.prevent="$emit('add-directory')"
      />
      <button
        type="button"
        class="room-tool"
        :disabled="loading || !directoryInput.trim()"
        @click="$emit('add-directory')"
      >
        添加目录
      </button>
    </div>
    <div v-if="directories.length" class="local-directory-list">
      <span
        v-for="directory in directories"
        :key="directory"
        class="local-directory"
      >
        {{ directory }}
        <button
          type="button"
          aria-label="移除本地目录"
          @click="$emit('remove-directory', directory)"
          >×</button
        >
      </span>
    </div>
    <div
      v-if="loading"
      class="local-scan-progress"
      role="status"
      aria-live="polite"
    >
      <span class="local-scan-progress-bar" aria-hidden="true"></span>
      <span>正在扫描目录并更新本地索引…</span>
    </div>
    <p v-if="error" class="room-warning">{{ error }}</p>
    <p v-else class="local-library-status">
      {{
        trackCount
          ? `已发现 ${trackCount} 首本地歌曲，可在下方直接点歌，也可在手机点歌页的“我的歌单 -> 本地歌单”中选择。`
          : '尚未配置本地音乐目录。'
      }}
    </p>
    <div v-if="playlists.length" class="local-playlist-browser">
      <div
        v-for="playlist in playlists"
        :key="playlist.id"
        class="local-playlist-section"
      >
        <div class="local-playlist-header">
          <strong>{{ playlist.name }}</strong>
          <span>{{ playlist.trackCount || playlist.tracks.length }} 首</span>
        </div>
        <div class="local-track-grid">
          <article
            v-for="item in playlist.tracks"
            :key="item.localId || item.id"
            class="local-track-item"
          >
            <img
              v-if="item.coverUrl"
              :src="item.coverUrl"
              :alt="item.name"
              class="local-track-cover"
              loading="lazy"
            />
            <div v-else class="local-track-cover local-track-cover-fallback">
              ♪
            </div>
            <div class="local-track-meta">
              <strong :title="item.name">{{ item.name }}</strong>
              <small>{{
                (item.artists || []).map(a => a.name || a).join(' / ') ||
                '未知歌手'
              }}</small>
            </div>
            <div class="local-track-buttons">
              <button
                type="button"
                class="room-tool"
                @click="
                  $emit('enqueue-track', { track: item, priority: false })
                "
              >
                点歌
              </button>
              <button
                type="button"
                class="room-tool"
                @click="$emit('enqueue-track', { track: item, priority: true })"
              >
                优先
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
export default {
  name: 'KaraokeLocalLibraryPanel',
  props: {
    directories: { type: Array, default: () => [] },
    playlists: { type: Array, default: () => [] },
    trackCount: { type: Number, default: 0 },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' },
    directoryInput: { type: String, default: '' },
    isElectron: { type: Boolean, default: false },
  },
};
</script>

<style lang="scss" scoped>
h2,
p {
  margin-top: 0;
}
.local-library button {
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease,
    border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}
.local-library button:not(:disabled):hover {
  border-color: rgba(108, 87, 233, 0.42);
  box-shadow: 0 6px 16px rgba(56, 42, 110, 0.12);
  transform: translateY(-1px);
}
.local-library button:not(:disabled):active {
  box-shadow: none;
  transform: translateY(1px) scale(0.97);
}
.local-library button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.eyebrow {
  margin: 18px 0 5px;
  color: var(--ktv-accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.local-library {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 16px 20px;
  box-sizing: border-box;
}
.local-library-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.local-library h2 {
  margin: 2px 0 0;
  color: var(--ktv-text-primary);
  font-size: 20px;
}
.local-library-note,
.local-library-status {
  margin: 4px 0 0;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.local-scan-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.local-scan-progress-bar {
  display: block;
  width: 72px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ktv-glass-border);
}
.local-scan-progress-bar::after {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: var(--ktv-accent);
  content: '';
  animation: ktv-local-scan 1.2s ease-in-out infinite;
}
@keyframes ktv-local-scan {
  0% {
    transform: translateX(-150%);
  }
  100% {
    transform: translateX(340%);
  }
}
.local-library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.local-directory-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.local-directory {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  gap: 6px;
  padding: 6px 10px;
  overflow: hidden;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 999px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local-directory button {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ktv-text-muted);
  font-size: 16px;
  line-height: 1;
}
.local-directory-add {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-input {
  width: 58px;
  min-height: 34px;
  padding: 0 7px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 9px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.local-directory-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 7px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font-size: 12px;
}
.local-note {
  color: var(--ktv-text-muted);
  font-size: 13px;
}
.local-playlist-browser {
  display: grid;
  gap: 12px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}
.local-playlist-section {
  display: grid;
  gap: 8px;
}
.local-playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ktv-text-secondary);
  font-size: 13px;
}
.local-track-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.local-track-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
}
.local-track-cover {
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--ktv-glass-strong);
}
.local-track-cover-fallback {
  display: grid;
  place-items: center;
  color: var(--ktv-text-muted);
  font-size: 18px;
}
.local-track-meta {
  flex: 1 1 auto;
  min-width: 0;
}
.local-track-meta strong,
.local-track-meta small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.local-track-meta strong {
  color: var(--ktv-text-primary);
  font-size: 13px;
}
.local-track-meta small {
  margin-top: 2px;
  color: var(--ktv-text-muted);
  font-size: 11px;
}
.local-track-buttons {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}
</style>
