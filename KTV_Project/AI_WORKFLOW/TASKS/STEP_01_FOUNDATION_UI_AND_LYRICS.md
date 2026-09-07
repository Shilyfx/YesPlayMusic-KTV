# TASK: Phase 1 — Foundation, Lyrics Enhancements, Design System and KTV Shell

## Objective

Establish a reviewable first implementation without introducing the LAN control server yet.

## Required outcomes

1. Preserve existing YesPlayMusic startup/playback behavior.
2. Implement continuous lyric font size customization.
3. Implement persisted lyric timing offset with clear positive/negative semantics.
4. Add reusable Glass UI tokens/components or equivalent style foundation.
5. Support Auto/Light/Dark for new KTV surfaces.
6. Add a KTV desktop shell with real current-track state where practical and mock queue where server/business queue is not yet implemented.
7. Add a responsive remote Web shell covering mobile/tablet/PC layouts with mock data.
8. Do not expose port 27232 to LAN.
9. Do not implement real LAN remote control in this phase.
10. Update AI_WORKFLOW artifacts and push branch `feat/ktv-phase-1`.

## Review breakpoint

Stop after Phase 1. Do not continue into KaraokeServer/real remote point-song behavior until GitHub review is completed.
