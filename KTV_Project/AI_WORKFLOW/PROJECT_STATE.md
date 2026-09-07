# PROJECT_STATE

## Project
- Name: YesPlayMusic KTV
- Upstream: qier222/YesPlayMusic
- Development host: Windows
- Target: Windows + macOS
- Architecture: Electron Desktop + isolated LAN Karaoke Web

## Current phase
- Phase: 1 / Implementation complete locally; Git checkpoint blocked by missing `.git` metadata
- Branch target for first implementation: `feat/ktv-phase-1`
- Latest reviewed commit: N/A (not yet pushed or reviewed)
- Latest Codex report: `REPORTS/CODEX_STEP_01_REPORT.md`
- Latest ChatGPT review: N/A

## Invariants
- Do not expose existing port 27232 to LAN.
- Do not upgrade Vue/Electron in Phase 1.
- Do not add Windows-only core implementation.
- Player.js remains playback core unless explicitly approved.
- Karaoke business state must not be hidden only inside Player internals.

## Next action
Configure the user's GitHub repository as `origin`, push `feat/ktv-phase-1`, then ask ChatGPT to review the GitHub branch. Do not start Phase 2 before that review.

## Phase 1 implementation
- Local Git checkpoint: `c740ab7` (implementation) and `dc3885d` (workflow metadata), both on `feat/ktv-phase-1`.
- Continuous `16–64px` lyric font sizing is persisted through the existing settings store.
- Persistent lyric offset supports `-10.0s` to `+10.0s`; positive values display lyrics earlier and do not alter source lyric timestamps or click-to-seek values.
- KTV desktop and remote shell routes, glass design tokens, Auto/Light/Dark theme controls, and responsive mock data views are implemented.
- No KaraokeServer, LAN listener, remote API, real queue engine, SSE, or WebSocket was added.

## Verification status
- Production web build passed with the workspace's Node 24 runtime only when `NODE_OPTIONS=--openssl-legacy-provider` was supplied for the legacy Webpack stack.
- Browser viewport checks passed for remote 390×844, 430×932, 768×1024, and 1440×900, and desktop KTV 1440×900 and 1920×1080.
- Existing lint remains blocked by eight pre-existing errors outside Phase 1 files. See the Phase 1 report.
