# Docker designated master and silent displays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** User explicitly selects a master computer; all other computers opening `/karaoke` show its synchronized lyrics silently, without a room-creation QR panel.

**Architecture:** Docker-only route wrapper mounts the existing KTV host view only after explicit master selection. Existing single host heartbeat also publishes a bounded timed lyric window and playback anchor; read-only viewers use one visibility-aware poll owner and interpolate progress locally. Server keeps exclusive lease and never grants ownership through display reads.

**Tech Stack:** Existing Vue 2, Node HTTP, Howler, CSS lyric scene; no new dependency.

**Spec:** User confirmed one audible master and silent extension screens, Docker-only, then requested implementation with explicit master designation.

## Global Constraints

- Guest next, Remote first enqueue auto-start, local library and incremental indexing unchanged.
- `VUE_APP_DOCKER_KTV=true` opts the web build into the wrapper; Electron and ordinary web routing retain the old view.
- No forced takeover. Owner stops/closes or lease expires before another computer can explicitly become master.
- No host/guest tokens, audio URLs or full catalog exposed by display endpoint.
- Publish lyrics once through host exchange; no follower lyric/catalog requests or audio playback.
- Switching a host to a display explicitly ends its existing session; refreshing/closing follows existing room lifetime semantics.

## Review Focus

- Simultaneous master claims: one winner, losers return to read-only display.
- Background/replaced/closed display: no duplicate timers or stale response updates.
- Pause, replay, seek, short lines and song changes: bounded interpolation follows current anchor without old-song flash.
- Stale heartbeat: freeze and show disconnected state; do not promote a viewer automatically.
- Hotkeys or restored local player: display role cannot start local audio.

## Tasks and gates

- [x] Server RED/GREEN: GET `/ktv/display`, bounded sanitized presentation, read-only access, exclusive owner, no lease extension, stale/expired behavior.
- [x] Host transport RED/GREEN: optional presentation callback/name piggyback on open/exchange, retain revision and command dedupe behavior.
- [x] Viewer transport/projection RED/GREEN: single-flight, AbortController, generation cancellation, hidden pause, safe playback extrapolation.
- [x] Docker wrapper + silent scene: explicit named master button, existing host view, release action, automatic follower, fullscreen, all lyric modes and default classic.
- [x] Run all source scripts, lint, production build and diff checks. Use only ego-browser for simultaneous master/two-display browser checks; independent source review.
- [x] Back up deployment; rebuild/restart only KTV backend and refresh web assets once safe for current room; verify live health and multi-display behavior.

## State

Base: `a8143f9b1d0b6e31962c8c01f7a7e9a95951cc63`.

Server and client tests failed before implementation, then passed; source suite
21 scripts and lint passed (7 existing warnings). Independent reviewer found
route-exit audio ownership and pending-claim teardown defects; both have direct
RED→GREEN component-method regression tests. Final review fixes use claim epochs
and synchronous session stop before owner release.

Ruling: Explicit designation lasts for the open host session, not an automatic
remembered takeover after page refresh — avoids audio activation and queue
recovery changes; users must select the master again after closing/reloading.

Ruling: Reuse existing Vue 2, host exchange, bounded 16-line lyric windows and a
single 1s display poll, with local ≤3s extrapolation — modest LAN load with no
per-view lyric API calls; frame-perfect audio hardware synchronization is not
claimed. On network stalls screens freeze and report reconnecting.

Browser testing exposed an existing mute-at-zero pause race: Howler's no-op fade
can complete before the callback is subscribed. Registered pause's callback
before starting fade, verified RED→GREEN in `test-karaoke-player.js`; preserves
normal fade semantics and makes muted master pause updates reliable.

Declined-to-judge rulings: reviewer did not certify physical-browser background
throttling, audible output/autoplay, network-latency visual precision or actual
CI/package execution. Local ego multi-page and source regressions provide scoped
evidence only; physical computers, speakers and network jitter remain manual QA.

User explicitly approved immediate backend restart ending the current room.

## Final evidence

- 21 source scripts passed after review fixes and the muted-pause repair; lint 0
  errors / 7 existing warnings. Production Docker web build and server bundle pass
  with the existing 7 CSS ordering / asset budget warnings.
- ego-browser used throughout. Local and deployed runs passed a real main browser
  player (`Howler.playing() === true`) plus two silent display pages, automatic
  first guest request, Guest next, four mode propagation, pause/seek/resume,
  no follower lyric fetches, explicit release and designation of a different master.
- These are three pages on one Windows computer, not a three-physical-computer
  test. Playback acceptance was muted; no new speaker or phone scan acceptance.
- Backup: `/mnt/mmc1-4/lumasing-backups/20261026-before-multiscreen.tgz`.
- Archive SHA256: `ff5631e08cbb37abdb9e38c12c7ffcfed39beade96e5414cb44ce268e3aee968`.
- Router KTV image rebuilt/recreated; API and web containers retained uptime.
  nginx reloaded to resolve backend address. Deployed room health true, no owner
  left behind after tests (`active:false`).
- Source CI is wired but not remotely run for this change. No Windows/macOS
  package build or device acceptance is claimed.

## File / function ledger

| File / module | Root problem and repair | Preserved / validation |
| --- | --- | --- |
| `src/server/KaraokeWebHost.js`, `handle` | Only privileged host/Guest routes; add sanitized cached read-only display response without token or lease mutation | Exclusive host/auth/expiry source regressions |
| `src/karaoke/webRoomBridge.js`, `start`/`performExchange` | Queue revision has no playback clock; piggyback name + bounded presentation on existing heartbeat | Single-flight, revision, command retry/expiry tests |
| `src/karaoke/lyricDisplay.js` | Followers lack clock/timings; bounded 16-line window based on actual playback and ≤3s projection | Hidden-master window, pause and backward seek unit tests |
| `src/karaoke/displayPoller.js` | No display polling owner; single-flight, timeout, generation and teardown | Late response and sync failure RED→GREEN tests |
| `src/views/karaokeWeb.vue` | Every web route mounted a host; explicit master selection and silent follower, guarded release/claim lifecycle | Direct component lifecycle RED→GREEN + ego pages |
| `src/router/index.js` | Docker needs independent entrance; opt-in flag routes only Docker build | Electron and normal web route retain original view |
| `src/App.vue`, `src/store/state.js`, `src/store/index.js` | Restored player/hotkeys could run on display; suppress player UI/hotkeys and defer bootstrap on Docker display entry | Existing music route initialization retained; browser display idle/no audio |
| `src/views/karaoke.vue` | No presentation source; publish settings/timed window and clear stale lyrics on track loading | Existing host controls, Guest next, first song and local library source suite |
| `src/utils/Player.js`, `pause` | Muted fade completion could be missed; subscribe before fade | Zero-volume RED→GREEN + real muted browser pause |
| `KaraokeLyricScene.vue` | Silent display needs classic composition; add classic spacing only | Existing host classic DOM unchanged |

No deferred reviewer minors. Physical-machine and jitter acceptance remain the
explicit limitations above, not silently assumed successes.
