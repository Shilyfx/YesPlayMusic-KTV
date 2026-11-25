<template>
  <section
    class="room-access room-access-overlay glass-panel"
    :class="{ 'room-access-pending': !lanRoom }"
  >
    <div v-if="lanRoom" class="room-qr-wrap">
      <img
        v-if="lanRoom.qrDataUrl"
        :src="lanRoom.qrDataUrl"
        alt="局域网 KTV 房间二维码"
      />
      <div v-else class="room-qr-placeholder">二维码暂不可用</div>
    </div>
    <div class="room-access-copy">
      <strong>{{
        lanRoom ? '用同一局域网设备扫码加入' : '选择对外网卡'
      }}</strong>
      <p v-if="lanRoom"
        >房间码 {{ lanRoom.code }}。链接仅在本次 KTV 进行期间有效。</p
      >
      <p v-if="lanRoom && lanRoom.qrError" class="room-warning">
        {{ lanRoom.qrError }}
      </p>
      <div v-if="lanRoom" class="room-link-block">
        <span class="room-link-label">局域网点歌</span>
        <div class="room-link-row">
          <code class="room-link">{{ lanRoom.joinUrl || lanRoom.url }}</code>
          <button
            type="button"
            class="room-link-copy"
            @click="$emit('copy-lan-link')"
          >
            {{ copyLinkLabel }}
          </button>
        </div>
      </div>
      <div v-if="lanRoom && lanRoom.backupJoinUrl" class="room-link-block">
        <span class="room-link-label"
          >备用加入链接（如手机开启加密DNS无法解析域名请用此链接）</span
        >
        <div class="room-link-row">
          <code class="room-link">{{ lanRoom.backupJoinUrl }}</code>
          <button
            type="button"
            class="room-link-copy"
            @click="$emit('copy-backup-link')"
          >
            {{ copyBackupLinkLabel }}
          </button>
        </div>
      </div>
      <p v-if="!lanRoom"
        >服务会监听全部网络；你选择的网卡只决定二维码中的访问地址。</p
      >
      <label v-if="lanCandidates.length">
        网卡地址
        <select
          :value="selectedLanAddress"
          @change="$emit('select-lan-address', $event.target.value)"
        >
          <option
            v-for="candidate in lanCandidates"
            :key="candidate.address"
            :value="candidate.address"
            >{{ candidate.interfaceName }} · {{ candidate.address }}</option
          >
        </select>
      </label>
      <button
        v-if="!lanRoom"
        type="button"
        class="generate-room"
        :disabled="!selectedLanAddress"
        @click="$emit('start-lan-room')"
        >生成房间二维码</button
      >
      <button
        v-else
        type="button"
        class="generate-room"
        @click="$emit('restart-lan-room')"
        >按当前网卡更新二维码</button
      >
      <div v-if="lanRoom" class="room-tools">
        <button type="button" class="room-tool" @click="$emit('retry-lan-qr')">
          重试二维码
        </button>
        <button type="button" class="room-tool" @click="$emit('self-test-lan')">
          {{ lanSelfTest === 'checking' ? '检测中…' : '检测当前网卡' }}
        </button>
      </div>
      <p v-if="lanSelfTest === 'ok'" class="room-success"
        >当前网卡可访问 KTV 服务</p
      >
      <p v-else-if="lanSelfTest === 'error'" class="room-warning">
        当前网卡自检失败，请确认手机与主机处于同一局域网
      </p>
    </div>
    <template v-if="lanRoom && (lanRoom.publicJoinUrl || isElectron)">
      <div class="room-qr-wrap">
        <img
          v-if="lanRoom.publicJoinUrl && lanRoom.publicQrDataUrl"
          :src="lanRoom.publicQrDataUrl"
          alt="公网 KTV 房间二维码"
        />
        <div v-else class="room-qr-placeholder">公网二维码暂不可用</div>
      </div>
      <div class="room-access-copy room-link-block">
        <strong>公网点歌</strong>
        <p v-if="lanRoom.publicStatus">状态：{{ publicStatusLabel }}</p>
        <p v-else-if="lanRoom.publicJoinUrl"
          >适用于使用移动网络或其他 Wi-Fi 的来宾。</p
        >
        <p v-if="lanRoom.publicError" class="room-warning">
          {{ lanRoom.publicError }}
        </p>
        <p v-if="lanRoom.publicQrError" class="room-warning">
          {{ lanRoom.publicQrError }}
        </p>
        <div v-if="lanRoom.publicJoinUrl" class="room-link-row">
          <code class="room-link">{{ lanRoom.publicJoinUrl }}</code>
          <button
            type="button"
            class="room-link-copy"
            @click="$emit('copy-public-link')"
          >
            一键复制
          </button>
        </div>
      </div>
    </template>

    <div v-if="isElectron" class="public-config">
      <strong>公网房间连接</strong>
      <p>保存或清除后，下次开启房间时生效；当前房间的连接保持不变。</p>
      <label>
        网关地址
        <input
          v-model.trim="draftGatewayOrigin"
          type="url"
          inputmode="url"
          placeholder="https://ktv.shilyfx.icu"
          autocomplete="url"
        />
      </label>
      <label>
        主机 ID
        <input
          v-model.trim="draftHostId"
          type="text"
          maxlength="128"
          autocomplete="username"
        />
      </label>
      <label>
        主机密钥
        <input
          v-model="draftHostSecret"
          type="password"
          maxlength="4096"
          autocomplete="new-password"
          placeholder="留空以沿用已保存的密钥"
        />
      </label>
      <p v-if="publicConfig.hasHostSecret" class="public-secret-state">
        已保存主机密钥；密钥不会显示在此处。
      </p>
      <p v-if="publicConfigError" class="room-warning">
        {{ publicConfigError }}
      </p>
      <div class="room-tools">
        <button
          type="button"
          class="room-tool save-public-config"
          :disabled="publicConfigSaving"
          @click="savePublicConfig(false)"
        >
          {{ publicConfigSaving ? '保存中…' : '保存公网设置' }}
        </button>
        <button
          v-if="publicConfig.hasHostSecret"
          type="button"
          class="room-tool"
          :disabled="publicConfigSaving"
          @click="savePublicConfig(true)"
        >
          清除已保存密钥
        </button>
      </div>
    </div>
  </section>
