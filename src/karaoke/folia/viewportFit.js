// Keep the readable foreground inside a margin without enlarging small text.
// Coordinates are in the canvas viewport, including scene transitions.
export function fitViewport(bounds, origin, width, height) {
  const margin = Math.min(width, height) * 0.04;
  const scale = Math.min(
    1,
    (width - margin * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - margin * 2) / Math.max(1, bounds.maxY - bounds.minY)
  );
  const minX = origin.x + (bounds.minX - origin.x) * scale;
  const maxX = origin.x + (bounds.maxX - origin.x) * scale;
  const minY = origin.y + (bounds.minY - origin.y) * scale;
  const maxY = origin.y + (bounds.maxY - origin.y) * scale;
  const shift = (min, max, limit) =>
    min < margin
      ? margin - min
      : max > limit - margin
      ? limit - margin - max
      : 0;
  return { scale, x: shift(minX, maxX, width), y: shift(minY, maxY, height) };
}
