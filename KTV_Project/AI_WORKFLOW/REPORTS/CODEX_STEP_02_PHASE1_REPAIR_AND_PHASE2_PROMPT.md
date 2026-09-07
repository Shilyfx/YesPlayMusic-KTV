# Codex Execution Prompt — YesPlayMusic KTV Phase 1.1 Repair + Phase 2

> **This is ONE continuous execution.** First repair and validate the reviewed Phase 1 branch. Only after the Phase 1.1 gate passes, create the Phase 2 branch from the fixed Phase 1 commit and implement Phase 2. Stop before any LAN server work.

## 0. Repository and authority

Repository:

`Shilyfx/YesPlayMusic-KTV`

Reviewed branch:

`feat/ktv-phase-1`

ChatGPT-reviewed HEAD:

`856de64d43ab0c11abcee532b238fe2c43909d09`

Review result:

**Conditional Pass — Phase 1 core is acceptable, but the repair/evidence gate below is mandatory before Phase 2.**

Use actual repository code and reproducible tests as the source of truth. Do not treat the previous Codex report as proof that behavior works.

## 1. Mandatory startup reading

Before editing anything, read in this exact order:

1. `KTV_Project/YesPlayMusic_KTV_项目书.md`
2. `KTV_Project/AI_WORKFLOW/README.md`
3. `KTV_Project/AI_WORKFLOW/PROJECT_STATE.md`
4. `KTV_Project/AI_WORKFLOW/DECISIONS.md`
5. `KTV_Project/AI_WORKFLOW/TASKS/STEP_01_FOUNDATION_UI_AND_LYRICS.md`
6. `KTV_Project/AI_WORKFLOW/PROMPTS/CODEX_STEP_01_PROMPT.md`
7. `KTV_Project/AI_WORKFLOW/REPORTS/CODEX_STEP_01_REPORT.md`
8. `KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_LATEST.md`
9. This prompt and the Phase 1 review supplied with it.

Then inspect the real source files yourself. Do not assume this prompt's proposed file names must be followed if the repository provides a cleaner existing abstraction.

## 2. Git safety and branch handling

### 2.1 Verify repository identity

Run and record:

- current working directory
- `git remote -v`
- `git status --short --branch`
- `git log --oneline --decorate -n 15`
- `git rev-parse HEAD`

The remote must resolve to the user's repository `Shilyfx/YesPlayMusic-KTV`.

### 2.2 Start from the reviewed branch

Fetch first:

`git fetch --all --prune`

Checkout:

`feat/ktv-phase-1`

The expected reviewed HEAD is `856de64d43ab0c11abcee532b238fe2c43909d09`.

If the remote branch has moved beyond that SHA, **do not hard reset and do not discard user changes**. Record the new commits, inspect them, determine whether they already address any review item, and continue from the actual remote HEAD only after documenting the divergence.

Do not force-push and do not rewrite the existing Phase 1 history.

---

# PART A — Phase 1.1 repair and evidence gate

## 3. Fix B-01: KTV stage font-size control must actually affect the stage

Current defect: `karaoke.vue` changes the persisted `lyricFontSize` number, but the stage text still uses fixed CSS `clamp(...)` font sizes.

Requirements:

1. The KTV stage's active lyric must visibly respond to `lyricFontSize`.
2. 16px, 28px and 64px must produce materially different stage sizes.
3. Previous/next lyric lines should scale coherently relative to the active line rather than remaining visually unrelated.
4. Preserve responsive safety at 1440×900 and 1920×1080; no clipping or horizontal overflow.
5. Keep using the existing persisted `lyricFontSize`; do not introduce a second KTV-only font setting in this repair unless there is a compelling, documented reason.
6. Prefer a CSS custom property or equivalent maintainable binding rather than duplicated inline calculations across multiple elements.
7. Normal lyrics and KTV should continue to share the same 16–64 contract for this phase.

Acceptance:

