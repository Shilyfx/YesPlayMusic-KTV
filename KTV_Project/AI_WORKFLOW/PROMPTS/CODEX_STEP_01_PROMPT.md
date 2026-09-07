# Codex Prompt — YesPlayMusic KTV Phase 1

You are modifying the repository forked from `qier222/YesPlayMusic`.

Your task is ONLY Phase 1: establish a safe KTV foundation, improve lyric controls, and create the desktop/remote UI shells. Do not continue into the LAN server or real phone-to-player control after completing this phase.

## Mandatory startup reading

Before editing code, read in this order:

1. `AI_WORKFLOW/PROJECT_STATE.md`
2. `AI_WORKFLOW/DECISIONS.md`
3. `AI_WORKFLOW/TASKS/STEP_01_FOUNDATION_UI_AND_LYRICS.md`
4. `YesPlayMusic_KTV_项目书.md` if it is present in the repository root; otherwise use the copy provided with this prompt package.

Then inspect the real repository structure and existing implementation. Do not assume file names from the plan are exact if the repository proves otherwise.

## Baseline verification

Before changing behavior:

- Record current branch and commit.
- Install/use dependencies without opportunistic upgrades.
- Verify the existing development launch/build path as far as the environment allows.
- Record any pre-existing failures separately from new failures.

Do not upgrade Vue, Electron, Howler, or the general build stack in this phase.

## Feature A — Continuous lyric font size

The existing project already has lyric font size settings. Replace/extend fixed size choices so the user can continuously customize the lyric size.

Requirements:

- Retain compatibility with existing saved settings.
- Recommended range: 16–64px; default 28px.
- A slider and/or +/- controls are acceptable; UI must show the numeric px value.
- Persist through the existing settings/localStorage mechanism.
- Existing lyrics page must react immediately.
- Avoid breaking translated/romanized lyrics layouts.

If you decide normal lyrics and KTV lyrics need different size settings, document the decision in `AI_WORKFLOW/DECISIONS.md`; do not silently add behavior.

## Feature B — Lyric timing offset

Add a persistent lyric timing offset setting.

Requirements:

- Support both advance and delay.
- Recommended range: -10.0 to +10.0 seconds.
- Fine adjustment: 0.1s.
- Provide a reset-to-zero action.
- Make the sign semantics explicit in code and UI. Prefer: positive = lyrics displayed earlier, negative = lyrics displayed later. If repository constraints make another convention safer, keep it internally consistent and document it.
- Do not mutate the source lyric timestamps.
- Do not make lyric-line click-to-seek seek to the wrong audio position because of the display offset.
- Persist the setting.

## Feature C — KTV design system

Create a minimal reusable styling foundation for new KTV surfaces.

Visual requirements:

- Glassmorphism, but readable rather than excessively transparent.
- Album-art ambient background or a realistic placeholder fallback.
- Auto / Light / Dark modes.
- Clear design tokens for glass backgrounds, border, text hierarchy, radius, blur and spacing.
- Respect `prefers-reduced-motion`.
- Provide a graceful reduced-transparency/low-performance fallback where practical.
- Do not add a large third-party UI framework.

## Feature D — Desktop KTV shell

Add a discoverable KTV mode entry and desktop KTV shell.

The shell should visually contain:

- Current track/title/artist/cover using real player state when feasible.
- Main lyric/stage area.
- A visible control area for Replay / Play-Pause / Next (these controls may call existing player methods where safe; do not create the full KTV queue engine yet).
- Lyric offset and font-size quick controls.
- A queue panel using clearly marked mock/placeholder queue data until Phase 2.
- A room/QR panel can be a non-functional placeholder in Phase 1 and must not pretend the LAN server exists.

The page must work at 1440x900 and 1920x1080 without clipping.

## Feature E — Responsive Remote Web shell

Create the future KTV song-request web UI shell, but do NOT implement the real LAN server or real remote control in this phase.

Required views/states:

- Header / room summary.
- Theme switcher Auto/Light/Dark.
- Now Playing card.
- Search input.
- Search result cards using mock data.
- Playability badges in mock states (playable/trial/unavailable).
- Queue view/list using mock data.
- Mobile bottom navigation or equivalent touch-first navigation.

Responsive acceptance widths:

- 390px mobile
- 430px mobile
- 768px tablet
- 1440px PC web

The PC web layout should take advantage of space (e.g. current track + results + queue columns), not just stretch the phone layout.

If the current build structure makes a separate remote bundle expensive, choose the smallest maintainable scaffold that can later be served independently by `KaraokeServer`. Document how Phase 3 will extract/serve it. Do not create an insecure LAN listener merely to preview the page.

## Strict boundaries

DO NOT:

- Change existing 27232 listener from localhost to 0.0.0.0.
- Add the real KaraokeServer in this phase.
- Add unrestricted remote endpoints.
- Implement WebSocket/SSE now.
- Upgrade Electron/Vue.
- Introduce Windows-only core logic.
- Reformat unrelated files.
- Rename large parts of the project without a concrete requirement.
- Claim macOS is tested if you only developed on Windows.

## Testing and verification

At minimum verify, where environment permits:

- Existing app starts.
- Existing normal playback controls are not obviously broken.
- Lyrics load/highlight.
- Font size min/default/max.
- Lyric offset negative/zero/positive.
- Offset persists after reload/restart.
- KTV desktop shell Light/Dark.
- Remote shell Light/Dark.
- Responsive widths listed above.
- Lint/build if the repository baseline supports them.

Capture exact failures; distinguish pre-existing failures from changes introduced by you.

## Required AI_WORKFLOW output

Before finishing:

1. Update `AI_WORKFLOW/PROJECT_STATE.md` with:
   - phase status
   - branch
   - commit hash after commit
   - what is implemented
   - what remains
2. Update `AI_WORKFLOW/CHANGELOG.md`.
3. Create `AI_WORKFLOW/REPORTS/CODEX_STEP_01_REPORT.md` from the report template.
4. In the report list EVERY materially changed file and why.
5. Record exact commands/tests and results.
6. Record screenshots/manual viewport checks if available as paths/descriptions; do not fabricate evidence.
7. Record unresolved issues and risk areas.

## Git checkpoint

Use branch:

`feat/ktv-phase-1`

Make clean, scoped commits. Push the branch to the user's GitHub repository.

STOP after pushing Phase 1. Do not start Phase 2.

The user will ask ChatGPT to inspect the GitHub branch. ChatGPT will review the real repository state and produce the next instructions.
