'use strict';

const ROOM_ACCESS_NOTICES = {
  ROOM_ENDED: Object.freeze({
    code: 'ROOM_ENDED',
    type: 'room-ended',
    kind: 'error',
    message: '当前 KTV 房间已结束，请联系主机重新开启。',
    terminal: true,
  }),
  INVALID_JOIN_TOKEN: Object.freeze({
    code: 'INVALID_JOIN_TOKEN',
    type: 'invalid-invite',
    kind: 'error',
    message: '邀请链接无效或已失效，请向主机获取新的邀请链接。',
    terminal: true,
  }),
};

const OFFLINE_NOTICE = Object.freeze({
  code: 'NETWORK_OFFLINE',
  type: 'network-offline',
  kind: 'error',
  message: '网络连接已断开，网络恢复后将自动重新连接。',
  recoverable: true,
  shouldReconnect: false,
});

const RESTORED_NOTICE = Object.freeze({
  code: 'NETWORK_RESTORED',
  type: 'network-restored',
  kind: 'info',
  message: '网络已恢复，正在重新连接 KTV…',
  recoverable: true,
  shouldReconnect: true,
});

function copyNotice(notice) {
  return notice ? { ...notice } : null;
}

function getRoomAccessNotice(error) {
  const code = typeof error === 'string' ? error : error && error.code;
  if (!Object.prototype.hasOwnProperty.call(ROOM_ACCESS_NOTICES, code))
    return null;
  return copyNotice(ROOM_ACCESS_NOTICES[code]);
}

function createNetworkStatusTracker({ isOnline = true } = {}) {
  let online = Boolean(isOnline);

  return {
    current() {
      return online ? null : copyNotice(OFFLINE_NOTICE);
    },
    update(nextOnline) {
      const next = Boolean(nextOnline);
      if (next === online) return null;

      online = next;
      return copyNotice(online ? RESTORED_NOTICE : OFFLINE_NOTICE);
    },
  };
}

module.exports = { createNetworkStatusTracker, getRoomAccessNotice };
