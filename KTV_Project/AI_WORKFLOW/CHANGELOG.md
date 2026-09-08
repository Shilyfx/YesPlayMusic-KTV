# CHANGELOG

## Unreleased

- Unified Phase 1–4 audit repair branch established from the canonical Phase 4 snapshot.
- Unified audit hardening: Player transient migration and cancellation generation,
  session-bound LAN lifecycle, server race/static-header checks, host-context
  catalog bridge, bounded Remote sessions/rates, polling-safe Remote DOM updates,
  lyric race/fullscreen fixes, mock-route retirement, and expanded CI regressions.
- Final audit repair: Electron Remote assets are copied into the packaged Remote
  tree with no desktop-bundle fallback; stale Remote mutations carry and verify the
  expected session; active KTV owns keyboard/media playback commands; player
  persistence, startup cancellation, and expired-session capacity regressions are
  covered by deterministic tests. Code/documentation checkpoints passed GitHub
  Actions `34258369587` / `34258965888`.

- Project plan and AI workflow scaffolding prepared.
- Phase 1 local implementation: continuous lyric font size, persisted lyric timing offset, reusable KTV glass tokens/theme switcher, desktop KTV shell, and responsive remote UI shell.
- Initial Git repository and Phase 1 implementation commit created: `c740ab7` on `feat/ktv-phase-1`.
- Full source and Phase 1 branch pushed to `https://github.com/Shilyfx/YesPlayMusic-KTV/tree/feat/ktv-phase-1`.
- Phase 1.1 repair gate: stage-size binding, lyric-state safety, Remote shortcut/mock corrections, baseline provenance, review archive, and Phase validation CI.
- Phase 2: local KTV session lifecycle, manager-owned temporary queue, independent queue-item IDs, duplicate point-song support, real player adapter controls, and KTV queue UI.
- Phase 2 browser validation used a logged-in real track for session start, duplicate requests, start queue, replay, and next-song transition; no LAN service or Remote integration was added.
- Phase 2.1 repair: transactional KTV playback ownership, failure/natural-end routing,
  Vuex runtime-service separation, queue move-to-front, deterministic domain tests, and
  expanded Phase validation scope.
- Phase 3.1 repair: main-process LAN lifecycle gate, transactional room startup,
  isolated remote assets, fragment token bootstrap, candidate selection, lyric
  fullscreen controls, and expanded blocking validation.
- Phase 4: authenticated per-client Remote sessions, strict LAN HTTP song-request
  API, server-side NetEase search/playability checks, manager-only queue bridge,
  requester ownership controls, adaptive polling, and responsive production Remote UI.
