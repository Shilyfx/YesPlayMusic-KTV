# KTV 全阶段统一修复报告

## Audit identity

- `UNIFIED_REPAIR_BASE_SHA`: `bfa19557c7b16e4d8bb0419cd30e8de837b502cd`
- Repair implementation SHAs: `ac9d41687b42ec6623c3c4b3474c2f36e29d4f84`,
  `51554f86edd5f5a62b3ca4a1cdf65677c11c5e69`
- Documentation checkpoint SHA: `e9853963f9ffd6c3588ff67e8273d77f8808dd99`
- Branch: `fix/ktv-full-audit`
- GitHub Action: [KTV Phase Validation #24](https://github.com/Shilyfx/YesPlayMusic-KTV/actions/runs/34254094631)
  for `9d0176a` — success (1m 25s). The workflow's full-repository lint remains
  explicitly non-blocking and reports known upstream diagnostics.

## Repairs and evidence

| Area                         | Issue / root cause                                                                                                                                               | Repair and verification                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Player P0                    | Runtime KTV fields could persist; an old async load could commit after session end.                                                                              | Explicit transient deny list and migration; generation-guarded KTV transaction stops output before fetching and commits audio only if still current. `test-karaoke-player.js` covers cancellation.                                                                                                                               |
| Session and LAN lifecycle    | Room security needed canonical renderer session identity and stale-room invalidation.                                                                            | LAN start reads manager snapshot; renderer reload/process loss stops the room; rooms and clients bind session/generation. Lifecycle test covers real-session gating.                                                                                                                                                             |
| Remote authorization         | Bootstrap/session maps lacked expiry cleanup and room-wide budgets.                                                                                              | Expired sessions purge; per-address bootstrap, room/client caps, and room-wide state/search/mutation budgets. Mutations reauthorize after awaits and before queue changes.                                                                                                                                                       |
| Host catalog                 | Main's raw localhost request was not proven to inherit host authentication/proxy context.                                                                        | Strict `search`/`trackDetail`/`availability` bridge calls the renderer's existing request stack. Only sanitized track data and playability return to LAN callers. Remote API test asserts bridge use.                                                                                                                            |
| Remote UI                    | Polling replaced all DOM and destroyed search input/results/focus.                                                                                               | One-time shell with polling limited to now-playing and queue patches; search state has query generation and abort guards.                                                                                                                                                                                                        |
| Server security/build assets | Static path and response hardening/regression coverage were incomplete; Electron's Remote entry retained `app://` paths while shared chunks were sibling assets. | Reject encoded separators/dot segments, use relative containment, apply no-store/nosniff/referrer/CSP headers, safely rewrite only the Remote entry, and permit a CSS/JS-only trusted bundle fallback; server test covers traversal, headers, start/start, restart, port collision, and the actual Electron bundle entry/assets. |
| KTV UI                       | Lyric controls could not wake after pointer events were disabled; stale lyric replies could overwrite current lyrics; mock Remote route was misleading.          | Activity listeners moved to lyric stage, lyric request guards added, and `/karaoke/remote` production mock route removed.                                                                                                                                                                                                        |
| CI                           | Repair branch was not a direct workflow trigger and Player regression was absent.                                                                                | `fix/ktv-*` trigger plus Player regression check added.                                                                                                                                                                                                                                                                          |

## Local checks

- Node 16 production web build: passed.
- Scoped Prettier and ESLint: passed.
- `test-karaoke-player.js`, domain, server, lifecycle, and Remote API suites: passed.
- Electron renderer build produced `dist_electron/bundled/remote/index.html` and
  its JS/CSS sibling assets. The server test opened that generated entry over a
  room URL, verified no `app://` reference remains, and loaded a generated CSS/JS
  asset through the room path. `background.js` resolves these paths beside the
  main bundle rather than from mutable `cwd`.

## Remaining acceptance evidence

The Windows Electron packaging command reached electron-builder's `win-unpacked`
phase in this environment, but did not leave a portable executable. This report
does **not** claim portable-EXE runtime verification. The final external gates are:

1. GitHub Actions for the pushed repair SHA succeeds.
2. Run the generated Windows app, start KTV and scan the QR on the same Wi-Fi.
3. While logged in on the host, verify Remote search, normal/priority request,
   own front/delete, room end, TV full-screen output, and physical audio output.

## Reviewer request

Please review `fix/ktv-full-audit` using
`bfa19557c7b16e4d8bb0419cd30e8de837b502cd...51554f86edd5f5a62b3ca4a1cdf65677c11c5e69`.
Confirm the GitHub Action for the repair branch and the remaining physical
Electron/LAN smoke evidence before declaring the release gate complete.

## Final Repair Follow-up

### Canonical references

- `UNIFIED_REPAIR_BASE_SHA`: `bfa19557c7b16e4d8bb0419cd30e8de837b502cd`
- `PREVIOUS_REPAIR_CODE_SHA`: `9d0176acb9989465743778a88c7046efa0d1469b`
- `PREVIOUS_REPAIR_DOC_SHA`: `b6a0b05cb0f25d830a996c196f4bdc325178f8f5`
- `FINAL_REPAIR_CODE_SHA`: `f5cc5866390d08565c1eae8d0e824a523a12460a`
- `FINAL_REPAIR_DOC_SHA`: `a94865958103a8bb4d897df57f0390f23ba1d26b`
- `FINAL_REPAIR_CODE_ACTION_RUN`: [34331990263](https://github.com/Shilyfx/YesPlayMusic-KTV/actions/runs/34331990263) — success.
- `FINAL_REPAIR_DOC_ACTION_RUN`: [34258965888](https://github.com/Shilyfx/YesPlayMusic-KTV/actions/runs/34258965888) — success.

### Closed items

| Item  | Final repair                                                                                                                                                         | Evidence                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P1-01 | Packaged Remote assets are copied into `remote/js` and `remote/css`; the server reads only that tree, with no Electron desktop-bundle fallback.                      | Electron renderer build plus LAN server regression verifies own assets load and actual desktop JS/CSS return 404. |
| P1-02 | Every queue mutation carries expected session identity across Remote API → IPC → renderer; the renderer rejects ended/replaced sessions immediately before mutation. | Delayed enqueue/remove/front regression cases reject `ROOM_ENDED` and leave the queue unchanged.                  |
| P1-03 | Space, Electron global media and browser MediaSession commands use active KTV-session ownership, including the active-without-current no-op rule.                    | Domain and Player command-routing regressions pass.                                                               |
| P2-01 | `updatePlayer()` removes transient KTV/runtime fields from the actual persisted `localStorage.player` object.                                                        | Persistence migration regression preserves normal state and removes each transient key.                           |
| P2-02 | `stopRoom()` waits for a pending startup to settle/cancel before the next room can start.                                                                            | Deterministic delayed-listen stop/restart regression passes.                                                      |
| P2-03 | Expired Remote clients are purged before the capacity decision.                                                                                                      | Deterministic 32-expired-client bootstrap regression passes.                                                      |

### Final validation and remaining physical gate

- Local: Node 16 web build, Electron renderer build, scoped Prettier/ESLint, and
  Player/domain/server/lifecycle/Remote API suites passed.
- Packaged-startup follow-up: the real Windows launch exposed a cyclic-store
  renderer lookup that caused a white page. `ipcRenderer.js` now resolves Player
  lazily and `db.js` tolerates Vuex hydration; the rebuilt package is ready for
  user-visible confirmation of the renderer and KTV flow.
- LAN test preparation: when multiple private adapters are available, room-link
  candidate sorting now prefers `192.168.*`; the current host exposes
  `WLAN = 192.168.0.169` and `以太网 = 10.46.8.202`.
- Cloud: both canonical code and documentation workflow runs above succeeded.
- Not claimed: packaged Windows runtime, same-Wi-Fi QR connection, logged-in NetEase
  Remote search/request, TV rendering, and physical audio. These remain the real
  device acceptance gate and must be observed before release approval.
