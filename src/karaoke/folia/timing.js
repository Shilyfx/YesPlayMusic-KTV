// Convert our lyric document into Folia's input contract. A plain LRC line is
// one timed unit. Explicit shared glyph cues prevent Folia from inventing an
// evenly spaced syllable timeline across pauses and uneven singing.
const documents = new WeakMap();
const graphemes =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
export function memoizedPvDocument(itemId, duration, lines) {
  const previous = documents.get(lines);
  if (previous?.itemId === itemId && previous.duration === duration)
    return previous.document;
  const document = Object.freeze({ itemId, duration, lines });
  documents.set(lines, { itemId, duration, document });
  return document;
}

export function toFoliaLines(document) {
  const source = document?.lines || [];
  const result = [];
  let nextTime = Number(document?.duration) || 0;
  let groupStart = Infinity;
  for (let index = source.length - 1; index >= 0; index--) {
    const line = source[index];
    const start = Number(line.time);
    if (!Number.isFinite(start) || start < 0 || !line.content) continue;
    if (start < groupStart) {
      if (Number.isFinite(groupStart)) nextTime = groupStart;
      groupStart = start;
    }
    const end = nextTime > start ? nextTime : start + 5;
    const text = String(line.content);
    const authored =
      Array.isArray(line.words) &&
      line.words.length &&
      line.words.every(
        word =>
          typeof word.text === 'string' &&
          Number.isFinite(word.startTime) &&
          Number.isFinite(word.endTime) &&
          word.startTime >= start &&
          word.endTime >= word.startTime &&
          word.endTime <= end
      );
    result.push({
      id: `${document.itemId || 'song'}:${index}`,
      startTime: start,
      endTime: end,
      fullText: text,
      words: authored
        ? line.words.map(word => ({ ...word }))
        : [
            {
              text,
              startTime: start,
              endTime: end,
              syllables: (graphemes
                ? Array.from(graphemes.segment(text), part => part.segment)
                : Array.from(text)
              ).map(text => ({ text, startTime: start, endTime: end })),
            },
          ],
      // Keep un-timed LRC together through the original semantic shot compiler.
      ...(!authored ? { wordSegments: [text] } : {}),
      isChorus: false,
    });
  }
  return result.reverse();
}

export function createPvClock(now = () => performance.now()) {
  let anchor = 0,
    received = now(),
    playing = false;
  return {
    set(position, active) {
      anchor = Math.max(0, Number(position) || 0);
      received = now();
      playing = Boolean(active);
    },
    get() {
      return (
        anchor +
        (playing ? Math.min(0.5, Math.max(0, now() - received) / 1000) : 0)
      );
    },
  };
}
