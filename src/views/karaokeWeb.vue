<template>
  <Karaoke
    v-if="isMaster"
    ref="master"
    :web-host-name="hostName"
    @web-room-lost="releaseMaster"
    @web-host-ended="releaseMaster"
  >
    <template #docker-controls>
      <button type="button" class="session-button" @click="requestRelease">
        主电脑：{{ hostName }} · 切换为副屏
      </button>
    </template>
  </Karaoke>
  <section
    v-else
    ref="screen"
    class="karaoke-surface display-screen"
    :data-ktv-theme="presentation.theme || 'light'"
    :style="sceneStyle"
  >
    <header>
      <button type="button" @click="$router.push('/')">返回音乐</button>
      <div
        ><strong>{{
          state.active ? state.hostName + ' · 同步副屏' : '等待指定主电脑'
        }}</strong>
        <small>{{ connectionLabel }} · 本屏静音</small></div
      >
      <div class="screen-actions">
        <button
          type="button"
          :aria-expanded="showSettings"
          @click="showSettings = !showSettings"
          >本屏歌词设置</button
        >
        <button type="button" @click="fullscreen">歌词全屏</button>
      </div>
    </header>
    <section
      v-if="showSettings"
      class="display-preferences glass-panel"
      aria-label="本屏歌词设置"
    >
      <fieldset>
        <legend>舞台与字体</legend>
        <label class="follow-toggle"
          ><input
            type="checkbox"
            :checked="preferences.followStyle"
            @change="updatePreference('followStyle', $event.target.checked)"
          />跟随主屏样式</label
        >
        <div class="preference-fields">
          <label
            >舞台样式<select
              aria-label="本屏舞台样式"
              :disabled="preferences.followStyle"
              :value="presentation.mode || 'classic'"
              @change="updatePreference('mode', $event.target.value)"
              ><option
                v-for="mode in stageModeOptions"
                :key="mode.value"
                :value="mode.value"
                >{{ mode.label }}</option
              ></select
            ></label
          >
          <label
            >歌词字效<select
              aria-label="本屏歌词字效"
              :disabled="preferences.followStyle"
              :value="presentation.effect || 'gradient'"
              @change="updatePreference('effect', $event.target.value)"
              ><option value="gradient">渐变</option
              ><option value="neon">霓虹</option
              ><option value="outline">描边</option
              ><option value="solid">纯色</option></select
            ></label
          >
          <label
            >歌词字号<input
              aria-label="本屏歌词字号"
              type="number"
              min="16"
              max="64"
              step="1"
              :disabled="preferences.followStyle"
              :value="presentation.fontSize || 45"
              @change="updatePreference('fontSize', $event.target.value)"
            />px</label
          >
        </div>
      </fieldset>
      <fieldset>
        <legend>歌词同步</legend>
        <label class="follow-toggle"
          ><input
            type="checkbox"
            :checked="preferences.followTiming"
            @change="updatePreference('followTiming', $event.target.checked)"
          />跟随主屏提前 / 延后</label
        >
        <label
          >本屏偏移<input
            aria-label="本屏歌词偏移"
            type="number"
            min="-10"
            max="10"
            step="0.1"
            :disabled="preferences.followTiming"
            :value="presentation.offset || 0"
            @change="updatePreference('offset', $event.target.value)"
          />秒</label
        >
        <p>正数提前，负数延后；以歌曲原始时间为准，不叠加主屏偏移。</p>
      </fieldset>
      <div class="preference-footer"
        ><span role="status">{{
          preferenceMessage || '仅保存在本机浏览器，不影响主屏与其他副屏。'
        }}</span
        ><button type="button" @click="restoreFollow"
          >全部恢复跟随主屏</button
        ></div
      >
    </section>
    <div v-if="!state.active" class="master-choice glass-panel">
      <h1>让多台电脑，听同一首歌</h1>
      <p
        >请在负责播放声音的电脑上指定主机。其他电脑打开本页面，会自动同步显示歌词。</p
      >
      <label
        >主电脑名称
        <input v-model="hostName" maxlength="40" placeholder="例如：客厅主电脑"
      /></label>
      <button
        type="button"
        :disabled="claiming || !connected"
        @click="chooseMaster"
        >将本机设为主电脑</button
      >
      <p v-if="error" role="status">{{ error }}</p>
    </div>
    <main v-else class="display-stage" aria-label="同步歌词舞台">
      <div class="track-caption"
        ><strong>{{ presentation.title || '等待主电脑开始播放' }}</strong
        ><span>{{ presentation.artists }}</span></div
      >
      <KaraokeLyricScene
        :mode="presentation.mode || 'classic'"
        :lines="stage"
        :cue-key="stage.cueKey"
        :effect="presentation.effect || 'gradient'"
        :playing="presentation.playing && !stale"
        :fullscreen="true"
      />
      <p v-if="stale" class="connection-warning" role="status"
        >主电脑同步中断，正在等待重连；本屏不会接管播放。</p
      >
    </main>
    <footer
      >Docker 多屏显示 · 请保持主电脑页面打开 ·
      只在主电脑或手机上点歌和切歌</footer
    >
  </section>
