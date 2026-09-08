# KTV 全阶段统一修复报告

## Audit identity

- `UNIFIED_REPAIR_BASE_SHA`: `bfa19557c7b16e4d8bb0419cd30e8de837b502cd`
- Repair implementation SHAs: `ac9d41687b42ec6623c3c4b3474c2f36e29d4f84`,
  `51554f86edd5f5a62b3ca4a1cdf65677c11c5e69`
- Documentation checkpoint SHA: `e9853963f9ffd6c3588ff67e8273d77f8808dd99`
- Branch: `fix/ktv-full-audit`
- GitHub Action: pending push

## Repairs and evidence

| Area | Issue / root cause | Repair and verification |
| --- | --- | --- |
| Player P0 | Runtime KTV fields could persist; an old async load could commit after session end. | Explicit transient deny list and migration; generation-guarded KTV transaction stops output before fetching and commits audio only if still current. `test-karaoke-player.js` covers cancellation. |
| Session and LAN lifecycle | Room security needed canonical renderer session identity and stale-room invalidation. | LAN start reads manager snapshot; renderer reload/process loss stops the room; rooms and clients bind session/generation. Lifecycle test covers real-session gating. |
| Remote authorization | Bootstrap/session maps lacked expiry cleanup and room-wide budgets. | Expired sessions purge; per-address bootstrap, room/client caps, and room-wide state/search/mutation budgets. Mutations reauthorize after awaits and before queue changes. |
| Host catalog | Main's raw localhost request was not proven to inherit host authentication/proxy context. | Strict `search`/`trackDetail`/`availability` bridge calls the renderer's existing request stack. Only sanitized track data and playability return to LAN callers. Remote API test asserts bridge use. |
| Remote UI | Polling replaced all DOM and destroyed search input/results/focus. | One-time shell with polling limited to now-playing and queue patches; search state has query generation and abort guards. |
| Server security/build assets | Static path and response hardening/regression coverage were incomplete; Electron's Remote entry retained `app://` paths while shared chunks were sibling assets. | Reject encoded separators/dot segments, use relative containment, apply no-store/nosniff/referrer/CSP headers, safely rewrite only the Remote entry, and permit a CSS/JS-only trusted bundle fallback; server test covers traversal, headers, start/start, restart, port collision, and the actual Electron bundle entry/assets. |
| KTV UI | Lyric controls could not wake after pointer events were disabled; stale lyric replies could overwrite current lyrics; mock Remote route was misleading. | Activity listeners moved to lyric stage, lyric request guards added, and `/karaoke/remote` production mock route removed. |
| CI | Repair branch was not a direct workflow trigger and Player regression was absent. | `fix/ktv-*` trigger plus Player regression check added. |

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
