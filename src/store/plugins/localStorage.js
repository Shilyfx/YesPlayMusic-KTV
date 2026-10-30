import { safeJsonWrite } from '@/utils/safeStorage';

const SETTINGS_MUTATIONS = new Set([
  'changeLang',
  'changeMusicQuality',
  'changeLyricFontSize',
  'changeOutputDevice',
  'updateSettings',
  'togglePlaylistCategory',
  'updateShortcut',
  'restoreDefaultShortcuts',
]);
const DATA_MUTATIONS = new Set(['updateData']);
const WRITE_DELAY = 250;

export default store => {
  let settingsTimer;
  let dataTimer;
  let settingsPending = false;
  let dataPending = false;
  let pendingSettings;
  let pendingData;

  const flushSettings = () => {
    clearTimeout(settingsTimer);
    settingsTimer = null;
    if (!settingsPending) return;
    settingsPending = false;
    safeJsonWrite('settings', pendingSettings);
    pendingSettings = undefined;
  };
  const flushData = () => {
    clearTimeout(dataTimer);
    dataTimer = null;
    if (!dataPending) return;
    dataPending = false;
    safeJsonWrite('data', pendingData);
    pendingData = undefined;
  };
  const flushPendingWrites = () => {
    flushSettings();
    flushData();
  };

  const scheduleSettingsWrite = state => {
    clearTimeout(settingsTimer);
    pendingSettings = state.settings;
    settingsPending = true;
    settingsTimer = setTimeout(flushSettings, WRITE_DELAY);
  };
  const scheduleDataWrite = state => {
    clearTimeout(dataTimer);
    pendingData = state.data;
    dataPending = true;
    dataTimer = setTimeout(flushData, WRITE_DELAY);
  };

  store.subscribe((mutation, state) => {
    if (SETTINGS_MUTATIONS.has(mutation.type)) scheduleSettingsWrite(state);
    if (DATA_MUTATIONS.has(mutation.type)) scheduleDataWrite(state);
  });

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', flushPendingWrites);
    window.addEventListener('beforeunload', flushPendingWrites);
  }
};

export { SETTINGS_MUTATIONS, DATA_MUTATIONS };
