export type SmartBeatMode = 'off' | 'on' | 'cached';

export class SmartBeatUnsupportedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SmartBeatUnsupportedError';
    }
}

export interface SmartBeatSources {
    beats: boolean;
    drums: boolean;
}

export interface SmartBeatModelVersions {
    beat_this: string;
    htdemucs: string;
}

export interface CanonicalBeats {
    source: 'beat_this';
    times: number[];
    downbeats: number[];
}

export interface CanonicalDrums {
    source: 'htdemucs';
    times: number[];
    strengths: number[];
    kinds: number[];
}

export interface CanonicalTimeline {
    trackKey: string;
    audioHash: string;
    modelVersions: SmartBeatModelVersions;
    duration: number;
    beats: CanonicalBeats | null;
    drums: CanonicalDrums | null;
}

export interface SmartBeatStatus {
    stage: 'unsupported' | 'loading-model' | 'fetching-audio' | 'analysing' | 'ready' | 'cached' | 'error' | 'cancelled';
    trackKey?: string;
    source?: 'beat_this' | 'htdemucs' | 'both';
    phase?: string;
    progress?: number;
    loaded?: number;
    total?: number;
    cacheHit?: boolean;
    message?: string;
    error?: string;
}
