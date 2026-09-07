# Baseline provenance

- Upstream repository: `qier222/YesPlayMusic`.
- Upstream reference used for this audit: `df075cca247eab7bf8686155cb8cc9a1f4c7e271`.
- ChatGPT Phase 1 review HEAD: `856de64d43ab0c11abcee532b238fe2c43909d09`.

## Historical limitation

The supplied workspace originally had no `.git` metadata. The first local KTV
repository commit was created after the Phase 1 code already existed. A true
pre-Phase-1 local Git commit therefore cannot be reconstructed from this
repository and must not be fabricated.

## Comparison at the Phase 1 review head

The listed source blobs at `856de64` match the named upstream reference except
for `src/electron/mpris.js`. Its only difference was unrelated formatting of two
`try/catch` statements; Phase 1.1 restores the upstream form.

| File | Review HEAD blob | Upstream blob | Result |
| --- | --- | --- | --- |
| `src/utils/Player.js` | `a0073ec45b30b617ea37d0bcd11681d08dfa0985` | same | unchanged |
| `package.json` | `e65f5fd1a1116e2d15e0504e84bbfe83b6f9150e` | same | unchanged |
| `yarn.lock` | `f6390d01294b8bf5a36ce4da10fbbe5933511b64` | same | unchanged |
| `src/background.js` | `612f877549c13b429460a3d31698f85f522bfff9` | same | unchanged; `27232` remains bound to `127.0.0.1` |
| `src/electron/ipcMain.js` | `09f3ca855f3035f01d0d83d0a91a0bc53ba62756` | same | unchanged |
| `src/electron/services.js` | `94720ceb2415f6b116456aa4b549bb79be52bfc2` | same | unchanged |
| `src/electron/mpris.js` | `f7ae54324aaae0803f46239c0dce7fdb91977b33` | `d778b34f8c80ede1b7b180292924d7b028c28cce` | formatting-only drift restored in Phase 1.1 |

## Future rule

Every phase must start from an explicit parent commit and record that parent
SHA before editing.
