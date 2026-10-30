const CALIBRATION_DURATION_MS = 6500;
const CONFIRM_WINDOW_MS = 1500;
const MIN_MOOD_HOLD_MS = 4500;
const BURST_COOLDOWN_MS = 15000;
const SEEK_RESET_THRESHOLD_SEC = 2.5;
const DIALOGUE_ROTATE_INTERVAL_MS = 5200;

export const MUSIC_SENSITIVITY_PRESETS = {
  gentle: {
    id: 'gentle',
    label: '柔和',
    thresholdScale: 1.24,
    transientThreshold: 0.14,
    beatCooldownMs: 1100,
    burstCooldownMs: 20000,
    allowPeakBurst: false,
  },
  standard: {
    id: 'standard',
    label: '标准',
    thresholdScale: 1.0,
    transientThreshold: 0.095,
    beatCooldownMs: 700,
    burstCooldownMs: BURST_COOLDOWN_MS,
    allowPeakBurst: true,
  },
  lively: {
    id: 'lively',
    label: '热闹',
    thresholdScale: 0.82,
    transientThreshold: 0.068,
    beatCooldownMs: 520,
    burstCooldownMs: BURST_COOLDOWN_MS,
    allowPeakBurst: true,
  },
};

export const MUSIC_REACTION_STATES = {
  idle: { state: 'idle', emotion: '02', label: '安静听你唱', action: null },
  paused: {
    state: 'paused',
    emotion: '06',
    label: '休息一下，等你继续',
    action: null,
  },
  listening: {
    state: 'listening',
    emotion: '16',
    label: '认真听你唱',
    action: null,
  },
  lively: {
    state: 'lively',
    emotion: '10',
    label: '跟着节奏摇摆',
    action: 'bounce',
  },
  excited: {
    state: 'excited',
    emotion: '13',
    label: '气氛起来了',
    action: 'bounce',
  },
  peak: {
    state: 'peak',
    emotion: '33',
    label: '全场高能',
    action: 'burst',
  },
  cooldown: {
    state: 'cooldown',
    emotion: '19',
    label: '余韵回落',
    action: null,
  },
  finished: {
    state: 'finished',
    emotion: '33',
    label: '完美收麦',
    action: 'burst',
  },
};

export const MUSIC_MOOD_DIALOGUES = {
  idle: [{ emotion: '02', label: '安静听你唱' }],
  paused: [
    { emotion: '06', label: '休息一下，等你继续' },
    { emotion: '15', label: '唱累了先喝口水' },
    { emotion: '35', label: '麦克风给你留着呢' },
    { emotion: '02', label: '随时准备接着唱' },
  ],
  listening: [
    { emotion: '16', label: '认真听你唱' },
    { emotion: '05', label: '前奏渐入，准备开嗓' },
    { emotion: '03', label: '期待你开口的第一句' },
    { emotion: '01', label: '把舞台交给你的好声音' },
    { emotion: '35', label: '静静感受这段旋律' },
    { emotion: '04', label: '伴奏好温柔，慢慢进拍' },
  ],
  lively: [
    { emotion: '10', label: '跟着节奏摇摆' },
    { emotion: '19', label: '这句唱得太有感觉了' },
    { emotion: '14', label: '声音好温柔，听入迷了' },
    { emotion: '39', label: '这一段我也想跟着哼' },
    { emotion: '37', label: '熟悉的旋律，全是青春' },
    { emotion: '16', label: '气息好稳，不想错过每一句' },
    { emotion: '03', label: '下一句会怎么演绎呢' },
    { emotion: '31', label: '全程陪你一起唱完' },
  ],
  excited: [
    { emotion: '13', label: '气氛起来了' },
    { emotion: '32', label: '副歌蓄力中，准备起飞' },
    { emotion: '10', label: '节奏加快，状态拉满' },
    { emotion: '31', label: '下一句高潮交给你' },
    { emotion: '07', label: '满血状态，越唱越来劲' },
    { emotion: '14', label: '心动暴击，唱到心坎里了' },
    { emotion: '39', label: '全场一起跟着合唱吧' },
  ],
  peak: [
    { emotion: '33', label: '全场高能，掌声送给你' },
    { emotion: '13', label: '这高音太惊艳全场了' },
    { emotion: '10', label: '副歌彻底燃起来了' },
    { emotion: '14', label: '开口就是王炸，太好听了' },
    { emotion: '39', label: '气氛推向最高潮' },
    { emotion: '07', label: '这实力简直是原唱吧' },
  ],
  cooldown: [
    { emotion: '19', label: '余韵回落，这味太对了' },
    { emotion: '12', label: '每一句都唱进故事里' },
    { emotion: '37', label: '刚刚那段副歌还在脑海回响' },
    { emotion: '04', label: '沉浸在尾音的温柔里' },
    { emotion: '14', label: '轻轻收尾也这么动人' },
    { emotion: '16', label: '静静听你把故事讲完' },
  ],
  finished: [
    { emotion: '33', label: '完美收麦，唱得太棒了' },
    { emotion: '13', label: '根本没听够，再来一首' },
    { emotion: '19', label: '这首完成得太漂亮了' },
    { emotion: '14', label: '余音绕梁，给你鼓掌' },
  ],
};

