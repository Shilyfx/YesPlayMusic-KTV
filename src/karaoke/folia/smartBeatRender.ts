import * as pvBeatFx from '../../../vendor/folia-pv/src/services/beatFx/beatFxLive';
import { mergeBeatFxEvents } from '../../../vendor/folia-pv/src/services/beatFx/clock';
import * as pvSignals from '../../../vendor/folia-pv/src/stores/motionSignals';
import * as completeBeatFx from '../../../vendor/folia-complete/src/services/beatFx/beatFxLive';
import { publishPendoloDrumHits } from '../../../vendor/folia-complete/src/services/beatFx/pendoloDrumHits';
import * as completeSignals from '../../../vendor/folia-complete/src/stores/motionSignals';
import {
  getSmartBeatSourceRequirements,
  normalizeSmartBeatPreferences,
  SMART_BEAT_EFFECTS,
} from '../smartBeatPreferences';

type SmartBeatTimeline = any;
export type RawAudioFeatures = {
  available: boolean;
  power: number;
  bass: number;
  lowMid: number;
  mid: number;
  vocal: number;
  treble: number;
};
type Bus = {
  beginBeatFxTrack(key: string | null): void;
  setBeatFxEvents(
    key: string,
    events: any[],
    source: string,
    note?: string
  ): void;
  setBeatFxLiveEffects(strengths: Readonly<Record<string, number>>): void;
  setBeatFxIntensities(beat: number, downbeat: number): void;
  tickBeatFx(audio: any, context: any): void;
  stopBeatFx(): void;
};

type BusOwner = { refresh: () => void; disposed: boolean };
const busOwners = new WeakMap<object, BusOwner[]>();

function claimBus(bus: Bus, owner: BusOwner) {
  const owners = busOwners.get(bus) || [];
  owners.push(owner);
  busOwners.set(bus, owners);
}

function releaseBus(bus: Bus, owner: BusOwner) {
  const owners = busOwners.get(bus);
  if (!owners) return;
  const index = owners.lastIndexOf(owner);
  if (index >= 0) owners.splice(index, 1);
  if (!owners.length) busOwners.delete(bus);
}

function currentBusOwner(bus: Bus) {
  const owners = busOwners.get(bus);
  return owners?.[owners.length - 1] || null;
}

const clamp01 = (value: unknown) =>
  Math.max(0, Math.min(1, Number(value) || 0));
const clampClock = (value: unknown) =>
  Math.max(0, Math.min(600, Number(value) || 0));

const liveSignals = (signals: any) => ({
  audioPower: signals.audioPower,
  audioBands: signals.audioBands,
});

const stableAudioSignals = Object.freeze({
  pv: liveSignals(pvSignals),
  complete: liveSignals(completeSignals),
});

/** Stable Folia MotionValues; the two source copies are both published below. */
export function getStableFoliaAudioSignals(renderer: string) {
  return ['sonnet', 'tempera', 'hanabi'].includes(renderer)
    ? stableAudioSignals.pv
    : stableAudioSignals.complete;
}

/** Publish the six sampled raw WebAudio features to each original store identity. */
export function publishSmartBeatAudioFeatures(value: RawAudioFeatures | any) {
  const available = value?.available === true;
  const features = {
    available,
    power: available ? clamp01(value.power) : 0,
    bass: available ? clamp01(value.bass) : 0,
    lowMid: available ? clamp01(value.lowMid) : 0,
    mid: available ? clamp01(value.mid) : 0,
    vocal: available ? clamp01(value.vocal) : 0,
    treble: available ? clamp01(value.treble) : 0,
  };
  for (const signals of [pvSignals, completeSignals]) {
    // Keep the bus contract normalized (0..1), and adapt to Folia's existing
    // byte-scale MotionValues (0..255) at the shared publisher boundary.
    signals.audioPower.set(features.power * 255);
    signals.bass.set(features.bass * 255);
    signals.lowMid.set(features.lowMid * 255);
    signals.mid.set(features.mid * 255);
    signals.vocal.set(features.vocal * 255);
    signals.treble.set(features.treble * 255);
  }
  return features;
}

