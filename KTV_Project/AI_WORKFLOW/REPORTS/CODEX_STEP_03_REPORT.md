# CODEX STEP 03 REPORT — Phase 3 LAN Room and KTV UI

## Baseline

- Remote Phase 2.1 gate commit: `21385ac20ef56e69f597a5d78b2fb7b2cbb39b54`
- Branch: `feat/ktv-phase-3`
- Gate: GitHub Actions run `34187060149` passed before this branch was created.

## Delivered

- Added an independent `KaraokeServer` on `0.0.0.0:27233`; the legacy
  desktop API remains on `127.0.0.1:27232`.
- LAN addresses are selected from non-loopback IPv4 interfaces; room code and
  URL token use `crypto.randomBytes`, and the token is never logged.
- Only an active desktop KTV session can start a room. Ending the session
  stops the LAN listener and invalidates its room URL.
- `GET /health` reports only active state. The room route requires its token;
  there are no remote search, queue, playback, SSE, WebSocket, or polling APIs.
- Added a standalone Remote bundle (`remote/index.html` + `src/remote`), QR
  generation using the existing `qrcode` dependency, and host QR presentation.
- KTV desktop now uses a lyric-first wide stage, queue move-to-front action,
  and distinct full-KTV versus lyric-only Fullscreen API actions.

## Verification

- `node scripts/test-karaoke-domain.js` passed.
- `node scripts/test-karaoke-server.js` passed: health, tokenized room access,
  rejected missing/invalid token, and server shutdown.
- Node 16 production build passed; the pre-existing CSS ordering/asset-size
  warnings remain warnings only.

## Explicitly out of scope

- No Phase 4 implementation: no remote song search, request queue, playback
  control, host-control API, SSE/WebSocket, or polling was added.