export function normalizeMusicSensitivity(value) {
  return MUSIC_SENSITIVITY_PRESETS[value] ? value : 'standard';
}

export function sanitizeMusicReaction(value) {
  if (!value || typeof value !== 'object') return null;
  const stateKey = MUSIC_REACTION_STATES[value.state]
    ? value.state
    : 'listening';
  const def = MUSIC_REACTION_STATES[stateKey];
  const intensity = Number.isFinite(value.intensity)
    ? Math.max(0, Math.min(1, Math.round(value.intensity * 1000) / 1000))
    : 0;
  const beatSeq = Number.isSafeInteger(value.beatSeq)
    ? Math.max(0, value.beatSeq)
    : 0;
  const burstSeq = Number.isSafeInteger(value.burstSeq)
    ? Math.max(0, value.burstSeq)
    : 0;
  const rawLabel =
    typeof value.label === 'string'
      ? value.label
          .replace(/[\r\n\t]/g, ' ')
          .trim()
          .slice(0, 40)
      : '';
  return {
    state: stateKey,
    emotion:
      typeof value.emotion === 'string' && /^[0-9]{2}$/.test(value.emotion)
        ? value.emotion
        : def.emotion,
    label: rawLabel || def.label,
    intensity,
    beatSeq,
    burstSeq,
    analyzed: value.analyzed === true,
    itemId: typeof value.itemId === 'string' ? value.itemId.slice(0, 160) : '',
    trackPosition:
      Number.isFinite(value.trackPosition) && value.trackPosition >= 0
        ? Math.min(86400, Math.round(value.trackPosition * 100) / 100)
        : 0,
  };
}

export function canSafelyTapMediaElement(node, options = {}) {
  if (!node || typeof node !== 'object')
    return { safe: false, reason: 'NO_MEDIA_ELEMENT' };
  const outputDevice = options.outputDevice || '';
  if (outputDevice && outputDevice !== 'default') {
    return { safe: false, reason: 'CUSTOM_OUTPUT_DEVICE' };
  }
  const src = String(node.currentSrc || node.src || '').trim();
  if (!src) return { safe: false, reason: 'EMPTY_SOURCE' };
  if (
    src.startsWith('blob:') ||
    src.startsWith('data:') ||
    src.startsWith('file:')
  ) {
    return { safe: true, reason: 'LOCAL_OR_BLOB_SOURCE' };
  }
  const currentOrigin =
    options.origin ||
    (typeof window !== 'undefined' && window.location
      ? window.location.origin
      : '');
  try {
    const parsed = new URL(src, currentOrigin || 'http://localhost');
    if (currentOrigin && parsed.origin === currentOrigin) {
      return { safe: true, reason: 'SAME_ORIGIN_SOURCE' };
    }
    if (node.crossOrigin === 'anonymous' || node.crossOrigin === '') {
      return { safe: true, reason: 'CORS_ENABLED_SOURCE' };
    }
    return { safe: false, reason: 'CROSS_ORIGIN_WITHOUT_CORS' };
  } catch (_) {
    return { safe: false, reason: 'INVALID_SOURCE_URL' };
  }
}