function makeDrumEvents(drums: any) {
  if (!drums) return [];
  return drums.times.map((time: number, index: number) => ({
    t: time,
    kind: 'beat',
    impact: drums.strengths[index],
    rhythmic: true,
    drumKind: drums.kinds[index],
  }));
}

function emptyEffects() {
  return Object.fromEntries(Object.keys(SMART_BEAT_EFFECTS).map(id => [id, 0]));
}

function projectEffects(mode: string, settings: any, timeline: any) {
  const normalized = normalizeSmartBeatPreferences(settings);
  const requirements = getSmartBeatSourceRequirements(normalized, mode);
  const effects = emptyEffects();
  if (normalized.mode === 'off')
    return { effects, requirements, enabled: false };
  for (const [id, definition] of Object.entries(SMART_BEAT_EFFECTS)) {
    if (definition.mode !== mode) continue;
    const setting = normalized.effects[id];
    const hasSource =
      definition.source === 'beats'
        ? Boolean(timeline?.beats?.source === 'beat_this')
        : Boolean(timeline?.drums?.source === 'htdemucs');
    if (setting.enabled && setting.strength > 0 && hasSource)
      effects[id] = setting.strength;
  }
  const enabled = Object.values(effects).some(strength => strength > 0);
  return { effects, requirements, enabled };
}

/**
 * Adapts the canonical two-source result to both original Folia module copies.
 * Its frame method accepts the unadjusted media position and never reads the lyric clock.
 */
