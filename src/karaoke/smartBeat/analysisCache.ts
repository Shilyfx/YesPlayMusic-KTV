import type { CanonicalTimeline, SmartBeatModelVersions, SmartBeatSources } from './types';

const DATABASE = 'lumasing-smartbeat-analysis-v1';
const STORE = 'timelines';
const MAX_TRACKS = 8;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TIMELINE_BYTES = 256 * 1024;
const MAX_EVENTS = 12000;

export interface CachedAnalysis {
    timeline: CanonicalTimeline;
    sources: SmartBeatSources;
}

export interface AnalysisStorage {
    get(cacheKey: string, versions: SmartBeatModelVersions, sources: SmartBeatSources): Promise<CachedAnalysis | CanonicalTimeline | null>;
    put(cacheKey: string, timeline: CanonicalTimeline, sources: SmartBeatSources): Promise<void>;
}

interface StoredAnalysis extends CachedAnalysis {
    cacheKey: string;
    bytes: number;
    updatedAt: number;
}

export const estimateTimelineBytes = (timeline: CanonicalTimeline): number =>
    new TextEncoder().encode(JSON.stringify(timeline)).byteLength;

const sortedTimes = (values: unknown, duration: number): values is number[] =>
    Array.isArray(values)
    && values.length <= MAX_EVENTS
    && values.every((time, index) => typeof time === 'number'
        && Number.isFinite(time)
        && time >= 0
        && time <= duration
        && (index === 0 || time >= values[index - 1]));

export const validateCanonicalTimeline = (value: unknown): value is CanonicalTimeline => {
    if (!value || typeof value !== 'object') return false;
    const timeline = value as CanonicalTimeline;
    if (typeof timeline.trackKey !== 'string' || timeline.trackKey.length > 1024) return false;
    if (!/^[a-f0-9]{64}$/.test(timeline.audioHash)) return false;
    if (!Number.isFinite(timeline.duration) || timeline.duration <= 0 || timeline.duration > 600) return false;
    if (!timeline.modelVersions || !/^[a-f0-9]{64}$/.test(timeline.modelVersions.beat_this)
        || !/^[a-f0-9]{64}$/.test(timeline.modelVersions.htdemucs)) return false;
    let count = 0;
    if (timeline.beats !== null) {
        if (timeline.beats?.source !== 'beat_this'
            || !sortedTimes(timeline.beats.times, timeline.duration)
            || !sortedTimes(timeline.beats.downbeats, timeline.duration)) return false;
        count += timeline.beats.times.length + timeline.beats.downbeats.length;
    }
    if (timeline.drums !== null) {
        const drums = timeline.drums;
        if (drums?.source !== 'htdemucs'
            || !sortedTimes(drums.times, timeline.duration)
            || !Array.isArray(drums.strengths)
            || !Array.isArray(drums.kinds)
            || drums.strengths.length !== drums.times.length
            || drums.kinds.length !== drums.times.length
            || !drums.strengths.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
            || !drums.kinds.every(value => Number.isInteger(value) && value >= 0 && value <= 2)) return false;
        count += drums.times.length;
    }
    return count <= MAX_EVENTS && estimateTimelineBytes(timeline) <= MAX_TIMELINE_BYTES;
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
});

const openDatabase = (): Promise<IDBDatabase | null> => new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
    }
    let request: IDBOpenDBRequest;
    try {
        request = indexedDB.open(DATABASE, 1);
    } catch {
        resolve(null);
        return;
    }
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE, { keyPath: 'cacheKey' });
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
});

const usableFor = (entry: StoredAnalysis, versions: SmartBeatModelVersions, sources: SmartBeatSources): boolean =>
    entry.timeline.modelVersions.beat_this === versions.beat_this
    && entry.timeline.modelVersions.htdemucs === versions.htdemucs
    && (!sources.beats || entry.sources.beats)
    && (!sources.drums || entry.sources.drums)
    && validateCanonicalTimeline(entry.timeline);

export const createIndexedDbAnalysisCache = (): AnalysisStorage => ({
    async get(cacheKey, versions, sources) {
        const db = await openDatabase();
        if (!db) return null;
        try {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const entry = await requestResult(store.get(cacheKey)) as StoredAnalysis | undefined;
            if (!entry || !usableFor(entry, versions, sources)) return null;
            entry.updatedAt = Date.now();
            store.put(entry);
            return { timeline: entry.timeline, sources: entry.sources };
        } catch {
            return null;
        } finally {
            db.close();
        }
    },

    async put(cacheKey, timeline, sources) {
        if (!cacheKey || cacheKey.length > 1024 || !validateCanonicalTimeline(timeline)) return;
        const bytes = estimateTimelineBytes(timeline);
        if (bytes > MAX_BYTES) return;
        const db = await openDatabase();
        if (!db) return;
        try {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const entries = await requestResult(store.getAll()) as StoredAnalysis[];
            const next: StoredAnalysis = { cacheKey, timeline, sources, bytes, updatedAt: Date.now() };
            const kept = entries.filter(entry => entry.cacheKey !== cacheKey);
            kept.push(next);
            kept.sort((a, b) => a.updatedAt - b.updatedAt);
            let keptBytes = kept.reduce((sum, entry) => sum + entry.bytes, 0);
            while (kept.length > MAX_TRACKS || keptBytes > MAX_BYTES) {
                const removed = kept.shift();
                if (!removed) break;
                keptBytes -= removed.bytes;
                store.delete(removed.cacheKey);
            }
            if (kept.some(entry => entry.cacheKey === cacheKey)) store.put(next);
        } catch {
            // Analysis remains usable when IndexedDB is unavailable or full.
        } finally {
            db.close();
        }
    },
});

export const ANALYSIS_CACHE_LIMITS = Object.freeze({ tracks: MAX_TRACKS, bytes: MAX_BYTES, timelineBytes: MAX_TIMELINE_BYTES, events: MAX_EVENTS });