</template>

<script>
export default {
  name: 'KaraokeRoomAccessPanel',
  props: {
    lanRoom: { type: Object, default: null },
    lanCandidates: { type: Array, default: () => [] },
    selectedLanAddress: { type: String, default: '' },
    lanSelfTest: { type: String, default: 'idle' },
    copyLinkLabel: { type: String, default: '一键复制' },
    copyBackupLinkLabel: { type: String, default: '一键复制' },
    isElectron: { type: Boolean, default: false },
    publicConfig: { type: Object, default: () => ({}) },
    publicConfigSaving: { type: Boolean, default: false },
    publicConfigError: { type: String, default: '' },
  },
  data() {
    return {
      draftGatewayOrigin:
        this.publicConfig.gatewayOrigin || 'https://ktv.shilyfx.icu',
      draftHostId: this.publicConfig.hostId || '',
      draftHostSecret: '',
    };
  },
  computed: {
    publicStatusLabel() {
      const labels = {
        starting: '正在连接',
        connected: '已连接',
        reconnecting: '正在重连',
        error: '连接失败',
        disabled: '未配置',
      };
      return labels[this.lanRoom && this.lanRoom.publicStatus] || '未连接';
    },
  },
  watch: {
    'publicConfig.gatewayOrigin'(value) {
      this.draftGatewayOrigin = value || 'https://ktv.shilyfx.icu';
    },
    'publicConfig.hostId'(value) {
      this.draftHostId = value || '';
    },
  },
  methods: {
    savePublicConfig(clearHostSecret) {
      const config = {
        gatewayOrigin: this.draftGatewayOrigin,
        hostId: this.draftHostId,
        hostSecret: clearHostSecret ? '' : this.draftHostSecret,
      };
      if (clearHostSecret) config.clearHostSecret = true;
      this.$emit('save-public-config', config);
      this.draftHostSecret = '';
    },
  },
};
</script>

<style lang="scss" scoped>
.room-access button {
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease,
    border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}
.room-access button:not(:disabled):hover {
  border-color: rgba(108, 87, 233, 0.42);
  box-shadow: 0 6px 16px rgba(56, 42, 110, 0.12);
  transform: translateY(-1px);
}
.room-access button:not(:disabled):active {
  box-shadow: none;
  transform: translateY(1px) scale(0.97);
}
.room-access button:disabled {
  cursor: not-allowed;
}
.room-access-pending .room-access-copy {
  grid-column: 1 / -1;
}
.room-access-copy {
  min-width: 0;
}
.room-qr-wrap {
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
}
.room-access img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 10px;
  background: #fff;
}
.room-qr-placeholder {
  padding: 16px;
  color: #777;
  font-size: 12px;
  text-align: center;
}
.room-access strong,
.room-access p {
  display: block;
  margin: 0;
}
.room-link {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--ktv-text-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1.45;
}
.room-link-block {
  min-width: 0;
  margin-top: 8px;
}
.room-link-label {
  display: block;
  margin-bottom: 5px;
  color: var(--ktv-text-muted);
  font-size: 11px;
}
.room-link-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}
.room-link {
  flex: 1 1 auto;
  padding: 8px 9px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-glass-soft);
}
.room-link-copy {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(108, 87, 233, 0.3);
  border-radius: 8px;
  background: var(--ktv-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.room-link-copy:hover {
  background: var(--ktv-accent-strong);
}
.public-config {
  grid-column: 1 / -1;
  min-width: 0;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--ktv-glass-border);
}
.public-config strong {
  color: var(--ktv-text-primary);
}
.public-config label {
  display: block;
  max-width: 520px;
  margin-top: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.public-config input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  margin-top: 4px;
  padding: 6px 9px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
}
.public-secret-state {
  color: var(--ktv-success) !important;
}
.room-access .room-link {
  overflow-wrap: anywhere;
}
.room-warning {
  color: #f2b56b !important;
}
.room-success {
  color: var(--ktv-success) !important;
}
.room-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.room-tool {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 7px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
  font-size: 11px;
}
.room-access p {
  margin-top: 6px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.room-access label {
  display: block;
  margin-top: 8px;
  color: var(--ktv-text-secondary);
  font-size: 12px;
}
.room-access select {
  max-width: 100%;
  margin-left: 8px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-glass-soft);
  color: var(--ktv-text-primary);
}
.generate-room {
  display: block;
  min-height: 32px;
  margin-top: 10px;
  padding: 0 11px;
  border: 1px solid var(--ktv-glass-border);
  border-radius: 8px;
  background: var(--ktv-accent);
  color: #fff;
  font-weight: 700;
}

@media (max-width: 760px) {
  .room-qr-wrap {
    width: min(240px, 100%);
    justify-self: center;
  }
  .room-access-copy,
  .room-access-pending .room-access-copy {
    grid-column: 1;
    width: 100%;
  }
}
</style>
