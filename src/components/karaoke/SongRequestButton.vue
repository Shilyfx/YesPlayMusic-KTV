<template>
  <span class="song-request" :class="'qr-' + placement">
    <button
      type="button"
      :disabled="!safeUrl"
      aria-label="点歌"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @click="openRequest"
      >点歌</button
    >
    <span v-if="hovered && image" class="song-request-qr" role="tooltip">
      <img :src="image" alt="本次房间点歌二维码" />
    </span>
  </span>
</template>

<script>
import QRCode from 'qrcode';

// Share work across screen/button mounts; no network request is needed.
const codes = new Map();
function qrFor(url) {
  if (!codes.has(url)) {
    const pending = QRCode.toDataURL(url, { margin: 3, width: 280 }).catch(
      error => {
        codes.delete(url);
        throw error;
      }
    );
    codes.set(url, pending);
    if (codes.size > 8) codes.delete(codes.keys().next().value);
  }
  return codes.get(url);
}

export default {
  name: 'SongRequestButton',
  props: {
    url: { type: String, default: '' },
    qrDataUrl: { type: String, default: '' },
    placement: { type: String, default: 'below' },
  },
  data: () => ({ hovered: false, generatedQr: '' }),
  computed: {
    safeUrl() {
      try {
        if (!this.url) return '';
        const url = new URL(this.url, window.location.href);
        return url.origin === window.location.origin &&
          /^\/room\/[a-zA-Z0-9_-]{1,64}\/?$/.test(url.pathname) &&
          url.hash.startsWith('#token=') &&
          url.hash.length > '#token='.length
          ? url.href
          : '';
      } catch (_) {
        return '';
      }
    },
    image() {
      return this.safeUrl ? this.qrDataUrl || this.generatedQr : '';
    },
  },
  watch: {
    safeUrl: {
      immediate: true,
      async handler(url) {
        this.hovered = false;
        this.generatedQr = '';
        if (!url || this.qrDataUrl) return;
        try {
          const image = await qrFor(url);
          if (!this._isDestroyed && this.safeUrl === url)
            this.generatedQr = image;
        } catch (_) {
          // The existing click-to-open action remains available.
        }
      },
    },
  },
  methods: {
    openRequest() {
      if (this.safeUrl)
        window.open(this.safeUrl, '_blank', 'noopener,noreferrer');
    },
  },
};
</script>

<style scoped>
.song-request {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
.song-request button {
  padding: 8px 12.8px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 12px;
  color: var(--ktv-text-primary);
  background: var(--ktv-glass-soft);
  font: inherit;
  cursor: pointer;
}
.qr-above button {
  min-height: 38px;
  padding: 0 13px;
  font-weight: 700;
}
.song-request button:disabled {
  opacity: 0.5;
  cursor: default;
}
.song-request button:focus-visible {
  outline: 2px solid var(--ktv-accent);
  outline-offset: 2px;
}
.song-request-qr {
  position: absolute;
  right: 0;
  top: calc(100% + 12px);
  z-index: 60;
  display: block;
  width: 200px;
  height: 200px;
  box-sizing: border-box;
  padding: 4px;
  border-radius: 14px;
  background: white;
  box-shadow: 0 12px 36px #14103233;
  pointer-events: none;
}
.qr-above .song-request-qr {
  top: auto;
  bottom: calc(100% + 12px);
}
.song-request-qr img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
}
</style>
