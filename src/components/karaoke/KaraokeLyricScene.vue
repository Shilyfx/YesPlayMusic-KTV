<template>
  <div
    class="lyric-scene"
    :data-scene="mode"
    :data-paused="!playing"
    :data-effect="effect"
    :data-fullscreen="fullscreen"
  >
    <div class="scene-guide" aria-hidden="true"><i /><i /><i /></div>
    <div ref="copy" class="scene-copy">
      <p :key="'past-' + cueKey" class="scene-past">{{ lines.before }}</p>
      <p :key="'now-' + cueKey" ref="active" class="scene-now">{{
        lines.active
      }}</p>
      <p :key="'next-' + cueKey" class="scene-next">{{ lines.after }}</p>
      <p :key="'later-' + cueKey" class="scene-later">
        {{ lines.afterSecond }}
      </p>
    </div>
  </div>
</template>

<script>
// Four visible lines, supplied by the existing lyric cursor. No network,
// independent playback clock, full-song DOM, or word-timing approximation.
export default {
  props: {
    mode: { type: String, required: true },
    lines: { type: Object, required: true },
    cueKey: { type: String, required: true },
    playing: { type: Boolean, default: false },
    effect: { type: String, default: 'gradient' },
    fullscreen: { type: Boolean, default: false },
  },
  watch: {
    cueKey: 'focusCue',
    fullscreen: 'focusCue',
    mode: 'focusCue',
  },
  mounted() {
    this.focusCue();
    if (typeof ResizeObserver !== 'undefined') {
      this.sceneResize = new ResizeObserver(() => this.focusCue());
      this.sceneResize.observe(this.$el);
    }
  },
  beforeDestroy() {
    this.sceneResize?.disconnect();
  },
  methods: {
    focusCue() {
      if (!this.fullscreen) return;
      this.$nextTick(() => {
        if (this._isDestroyed || !this.fullscreen || !this.$refs.active) return;
        // Offset geometry ignores entrance transforms. Scroll only this scene,
        // never the host page; a long line remains manually scrollable.
        this.$el.scrollTop =
          this.$refs.copy.offsetTop + this.$refs.active.offsetTop - 12;
      });
    },
  },
};
</script>

