// Leave room for the rolling presentation and queue inside the 1 MiB host body.
export const LYRIC_DOCUMENT_MAX_BYTES = 768 * 1024;

// Times and duration use seconds, as does the existing presentation transport.
// Call only for a new document; callers cache by identity/revision on heartbeats.
export function sanitizeLyricDocument(value) {
  const invalid = () => {
    throw new Error('INVALID_PV_LYRICS');
  };
  if (
    !value ||
    typeof value.itemId !== 'string' ||
    !value.itemId.trim() ||
    value.itemId.length > 160 ||
    !Number.isFinite(value.duration) ||
    value.duration < 0 ||
    value.duration > 86400
  )
    invalid();
  const source = value.lines;
  if (!Array.isArray(source) || source.length > 10000) invalid();
  let previous = 0;
  const lines = source.map(line => {
    if (
      !line ||
      !Number.isFinite(line.time) ||
      line.time < previous ||
      line.time > value.duration ||
      typeof line.content !== 'string' ||
      line.content.length > 4096
    )
      invalid();
    previous = line.time;
    return Object.freeze({ time: line.time, content: line.content });
  });
  const document = Object.freeze({
    itemId: value.itemId,
    duration: value.duration,
    lines: Object.freeze(lines),
  });
  if (
    new TextEncoder().encode(JSON.stringify(document)).length >
    LYRIC_DOCUMENT_MAX_BYTES
  )
    invalid();
  return document;
}