- Set 16 → screenshot/manual evidence shows smaller KTV stage lyric.
- Set 28 → default/normal state.
- Set 64 → clearly larger but still usable at required desktop sizes.
- Reload and verify the value is preserved.

## 4. Fix B-02: correct the KTV lyric state before the first timed line

Current defect: `stageLyrics()` maps `activeIndex === -1` to index `1`, which can show the second lyric as current before any lyric should be active.

Requirements:

1. Model at least:
   - before first lyric
   - normal active lyric
   - final lyric / after final lyric
2. If `effectiveProgress = playerProgress + lyricOffsetSeconds` is before the first lyric timestamp:
   - do not highlight the second lyric;
   - show a neutral waiting/current state;
   - first lyric may be shown as the upcoming line.
3. Negative offsets must not cause negative indexing or incorrect active lines.
4. Empty lyrics and fallback lyrics must remain safe.
5. Do not mutate source timestamps.

Test at minimum:

- progress 0, first lyric > 0, offset 0
- progress 0, offset -1.0
- progress just before first line
- progress exactly first line
- last line and after last line

## 5. Fix B-03: Remote Shell must not inherit real local player shortcut side effects

Current defect: the route-local Remote mock does not call Player itself, but `App.vue` handles Space globally and can call `player.playOrPause()` on `karaokeRemote`.

Requirements:

1. Exclude `karaokeRemote` from the global Space playback shortcut.
2. Keep the local KTV Desktop route's Space behavior if it is useful and already safe.
3. Remote inputs/buttons must remain mock-only in Part A.
4. Do not connect Remote to `KaraokeManager` during Phase 2 either; Remote real integration is a later phase.

Acceptance:

- Enter `/karaoke/remote`, press Space outside an input; player state must not toggle.
- Desktop normal player and `/karaoke` behavior remain unaffected.

## 6. Fix O-01: normalize lyric font size consistently

The settings getter clamps 16–64, while `lyrics.vue` currently renders the raw stored value.

Requirements:

- Centralize or consistently reuse a 16–64 numeric normalization rule.
- An old/corrupt localStorage value such as `5`, `100`, string numeric values, `null`, or non-numeric text must not render an out-of-contract lyric size.
- Default remains 28px.
- Avoid adding a utility abstraction more complex than necessary.

## 7. Fix O-02: Remote mock state consistency

Although Remote stays mock-only, its mock behavior must be internally coherent.

Current issues:

- removing a queue item does not clear the corresponding track's `requested` state;
- the button text hardcodes “第 5 首”.

Requirements:

- canceling a mock request must permit re-requesting it;
- shown queue position must be derived from current mock queue state;
- do not accidentally add real APIs while fixing this.

## 8. Audit O-03: eliminate unrelated source formatting drift

The reviewed branch's `src/electron/mpris.js` differs in blob SHA from current upstream, while the KTV work does not require this file.

Reference upstream during this review:

`qier222/YesPlayMusic@df075cca247eab7bf8686155cb8cc9a1f4c7e271`

Requirements:

1. Compare the current fork version to that upstream reference.
2. If the difference is only unrelated formatting and has no KTV reason, restore the upstream form.
3. Do not revert meaningful upstream bug fixes.
4. Do not reformat unrelated source globally.
5. Record the exact result in the report.

## 9. Repair AI_WORKFLOW consistency

The current workflow metadata is stale/inconsistent.

### 9.1 Add baseline provenance file

Create:

`KTV_Project/AI_WORKFLOW/BASELINE.md`

It must explicitly state:

- upstream repository: `qier222/YesPlayMusic`
- upstream reference used for this audit: `df075cca247eab7bf8686155cb8cc9a1f4c7e271`
- ChatGPT Phase 1 review HEAD: `856de64d43ab0c11abcee532b238fe2c43909d09`
- the historical fact that the local workspace originally lacked `.git` and the first KTV repository commit was created after Phase 1 code already existed
- therefore a true pre-Phase1 local Git commit cannot be reconstructed from this repository and must not be fabricated
- key comparison results for at least:
  - `src/utils/Player.js`
  - `package.json`
  - `yarn.lock`
  - `src/background.js` 27232 binding
  - `src/electron/ipcMain.js`
  - `src/electron/services.js`
  - `src/electron/mpris.js` after the O-03 audit
