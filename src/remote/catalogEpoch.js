const GENERATION_KEYS = [
  'search',
  'playlists',
  'playlistTracks',
  'recommendations',
  'recommendationTracks',
  'toplists',
  'toplistTracks',
];

export default function invalidateRemoteCatalogState(state, nextEpoch) {
  if (
    !Number.isSafeInteger(nextEpoch) ||
    nextEpoch < 0 ||
    state.catalogEpoch === nextEpoch ||
    (Number.isSafeInteger(state.catalogEpoch) && nextEpoch < state.catalogEpoch)
  )
    return null;

  const generations = {};
  GENERATION_KEYS.forEach(key => {
    const current = state.generations[key];
    generations[key] =
      (Number.isSafeInteger(current) && current >= 0 ? current : 0) + 1;
  });

  return {
    catalogEpoch: nextEpoch,
    generations,
    searchResults: [],
    playlists: [],
    playlistsLoaded: false,
    selectedPlaylistId: '',
    playlistTracks: [],
    recommendations: [],
    recommendationsLoaded: false,
    selectedRecommendationId: '',
    recommendationTracks: [],
    toplists: [],
    toplistsLoaded: false,
    selectedToplistId: '',
    toplistTracks: [],
    chartView: 'lists',
  };
}
