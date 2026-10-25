# Docker KTV browser host

User requested implementing the Docker KTV room service after the web-only
deployment could open KTV but could not generate a room QR code. Execution is
authorized in the current conversation; use the existing UI and product behavior.

## Approach

Reuse KaraokeServer, KaraokeRemoteService, KaraokeCatalogService and the browser's
existing KaraokeManager. A Docker Node service replaces Electron IPC with an
authenticated host command mailbox. Browser is the queue authority and audio
player. Catalog operations run in the host browser and retain its account context.
An independently owned server queue was considered but would create two queue
authorities; running Electron in the router would require a display/audio stack.

## Constraints and decisions

- Keep Guest next, Remote first-track auto-start, desktop IPC and local indexing.
- One browser host per router; exclusive random bearer token, no token in guest
  state. Host expires after 90 seconds without exchange; close invalidates guests.
- Browser exchange single-flight every 1000ms, snapshots only on revision changes;
  commands retained until acknowledged, browser dedupes completed command IDs.
- Guest routes and room assets reuse existing server behavior and rate limits.
- Public origin is configured as http://192.168.100.1:18080, never container IP.
- Same-origin mutations only; bounded request body, pending commands and timeout.
- UI provides a click to enable browser audio; autoplay rules still apply.
- This increment does not add router disk music indexing; desktop library remains.
- Deploy only after tests/build; back up existing router dist/config before replacing.

## Verification

HTTP integration with simulated browser host verifies QR, guest bootstrap/search,
enqueue, queue state, next, invalid tokens, stale host/session and close. Domain
tests verify first-track auto-start and Guest next unchanged. Browser test verifies
the actual room button, QR URL, guest join and host command transport if the browser
runtime is available. Human mobile scanning and audible playback remain acceptance.
