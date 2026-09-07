# TASK: Phase 2 — local KTV Session and Queue

## Objective

After the Phase 1.1 repair commit is pushed, implement a local-only KTV
business layer for the desktop host.

## Required outcomes

1. A temporary `KaraokeSession` and canonical queue with independent queue-item IDs.
2. Duplicates allowed by `trackId`; management operates on `queueItemId`.
3. A framework-independent `KaraokeManager` and thin Player adapter.
4. Desktop start/end session controls, real queue controls, and host-side enqueue.
5. Replay/next state transitions that do not modify NetEase playlists.

## Boundaries

No KaraokeServer, LAN listener, QR room, remote API, SSE/WebSocket, or Remote
integration. `/karaoke/remote` remains a mock-only preview.