export function createSmartBeatRenderBridge(options: any = {}) {
  const preview = options.preview === true;
  let mode = String(options.mode || '');
  let trackKey = typeof options.trackKey === 'string' ? options.trackKey : '';
  let settings = normalizeSmartBeatPreferences(options.settings);
  let timeline: SmartBeatTimeline | null = options.timeline || null;
  let disposed = false;
  let cachedDrumTimeline: SmartBeatTimeline | null = null;
  let cachedDrumHits: any = null;
  let projection: any = {
    effects: emptyEffects(),
    requirements: { beats: false, drums: false },
    enabled: false,
  };

  if (preview) {
    return {
      update: () => true,
      frame: () => undefined,
      getSmartBeatDrumHits: () => null,
      getSmartBeatEnabled: () => false,
      getProjection: () => projection,
      dispose: () => undefined,
    };
  }

  const buses: { pv: Bus; complete: Bus } = options.buses || {
    pv: pvBeatFx as any,
    complete: completeBeatFx as any,
    publishPendoloDrumHits,
  };
  const owner: BusOwner = { refresh: () => undefined, disposed: false };

  function ownsBuses() {
    return (
      !disposed &&
      !owner.disposed &&
      currentBusOwner(buses.pv) === owner &&
      currentBusOwner(buses.complete) === owner
    );
  }

  function getSmartBeatDrumHits(requestedTrackKey: string | null) {
    const currentTimeline =
      timeline && timeline.trackKey === trackKey ? timeline : null;
    if (
      disposed ||
      mode !== 'tempera' ||
      requestedTrackKey !== trackKey ||
      projection?.effects['tempera.inkFlash'] <= 0 ||
      !currentTimeline?.drums ||
      currentTimeline.drums.source !== 'htdemucs'
    )
      return null;
    if (cachedDrumTimeline !== currentTimeline) {
      cachedDrumTimeline = currentTimeline;
      cachedDrumHits = {
        times: Float64Array.from(currentTimeline.drums.times),
        strengths: Float32Array.from(currentTimeline.drums.strengths),
        kinds: Uint8Array.from(currentTimeline.drums.kinds),
        until: currentTimeline.duration,
      };
    }
    return cachedDrumHits;
  }

  function clearDrumHits() {
    if (ownsBuses()) buses.publishPendoloDrumHits?.('', null);
  }

  function apply() {
    if (disposed) return projection;
    const currentTimeline =
      timeline && timeline.trackKey === trackKey ? timeline : null;
    const nextProjection = projectEffects(mode, settings, currentTimeline);
    const requirements = nextProjection.requirements;
    const useBeats = requirements.beats && Boolean(currentTimeline?.beats);
    const useDrums = requirements.drums && Boolean(currentTimeline?.drums);
    const source = useBeats ? 'beat_this' : useDrums ? 'htdemucs' : 'beat_this';
    const events = useBeats
      ? mergeBeatFxEvents(
          currentTimeline.beats.times,
          currentTimeline.beats.downbeats
        )
      : useDrums
      ? makeDrumEvents(currentTimeline.drums)
      : [];

    if (ownsBuses()) {
      for (const bus of [buses.pv, buses.complete]) {
        bus.setBeatFxIntensities(
          settings.beatStrength,
          settings.downbeatStrength
        );
        bus.setBeatFxLiveEffects(nextProjection.effects);
        if (trackKey) bus.setBeatFxEvents(trackKey, events, source);
        else bus.stopBeatFx();
      }
    }

    const pendoloEnabled =
      mode === 'pendolo' &&
      nextProjection.effects['pendolo.drumhead'] > 0 &&
      useDrums;
    if (ownsBuses() && pendoloEnabled && currentTimeline?.drums) {
      buses.publishPendoloDrumHits?.(trackKey, {
        times: Float64Array.from(currentTimeline.drums.times),
        strengths: Float32Array.from(currentTimeline.drums.strengths),
        kinds: Uint8Array.from(currentTimeline.drums.kinds),
        until: currentTimeline.duration,
      });
    } else if (ownsBuses()) {
      clearDrumHits();
    }
    const result = { ...nextProjection, source, events };
    projection = result;
    return result;
  }

  owner.refresh = () => {
    if (disposed || owner.disposed) return;
    if (trackKey) {
      buses.pv.beginBeatFxTrack(trackKey);
      buses.complete.beginBeatFxTrack(trackKey);
    } else {
      buses.pv.stopBeatFx();
      buses.complete.stopBeatFx();
    }
    projection = apply();
  };
  claimBus(buses.pv, owner);
  claimBus(buses.complete, owner);
  if (trackKey && ownsBuses()) {
    buses.pv.beginBeatFxTrack(trackKey);
    buses.complete.beginBeatFxTrack(trackKey);
  }
  projection = apply();

  function update(patch: any = {}) {
    if (disposed) return false;
    if (Object.prototype.hasOwnProperty.call(patch, 'mode'))
      mode = String(patch.mode || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'trackKey')) {
      const nextKey = typeof patch.trackKey === 'string' ? patch.trackKey : '';
      if (nextKey !== trackKey) {
        trackKey = nextKey;
        if (!ownsBuses()) {
          // Keep this bridge's local state without touching a newer stage's clock.
        } else if (trackKey) {
          buses.pv.beginBeatFxTrack(trackKey);
          buses.complete.beginBeatFxTrack(trackKey);
        } else {
          buses.pv.stopBeatFx();
          buses.complete.stopBeatFx();
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'settings'))
      settings = normalizeSmartBeatPreferences(patch.settings);
    if (Object.prototype.hasOwnProperty.call(patch, 'timeline'))
      timeline = patch.timeline || null;
    projection = apply();
    return true;
  }

  function frame({ rawPosition = 0, playing = false } = {}) {
    if (disposed || !trackKey || !ownsBuses()) return;
    const mediaClockFacade = {
      currentTime: clampClock(rawPosition),
      paused: playing !== true,
      ended: playing !== true,
    };
    buses.pv.tickBeatFx(mediaClockFacade, null);
    buses.complete.tickBeatFx(mediaClockFacade, null);
  }

  return {
    update,
    frame,
    getSmartBeatDrumHits,
    getSmartBeatEnabled: () => Boolean(projection?.enabled),
    getProjection: () => projection,
    dispose() {
      if (disposed) return;
      const wasOwner = ownsBuses();
      if (wasOwner) {
        buses.pv.stopBeatFx();
        buses.complete.stopBeatFx();
        buses.publishPendoloDrumHits?.('', null);
      }
      disposed = true;
      owner.disposed = true;
      releaseBus(buses.pv, owner);
      releaseBus(buses.complete, owner);
      if (wasOwner) {
        const previousPv = currentBusOwner(buses.pv);
        const previousComplete = currentBusOwner(buses.complete);
        if (
          previousPv &&
          previousPv === previousComplete &&
          !previousPv.disposed
        ) {
          previousPv.refresh();
        }
      }
    },
  };
}