<style scoped>
.lyric-scene {
  position: relative;
  width: 100%;
  min-height: 380px;
  display: grid;
  align-items: center;
  z-index: 1;
  --scene-ink: var(--ktv-text-primary);
}
.scene-copy {
  position: relative;
  width: 100%;
}
.scene-copy p {
  position: relative;
  margin: 0;
  overflow-wrap: anywhere;
  line-height: 1.35;
  color: var(--scene-ink);
}
.scene-now {
  font-size: var(--ktv-active-lyric-size);
  font-weight: 800;
  letter-spacing: -0.04em;
}
.scene-past,
.scene-next {
  font-size: clamp(15px, calc(var(--ktv-active-lyric-size) * 0.48), 36px);
  opacity: 0.5;
}
.scene-later {
  font-size: clamp(12px, calc(var(--ktv-active-lyric-size) * 0.34), 26px);
  opacity: 0.3;
}
[data-effect='gradient'] .scene-now {
  background: linear-gradient(
    105deg,
    var(--ktv-accent-strong),
    var(--ktv-text-primary) 42%,
    var(--ktv-accent)
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
[data-effect='neon'] .scene-now {
  color: #f7d8ff;
  text-shadow: 0 0 8px rgba(237, 164, 255, 0.8),
    0 0 26px rgba(162, 103, 255, 0.72);
}
[data-effect='outline'] .scene-now {
  color: transparent;
  -webkit-text-stroke: 1.5px var(--ktv-accent-strong);
}
.scene-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
/* Editorial spread: a spine, generous margins, and alternating alignment. */
[data-scene='poem'] {
  text-align: left;
  padding: 44px 0 66px;
}
[data-scene='poem'] .scene-copy {
  padding-left: 8%;
  box-sizing: border-box;
  border-left: 1px solid var(--ktv-accent);
}
[data-scene='poem'] .scene-now {
  font-family: 'Songti SC', 'Noto Serif CJK SC', 'SimSun', serif;
  font-weight: 500;
  margin: 38px 0;
  max-width: 90%;
  animation: scene-print 800ms ease-out both;
}
[data-scene='poem'] .scene-next,
[data-scene='poem'] .scene-later {
  text-align: right;
  margin-top: 16px;
  padding-right: 4%;
}
[data-scene='poem'] .scene-past {
  letter-spacing: 0.16em;
}
/* A fixed vanishing point; only the incoming line travels toward the reader. */
[data-scene='depth'] {
  perspective: 800px;
  text-align: center;
  padding: 55px 0 80px;
}
[data-scene='depth'] .scene-copy {
  transform-style: preserve-3d;
}
[data-scene='depth'] .scene-past {
  transform: translateY(-22px) rotateX(-18deg) scale(0.85);
}
[data-scene='depth'] .scene-now {
  margin: 28px 0 46px;
  animation: scene-approach 900ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
[data-scene='depth'] .scene-next {
  transform: rotateX(22deg) scale(0.8);
}
[data-scene='depth'] .scene-later {
  margin-top: 22px;
  transform: rotateX(30deg) scale(0.62);
}
[data-scene='depth'] .scene-guide {
  inset: 12% 3%;
  border: 1px solid var(--ktv-accent);
  opacity: 0.18;
  transform: perspective(500px) rotateX(58deg) scale(0.86);
}
[data-scene='depth'] .scene-guide i {
  position: absolute;
  inset: 20%;
  border: 1px solid var(--ktv-accent);
}
[data-scene='depth'] .scene-guide i:nth-child(2) {
  inset: 35%;
}
/* Arc composition, not a rotating canvas: active text stays horizontal. */
[data-scene='orbit'] {
  padding: 64px 0 80px;
  text-align: left;
}
[data-scene='orbit'] .scene-guide {
  width: 85%;
  aspect-ratio: 1;
  inset: 50% auto auto -45%;
  transform: translateY(-50%);
  border: 1px solid var(--ktv-accent);
  border-radius: 50%;
  opacity: 0.28;
}
[data-scene='orbit'] .scene-copy {
  padding-left: 12%;
  box-sizing: border-box;
}
[data-scene='orbit'] .scene-past {
  width: 88%;
  transform: translateX(10%) rotate(-7deg);
  transform-origin: left center;
}
[data-scene='orbit'] .scene-now {
  margin: 40px 0;
  padding-left: 14px;
  border-left: 3px solid var(--ktv-accent);
  animation: scene-orbit 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
[data-scene='orbit'] .scene-next {
  width: 88%;
  transform: translateX(10%) rotate(7deg);
  transform-origin: left center;
}
[data-scene='orbit'] .scene-later {
  margin-top: 38px;
  transform: translateX(3%) rotate(12deg);
  transform-origin: left center;
}
@keyframes scene-print {
  from {
    opacity: 0;
    transform: translateY(22px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes scene-approach {
  from {
    opacity: 0;
    transform: translateZ(-160px) rotateX(16deg);
  }
  to {
    opacity: 1;
    transform: translateZ(0) rotateX(0);
  }
}
@keyframes scene-orbit {
  from {
    opacity: 0;
    transform: translateY(35px) rotate(6deg);
  }
  to {
    opacity: 1;
    transform: translateY(0) rotate(0);
  }
}
[data-paused='true'] .scene-now {
  animation: none;
}
@media (max-width: 700px) {
  .lyric-scene {
    min-height: 310px;
  }
  .scene-now {
    font-size: var(--ktv-active-lyric-size);
  }
  [data-scene='orbit'] .scene-copy {
    padding-left: 4%;
    width: 89%;
  }
}
.lyric-scene[data-fullscreen='true'] {
  min-height: 0;
  max-height: calc(100vh - 180px);
  max-height: calc(100dvh - 180px);
  overflow: auto;
  padding-top: 18px;
  padding-bottom: 18px;
  box-sizing: border-box;
  flex-shrink: 1;
  align-items: safe center;
}
@media (max-height: 500px) {
  [data-fullscreen='true'] .scene-past,
  [data-fullscreen='true'] .scene-next,
  [data-fullscreen='true'] .scene-later {
    transform: none;
    width: 100%;
  }
  [data-fullscreen='true'] .scene-now {
    margin-top: 12px;
    margin-bottom: 16px;
  }
  [data-fullscreen='true'] .scene-later {
    margin-top: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .scene-copy p {
    animation: none !important;
  }
}
</style>
