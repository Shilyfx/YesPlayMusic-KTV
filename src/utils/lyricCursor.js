export function findLyricIndex(lines, progress, previousIndex = -1) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  if (progress < lines[0].time) return -1;

  let index = previousIndex;
  if (index < 0 || index >= lines.length || progress < lines[index].time) {
    let low = 0;
    let high = lines.length - 1;
    index = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (progress >= lines[middle].time) {
        index = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return index;
  }

  while (index + 1 < lines.length && progress >= lines[index + 1].time)
    index += 1;
  return index;
}

export default findLyricIndex;
