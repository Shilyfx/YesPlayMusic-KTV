import KaraokeManager from './KaraokeManager';
import KaraokePlayerAdapter from './KaraokePlayerAdapter';
import { createKaraokeQueueRecovery } from './KaraokeQueueRecovery';

export function createKaraokeRuntime(player, store) {
  let sessionStorage = null;
  try {
    sessionStorage =
      typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (_) {
    // Storage can be unavailable in restricted browser contexts.
  }
  const manager = new KaraokeManager(new KaraokePlayerAdapter(player), {
    recoveryStorage: createKaraokeQueueRecovery(sessionStorage),
  });
  manager.subscribe(karaoke => store.commit('replaceKaraokeState', karaoke));
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () =>
      manager.preserveRecoveryForPageHide()
    );
    window.addEventListener('pageshow', event => {
      if (event.persisted) manager.resumeAfterPageShow();
    });
  }
  return manager;
}