export function extractAudioFeatures(
  timeDomain,
  frequencyData,
  previousLow = 0,
  previousRms = 0
) {
  let sumSquares = 0;
  const tdLength = timeDomain?.length || 0;
  for (let i = 0; i < tdLength; i++) {
    const sample = timeDomain[i];
    sumSquares += sample * sample;
  }
  const rms = tdLength > 0 ? Math.sqrt(sumSquares / tdLength) : 0;

  const freqLength = frequencyData?.length || 0;
  const lowEnd = Math.min(freqLength, 12);
  let lowSum = 0;
  for (let i = 1; i < lowEnd; i++) {
    lowSum += frequencyData[i] / 255;
  }
  const lowEnergy = lowEnd > 1 ? lowSum / (lowEnd - 1) : 0;

  const highStart = Math.min(freqLength, 12);
  const highEnd = Math.min(freqLength, 64);
  let highSum = 0;
  for (let i = highStart; i < highEnd; i++) {
    highSum += frequencyData[i] / 255;
  }
  const highEnergy = highEnd > highStart ? highSum / (highEnd - highStart) : 0;

  const lowFlux = Math.max(0, lowEnergy - previousLow * 1.08);
  const rmsFlux = Math.max(0, rms - previousRms * 1.12);
  const transient = Math.min(1, lowFlux * 0.7 + rmsFlux * 0.6);

  return {
    rms: Math.min(1, rms),
    lowEnergy: Math.min(1, lowEnergy),
    highEnergy: Math.min(1, highEnergy),
    transient,
  };
}

/**
 * Raw WebAudio contract: RMS power plus normalized average FFT magnitude for
 * 20–250, 250–500, 500–2000, 250–4000 and 4000–16000 Hz bands. `available`
 * is true only when these values came from the active analyser buffers.
 */
export function extractRawAudioBands(
  timeDomainData,
  frequencyData,
  sampleRate,
  fftSize
) {
  let sumSquares = 0;
  for (let index = 0; index < timeDomainData.length; index++) {
    const sample = Number(timeDomainData[index]) || 0;
    sumSquares += sample * sample;
  }
  const power = timeDomainData.length
    ? Math.min(1, Math.sqrt(sumSquares / timeDomainData.length))
    : 0;
  const binHz = sampleRate / fftSize;
  const averageBand = (minimum, maximum) => {
    const start = Math.max(1, Math.floor(minimum / binHz));
    const end = Math.min(
      frequencyData.length,
      Math.max(start + 1, Math.ceil(maximum / binHz))
    );
    if (end <= start) return 0;
    let total = 0;
    for (let index = start; index < end; index++)
      total += frequencyData[index] / 255;
    return Math.max(0, Math.min(1, total / (end - start)));
  };
  return {
    available: true,
    power,
    bass: averageBand(20, 250),
    lowMid: averageBand(250, 500),
    mid: averageBand(500, 2000),
    vocal: averageBand(250, 4000),
    treble: averageBand(4000, Math.min(sampleRate / 2, 16000)),
  };
}

export const unavailableAudioFeatures = () => ({
  available: false,
  power: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  vocal: 0,
  treble: 0,
});

