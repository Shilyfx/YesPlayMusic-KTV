# PROJECT_STATE

## Project

- Name: YesPlayMusic KTV
- Upstream: qier222/YesPlayMusic
- Development host: Windows
- Target: Windows + macOS
- Architecture: Electron Desktop + isolated LAN Karaoke Web

## Current phase

- Phase: Phase 1–4 unified audit repair implementation complete; CI and manual
  device smoke remain the release gates on `fix/ktv-full-audit`.
- Active branch: `fix/ktv-full-audit`
- Phase 1.1 fixed GitHub parent: `98436df30434432037f8dfc0213b85df33205176`
- Phase 2 GitHub implementation commit: `d091844f456bd91cc36b6bac6fc6500d3b55134e`
- Phase 2.1 fixed GitHub commit: `21385ac20ef56e69f597a5d78b2fb7b2cbb39b54`
- Phase 2.1 green run: `34187060149`
- Phase 3.1 repaired GitHub parent: `0c0c57f15da5c91434764de8080021515e91c211`
- Latest Codex report: `REPORTS/CODEX_STEP_04_REPORT.md`
- Latest ChatGPT review: `REVIEWS/CHATGPT_PHASE_01_REVIEW.md` (Conditional Pass for Phase 1 only)

## Release stabilization checkpoint (2026-09-10)

- Branch: `fix/ktv-release-stabilization`
- Base SHA: `a4c5c9c0d84a2d331f005e1a9deee6b37986c6e2`
- Scope: unified product stabilization per `CODEX_KTV_FULL_PRODUCT_STABILIZATION_PROMPT.md`.
- Local lint, web build, KTV regressions, safe-storage test and Windows package build passed.
- GitHub Actions and physical phone/TV/audio gates remain pending after push; do not mark release-ready before those gates are green.

## Invariants

- Do not expose existing port 27232 to LAN.
- Do not upgrade Vue/Electron in Phase 1.
- Do not add Windows-only core implementation.
- Player.js remains playback core unless explicitly approved.
- Karaoke business state must not be hidden only inside Player internals.

## Next action

Review the unified audit diff, wait for the repair-branch GitHub validation, then
complete the logged-in NetEase and physical LAN/TV/audio smoke test. Do not add
WebSocket/SSE or general desktop APIs.

For this stabilization branch, first wait for `KTV Phase Validation` and `KTV Packaging Validation`, then submit only the stabilization diff for ChatGPT review.

## Final repair checkpoint

- Code checkpoint: `f5cc5866390d08565c1eae8d0e824a523a12460a`; Phase Validation
  run `34331990263` succeeded. This checkpoint also guards renderer startup
  against an early cyclic-store player lookup that produced a white screen.
- Room-link selection now prefers the active `192.168.*` Wi-Fi adapter when more
  than one private IPv4 candidate exists.
- Documentation checkpoint: `a94865958103a8bb4d897df57f0390f23ba1d26b`; Phase
  Validation run `34258965888` succeeded.
- Scope is limited to P1-01/02/03 and P2-01/02/03 final-audit repairs. No Phase 5
  capability was added.
- The only remaining release-gate evidence is physical: packaged Windows app,
  same-LAN QR connection, logged-in NetEase search/request, TV display, and audio.

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

## Phase 4 implementation

- The LAN remote server exposes only an authenticated `/ktv/api` whitelist. A QR
  fragment join token is exchanged once for a per-browser client session and is
  removed from the address bar; room stop/restart invalidates all client sessions.
- `KaraokeManager` remains the only queue source of truth. Main-process HTTP uses
  a narrow IPC command bridge to its public snapshot/enqueue/remove/front methods.
- Search, detail, and availability checks use a strict Main→Renderer catalog bridge,
  so they inherit the host's authenticated NetEase request/proxy context. Remote
  clients receive only sanitized metadata and a playability enum. Point-song always
  performs a fresh playable check, permits duplicates, and never auto-starts audio.
- The responsive Remote page has real now-playing, search, normal/priority request,
  own waiting-item controls, theme modes, and 1.5/5 second adaptive polling.
