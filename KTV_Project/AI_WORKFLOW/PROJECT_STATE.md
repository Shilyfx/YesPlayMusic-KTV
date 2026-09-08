# PROJECT_STATE

## Project

- Name: YesPlayMusic KTV
- Upstream: qier222/YesPlayMusic
- Development host: Windows
- Target: Windows + macOS
- Architecture: Electron Desktop + isolated LAN Karaoke Web

## Current phase

- Phase: 3 / isolated LAN room and KTV UI enhancement in progress on `feat/ktv-phase-3`
- Active branch: `feat/ktv-phase-3`
- Phase 1.1 fixed GitHub parent: `98436df30434432037f8dfc0213b85df33205176`
- Phase 2 GitHub implementation commit: `d091844f456bd91cc36b6bac6fc6500d3b55134e`
- Phase 2.1 fixed GitHub commit: `21385ac20ef56e69f597a5d78b2fb7b2cbb39b54`
- Phase 2.1 green run: `34187060149`
- Latest Codex report: `REPORTS/CODEX_STEP_03_REPORT.md`
- Latest ChatGPT review: `REVIEWS/CHATGPT_PHASE_01_REVIEW.md` (Conditional Pass for Phase 1 only)

## Invariants

- Do not expose existing port 27232 to LAN.
- Do not upgrade Vue/Electron in Phase 1.
- Do not add Windows-only core implementation.
- Player.js remains playback core unless explicitly approved.
- Karaoke business state must not be hidden only inside Player internals.

## Next action

Push the Phase 3.1 repair and wait for a green GitHub validation gate. Do not
begin Phase 4 remote search, queue APIs, polling, SSE, or WebSocket work before it.

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

## Phase 2 implementation

- `KaraokeSession`, `KaraokeQueue`, `KaraokeManager`, and `KaraokePlayerAdapter` own local KTV lifecycle and queue state outside Player internals.
- A narrow public `Player.playTrackByID()` hook lets the manager start, replay, and advance real songs without exposing Player private state.
- The temporary local queue uses an independent queue-item ID, so duplicate song requests are valid; ending the session clears current, waiting, and history state.
- Vuex carries a snapshot for rendering only; the manager remains the source of truth. The Remote screen remains mock-only.
- Natural-end auto-advance is deliberately deferred until the player offers a stable public completion callback.

## Verification status

- Production web build passed with the workspace's Node 24 runtime only when `NODE_OPTIONS=--openssl-legacy-provider` was supplied for the legacy Webpack stack.
- Browser viewport checks passed for remote 390×844, 430×932, 768×1024, and 1440×900, and desktop KTV 1440×900 and 1920×1080.
- Existing lint remains blocked by eight pre-existing errors outside Phase 1 files. See the Phase 1 report.
- Phase 2 scoped Prettier and ESLint checks passed; the production web build passed with `NODE_OPTIONS=--openssl-legacy-provider`.
- Logged-in browser validation passed with a real NetEase track: session start, duplicate requests, start queue, replay, and next-song transition. The active temporary session was intentionally left intact rather than clearing local data without confirmation.
