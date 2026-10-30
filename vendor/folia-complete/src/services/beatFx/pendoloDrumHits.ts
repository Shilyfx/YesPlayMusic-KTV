export type DrumHitKind = 0 | 1 | 2;
export const DRUM_KICK: DrumHitKind = 0;
export const DRUM_SNARE: DrumHitKind = 1;
export const DRUM_HAT: DrumHitKind = 2;
export interface DrumHits {
  times: Float64Array;
  strengths: Float32Array;
  kinds: Uint8Array;
  until?: number;
}

let activeTrackKey: string | null = null;
let activeHits: DrumHits | null = null;

/** G4 publishes real keyed drum events here; absent data leaves the source effect at rest. */
export const publishPendoloDrumHits = (trackKey: string, hits: DrumHits | null): void => {
  activeTrackKey = hits ? trackKey : null;
  activeHits = hits;
};

export const clearPendoloDrumHits = (): void => {
  activeTrackKey = null;
  activeHits = null;
};

export const getDrumHits = (trackKey: string | null): DrumHits | null =>
  trackKey !== null && trackKey === activeTrackKey ? activeHits : null;