- future rule: every phase starts from an explicit parent commit and records the parent SHA before edits.

### 9.2 Record this ChatGPT review

Create or update:

`KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_PHASE_01_REVIEW.md`

Use the supplied review content/summary. Include:

- reviewed HEAD `856de64...`
- verdict `Conditional Pass`
- B-01 through B-06
- Phase 1.1 gate

Update:

`KTV_Project/AI_WORKFLOW/REVIEWS/CHATGPT_LATEST.md`

It must no longer say Phase 1 was never pushed. It should point to the Phase 1 review and state that repair is in progress/completed as appropriate.

### 9.3 Update PROJECT_STATE cleanly

Remove stale statements such as “blocked by missing `.git` metadata”.

Before entering Phase 2, `PROJECT_STATE.md` must record:

- original ChatGPT-reviewed HEAD
- Phase 1 repair commit SHA
- validation status
- latest review file
- Phase 1 status: `Conditional Pass -> repaired; awaiting later confirmation as part of Phase 2 review` or equivalent accurate wording
- next action: Phase 2 implementation in this same execution.

Never write “ChatGPT approved the repair commit” because ChatGPT has not reviewed that future commit yet.

## 10. Add auditable Phase validation CI

Do not modify the release workflow merely to make this feature branch run releases.

Add a separate lightweight workflow, for example:

`.github/workflows/phase-validation.yml`

Requirements:

- trigger on `push`/`pull_request` for `feat/ktv-*` and `workflow_dispatch`;
- Node 16;
- use the committed Yarn lockfile;
- no dependency version upgrades;
- no app publishing, releases, signing, notarization or secrets;
- run a production web build;
- run Prettier check on files changed by the KTV phases, or a stable scoped KTV source set;
- run ESLint for the KTV-touched/new files as a blocking step;
- run full repository lint as a separately labeled diagnostic if it still contains upstream errors. It may be non-blocking only if the failure is clearly captured and the Phase-changed files are clean;
- never hide a newly introduced lint failure under “pre-existing”.

If a GitHub Actions run cannot be observed before the execution finishes, still push the workflow and record that CI status is pending. Do not fabricate a successful run.

## 11. Phase 1.1 validation gate

Run in a project-supported environment where possible. Prefer Node 16 because `package.json` declares Node 14/16.

At minimum:

### Functional/manual

- normal lyric page: 16 / 28 / 64 visible sizes
- normal lyric page: offset -1.0 / 0 / +1.0
- positive offset = earlier
- click lyric line still seeks original timestamp
- KTV stage: 16 / 28 / 64 visibly changes
- KTV stage before-first lyric state is correct at negative offset
- replay seeks to 0 without changing a queue (queue is still mock in Part A)
- Remote route Space does not toggle Player
- Remote 390×844, 430×932, 768×1024, 1440×900
- KTV 1440×900, 1920×1080
- Light/Dark/Auto as applicable

### Build/quality

- production build
- scoped KTV lint
- scoped Prettier check
- full lint diagnostic with exact error list

### Security/scope

Confirm by source search/direct inspection:

- `src/background.js` still listens `27232` on `127.0.0.1`
- no `0.0.0.0`
- no KaraokeServer
- no 27233 listener
- no SSE/WebSocket
- no Remote API
- no real KTV Queue engine yet at the end of Part A

## 12. Commit and push Phase 1.1

Use a scoped commit or small set of commits, for example:

- `fix: address phase 1 KTV review findings`
- `chore: add KTV phase validation and audit baseline`

Push normally to:

`origin/feat/ktv-phase-1`

