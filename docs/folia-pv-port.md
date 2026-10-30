# Original Folia PV integration

The requested scope is Sonnet, Tempera and Hanabi, preserving Folia's original
visual algorithms rather than adding CSS approximations. Existing classic,
poem, depth and orbit modes remain selectable. The user chose original engines.

## Implementation

- Pin Folia aecd330b720eb8fc728e6b10ebcec261b144d683 and vendor the 165-file
  runtime dependency closure, preserving license and copyright.
- Preserve the minimal optional Sonnet post-camera callback in LUMASING.patch.
  The adapter fits actual foreground glyph bounds inside a 4% viewport margin,
  correcting only overflow while leaving decoration and scene backgrounds free.
- Use the original shot compilers and Pixi runtime classes directly, with a Vue
  lifecycle adapter instead of Folia's React application shell. Build native ES
  modules separately with esbuild so Vue 2 / Webpack 4 need no framework upgrade.
- Fetch the runtime manifest only when a PV is selected, share the import promise,
  cancel superseded initialization and destroy textures/tickers on unmount.
- Drive the engines from existing player/follower clocks. Interpolate at most
  500 ms between clock updates; stop the ticker when paused/hidden and respect
  reduced motion. No second playback or audio source is created.
- Transfer complete lyric documents only when their identity changes; serve them
  by generation/revision and cache one immutable copy in the existing poll owner.
  The current rolling-window lyric projection stays available for legacy modes.
- Keep source download and AGPL attribution available in lyric settings. The
  source archive has an explicit allowlist excluding secrets and deployment data.

## Capability boundaries

Folia's native shot layout, typography and transitions are retained. Optional AI
themes, user-image library, mod host and audio-analysis models are not part of
this port. Line-timed LRC uses a shared line cue for all graphemes and a whole-line
semantic boundary, preventing the original engine from inventing evenly spaced
word timings across pauses. Authored word timings remain intact when supplied.
Sonnet and
Tempera receive the screen font scale; Hanabi uses its original automatic sizing.
PV modes use native typography effects while the old four font effects are
preserved for the existing modes. Per-screen mode, theme and timing remain local.

## Validation and deployment

Test full-document version/dedupe/abort behavior and clock/lyric conversion.
Use ego-browser on the compiled page to exercise all three original WebGL
engines, pause/seek/switch/long lyrics, light/dark and fullscreen, preserving old
features. Build the frontend and KTV server, back up the router deployment,
restart only KTV under the user's existing authorization, and publish the index
last. Record real results and untested physical-device acceptance separately.
