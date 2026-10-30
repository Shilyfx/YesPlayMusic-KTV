# Folia PV runtime subset

Upstream: https://github.com/chthollyphile/folia-major
Commit: aecd330b720eb8fc728e6b10ebcec261b144d683
License: AGPL-3.0 (see LICENSE). Copyright belongs to the upstream contributors.

The 165 files listed in UPSTREAM.json are copied from upstream. LUMASING.patch
records the Sonnet foreground-viewport callback and the bounded Tempera ink
consumer backport. The Tempera ink shader, tileable noise field, hit filtering,
and fade envelope come from Folia source revision
7a5f975e337e5ba13f55d72b5bc68983bf41c379, paths
`src/components/visualizer/tempera/temperaInkFlash.ts` and
`src/components/visualizer/tempera/createTemperaPixiRuntime.ts`. The LumaSing
adapter replaces that source revision's internal analysis-store lookup with
the canonical G4 HTDemucs timeline callback; it does not substitute a separate
flash effect. The shot compilers, typography and transition algorithms remain
upstream's.
Reproduce the selection and patch with `node scripts/vendor-folia-pv.cjs <checkout>`.

LumaSing's adapter is in src/karaoke/folia and KaraokePvScene.vue. It replaces
the React application shell with a Vue lifecycle, supplies playback time and
lyric documents, limits the dynamic Lucide vocabulary to five local icons,
and passes no song-title metadata to the original opening/credits cards.
Optional Folia audio-analysis/beat models, AI themes, mod host and uploaded
image library are not included. Their absence does not start network requests.
Plain LRC has line timing only: the original rendering algorithm's subdivision
of those intervals is animation, not measured syllable alignment.

Runtime assets build locally; no third-party CDN or hosted Folia is required.