export function extractLyricCadenceFeatures(
  lyrics = [],
  position = 0,
  previousCueIndex = -1,
  previousBeatBucket = -1
) {
  const pos = Number.isFinite(position) ? Math.max(0, position) : 0;
  const validLines = Array.isArray(lyrics)
    ? lyrics.filter(
        line =>
          line &&
          Number.isFinite(line.time) &&
          typeof line.content === 'string' &&
          line.content.trim().length > 0
      )
    : [];

  if (!validLines.length) {
    const wave =
      0.5 + 0.35 * Math.sin(pos * 0.22) + 0.15 * Math.sin(pos * 0.09);
    const beatBucket = Math.floor(pos / 1.8);
    const beatHit = beatBucket !== previousBeatBucket && pos >= 3.5;
    const rms = pos < 4 ? 0.07 : 0.11 + wave * 0.11;
    return {
      rms: Math.min(1, rms),
      lowEnergy: Math.min(1, rms * 0.92),
      highEnergy: Math.min(1, rms * 0.78),
      transient: beatHit ? 0.16 : 0.02,
      cueIndex: -1,
      beatBucket,
    };
  }

  let activeIdx = -1;
  for (let i = 0; i < validLines.length; i++) {
    if (validLines[i].time <= pos + 0.08) activeIdx = i;
    else break;
  }

  const firstTime = validLines[0].time;
  const lastTime = validLines[validLines.length - 1].time;
  const totalSpan = Math.max(30, lastTime - firstTime);

  if (activeIdx < 0) {
    return {
      rms: 0.055,
      lowEnergy: 0.05,
      highEnergy: 0.04,
      transient: 0.01,
      cueIndex: -1,
      beatBucket: Math.floor(pos / 2.2),
    };
  }

  const currentLine = validLines[activeIdx];
  const nextLine = validLines[activeIdx + 1] || null;
  const lineGap = nextLine
    ? Math.max(0.6, nextLine.time - currentLine.time)
    : 5.5;
  const elapsedInLine = Math.max(0, pos - currentLine.time);

  if (lineGap >= 8.0 && elapsedInLine >= 4.2) {
    return {
      rms: 0.06,
      lowEnergy: 0.05,
      highEnergy: 0.04,
      transient: 0.015,
      cueIndex: activeIdx,
      beatBucket: Math.floor(pos / 2.0),
    };
  }

  const winStart = pos - 5.5;
  const winEnd = pos + 6.5;
  let nearbyLines = 0;
  let nearbyChars = 0;
  for (let i = 0; i < validLines.length; i++) {
    const t = validLines[i].time;
    if (t >= winStart && t <= winEnd) {
      nearbyLines += 1;
      nearbyChars += validLines[i].content.replace(/\s+/g, '').length;
    }
  }

  const progressRatio = Math.max(0, Math.min(1, (pos - firstTime) / totalSpan));
  const chorusWave =
    (progressRatio >= 0.25 && progressRatio <= 0.46) ||
    (progressRatio >= 0.58 && progressRatio <= 0.86)
      ? 1
      : 0;
  const densityScore = Math.min(
    1.5,
    nearbyLines / 3.2 + nearbyChars / 42 + (lineGap < 2.6 ? 0.32 : 0)
  );
  const baseRms = 0.095 + densityScore * 0.075 + chorusWave * 0.045;
  const linePulse = elapsedInLine < 0.65 ? 0.028 : 0;
  const rms = Math.min(0.45, baseRms + linePulse);
  const lowEnergy = Math.min(
    0.55,
    0.09 + densityScore * 0.09 + chorusWave * 0.06
  );

  const beatInterval =
    densityScore >= 1.05 ? 1.15 : densityScore >= 0.7 ? 1.55 : 2.1;
  const beatBucket = Math.floor(pos / beatInterval);
  const isNewCue = activeIdx !== previousCueIndex && elapsedInLine < 0.45;
  const isBeatTick = beatBucket !== previousBeatBucket;
  const transient = isNewCue
    ? 0.19
    : isBeatTick
    ? Math.min(0.18, 0.09 + densityScore * 0.05)
    : 0.02;

  return {
    rms,
    lowEnergy,
    highEnergy: Math.min(0.5, rms * 0.85),
    transient,
    cueIndex: activeIdx,
    beatBucket,
  };
}

