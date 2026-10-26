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
      <button type="button" @click="fullscreen">歌词全屏</button>
    </header>
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
    };
  },
  computed: {
    presentation() {
      return this.state.presentation || {};
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
        this.state.presentation,
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
input {
  padding: 10px 16px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 10px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font: inherit;
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
  .display-screen {
    padding: 14px;
    gap: 12px;
  }
  header {
    gap: 8px;
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
