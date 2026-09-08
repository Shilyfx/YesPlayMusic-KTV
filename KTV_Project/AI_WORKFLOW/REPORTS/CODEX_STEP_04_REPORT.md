# CODEX Step 04 Report — Real LAN Remote Song Request

## Implemented

- Per-room client-session bootstrap with random opaque client credentials and room-stop/restart invalidation.
- Strict `/ktv/api` route whitelist, JSON size/type checks, in-memory per-client rate limits, and sanitized state responses.
- Desktop-side NetEase catalog search/detail/availability path with five-minute caches and a fresh availability check before enqueue.
- Main-process to renderer command bridge that exclusively calls public `KaraokeManager` snapshot, enqueue, remove, and front operations.
- Full responsive Remote page with room/theme header, now playing, result cards, normal and priority point-song, own queued-item controls, and adaptive polling.
- HTTP integration test for bad and old credentials, search metadata, duplicate requests, priority ordering, ownership enforcement, sanitized state, and stop/restart invalidation.
- Raised the Webpack 4 chunk ceiling from three to four. The complete Remote CSS
  entry otherwise caused the legacy chunk merger to emit an invalid CSS
  `contenthash` merge during production builds.

## Parent and checkpoints

- Phase 3.1 parent: `0c0c57f15da5c91434764de8080021515e91c211`.
- Phase 4 branch: `feat/ktv-phase-4`.
- Implementation checkpoint SHA: `f122023850329d2905eafd2a0b47821479db67dc`.

## Required follow-up verification

- Local scoped formatting, lint, domain/server/lifecycle/remote API tests, and a
  Node 16 production build passed after the chunk-ceiling repair.
- GitHub Actions Phase Validation must be green after push.
- Real LAN QR and logged-in NetEase search/playability smoke tests remain required because local unit tests use a deterministic upstream stub.

## Limitations

- Sessions, catalog cache, and rate limits are deliberately in-memory and vanish when the desktop app or room stops.
- The Remote client can request songs and manage only its own waiting entries; host playback remains desktop-controlled.
