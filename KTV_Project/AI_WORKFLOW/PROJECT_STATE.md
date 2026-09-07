# PROJECT_STATE

## Project
- Name: YesPlayMusic KTV
- Upstream: qier222/YesPlayMusic
- Development host: Windows
- Target: Windows + macOS
- Architecture: Electron Desktop + isolated LAN Karaoke Web

## Current phase
- Phase: 1.1 / Conditional Pass repairs validated locally; pending scoped commit and push
- Branch target for first implementation: `feat/ktv-phase-1`
- Latest reviewed commit: `856de64d43ab0c11abcee532b238fe2c43909d09`
- Latest Codex report: `REPORTS/CODEX_STEP_01_REPORT.md`
- Latest ChatGPT review: `REVIEWS/CHATGPT_PHASE_01_REVIEW.md` (Conditional Pass)

## Invariants
- Do not expose existing port 27232 to LAN.
- Do not upgrade Vue/Electron in Phase 1.
- Do not add Windows-only core implementation.
- Player.js remains playback core unless explicitly approved.
- Karaoke business state must not be hidden only inside Player internals.

## Next action
Commit and push the Phase 1.1 repair gate, then create Phase 2 from that exact
fixed SHA in this execution. ChatGPT has not reviewed the future repair commit.

## Phase 1 implementation
- GitHub branch: `origin/feat/ktv-phase-1` at reviewed SHA `856de64` before the Phase 1.1 repair commit.
- Continuous `16–64px` lyric font sizing is persisted through the existing settings store.
- Persistent lyric offset supports `-10.0s` to `+10.0s`; positive values display lyrics earlier and do not alter source lyric timestamps or click-to-seek values.
- KTV desktop and remote shell routes, glass design tokens, Auto/Light/Dark theme controls, and responsive mock data views are implemented.
- No KaraokeServer, LAN listener, remote API, real queue engine, SSE, or WebSocket was added.

## Phase 1.1 repair gate
- B-01: KTV stage now binds its active lyric size to the shared persisted 16–64px setting.
- B-02: KTV lyrics distinguish waiting, before-first, active/final, and after-final states.
- B-03: `/karaoke/remote` is excluded from the global Space playback shortcut.
- B-04/B-05: lyric-size normalization is shared and Remote mock cancellation resets request state and derived position.
- B-06: baseline provenance, Phase 1 review archive, and scoped validation CI were added.

## Verification status
- Production web build passed with the workspace's Node 24 runtime only when `NODE_OPTIONS=--openssl-legacy-provider` was supplied for the legacy Webpack stack.
- Browser viewport checks passed for remote 390×844, 430×932, 768×1024, and 1440×900, and desktop KTV 1440×900 and 1920×1080.
- Existing lint remains blocked by eight pre-existing errors outside Phase 1 files. See the Phase 1 report.

