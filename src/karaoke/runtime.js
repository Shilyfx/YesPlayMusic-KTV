import KaraokeManager from './KaraokeManager';
import KaraokePlayerAdapter from './KaraokePlayerAdapter';

export function createKaraokeRuntime(player, store) {
  const manager = new KaraokeManager(new KaraokePlayerAdapter(player));
  manager.subscribe(karaoke => store.commit('replaceKaraokeState', karaoke));
  return manager;
}