export function createMusicReactionController({
  now = () => Date.now(),
  sensitivity = 'standard',
  calibrationMs = CALIBRATION_DURATION_MS,
  confirmWindowMs = CONFIRM_WINDOW_MS,
  minHoldMs = MIN_MOOD_HOLD_MS,
} = {}) {
  let currentSensitivity = normalizeMusicSensitivity(sensitivity);
  let activeKey = '';
  let state = 'idle';
  let stateEnteredAt = 0;
  let candidateState = null;
  let candidateSince = 0;
  let playAccumulatedMs = 0;
  let lastUpdateAt = 0;
  let lastTrackPosition = null;
  let shortRms = 0;
  let mediumRms = 0;
  let shortLow = 0;
  let baselineRms = 0;
  let baselineSpread = 0.04;
  let calibrationSamples = [];
  let calibrated = false;
  let prevLow = 0;
  let prevRms = 0;
  let beatSeq = 0;
  let burstSeq = 0;
  let lastBeatAt = -Infinity;
  let lastBurstAt = -Infinity;
  let finishedItemKey = '';
  let dialogueStep = 0;
  let lastDialogueRotateAt = 0;

  function resetAnalysisWindow(keepBaseline = false) {
    shortRms = 0;
    mediumRms = 0;
    shortLow = 0;
    prevLow = 0;
    prevRms = 0;
    candidateState = null;
    candidateSince = 0;
    if (!keepBaseline) {
      playAccumulatedMs = 0;
      baselineRms = 0;
      baselineSpread = 0.04;
      calibrationSamples = [];
      calibrated = false;
      dialogueStep = 0;
    }
  }

  function transitionTo(nextState, timestamp, allowBurst = true) {
    if (state === nextState) return;
    state = nextState;
    stateEnteredAt = timestamp;
    lastDialogueRotateAt = timestamp;
    dialogueStep = 0;
    candidateState = null;
    candidateSince = 0;
    const preset = MUSIC_SENSITIVITY_PRESETS[currentSensitivity];
    if (
      allowBurst &&
      (nextState === 'peak' || nextState === 'finished') &&
      (nextState === 'finished' || preset.allowPeakBurst) &&
      timestamp - lastBurstAt >= preset.burstCooldownMs
    ) {
      lastBurstAt = timestamp;
      burstSeq += 1;
    }
  }

  function snapshot(analyzed = false, itemId = '', trackPosition = 0) {
    const def = MUSIC_REACTION_STATES[state] || MUSIC_REACTION_STATES.listening;
    const pool = MUSIC_MOOD_DIALOGUES[state] || [
      { emotion: def.emotion, label: def.label },
    ];
    let keyHash = 0;
    for (let i = 0; i < activeKey.length; i++) {
      keyHash = (keyHash * 31 + activeKey.charCodeAt(i)) >>> 0;
    }
    const chosen =
      dialogueStep === 0 || pool.length <= 1
        ? pool[0]
        : pool[
            1 +
              ((dialogueStep - 1 + (keyHash % (pool.length - 1))) %
                (pool.length - 1))
          ] || pool[0];
    const normIntensity =
      state === 'idle' || state === 'paused'
        ? 0
        : calibrated && baselineRms > 0.005
        ? Math.max(
            0,
            Math.min(
              1,
              (shortRms - baselineRms * 0.5) /
                Math.max(0.05, baselineRms * 1.4 + baselineSpread * 2)
            )
          )
        : Math.max(0, Math.min(1, shortRms * 3));
    return {
      state: def.state,
      emotion: chosen.emotion || def.emotion,
      label: chosen.label || def.label,
      action: def.action,
      intensity: Math.round(normIntensity * 1000) / 1000,
      beatSeq,
      burstSeq,
      analyzed: Boolean(analyzed),
      calibrating: Boolean(activeKey && !calibrated && state === 'listening'),
      sensitivity: currentSensitivity,
      itemId: String(itemId || ''),
      trackPosition: Number.isFinite(trackPosition) ? trackPosition : 0,
    };
  }

  function computeTargetMood(preset, silentAudio) {
    if (silentAudio) return 'listening';
    const scale = preset.thresholdScale;
    const norm =
      baselineRms > 0.005 ? shortRms / Math.max(0.02, baselineRms) : 1;
    const zScore = (shortRms - baselineRms) / Math.max(0.018, baselineSpread);
    const rising = mediumRms > 0.005 ? (shortRms - mediumRms) / mediumRms : 0;

    if (state === 'peak') {
      if (norm >= 1.32 * scale || zScore >= 1.1 * scale) return 'peak';
      return 'cooldown';
    }
    if (state === 'excited') {
      if (
        (norm >= 1.62 * scale || zScore >= 1.85 * scale) &&
        shortLow >= 0.12 * scale
      ) {
        return 'peak';
      }
      if (norm >= 1.14 * scale || zScore >= 0.45 * scale) return 'excited';
      return 'cooldown';
    }
    if (state === 'cooldown') {
      if (norm >= 1.45 * scale || zScore >= 1.35 * scale) return 'excited';
      if (norm >= 0.88 * scale) return 'lively';
      return 'listening';
    }
    if (state === 'lively') {
      if ((norm >= 1.58 * scale || zScore >= 1.75 * scale) && rising >= 0.08) {
        return 'peak';
      }
      if (
        norm >= 1.32 * scale ||
        zScore >= 1.05 * scale ||
        (norm >= 1.15 * scale && rising >= 0.16)
      ) {
        return 'excited';
      }
      if (norm >= 0.72 * scale || zScore >= -0.6) return 'lively';
      return 'listening';
    }
    // From listening
    if (norm >= 1.62 * scale || zScore >= 1.85 * scale) return 'peak';
    if (
      norm >= 1.34 * scale ||
      zScore >= 1.1 * scale ||
      (norm >= 1.16 * scale && rising >= 0.18)
    ) {
      return 'excited';
    }
    if (norm >= 0.88 * scale && shortRms >= 0.015) return 'lively';
    return 'listening';
  }

  return {
    setSensitivity(value) {
      currentSensitivity = normalizeMusicSensitivity(value);
      return currentSensitivity;
    },
    getSensitivity() {
      return currentSensitivity;
    },
    markFinished({ itemId = '', trackId = '', timestamp = now() } = {}) {
      const key = `${itemId || ''}:${trackId || ''}`;
      if (!key || key === ':') return snapshot(false, itemId, 0);
      finishedItemKey = key;
      transitionTo('finished', timestamp, true);
      return snapshot(false, itemId, lastTrackPosition || 0);
    },
    reset() {
      activeKey = '';
      state = 'idle';
      stateEnteredAt = 0;
      lastUpdateAt = 0;
      lastTrackPosition = null;
      finishedItemKey = '';
      resetAnalysisWindow(false);
    },
    update(input = {}) {
      const timestamp = Number.isFinite(input.now) ? input.now : now();
      if (input.sensitivity) {
        currentSensitivity = normalizeMusicSensitivity(input.sensitivity);
      }
      const itemId = String(input.itemId || '');
      const trackId = String(input.trackId || '');
      const hasTrack = Boolean(itemId || trackId || input.hasTrack);
      const key = hasTrack ? `${itemId}:${trackId}` : '';
      const playing = Boolean(input.playing && hasTrack);
      const trackPosition = Number.isFinite(input.position)
        ? Math.max(0, input.position)
        : 0;
      const dt =
        lastUpdateAt > 0
          ? Math.max(0, Math.min(2000, timestamp - lastUpdateAt))
          : 50;
      lastUpdateAt = timestamp;

      if (!hasTrack) {
        if (state !== 'idle') {
          activeKey = '';
          lastTrackPosition = null;
          resetAnalysisWindow(false);
          transitionTo('idle', timestamp, false);
        }
        return snapshot(false, '', 0);
      }

      if (key !== activeKey) {
        activeKey = key;
        finishedItemKey = '';
        lastTrackPosition = trackPosition;
        resetAnalysisWindow(false);
        transitionTo(playing ? 'listening' : 'paused', timestamp, false);
      } else if (
        lastTrackPosition !== null &&
        playing &&
        Math.abs(trackPosition - lastTrackPosition) >
          SEEK_RESET_THRESHOLD_SEC + dt / 1000
      ) {
        resetAnalysisWindow(calibrated);
      }
      lastTrackPosition = trackPosition;

      if (!playing) {
        if (finishedItemKey === key && state === 'finished') {
          return snapshot(false, itemId, trackPosition);
        }
        if (state !== 'paused') {
          candidateState = null;
          candidateSince = 0;
          transitionTo('paused', timestamp, false);
        } else if (
          timestamp - lastDialogueRotateAt >=
          DIALOGUE_ROTATE_INTERVAL_MS * 1.4
        ) {
          lastDialogueRotateAt = timestamp;
          dialogueStep += 1;
        }
        return snapshot(false, itemId, trackPosition);
      }

      finishedItemKey = '';
      if (state === 'idle' || state === 'paused' || state === 'finished') {
        transitionTo('listening', timestamp, false);
      }

      const analyzed = input.analyzed === true;
      const muted =
        input.muted === true ||
        (Number.isFinite(input.volume) && input.volume <= 0);
      const preset = MUSIC_SENSITIVITY_PRESETS[currentSensitivity];

      if (!analyzed) {
        playAccumulatedMs += dt;
        const fallbackTarget =
          !muted && playAccumulatedMs >= calibrationMs ? 'lively' : 'listening';
        if (
          fallbackTarget !== state &&
          timestamp - stateEnteredAt >= minHoldMs
        ) {
          transitionTo(fallbackTarget, timestamp, false);
        } else if (
          !muted &&
          timestamp - lastDialogueRotateAt >= DIALOGUE_ROTATE_INTERVAL_MS
        ) {
          lastDialogueRotateAt = timestamp;
          dialogueStep += 1;
        }
        return snapshot(false, itemId, trackPosition);
      }

      const rawRms = muted
        ? 0
        : Math.max(0, Math.min(1, Number(input.rms) || 0));
      const rawLow = muted
        ? 0
        : Math.max(0, Math.min(1, Number(input.lowEnergy) || 0));
      const transient = muted
        ? 0
        : Number.isFinite(input.transient)
        ? Math.max(0, Math.min(1, input.transient))
        : Math.max(
            0,
            (rawLow - prevLow * 1.08) * 0.7 + (rawRms - prevRms * 1.12) * 0.6
          );
      prevLow = rawLow;
      prevRms = rawRms;

      const shortAlpha = Math.min(1, dt / 350);
      const medAlpha = Math.min(1, dt / 2400);
      shortRms =
        shortRms === 0 ? rawRms : shortRms + (rawRms - shortRms) * shortAlpha;
      mediumRms =
        mediumRms === 0 ? rawRms : mediumRms + (rawRms - mediumRms) * medAlpha;
      shortLow =
        shortLow === 0 ? rawLow : shortLow + (rawLow - shortLow) * shortAlpha;

      const silentAudio = muted || shortRms < 0.004;

      if (
        !silentAudio &&
        transient >= preset.transientThreshold &&
        timestamp - lastBeatAt >= preset.beatCooldownMs
      ) {
        lastBeatAt = timestamp;
        beatSeq += 1;
      }

      playAccumulatedMs += dt;

      if (!calibrated) {
        if (!silentAudio && rawRms > 0.004) {
          calibrationSamples.push(rawRms);
        }
        if (playAccumulatedMs >= calibrationMs) {
          calibrated = true;
          if (calibrationSamples.length >= 4) {
            const mean =
              calibrationSamples.reduce((sum, v) => sum + v, 0) /
              calibrationSamples.length;
            const variance =
              calibrationSamples.reduce(
                (sum, v) => sum + (v - mean) * (v - mean),
                0
              ) / calibrationSamples.length;
            baselineRms = Math.max(0.02, mean);
            baselineSpread = Math.max(0.018, Math.sqrt(variance));
          } else {
            baselineRms = Math.max(0.04, shortRms || 0.08);
            baselineSpread = 0.03;
          }
          calibrationSamples = [];
        }
        return snapshot(true, itemId, trackPosition);
      }

      if (!silentAudio) {
        const diff = Math.abs(shortRms - baselineRms);
        baselineRms += (shortRms - baselineRms) * 0.008;
        baselineSpread = Math.max(
          0.018,
          baselineSpread + (diff - baselineSpread) * 0.01
        );
      }

      const MOOD_RANK = {
        idle: 0,
        paused: 0,
        listening: 1,
        cooldown: 2,
        lively: 2,
        excited: 3,
        peak: 4,
      };
      const desiredState = computeTargetMood(preset, silentAudio);
      if (desiredState === state) {
        candidateState = null;
        candidateSince = 0;
      } else {
        const currentRank = MOOD_RANK[state] ?? 1;
        const prevDir =
          candidateState === null
            ? 0
            : Math.sign((MOOD_RANK[candidateState] ?? 1) - currentRank);
        const nextDir = Math.sign((MOOD_RANK[desiredState] ?? 1) - currentRank);
        if (candidateState === null || prevDir !== nextDir) {
          candidateState = desiredState;
          candidateSince = timestamp;
        } else {
          candidateState = desiredState;
          if (
            timestamp - candidateSince >= confirmWindowMs &&
            timestamp - stateEnteredAt >= minHoldMs
          ) {
            transitionTo(desiredState, timestamp, true);
          }
        }
      }

      if (
        !silentAudio &&
        calibrated &&
        timestamp - lastDialogueRotateAt >= DIALOGUE_ROTATE_INTERVAL_MS
      ) {
        lastDialogueRotateAt = timestamp;
        dialogueStep += 1;
      }

      return snapshot(true, itemId, trackPosition);
    },
  };
}

