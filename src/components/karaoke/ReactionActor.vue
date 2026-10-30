<template><div ref="canvas" class="reaction-actor" /></template>
<script>
import { loadEmotionBall, loadMoodMates } from '@/karaoke/moodMates';
export default {
  props: {
    character: { type: String, default: 'ball' },
    emotion: { type: String, default: '02' },
    active: { type: Boolean, default: true },
    bodyColor: { type: String, default: '' },
    eyeColor: { type: String, default: '' },
  },
  watch: {
    character: 'load',
    emotion: 'sync',
    active: 'sync',
    bodyColor: 'syncTheme',
    eyeColor: 'syncTheme',
  },
  created() {
    this.engine = null;
    this.loadVersion = 0;
  },
  mounted() {
    this.load();
  },
  beforeDestroy() {
    this.loadVersion++;
    this.engine?.destroy();
    this.engine = null;
  },
  methods: {
    async load() {
      const version = ++this.loadVersion;
      this.engine?.destroy();
      this.engine = null;
      try {
        const library = await (this.character === 'ball'
          ? loadEmotionBall()
          : loadMoodMates());
        if (version !== this.loadVersion || !this.$refs.canvas) return;
        this.engine = library.create(this.$refs.canvas, {
          character: this.character,
          emotion: this.emotion,
          autostart: false,
          idle: false,
          lite: false,
        });
        this.sync();
        this.$emit('ready');
      } catch (error) {
        if (version === this.loadVersion) this.$emit('unavailable', error);
      }
    },
    sync() {
      if (!this.engine) return;
      this.applyTheme();
      this.engine.setActive(this.active);
      if (this.engine.emotionId !== this.emotion)
        this.engine.setEmotion(this.emotion);
      if (!this.active) this.engine.renderStatic?.();
    },
    applyTheme() {
      if (!this.engine) return;
      const body =
        typeof this.bodyColor === 'string' ? this.bodyColor.trim() : '';
      const eyes =
        typeof this.eyeColor === 'string' ? this.eyeColor.trim() : '';
      this.engine._theme =
        body || eyes ? { body: body || null, eyes: eyes || null } : null;
    },
    syncTheme() {
      if (!this.engine) return;
      this.applyTheme();
      if (!this.active) this.engine.renderStatic?.();
    },
    perform(action) {
      if (!action || !this.engine) return;
      if (action === 'burst') this.engine.burst?.(12);
      else if (action === 'firework') {
        this.engine.bounce?.();
        this.engine.burst?.(24);
      } else if (action === 'carnival') {
        if (this.engine.celebrate) this.engine.celebrate(1.2);
        else {
          this.engine.spin?.(1);
          this.engine.burst?.(20);
        }
      } else if (action === 'signature') {
        const ok = this.engine.signature?.(1);
        if (!ok) this.engine.burst?.(10);
      } else if (action === 'spin-burst') {
        this.engine.spin?.(1);
        this.engine.burst?.(14);
      } else {
        this.engine[action]?.();
      }
    },
  },
};
</script>
<style scoped>
.reaction-actor {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.reaction-actor ::v-deep svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
</style>