Record the exact resulting SHA as `PHASE1_FIXED_SHA` in the report and `PROJECT_STATE.md`.

### STOP condition before Phase 2

Do not continue to Part B if any of the following is true:

- B-01/B-02/B-03 remains unresolved;
- build fails due to a Phase 1 change;
- scoped lint fails due to a Phase 1 change;
- 27232 became LAN-exposed;
- real remote/server work accidentally appeared;
- Git state is ambiguous or unpushed.

If the only remaining failure is a verified upstream/full-repo lint issue outside the changed files, document it and Part B may proceed.

---

# PART B — Phase 2: real local KTV Session and Queue

## 13. Create Phase 2 branch only after Part A gate passes

From the exact `PHASE1_FIXED_SHA`:

`git checkout -b feat/ktv-phase-2 <PHASE1_FIXED_SHA>`

If that branch already exists remotely, do not overwrite it blindly. Inspect its ancestry and reconcile safely.

Record:

- Phase 2 parent SHA
- Phase 2 starting branch
- clean working tree state

## 14. Phase 2 objective

Implement a **real, local-only KTV business layer** for the desktop host:

- `KaraokeSession`
- canonical temporary `KaraokeQueue`
- `KaraokeManager`
- thin Player adapter/integration
- host-side queue management UI
- session start/end
- real replay/next behavior coordinated with the KTV queue

The queue is temporary application state and must **not** create or modify a user's NetEase playlist.

## 15. Strict Phase 2 boundaries

### You MAY

- add local business modules under a clear KTV namespace;
- use existing Player public methods;
- add a narrow generic Player hook/public method only if necessary and justified;
- add host-side buttons/actions to place real NetEase tracks into the local KTV queue;
- replace the desktop KTV mock queue with real local queue state;
- maintain a local played/skipped history during the session;
- use Vue/Vuex/existing project patterns, but choose the smallest maintainable state mechanism.

### You MUST NOT

- create KaraokeServer;
- listen on `0.0.0.0`;
- open 27233 or another LAN port;
- generate a functional QR room link;
- expose any new HTTP remote endpoint;
- connect `/karaoke/remote` to real KaraokeManager data;
- implement phone point-song;
- implement SSE or WebSocket;
- implement network token/room-code authentication;
- upgrade Vue, Electron, Howler, Node stack or introduce a large UI framework;
- use `_playNextList` as the canonical KTV business queue;
- store all KTV business state only inside `Player.js`;
- silently write a KTV session to a NetEase playlist;
- add Windows-only core behavior.

These belong to Phase 3/4 or later.

## 16. Required Phase 2 domain model

Adapt names to the repository if needed, but keep these responsibilities separate.

Recommended source structure:

```text
src/karaoke/
  constants.js
  KaraokeSession.js
  KaraokeQueue.js
  KaraokeManager.js
  KaraokePlayerAdapter.js
```

Do not create unnecessary class hierarchy. Plain modules/classes are acceptable.

### 16.1 KaraokeSession

Minimum semantic fields:

```text
sessionId
status: idle | active | ended
createdAt
startedAt
endedAt
```

Optional host-only policy fields can be added if immediately useful, but do not build the future network permission system now.

Rules:

- session starts explicitly from the desktop KTV UI;
- one active local session at a time;
- end session terminates the temporary KTV context;
- ending the session does not alter NetEase playlists.

### 16.2 Queue item identity

Queue identity must be independent of track identity.

Minimum queue item:

```json
{
  "queueItemId": "unique-id",
  "trackId": 123456,
  "trackName": "晴天",
  "artists": ["周杰伦"],
  "albumName": "叶惠美",
  "coverUrl": "...",
  "durationMs": 269000,
  "requesterId": "host",
  "requesterName": "主机",
  "requestedAt": "ISO timestamp",
  "status": "queued"
}
```

Permitted statuses for Phase 2:

`queued | playing | played | skipped | removed`

If you use a smaller status model, document why and still preserve observable state transitions.