const mediaElementTaps = new WeakMap();

export function createPlayerMusicAnalyzer({
  getPlayer,
  getCurrentItem = () => null,
  getLyrics = () => [],
  getOutputDevice = () => '',
  onUpdate = () => {},
  onAudioFeatures = null,
  sampleIntervalMs = 50,
  now = () => Date.now(),
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  const controller = createMusicReactionController({ now });
  let timer = null;
  let sharedAudioContext = null;
  const timeDomainBuffer = new Float32Array(256);
  const byteTimeDomainBuffer = new Uint8Array(256);
  const frequencyBuffer = new Uint8Array(128);
  let previousLow = 0;
  let previousRms = 0;
  let previousCueIndex = -1;
  let previousBeatBucket = -1;
  let lastTrackKey = '';
  let latestSnapshot = controller.update({ hasTrack: false });

  function getAudioContext() {
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
      return sharedAudioContext;
    }
    const AudioCtx =
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AudioCtx) return null;
    try {
      sharedAudioContext = new AudioCtx();
      return sharedAudioContext;
    } catch (_) {
      return null;
    }
  }

  function resolveAnalyserForNode(node) {
    const check = canSafelyTapMediaElement(node, {
      outputDevice: getOutputDevice(),
    });
    if (!check.safe) return null;
    const existing = mediaElementTaps.get(node);
    if (existing) {
      if (existing.context.state === 'suspended') {
        existing.context.resume?.().catch?.(() => {});
      }
      return existing.analyser;
    }
    const context = getAudioContext();
    if (!context) return null;
    try {
      if (context.state === 'suspended') {
        context.resume?.().catch?.(() => {});
      }
      const sourceNode = context.createMediaElementSource(node);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      sourceNode.connect(analyser);
      analyser.connect(context.destination);
      const tap = { context, sourceNode, analyser };
      mediaElementTaps.set(node, tap);
      return analyser;
    } catch (_) {
      return null;
    }
  }

  function tick() {
    const player = typeof getPlayer === 'function' ? getPlayer() : null;
    const item = typeof getCurrentItem === 'function' ? getCurrentItem() : null;
    const track = player?.currentTrack;
    const itemId = item?.queueItemId || '';
    const trackId = item?.trackId || track?.id || '';
    const hasTrack = Boolean(itemId || trackId);
    const trackKey = hasTrack ? `${itemId}:${trackId}` : '';
    if (trackKey !== lastTrackKey) {
      lastTrackKey = trackKey;
      previousCueIndex = -1;
      previousBeatBucket = -1;
    }
    const playing = Boolean(hasTrack && player?.playing);
    const position = playing
      ? Number(player?.seek?.(null, false) ?? player?.progress ?? 0) || 0
      : Number(player?.progress ?? 0) || 0;
    const volume = Number.isFinite(player?.volume) ? player.volume : 1;
    const muted = volume <= 0;

    let features = {
      analyzed: false,
      rms: 0,
      lowEnergy: 0,
      highEnergy: 0,
      transient: 0,
    };
    let rawAudioFeatures = unavailableAudioFeatures();

    if (playing && !muted) {
      const node = player?._howler?._sounds?.[0]?._node;
      const sourceActive = node?.ended !== true && node?.paused !== true;
      const analyser = sourceActive ? resolveAnalyserForNode(node) : null;
      let usedWebAudio = false;
      if (analyser && sharedAudioContext?.state === 'running') {
        try {
          if (typeof analyser.getFloatTimeDomainData === 'function') {
            analyser.getFloatTimeDomainData(timeDomainBuffer);
          } else {
            analyser.getByteTimeDomainData(byteTimeDomainBuffer);
            for (let i = 0; i < byteTimeDomainBuffer.length; i++) {
              timeDomainBuffer[i] = (byteTimeDomainBuffer[i] - 128) / 128;
            }
          }
          analyser.getByteFrequencyData(frequencyBuffer);
          rawAudioFeatures = extractRawAudioBands(
            timeDomainBuffer,
            frequencyBuffer,
            Number(sharedAudioContext?.sampleRate) || 44100,
            Number(analyser.fftSize) || 256
          );
          const extracted = extractAudioFeatures(
            timeDomainBuffer,
            frequencyBuffer,
            previousLow,
            previousRms
          );
          if (extracted.rms > 0.002 || extracted.lowEnergy > 0.002) {
            previousLow = extracted.lowEnergy;
            previousRms = extracted.rms;
            features = { analyzed: true, ...extracted };
            usedWebAudio = true;
          }
        } catch (_) {
          rawAudioFeatures = unavailableAudioFeatures();
          usedWebAudio = false;
        }
      }
      if (!usedWebAudio) {
        const lyrics = typeof getLyrics === 'function' ? getLyrics() : [];
        const cadence = extractLyricCadenceFeatures(
          lyrics,
          position,
          previousCueIndex,
          previousBeatBucket
        );
        previousCueIndex = cadence.cueIndex;
        previousBeatBucket = cadence.beatBucket;
        previousLow = cadence.lowEnergy;
        previousRms = cadence.rms;
        features = {
          analyzed: true,
          rms: cadence.rms,
          lowEnergy: cadence.lowEnergy,
          highEnergy: cadence.highEnergy,
          transient: cadence.transient,
        };
      }
    } else {
      previousLow = 0;
      previousRms = 0;
    }

    latestSnapshot = controller.update({
      now: now(),
      itemId,
      trackId,
      hasTrack,
      playing,
      position,
      volume,
      muted,
      ...features,
    });
    if (typeof onAudioFeatures === 'function')
      onAudioFeatures(rawAudioFeatures);
    onUpdate(latestSnapshot);
    return latestSnapshot;
  }

  return {
    start() {
      if (timer !== null) return;
      tick();
      timer = schedule(tick, sampleIntervalMs);
    },
    stop() {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    },
    tick,
    markFinished(detail) {
      latestSnapshot = controller.markFinished(detail);
      onUpdate(latestSnapshot);
      return latestSnapshot;
    },
    setSensitivity(value) {
      return controller.setSensitivity(value);
    },
    getSnapshot() {
      return latestSnapshot;
    },
    dispose() {
      this.stop();
      controller.reset();
    },
  };
}
