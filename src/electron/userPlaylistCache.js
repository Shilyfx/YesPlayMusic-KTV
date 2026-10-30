const DEFAULT_TTL = 45 * 1000;

export default function createUserPlaylistCache(ttl = DEFAULT_TTL) {
  let uid = '';
  let expiresAt = 0;
  let playlists = [];
  let promise = null;

  return async function getPlaylists({
    userId,
    fetchPlaylists,
    force = false,
  }) {
    const key = String(userId || '');
    if (!key) throw new Error('HOST_NOT_LOGGED_IN');
    if (promise && uid === key) return promise;
    if (!force && uid === key && expiresAt > Date.now()) return playlists;

    uid = key;
    expiresAt = 0;
    const request = (async () => {
      const nextPlaylists = await fetchPlaylists();
      const result = Array.isArray(nextPlaylists) ? nextPlaylists : [];
      if (uid === key && promise === request) {
        playlists = result;
        expiresAt = Date.now() + ttl;
      }
      return result;
    })();
    promise = request;
    return request.finally(() => {
      if (promise === request) promise = null;
    });
  };
}