### 16.3 Duplicate policy

**Allow duplicate track IDs in the KTV queue by default.**

Reason: KTV sessions legitimately allow the same song to be requested multiple times. Therefore:

- `queueItemId` is unique;
- `trackId` is not the queue key;
- reordering/removing must operate on queueItemId.

Document this as a decision.

## 17. Required KaraokeManager operations

At minimum provide clear behavior equivalent to:

```text
startSession()
endSession()
enqueueTrack(track, requester)
removeQueueItem(queueItemId)
moveQueueItem(queueItemId, targetIndex) OR moveUp/moveDown
clearWaitingQueue()
playQueueItem(queueItemId) / startQueue()
next()
replay()
playOrPause() or delegated equivalent
```

Additional helpers are allowed if they simplify UI state.

### 17.1 Invariants

- only one queue item can have status `playing`;
- waiting queue order is deterministic;
- removing a queued item does not affect unrelated tracks;
- replay does not add/remove/reorder queue items;
- next transitions the current item appropriately and advances once;
- empty-next is safe and does not throw;
- ending session clears or terminates the transient queue per a documented policy;
- normal YesPlayMusic playback outside KTV remains usable.

## 18. Player integration architecture

`src/utils/Player.js` remains the playback engine, not the KTV domain store.

### Preferred approach

Use a thin `KaraokePlayerAdapter` that delegates to existing public methods such as:

- `seek(0)`
- `play()`
- `playOrPause()`
- `playNextTrack()` only when it matches the desired local-KTV transition semantics
- an existing safe “play specific track”/playlist method where appropriate

If current public Player APIs are insufficient to play a specific queue item safely:

1. first look for an existing public method that can be reused;
2. if none exists, add the smallest generic public Player capability rather than exposing many internals;
3. document why it was necessary;
4. keep KTV state in KaraokeManager, not Player;
5. do not scatter access to `_currentTrack`, `_list`, `_playNextList`, `_howler` across KTV UI/business code.

Any unavoidable private access must be isolated in the adapter, documented, and justified as temporary technical debt.

## 19. Queue-to-playback transition rules

Use an explicit state machine rather than relying on visual array position alone.

Recommended host behavior:

### Start first queued song

- session active
- first `queued` item → `playing`
- request Player to play its track
- current KTV item references that queueItemId

### Host presses “下一首/切歌”

- current KTV item → `skipped`
- next queued item → `playing`
- Player switches to that track
- if none exists, no exception; current becomes none and session remains active in an empty/waiting state

### Song naturally finishes

If a safe and maintainable existing event/hook can detect completion:

- current → `played`
- next queued item → `playing`

If safe natural-end integration would require invasive Player modifications, implement the minimal explicit host-next flow in Phase 2 and document natural-end auto-advance as a known Phase 2 gap. **Do not fake it.**

### Replay

- Player seek to 0 and play
- current queueItemId/status unchanged
- waiting order unchanged

### Remove queued item

- only waiting/queued items are removable through normal queue controls
- current playing item should not be silently deleted; use “切歌” for the current item unless you implement a clearly defined safe action.

## 20. How the host adds real tracks in Phase 2

Phase 2 needs a real way to populate the queue without Remote networking.

Implement the smallest natural host-side entry point. Preferred options:

1. Existing `TrackList` context menu / row action: **“加入 KTV 待唱”** when a KTV session is active.
2. Optional KTV stage action: **“将当前歌曲加入待唱”** for testing/quick use.

Requirements:

- use real track metadata already available in the existing UI;
- if the track object is partial, resolve only the minimum metadata required by the queue model using existing APIs;
- no Remote API;
- no NetEase playlist write;
- action should show a clear local toast/feedback;
- session-inactive behavior must be explicit: disable/hide the action or offer to enter/start KTV locally, but do not silently create network room state.

## 21. Desktop KTV UI — replace mock queue with real local queue

Keep the established glass visual language.

