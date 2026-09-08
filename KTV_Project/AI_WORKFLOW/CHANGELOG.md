# CHANGELOG

## Unreleased
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
