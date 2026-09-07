# DECISIONS

## D-001 Desktop remains Electron
Status: Accepted

The desktop host remains Electron. We do not convert the whole application into a pure browser-hosted player.

## D-002 Remote song request is a separate LAN Web surface
Status: Accepted

The mobile/PC remote web is a responsive, limited KTV interface and must not expose the full desktop app.

## D-003 Separate KTV port
Status: Accepted

Existing desktop server remains bound to localhost. Karaoke LAN server uses a separate port (default design: 27233).

## D-004 First implementation phase freezes major framework versions
Status: Accepted

No Vue 3/Electron major migration while implementing Phase 1.

## D-005 Cross-platform-first
Status: Accepted

Core code uses cross-platform Node/Electron APIs. Windows is the primary development environment, macOS remains a first-class target.

## D-006 Glass UI
Status: Accepted

Remote Web and KTV desktop UI use a shared glassmorphism design language with Light/Dark/Auto modes and responsive behavior.

## D-007 Phase 1 remote surface remains a route-local scaffold
Status: Accepted

Phase 1 exposes the remote song-request shell at `/karaoke/remote` in the existing Vue build to avoid creating a server before the security boundary is designed. The shell owns only mock presentation state and a browser-local theme preference. In Phase 3, its view/components can be moved into the static bundle served by `KaraokeServer`; no remote endpoint or player control bridge exists yet.