### 21.1 Header/session state

Show:

- KTV status: 未开始 / 本机 KTV 进行中 / 已结束
- explicit badge: **“本机模式”**
- explicit room text: **“局域网房间将在 Phase 3 开启”**
- Auto/Light/Dark theme selector
- Start Session / End Session actions as appropriate

There must be no functional QR code or LAN address yet.

### 21.2 Real queue panel

Replace desktop mock queue after Phase 2 manager is active.

Show:

- current item
- waiting items in exact order
- requester `主机` for Phase 2 host-added entries
- state badge where useful
- queue count
- empty state

Host controls for waiting items:

- move up
- move down
- remove

Optional: clear waiting queue with confirmation.

Do not add drag-and-drop unless it is trivial and robust; buttons are sufficient for Phase 2.

### 21.3 Playback controls

- 重唱
- 播放/暂停
- 下一首 / 切歌

These must route through KaraokeManager/adapter while a KTV session controls a queue, so UI state and playback do not diverge.

### 21.4 Lyrics controls

Retain and verify:

- 16–64px stage size
- offset +/-0.1, reset 0
- positive = earlier
- no source timestamp mutation

## 22. End-session UX

End Session should be explicit and safe.

Recommended behavior:

1. Ask for confirmation if there is an active/waiting queue.
2. End the KTV session.
3. Clear transient queue/history according to the documented Phase 2 policy (recommended: clear on end; no persistence yet).
4. Do not delete/change NetEase data.
5. Do not terminate the desktop music application.
6. Return the KTV UI to a clear idle state.

Do not add crash recovery persistence in this phase unless it is extremely small and separately documented. The default requirement is **in-memory temporary session**.

## 23. Remote Shell during Phase 2

Remote remains **mock-only**.

Requirements:

- keep responsive mobile/tablet/PC UI;
- keep mock search/queue/playability data;
- label it “Phase 2 预览 / 尚未连接局域网房间” or equivalent;
- do not import/use KaraokeManager;
- do not expose live desktop queue;
- do not control Player;
- do not add HTTP/fetch/axios calls for KTV remote behavior.

This strict separation prepares Phase 3 security review.

## 24. Phase 2 testing matrix

### 24.1 Domain/unit-style tests

If the repository lacks a unit-test framework, do not install a large framework solely for this task. Use the lightest maintainable test route available (small Node-compatible tests, pure-module checks, or focused runtime assertions). Document limitations.

Verify at minimum:

#### Session
- idle → active
- calling start when already active is safe/idempotent or explicitly rejected
- active → ended/idle per policy
- end clears transient state as designed

#### Queue
- enqueue 1 item
- enqueue 5 items
- enqueue same `trackId` twice → two unique queueItemIds
- remove middle waiting item
- move first/last boundaries safely
- reorder and preserve exact order
- clear waiting queue
- current item cannot be accidentally removed via waiting-item operation

#### Playback coordination
- play first queued item
- next: current → skipped and next → playing
- replay: seek 0, no queue mutation
- empty next: no exception
- normal Player path outside active KTV remains unaffected

### 24.2 UI/manual

Desktop KTV:

- 1440×900
- 1920×1080
- empty queue
- 1 queue item
- 10+ queue items; panel scrolls correctly
- Light/Dark/Auto
- 16/28/64px stage lyric
- -1/0/+1 offset
- Start/End Session
- move/remove queue items

Host TrackList:

- KTV action only appears/behaves according to session policy
- real track can be enqueued
- duplicate real track can be enqueued twice

Remote shell:

- 390×844
- 430×932
- 768×1024
- 1440×900
- remains mock-only
- Space has no player side effect

### 24.3 Regression/security

- normal home/library/search navigation
- normal player play/pause/next outside KTV
- normal lyrics page
- `127.0.0.1:27232` unchanged
- no 0.0.0.0
- no 27233 listener
- no KaraokeServer
- no SSE/WebSocket
- no KTV remote HTTP API
- package.json/yarn.lock unchanged unless an absolutely necessary tiny dependency is justified; preferred result is unchanged

