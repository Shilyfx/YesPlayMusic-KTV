# KTV Canonical History

- Historical alternate Phase 3 lineage: `9130ed28c705213ee02da0c3d383f39e89ba3a58`.
- Current Phase 4 pre-repair canonical snapshot: `bfa19557c7b16e4d8bb0419cd30e8de837b502cd`.
- Unified repair branch: `fix/ktv-full-audit`.
- `UNIFIED_REPAIR_BASE_SHA`: `bfa19557c7b16e4d8bb0419cd30e8de837b502cd`.
- `UNIFIED_REPAIR_SHA`: `ac9d41687b42ec6623c3c4b3474c2f36e29d4f84`.

Future review diffs must use `UNIFIED_REPAIR_BASE_SHA...UNIFIED_REPAIR_SHA`; older
Phase 3 lineages are historical evidence only and must not be force-rewritten.

## Release stabilization lineage

- `STABILIZATION_BASE_SHA`: `a4c5c9c0d84a2d331f005e1a9deee6b37986c6e2`
- Branch: `fix/ktv-release-stabilization`
- The stabilization branch is additive and does not reset or rewrite the
  historical Phase 1–4 branches. Its final commit SHA is recorded here after
  the local verification commit is created.

## Final repair code checkpoint

- `PREVIOUS_REPAIR_CODE_SHA`: `9d0176acb9989465743778a88c7046efa0d1469b`
- `PREVIOUS_REPAIR_DOC_SHA`: `b6a0b05cb0f25d830a996c196f4bdc325178f8f5`
- `FINAL_REPAIR_CODE_SHA`: `f5cc5866390d08565c1eae8d0e824a523a12460a`
- `FINAL_REPAIR_CODE_ACTION_RUN`: `34331990263` (success)
- `FINAL_REPAIR_DOC_SHA`: `a94865958103a8bb4d897df57f0390f23ba1d26b`
- `FINAL_REPAIR_DOC_ACTION_RUN`: `34258965888` (success)
