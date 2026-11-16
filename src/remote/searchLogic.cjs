function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function findLocalTracks(query, localPlaylists = []) {
  const clean = normalizeSearchText(query);
  if (!clean) return [];
  const matches = [];
  const seen = new Set();

  localPlaylists.forEach(playlist => {
    (playlist.tracks || []).forEach(track => {
      const trackId = String(track.trackId || track.id || '');
      if (!trackId || seen.has(trackId)) return;
      const trackName = normalizeSearchText(track.name);
      const trackArtists = (track.artists || track.ar || []).map(item =>
        normalizeSearchText(typeof item === 'string' ? item : item && item.name)
      );
      const trackAlbum = normalizeSearchText(track.album);

      const nameMatch =
        trackName && (trackName.includes(clean) || clean.includes(trackName));
      const artistMatch = trackArtists.some(
        name => name && (name.includes(clean) || clean.includes(name))
      );
      const albumMatch =
        trackAlbum &&
        (trackAlbum.includes(clean) || clean.includes(trackAlbum));

      if (nameMatch || artistMatch || albumMatch) {
        seen.add(trackId);
        matches.push({ ...track, source: 'local' });
      }
    });
  });

  return matches;
}

function mergeSearchResults(localMatches, remoteResults) {
  const seen = new Set();
  const merged = [];
  (localMatches || []).forEach(track => {
    const trackId = String(track.trackId || track.id || '');
    if (!trackId || seen.has(trackId)) return;
    seen.add(trackId);
    merged.push({ ...track, source: 'local' });
  });
  (remoteResults || []).forEach(track => {
    const trackId = String(track.trackId || track.id || '');
    if (!trackId || seen.has(trackId)) return;
    seen.add(trackId);
    merged.push(track);
  });
  return merged;
}

function buildSearchRequest(query, signal) {
  return {
    path: `/search?q=${encodeURIComponent(query)}`,
    options: { signal },
  };
}

function getSearchResults(response) {
  return response.results;
}

function getSearchRenderState(query, results, searching = false) {
  if (searching) return { state: 'searching', message: '正在搜索…' };
  if (!results.length) {
    return {
      state: 'empty',
      message: String(query || '').trim()
        ? '没有找到可展示的歌曲。'
        : '输入关键词后点击搜索或按回车点歌。',
    };
  }
  return { state: 'results', results };
}

module.exports = {
  buildSearchRequest,
  findLocalTracks,
  getSearchRenderState,
  getSearchResults,
  mergeSearchResults,
  normalizeSearchText,
};
