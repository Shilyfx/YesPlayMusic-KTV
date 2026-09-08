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

## D-008 Phase 2 queue is local, temporary, and duplicate-tolerant

Status: Accepted

The Phase 2 queue lives only in the local KTV manager. It assigns a queue-item ID
separate from a NetEase track ID, permits duplicate requests, and is cleared when
the KTV session ends. It does not write a NetEase playlist or persist KTV history.

## D-009 Natural-end auto-advance awaits a public player callback

Status: Accepted

Phase 2 uses a narrow public player adapter for host-directed start, next, replay,
and play/pause. It does not subscribe to private Player internals to infer song
completion; natural-end auto-advance is deferred until a stable public completion
hook is available.

## D-010 KTV playback owns its audio lifecycle

Status: Accepted

While an active KTV queue item is playing, Player must route end, error, next, and
play/pause through KaraokeManager. KTV failures never fall through to the ordinary
playlist; ending KTV stops its audio and does not restore prior playback in Phase 2.1.

## D-011 Phase 4 remote is authenticated and manager-bridged

Status: Accepted

The LAN QR token is a one-time bootstrap credential and is exchanged for an
in-memory Remote client session. The HTTP server calls only explicit
`KaraokeManager` public operations through Electron IPC; it does not retain a
parallel queue or access Player internals. The API is polling-only and exposes a
strict song-request whitelist, never a generic desktop or NetEase proxy.

## D-012 Remote catalog uses the host request context

Status: Accepted

The LAN server calls only the whitelisted `search`, `trackDetail`, and
`availability` actions over the existing Main→Renderer command bridge. The
Renderer reuses the host request stack, including its authenticated NetEase and
proxy context. Cookies, raw upstream responses, and arbitrary URLs are never
passed to Remote clients.

## D-013 Packaged Remote assets are self-contained

Status: Accepted

Electron packaging copies every JS/CSS file referenced by `remote/index.html` into
the `remote/` tree and rewrites that entry to relative URLs. `KaraokeServer` serves
Remote assets only from that tree; it must never fall back to desktop bundle assets.
