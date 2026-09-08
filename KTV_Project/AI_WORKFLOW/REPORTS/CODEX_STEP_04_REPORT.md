# CODEX Step 04 Report — Real LAN Remote Song Request

## Implemented

- Per-room client-session bootstrap with random opaque client credentials and room-stop/restart invalidation.
- Strict `/ktv/api` route whitelist, JSON size/type checks, in-memory per-client rate limits, and sanitized state responses.
- Desktop-side NetEase catalog search/detail/availability path with five-minute caches and a fresh availability check before enqueue.
- Main-process to renderer command bridge that exclusively calls public `KaraokeManager` snapshot, enqueue, remove, and front operations.
- Full responsive Remote page with room/theme header, now playing, result cards, normal and priority point-song, own queued-item controls, and adaptive polling.
- HTTP integration test for bad and old credentials, search metadata, duplicate requests, priority ordering, ownership enforcement, sanitized state, and stop/restart invalidation.

## Parent and checkpoints

- Phase 3.1 parent: `0c0c57f15da5c91434764de8080021515e91c211`.
- Phase 4 branch: `feat/ktv-phase-4`.
- Implementation and documentation checkpoint SHA: recorded with the Phase 4 commit.

## Required follow-up verification

- Local scoped formatting, lint, domain/server/lifecycle/remote API tests, and legacy-WebPack-compatible build must pass.
- GitHub Actions Phase Validation must be green after push.
- Real LAN QR and logged-in NetEase search/playability smoke tests remain required because local unit tests use a deterministic upstream stub.

## Limitations

- Sessions, catalog cache, and rate limits are deliberately in-memory and vanish when the desktop app or room stops.
- The Remote client can request songs and manage only its own waiting entries; host playback remains desktop-controlled.
