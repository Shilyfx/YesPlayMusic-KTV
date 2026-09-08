# Step 04 — Real LAN Remote Song Request

## Scope

- Exchange the QR fragment token for a room-bound in-memory client session.
- Serve a narrow authenticated HTTP API from the isolated KTV listener.
- Query and revalidate NetEase tracks on the desktop side only.
- Use `KaraokeManager` public operations as the sole queue authority.
- Provide normal/priority song requests, own-item queue controls, and adaptive polling.

## Explicit exclusions

- No generic API proxy, desktop player endpoint, WebSocket, SSE, account-cookie
  forwarding, queue persistence, or remote playback controls.
- No automatic playback when a remote user adds the first waiting song.

## Acceptance checks

1. Invalid, stopped, and restarted room credentials are rejected.
2. State contains no join token, client token, or upstream response payload.
3. A client cannot change another client's waiting item or a current/history item.
4. Priority moves a new waiting item to the front without interrupting current audio.
5. Build plus local remote API integration test pass before GitHub validation.
