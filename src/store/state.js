import initLocalStorage from './initLocalStorage';
import pkg from '../../package.json';
import updateApp from '@/utils/updateApp';
import {
  isData,
  isLastfm,
  isPlayer,
  isSettings,
  safeJsonRead,
} from '@/utils/safeStorage';

if (localStorage.getItem('appVersion') === null) {
  localStorage.setItem('settings', JSON.stringify(initLocalStorage.settings));
  localStorage.setItem('data', JSON.stringify(initLocalStorage.data));
  localStorage.setItem('appVersion', pkg.version);
}

updateApp();

const persistedSettings = safeJsonRead(
  'settings',
  initLocalStorage.settings,
  isSettings
);
const persistedData = safeJsonRead('data', initLocalStorage.data, isData);

export default {
  showLyrics: false,
  enableScrolling: true,
  title: 'YesPlayMusic',
  liked: {
    songs: [],
    songsWithDetails: [], // 只有前12首
    playlists: [],
    albums: [],
    artists: [],
    mvs: [],
    cloudDisk: [],
    playHistory: {
      weekData: [],
      allData: [],
    },
  },
  contextMenu: {
    clickObjectID: 0,
    showMenu: false,
  },
  toast: {
    show: false,
    text: '',
    timer: null,
  },
  modals: {
    addTrackToPlaylistModal: {
      show: false,
      selectedTrackID: 0,
    },
    newPlaylistModal: {
      show: false,
      afterCreateAddTrackID: 0,
    },
  },
  dailyTracks: [],
  lastfm: safeJsonRead('lastfm', {}, isLastfm),
  player: safeJsonRead('player', {}, isPlayer),
  karaoke: {
    session: { status: 'idle' },
    currentItem: null,
    waitingItems: [],
    historyItems: [],
    queueCount: 0,
  },
  // Merge persisted values with the current defaults so upgrades cannot
  // leave newly introduced settings undefined. Nested proxy settings are
  // merged independently for the same reason.
  settings: {
    ...initLocalStorage.settings,
    ...persistedSettings,
    proxyConfig: {
      ...initLocalStorage.settings.proxyConfig,
      ...(persistedSettings.proxyConfig || {}),
    },
  },
  data: { ...initLocalStorage.data, ...persistedData },
};
