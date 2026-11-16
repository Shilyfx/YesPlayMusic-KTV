'use strict';

const assert = require('assert');
const {
  createNetworkStatusTracker,
  getRoomAccessNotice,
} = require('./remoteStatus.cjs');

function testRoomEndedAndInvalidInviteHaveDifferentNotices() {
  const ended = getRoomAccessNotice({ code: 'ROOM_ENDED' });
  const invalidInvite = getRoomAccessNotice({ code: 'INVALID_JOIN_TOKEN' });

  assert.strictEqual(ended.type, 'room-ended');
  assert.strictEqual(ended.kind, 'error');
  assert.strictEqual(ended.terminal, true);
  assert.match(ended.message, /房间已结束/);
  assert.strictEqual(invalidInvite.type, 'invalid-invite');
  assert.strictEqual(invalidInvite.kind, 'error');
  assert.strictEqual(invalidInvite.terminal, true);
  assert.match(invalidInvite.message, /邀请链接无效或已失效/);
  assert.notStrictEqual(ended.message, invalidInvite.message);
}

function testRoomAccessNoticeAcceptsAnErrorCodeAndIgnoresOtherErrors() {
  assert.strictEqual(getRoomAccessNotice('ROOM_ENDED').type, 'room-ended');
  assert.strictEqual(getRoomAccessNotice(new Error('network error')), null);
  assert.strictEqual(getRoomAccessNotice({ code: 'toString' }), null);
  assert.strictEqual(getRoomAccessNotice(null), null);
}

function testOfflineAndRecoveryNoticesAreEmittedOnlyOnTransitions() {
  const tracker = createNetworkStatusTracker({ isOnline: true });

  const offline = tracker.update(false);
  assert.strictEqual(offline.type, 'network-offline');
  assert.strictEqual(offline.kind, 'error');
  assert.strictEqual(offline.recoverable, true);
  assert.strictEqual(offline.shouldReconnect, false);
  assert.match(offline.message, /网络连接已断开/);
  assert.strictEqual(tracker.update(false), null);
  const restored = tracker.update(true);
  assert.strictEqual(restored.type, 'network-restored');
  assert.strictEqual(restored.kind, 'info');
  assert.strictEqual(restored.recoverable, true);
  assert.strictEqual(restored.shouldReconnect, true);
  assert.match(restored.message, /网络已恢复/);
  assert.strictEqual(tracker.update(true), null);
}

function testInitiallyOfflineStateCanBeShownAndThenRecovered() {
  const tracker = createNetworkStatusTracker({ isOnline: false });

  assert.strictEqual(tracker.current().type, 'network-offline');
  assert.strictEqual(tracker.update(true).shouldReconnect, true);
}

testRoomEndedAndInvalidInviteHaveDifferentNotices();
testRoomAccessNoticeAcceptsAnErrorCodeAndIgnoresOtherErrors();
testOfflineAndRecoveryNoticesAreEmittedOnlyOnTransitions();
testInitiallyOfflineStateCanBeShownAndThenRecovered();
console.log('PASS: remote room access and network status transitions');
