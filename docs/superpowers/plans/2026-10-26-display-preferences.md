# Independent display preferences

User confirmed that “custom lyrics” means the existing stage modes, text effects
and font size, not editing lyric text. Each Docker follower can also select its
own absolute lyric offset. Default follows master; custom values never add to
master offset and never write the master's Vuex settings or room commands.

Reuse current UI tokens and native controls, in a collapsible “本屏歌词设置” panel
inside the fullscreen surface. Separate follow-style/follow-timing switches;
restore-follow button. Persist validated browser-local data under a dedicated
versioned localStorage key, only on explicit control changes.

Gates:
- [x] RED/GREEN pure preference normalization, storage failures, default follow,
      independent styles/time, master immutability and restoring follow.
- [x] RED/GREEN timed windows include context around raw audio ±13 seconds
      (±10 offset plus ≤3 extrapolation), retain current anchor and bounded
      ≤4096 lines / 192KiB encoded lyric payload; bounded authenticated host
      request ≤1MiB to accommodate UTF-8 lyric windows. No new request owner.
- [x] Add UI and effective-presentation projection, verify no cue flicker regression.
- [x] Full source tests/build/lint, independent review, ego-browser local settings,
      reload persistence, fullscreen, real projection and two-view independence.
- [x] Back up/deploy with permission if room restart is needed; verify deployment.

Keep Guest next, first song auto-start, local/incremental library and Electron
behavior. No physical-device/remote-CI/package claims without actual runs.

Review found fixed 128-line trimming broke valid independent offsets in dense
files. Regression at 10 cues/second and master offsets 0/+10/-10 failed before
repair and now passes. Selection covers time instead of centering on master
offset; bounded payloads carry contextFrom/contextUntil, so pathological files
outside the transmitted range report unavailable rather than a wrong lyric.
Tests also cover backward seek, +10 offset with 3s extrapolation, 4096-line and
UTF-8 byte limits, and retention of the raw current cue when clipping is needed.

UI tests use ego-browser with compiled local fixtures: independent styles/time,
master immutability, reload persistence, two-page live isolation, restore follow
and 390×844 fullscreen controls passed. The dedicated preference key is restored
after tests; no room claims, host commands or account-data changes in this test.

User explicitly approved immediate update and ending the current room in their
follow-up answer. Deployed only after that answer; the earlier unanswered async
question was not treated as permission.

Final local results: 22 source scripts passed; lint 0 errors / 7 existing warnings;
production web + Node server build passed with 7 existing build warnings. After
review repair, ego-browser UI fixture, continuity DOM test and actual local
KTV host plus two displays all passed. No production room was changed.

Ruling: each browser owns preferences in a separate versioned key (not a server
setting); separate physical computers remain independent. Same-browser tabs use
the same persisted preference key, but do not overwrite each other's live state.
Ruling: dense pathological contexts have explicit valid time bounds, a 4096-line
and 192KiB payload cap; outside those bounds show an honest unavailable message.
No new request owner, full-song scan, metadata fetch or audio path is introduced.
Reviewer deferred no source findings after the one dense-window issue was fixed;
its physical-device/real-world jitter/mixed-client concerns remain manual QA.

## Deployment evidence

Source SHA `6aae7c942490dded9dd35df51fef5912b5a92e8d` deployed to router.
Backup `/mnt/mmc1-4/lumasing-backups/20261026-before-display-preferences.tgz`.
Uploaded archive SHA256
`bf210cb1579934a755118f98f367148183436c969123e5d71781540e8e22663c`
matched remotely. KTV image rebuilt and container recreated, nginx reloaded for
backend DNS; API/web uptime preserved. Deployed ego-browser settings fixture,
DOM continuity regression and real host/two-display/Guest playback flows passed.
No host lease left behind (`active:false`); KTV and API health good.
Browser checks are not physical multi-computer or audible speaker acceptance;
no package build or remote GitHub CI execution is claimed.
