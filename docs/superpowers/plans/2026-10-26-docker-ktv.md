# Docker KTV Implementation Plan

> **For agentic workers:** Implement tasks inline, test each boundary before deployment.

**Goal:** Router-hosted KTV room QR and phone control of the browser player.
**Architecture:** Existing browser manager + authenticated HTTP host mailbox + existing guest API.
**Tech Stack:** Node, Vue 2, esbuild, Docker Compose, nginx.
**Spec:** docs/superpowers/specs/2026-10-26-docker-ktv-design.md

## Global Constraints

Preserve Guest next, first-song auto-start, Electron IPC, desktop local library.
No credentials in source or guest payloads. Single host and bounded command queues.

## Review Focus

Expired host commands, duplicate command delivery, old-session actions, guest token
used as host token, closing or refreshing the browser while commands are pending.

### Task 1: Server host transport

- [x] Write integration test `scripts/test-karaoke-web-host.js`; observe missing module failure.
- [x] Add `src/server/KaraokeWebHost.js`, `src/server/main.js` using existing server/API.
- [x] Verify QR URL, exclusive host, mutation origins, commands/ack, cached snapshot,
  room closure, host TTL, stale commands and Guest authorization.

### Task 2: Browser transport and room UI

- [x] Export shared command executor/catalog from existing renderer module.
- [x] Add `src/karaoke/webRoomBridge.js` with single-flight exchange, bounded dedupe,
  timeout, lease cleanup and lifecycle stop. Test retry/dedupe/session semantics.
- [x] Use room bridge for LAN controls in `karaoke.vue`; leave window/local IPC unchanged.
- [x] Provide audio-enable button; preserve play/queue domain tests.

### Task 3: Packaging, deploy and verify

- [x] Bundle Node room service with esbuild; add router Dockerfile and Compose service.
- [x] Add nginx room/guest/host routing; preserve QR-login header buffer fix.
- [x] Run all test scripts, lint, production build, diff check.
- [x] Back up router deployment; upload build; start room service; test health and
  full guest flow against deployed HTTP routes; verify restart.
- [x] Record exact outcomes and real-device limitations in router README.

## Execution record

Base: `3e40c072319b58eb1e1fb8afe073300460f297e5`; existing user files preserved.
Task 1: HTTP tests RED (missing implementation), then GREEN including ownership body races.
Task 2: bridge tests RED then GREEN; domain and Remote API tests GREEN.
Task 3: 17 source test scripts GREEN, lint GREEN with 7 existing warnings; web and server
bundles built. Real router Playwright tested room QR, mobile guest, actual search, audio
player running, next HTTP 200 and end/reopen fresh room. Old deployment backed up.
Independent review: four P2 findings, all RED→GREEN regressions: cache reset after service
restart; late open after dispose; slow commands blocking heartbeat; expired next execution.
Ruling: execute commands independently of heartbeat; use the existing manager's transition
lock for next rather than adding a second serialized queue, preserving rapid-next behavior.
Browser lifecycle regression also caught stale QR after ending/restarting KTV; fixed and
live-tested. No real phone scan or audible device acceptance is claimed.
