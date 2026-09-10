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

  const scheduleSettingsWrite = state => {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(
      () => safeJsonWrite('settings', state.settings),
      WRITE_DELAY
    );
  };
  const scheduleDataWrite = state => {
    clearTimeout(dataTimer);
    dataTimer = setTimeout(
      () => safeJsonWrite('data', state.data),
      WRITE_DELAY
    );
  };

  store.subscribe((mutation, state) => {
    if (SETTINGS_MUTATIONS.has(mutation.type)) scheduleSettingsWrite(state);
    if (DATA_MUTATIONS.has(mutation.type)) scheduleDataWrite(state);
  });
};

export { SETTINGS_MUTATIONS, DATA_MUTATIONS };