## 25. Phase 2 CI / quality gate

The Phase Validation workflow added in Part A should run for `feat/ktv-phase-2`.

Run/record locally as well:

- supported Node/Yarn versions
- production build
- scoped ESLint for all KTV/newly touched files
- Prettier check
- full lint diagnostic

If a new KTV file has lint errors, Phase 2 is not complete.

## 26. AI_WORKFLOW artifacts required for Phase 2

Create/update:

### Task

`KTV_Project/AI_WORKFLOW/TASKS/STEP_02_LOCAL_SESSION_AND_QUEUE.md`

It must define the actual implemented scope and explicit Phase 3 exclusions.

### Prompt archive

Copy this prompt into:

`KTV_Project/AI_WORKFLOW/PROMPTS/CODEX_STEP_02_PHASE1_REPAIR_AND_PHASE2_PROMPT.md`

### Report

Create:

`KTV_Project/AI_WORKFLOW/REPORTS/CODEX_STEP_02_REPORT.md`

Required sections:

1. Git identity and exact SHAs
2. Phase 1 repair findings and exact fixes
3. `PHASE1_FIXED_SHA`
4. Phase 1.1 validation commands/results
5. Phase 2 parent SHA
6. Phase 2 architecture
7. every materially changed file and reason
8. Session state model
9. Queue item model and duplicate policy
10. Player adapter strategy / any Player.js changes
11. exact queue transition behavior
12. desktop UI changes
13. Remote remains mock-only proof
14. build/lint/format/CI status
15. viewport/manual evidence
16. security boundary checks
17. known issues / not verified
18. exact final Phase 2 commit SHA and push result

### Project state

At the end, `PROJECT_STATE.md` must accurately say:

- current phase = Phase 2 implementation complete, awaiting ChatGPT review
- branch = `feat/ktv-phase-2`
- parent = `PHASE1_FIXED_SHA`
- latest ChatGPT review = Phase 1 review of `856de64...` (Conditional Pass)
- latest Codex report = STEP 02 report
- Phase 3 has **not** started
- next action = ask ChatGPT to review `feat/ktv-phase-2`

### CHANGELOG / DECISIONS

Update both with decisions that materially affect future phases, especially:

- duplicate track policy
- queue item identity
- session end/clear policy
- Player adapter boundary
- any natural-end limitation
- Remote remains mock-only until later phase

## 27. Git commits and push

Keep commits scoped. A reasonable sequence is:

Phase 1 branch:

1. `fix: address phase 1 KTV review findings`
2. `chore: add KTV audit baseline and validation workflow`

Then push `feat/ktv-phase-1`.

Phase 2 branch:

1. `feat: add local KTV session and queue domain`
2. `feat: connect desktop KTV queue to player`
3. `docs: record KTV phase 2 checkpoint`

Exact grouping may differ if a cleaner history results.

Push:

`origin/feat/ktv-phase-2`

Do not force-push.

## 28. Final stop condition

**STOP after Phase 2 is committed and pushed.**

Do not implement Phase 3, even if time remains.

Specifically do not add:

- LAN server
- QR code functionality
- 27233 listener
- room token
- phone search API
- real Remote queue
- polling/SSE/WebSocket

The next action is a new ChatGPT review of:

`https://github.com/Shilyfx/YesPlayMusic-KTV/tree/feat/ktv-phase-2`

## 29. Completion standard

Do not say “completed” merely because code was written. Completion requires:

- Part A repair gate passed and pushed;
- Phase 2 branch is descendant of exact fixed Phase 1 SHA;
- domain invariants are demonstrably checked;
- desktop queue is real local state, not mock;
- Remote remains mock-only;
- no prohibited LAN work;
- build + scoped quality checks are clean;
- AI_WORKFLOW reflects the actual Git state;
- exact final SHA is recorded and pushed.


