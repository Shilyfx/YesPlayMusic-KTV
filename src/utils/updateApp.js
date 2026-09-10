import initLocalStorage from '@/store/initLocalStorage.js';
import pkg from '../../package.json';
import { safeJsonRead, safeJsonWrite } from './safeStorage';

const KTV_FONT_DEFAULT_MIGRATION_KEY = 'ktvLyricFontSizeDefaultV1';

const updateSetting = () => {
  const parsedSettings = safeJsonRead('settings', {});
  const settings = {
    ...initLocalStorage.settings,
    ...parsedSettings,
  };

  if (
    settings.shortcuts.length !== initLocalStorage.settings.shortcuts.length
  ) {
    // 当新增 shortcuts 时
    const oldShortcutsId = settings.shortcuts.map(s => s.id);
    const newShortcutsId = initLocalStorage.settings.shortcuts.filter(
      s => oldShortcutsId.includes(s.id) === false
    );
    newShortcutsId.map(id => {
      settings.shortcuts.push(
        initLocalStorage.settings.shortcuts.find(s => s.id === id)
      );
    });
  }

  if (localStorage.getItem('appVersion') === '"0.3.9"') {
    settings.lyricsBackground = true;
  }

  // 28px was the shipped KTV default before the stage controls were made
  // directly editable. Migrate only that legacy default once, preserving any
  // size the user has already chosen.
  if (localStorage.getItem(KTV_FONT_DEFAULT_MIGRATION_KEY) !== '1') {
    if (settings.lyricFontSize === 28)
      settings.lyricFontSize = initLocalStorage.settings.lyricFontSize;
    localStorage.setItem(KTV_FONT_DEFAULT_MIGRATION_KEY, '1');
  }

  safeJsonWrite('settings', settings);
};

const updateData = () => {
  const parsedData = safeJsonRead('data', {});
  const data = { ...parsedData };
  [
    '_playbackOwner',
    '_playbackEndedListeners',
    '_playbackErrorListeners',
    '_karaokeCommandHandlers',
    '_karaokePlaybackGeneration',
    '_karaokePlaybackPending',
  ].forEach(key => delete data[key]);
  safeJsonWrite('data', data);
};

export const updatePlayer = () => {
  let parsedData = safeJsonRead('player', {});
  let appVersion = localStorage.getItem('appVersion');
  if (appVersion === `"0.2.5"`) parsedData = {}; // 0.2.6版本重构了player
  const data = {
    ...parsedData,
  };
  [
    '_playbackOwner',
    '_playbackEndedListeners',
    '_playbackErrorListeners',
    '_karaokeCommandHandlers',
    '_karaokePlaybackGeneration',
    '_karaokePlaybackPending',
  ].forEach(key => delete data[key]);
  safeJsonWrite('player', data);
};

const removeOldStuff = () => {
  // remove old indexedDB databases created by localforage
  indexedDB.deleteDatabase('tracks');
};

export default function () {
  updateSetting();
  updateData();
  updatePlayer();
  removeOldStuff();
  localStorage.setItem('appVersion', JSON.stringify(pkg.version));
}
