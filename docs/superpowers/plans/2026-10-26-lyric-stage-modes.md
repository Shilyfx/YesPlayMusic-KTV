# Incremental lyric stage modes

## Scope and design

User requested substantial Folia-inspired lyric presentation changes as additional
modes, not a replacement. Independently authored Vue/CSS implementation; no Folia
AGPL source or new rendering dependency is incorporated.

- Preserve classic stage as default and fallback.
- Add poem (editorial serif spread), depth (perspective entrance), orbit (arc layout).
- Use the existing lyric request, cursor, offset, and four-line window. Do not add
  request owners, clocks, whole-song rendering, or invented word-level timing.
- Save selection through the existing batched settings path.
- Reduced-motion and paused scenes display static readable lyrics.
- Preserve Guest next, Remote first-song auto-start, local/incremental library.

## Implementation / validation gates

1. Mode compatibility regression RED: missing module; GREEN after implementing
   finite known modes and classic fallback.
2. Implement scene component, mode selector, default setting; inspect real page.
3. Run all source test scripts, lint, production build; isolated desktop/mobile
   browser fixture verifies 10,000-line bounded DOM, persistence and reduced motion.
4. Inspect screenshots; repair any layout failures before deployment.
5. Back up router deployment, overlay static assets only; no API/KTV restart.
6. Run deployed stage smoke and existing real host/guest playback acceptance.

## Verification record

| File / module | Problem and cause | Change | Preserved / verification |
| --- | --- | --- | --- |
| `src/utils/lyricStageModes.js` | No independently selectable stage layout | Finite modes, classic fallback | Invalid/missing values unit-tested |
| `src/components/karaoke/KaraokeLyricScene.vue` | Only classic centered line composition | Four-line CSS scene, cue entrance and fullscreen scroll following | Existing lyric timing; browser layout/effect/size/cue tests |
| `src/views/karaoke.vue` | No layout selector; extra control exposes narrow overflow; mixed fullscreen selectors invalidate standard rule | Add selector/scene; wrap controls; separate standard fullscreen rule | Original classic DOM and all playback methods retained; host/guest smoke |
| `src/store/initLocalStorage.js` | No saved stage choice | Add classic default through existing defaults merge | Existing batched settings persistence, reload test |
| `scripts/test-lyric-stage-modes.js`, `scripts/smoke-lyric-stages.js`, CI | No mode regression coverage | Unit + isolated production-browser fixtures, wire source test into CI | No production test hooks; source CI not claimed run |

18 source test scripts passed. Production build passed with 7 existing
CSS-order/asset-budget warnings; lint has 0 errors and 7 existing warnings.
Desktop 1440×1000, narrow 390×844 and actual fullscreen 844×390 checked in
isolated Chromium. Screenshots inspected, control wrapping and footer overlap
fixed. Browser tests cover four effects, 16/64px sizes, long lyric scroll access,
cue following, mode persistence, reduced motion and classic restoration.

Independent review identified inactive effect controls, clamped font settings,
short-fullscreen clipping and missing cue scroll following; each was repaired.
Unsupported vendor selectors also invalidated the old fullscreen layout rule;
the standard selector now has a separate rule. A component-owned ResizeObserver
repositions the cue on fullscreen resize and is disconnected on destruction.

Before/after: four rendered lyric paragraphs in classic and each new mode;
switching modes adds zero lyric requests, zero timers and zero dependencies.
No real-device FPS/power measurements were made.

Router backup exists at
`/mnt/mmc1-4/lumasing-backups/20261026-before-lyric-stages.tgz`.
Deployed to `http://192.168.100.1:18080` by overlaying assets first and index last;
API/KTV/web container identities and uptime were preserved. Uploaded archive
SHA256 `cf5241b6b0aa6362e8382d971992181d382b4aec0ef578fa16ad8dd265ebdfee`
matched on the router. Deployed stage smoke passed; real host/guest browser smoke
passed QR generation, guest join/search, first enqueue automatic playback
(`Howler.playing() === true`), Guest next, and session restart/new QR. API and KTV
healthy after deployment; host lease released. Browser fixtures are not
real-device acceptance. No real mobile scan or speaker listening was performed.
No claims about macOS/Windows packaging or GitHub CI from a web-only build.
