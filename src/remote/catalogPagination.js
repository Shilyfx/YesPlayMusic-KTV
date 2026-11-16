export function createCatalogPageState() {
  return {
    nextOffset: 0,
    hasMore: false,
    total: null,
    requestedCount: 0,
    unavailableCount: 0,
    loading: false,
    error: null,
    retryAfterMs: 0,
  };
}

export function appendCatalogItems(currentItems, nextItems, getId) {
  const existing = Array.isArray(currentItems) ? currentItems : [];
  const incoming = Array.isArray(nextItems) ? nextItems : [];
  const identify = getId || (item => item?.trackId || item?.id || '');
  const seen = new Set(
    existing.map(item => String(identify(item) || '')).filter(Boolean)
  );
  const merged = [...existing];
  incoming.forEach(item => {
    const id = String(identify(item) || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(item);
  });
  return merged;
}

export function catalogPageProgress(page, offset, limit) {
  const items = Array.isArray(page?.tracks)
    ? page.tracks
    : Array.isArray(page?.playlists)
    ? page.playlists
    : [];
  const requestedCount =
    Number.isSafeInteger(page?.requestedCount) && page.requestedCount >= 0
      ? page.requestedCount
      : items.length;
  const nextOffset =
    Number.isSafeInteger(page?.nextOffset) && page.nextOffset >= offset
      ? page.nextOffset
      : offset + requestedCount;
  const total =
    Number.isSafeInteger(page?.total) && page.total >= 0 ? page.total : null;
  return {
    nextOffset,
    requestedCount,
    unavailableCount:
      Number.isSafeInteger(page?.unavailableCount) && page.unavailableCount >= 0
        ? page.unavailableCount
        : 0,
    total,
    hasMore:
      typeof page?.hasMore === 'boolean'
        ? page.hasMore
        : requestedCount >= limit,
  };
}