</template>

<script>
import { Howler } from 'howler';
import Karaoke from './karaoke.vue';
import KaraokeLyricScene from '@/components/karaoke/KaraokeLyricScene.vue';
import createDisplayPoller from '@/karaoke/displayPoller';
import { projectPresentation } from '@/karaoke/lyricDisplay';
import { stageModeOptions } from '@/utils/lyricStageModes';
import {
  readDisplayPreferences,
  writeDisplayPreferences,
  normalizeDisplayPreferences,
  effectiveDisplayPresentation,
} from '@/karaoke/displayPreferences';

export default {
  components: { Karaoke, KaraokeLyricScene },
  data() {
    return {
      isMaster: false,
      claiming: false,
      hostName: '主电脑',
      state: { active: false },
      connected: false,
      error: '',
      receivedAt: 0,
      clockNow: 0,
      clock: null,
      claimEpoch: 0,
      showSettings: false,
      preferences: readDisplayPreferences(),
      preferenceMessage: '',
    };
  },
  computed: {
    presentation() {
      return effectiveDisplayPresentation(
        this.state.presentation || {},
        this.preferences
      );
    },
    stageModeOptions() {
      return stageModeOptions;
    },
    stale() {
      return (
        !this.connected ||
        this.state.stale ||
        this.clockNow - this.receivedAt > 5000
      );
    },
    connectionLabel() {
      if (!this.connected) return '连接服务中';
      return this.state.active
        ? this.stale
          ? '等待主电脑重连'
          : '与主电脑同步'
        : '尚未指定主电脑';
    },
    stage() {
      const age =
        Math.max(
          0,
          (this.state.serverTime || 0) - (this.state.updatedAt || 0)
        ) / 1000;
      return projectPresentation(
        this.presentation,
        age + Math.max(0, this.clockNow - this.receivedAt) / 1000
      );
    },
    sceneStyle() {
      return {
        '--ktv-active-lyric-size': `${this.presentation.fontSize || 45}px`,
      };
    },
  },
  created() {
    this.previousMuted = Howler._muted;
    this.silenceDisplay();
    this.poller = createDisplayPoller({
      onState: state => {
        this.state = state;
        this.connected = true;
        this.receivedAt = this.clockNow = performance.now();
        this.restartClock();
      },
      onError: () => {
        this.connected = false;
        this.error = '无法连接 Docker KTV 服务';
      },
    });
    this.visibilityHandler = () => {
      clearInterval(this.clock);
      if (document.hidden || this.isMaster) this.poller.stop();
      else {
        this.poller.start();
        this.restartClock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.pageHideHandler = () => {
      if (this.isMaster) this.releaseMaster();
    };
    window.addEventListener('pagehide', this.pageHideHandler);
    this.visibilityHandler();
  },
  beforeDestroy() {
    this.leaving = true;
    this.claimEpoch++;
    if (this.isMaster) this.$store.$karaokeManager.endSession();
    this.poller.stop();
    clearInterval(this.clock);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('pagehide', this.pageHideHandler);
    Howler.mute(this.previousMuted);
    this.$store.state.webKtvDisplayOnly = true;
    if (this.$route.name !== 'karaoke') this.$store.$initializePlayerOnce();
  },
  methods: {
    updatePreference(key, value) {
      if (
        ![
          'followStyle',
          'followTiming',
          'mode',
          'effect',
          'fontSize',
          'offset',
        ].includes(key)
      )
        return;
      this.preferences = normalizeDisplayPreferences({
        ...this.preferences,
        [key]: value,
      });
      this.savePreferences();
    },
    savePreferences() {
      this.preferenceMessage = writeDisplayPreferences(this.preferences)
        ? '本屏设置已保存'
        : '浏览器不允许保存；本次设置仍然生效';
    },
    restoreFollow() {
      this.preferences = {
        ...this.preferences,
        followStyle: true,
        followTiming: true,
      };
      this.savePreferences();
    },
    silenceDisplay() {
      this.$store.state.webKtvDisplayOnly = true;
      Howler.mute(true);
      this.$store.state.player.pause();
    },
    restartClock() {
      clearInterval(this.clock);
      if (
        document.hidden ||
        this.isMaster ||
        !this.state.active ||
        !this.presentation.playing
      )
        return;
      this.clock = setInterval(() => {
        this.clockNow = performance.now();
        if (this.clockNow - this.receivedAt > 5000) clearInterval(this.clock);
      }, 100);
    },
    async chooseMaster() {
      if (this.claiming || this.state.active) return;
      const claim = ++this.claimEpoch;
      this.claiming = true;
      this.error = '';
      this.poller.stop();
      clearInterval(this.clock);
      this.$store.state.webKtvDisplayOnly = false;
      Howler.mute(this.previousMuted);
      this.isMaster = true;
      await this.$nextTick();
      try {
        if (this.leaving || claim !== this.claimEpoch) return;
        const master = this.$refs.master;
        master.enableBrowserAudio();
        this.$store.state.player._initMediaSession();
        await master.loadLanCandidates();
        if (this.leaving || claim !== this.claimEpoch) return;
        const result = await master.startLanRoom();
        if (this.leaving || claim !== this.claimEpoch) {
          await master.webRoomBridge.dispose();
          return;
        }
        if (!result?.ok)
          throw new Error('未能取得主电脑资格，可能已有另一台主电脑');
      } catch (error) {
        if (this.leaving || claim !== this.claimEpoch) return;
        this.error = error.message;
        await this.releaseMaster();
      } finally {
        if (claim === this.claimEpoch) this.claiming = false;
      }
    },
    requestRelease() {
      if (
        window.confirm(
          '释放主电脑会结束当前房间及播放，其他电脑将等待重新指定主机。继续吗？'
        )
      )
        this.releaseMaster();
    },
    async releaseMaster() {
      const release = ++this.claimEpoch;
      this.claiming = false;
      const master = this.$refs.master;
      if (master) {
        this.$store.$karaokeManager.endSession();
        await master.webRoomBridge.dispose();
      }
      if (this.leaving || release !== this.claimEpoch) return;
      this.isMaster = false;
      this.silenceDisplay();
      this.state = { active: false };
      this.visibilityHandler();
    },
    fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else this.$refs.screen.requestFullscreen?.().catch(() => {});
    },
  },
};
</script>

<style scoped>
.display-screen {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--ktv-bg-base);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
header div {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
}
small,
footer,
.track-caption span {
  color: var(--ktv-text-muted);
  font-size: 12px;
}
button,
input,
select {
  padding: 10px 16px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
}
.screen-actions {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
}
.display-preferences {
  flex-shrink: 0;
  padding: 16px 20px;
  max-height: 40vh;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px 24px;
}
.display-preferences fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.display-preferences legend {
  font-weight: 700;
  margin-bottom: 10px;
}
.display-preferences label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
}
.display-preferences input[type='checkbox'] {
  accent-color: var(--ktv-accent);
  width: 16px;
  height: 16px;
}
.follow-toggle {
  margin-bottom: 12px;
  display: flex !important;
}
.preference-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.display-preferences input[type='number'] {
  width: 68px;
  padding: 8px;
}
.display-preferences select {
  padding: 8px;
  max-width: 100%;
}
.display-preferences p {
  color: var(--ktv-text-muted);
  font-size: 12px;
  margin-bottom: 0;
}
.display-preferences :disabled {
  opacity: 0.5;
}
.preference-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ktv-text-muted);
  font-size: 12px;
}
.display-preferences :focus-visible {
  outline: 2px solid var(--ktv-accent);
  outline-offset: 3px;
}
.master-choice {
  margin: auto;
  padding: 36px;
  max-width: 640px;
  line-height: 1.8;
}
.master-choice label {
  display: block;
  margin: 24px 0;
}
.master-choice button {
  background: var(--ktv-accent);
  color: white;
}
.master-choice button:disabled {
  opacity: 0.4;
}
.display-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.track-caption {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 14px;
  margin-bottom: 16px;
}
.connection-warning {
  position: absolute;
  bottom: 0;
  color: var(--ktv-warning);
  font-size: 13px;
}
footer {
  text-align: center;
  flex-shrink: 0;
}
@media (max-width: 700px) {
  .display-preferences {
    grid-template-columns: 1fr;
    padding: 12px;
  }
  .preference-footer {
    flex-wrap: wrap;
  }
  .display-screen {
    padding: 14px;
    gap: 12px;
  }
  header {
    gap: 8px;
    flex-wrap: wrap;
  }
  .screen-actions {
    width: 100%;
    justify-content: flex-end;
  }
  header button {
    font-size: 12px;
    padding: 8px;
  }
  .master-choice {
    padding: 20px;
  }
  h1 {
    font-size: 24px;
  }
  .track-caption {
    flex-direction: column;
    align-items: center;
  }
}
</style>
