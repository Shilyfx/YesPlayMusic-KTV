# Third-party rendering components

The original Sonnet, Tempera and Hanabi lyric PV runtimes are from
[Folia](https://github.com/chthollyphile/folia-major), pinned at
`aecd330b720eb8fc728e6b10ebcec261b144d683`.
They are distributed under AGPL-3.0, with upstream copyright retained in
`vendor/folia-pv/LICENSE`, `NOTICE.md` and `UPSTREAM.json`.
The original LumaSing/YesPlayMusic license does not replace this license.

The PV settings link exposes `/pv/source.tgz`, the corresponding application,
adapter and vendored source, dependency manifest, lockfile and build scripts.
The archive is rebuilt with each frontend build, using an explicit allowlist
that excludes environment files, repository metadata and deployment data.
Runtime dependency licenses are preserved in emitted `.LEGAL.txt` assets.

Build the web frontend with the locked dependencies and `yarn build` (Node 16
is used by the existing CI). `scripts/build-folia-pv.cjs` builds the native
ES modules before Vue CLI copies the public assets. Updating the Folia source
subset is a separate, explicit operation described in its vendor notice.
The local `LUMASING.patch` adds an optional Sonnet shot callback; the LumaSing
adapter uses it to keep readable foreground lyrics inside the screen edges.

Additional original renderers and background layers are selected from Folia
`7a5f975e337e5ba13f55d72b5bc68983bf41c379`. Their source hashes and bounded
host adaptations are recorded in `vendor/folia-complete/UPSTREAM.json`;
the original license and the corresponding source are included in the same
download archive. The existing patched PV subset remains pinned separately.

The same complete revision supplies the AGPL-3.0 analysis source under
`vendor/folia-analysis`. Its NOTICE and model manifest attribute the
MIT-licensed Beat This! and HTDemucs weights and record exact sizes and
SHA-256 values. The build verifies both exports before publishing them under
`/pv/models`; corresponding source includes the manifest and fetch script.
Inference is an optional WebGPU capability, separate from ordinary lyrics.

The KTV reaction characters Nimbo and Twinkle are from
[Aora Bot Mood Mates](https://github.com/sam70361/aora-bot), pinned at
`e3b6148c818da4a8e1966f2bc89cdb3cee473b73`. Their original source,
attribution and licenses are retained under `public/reactions/mood-mates`.
The upstream community license permits personal learning, research and
noncommercial use; commercial use requires a separate license from the author.

The Emotion Ball character and engine are from the same pinned Aora Bot
revision. The original files, license and NOTICE are retained under
`public/reactions/emotion-ball`. The ball character's visual design is limited
to personal technical study and research and is prohibited from commercial use;
the engine and data have separate licensing terms.
