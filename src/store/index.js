import Vue from 'vue';
import Vuex from 'vuex';
import state from './state';
import mutations from './mutations';
import actions from './actions';
import {
  changeAppearance,
  changeThemeColor,
  configureCommonStore,
} from '@/utils/common';
import { configureTrackStore } from '@/api/track';
import Player, { configurePlayerStore } from '@/utils/Player';
import { createKaraokeRuntime } from '@/karaoke/runtime';
// vuex 自定义插件
import saveToLocalStorage from './plugins/localStorage';
import { getSendSettingsPlugin } from './plugins/sendSettings';
import { configureCachePolicy, initTracksCacheBytes } from '@/utils/db';
import { configureAuthStore } from '@/utils/auth';

const PLAYER_PERSISTED_KEYS = new Set([
  '_enabled',
  '_repeatMode',
  '_shuffle',
  '_reversed',
  '_volume',
  '_volumeBeforeMuted',
  '_list',
  '_current',
  '_shuffledList',
  '_shuffledCurrent',
  '_playlistSource',
  '_currentTrack',
  '_playNextList',
  '_isPersonalFM',
  '_personalFMTrack',
  '_personalFMNextTrack',
]);
const PLAYER_IPC_KEYS = new Set(['_playing', '_currentTrack']);

Vue.use(Vuex);

let plugins = [saveToLocalStorage];
if (process.env.IS_ELECTRON === true) {
  let sendSettings = getSendSettingsPlugin();
  plugins.push(sendSettings);
}
const options = {
  state,
  mutations,
  actions,
  plugins,
};

const store = new Vuex.Store(options);

configureAuthStore(store);
configurePlayerStore(store);
configureCommonStore(store);
configureTrackStore(store);
configureCachePolicy(store.state.settings);
if (process.env.IS_ELECTRON === true) initTracksCacheBytes();

if ([undefined, null].includes(store.state.settings.lang)) {
  const defaultLang = 'en';
  const langMapper = new Map()
    .set('zh', 'zh-CN')
    .set('zh-TW', 'zh-TW')
    .set('en', 'en')
    .set('tr', 'tr');
  store.state.settings.lang =
    langMapper.get(
      langMapper.has(navigator.language)
        ? navigator.language
        : navigator.language.slice(0, 2)
    ) || defaultLang;
  localStorage.setItem('settings', JSON.stringify(store.state.settings));
}

changeAppearance(store.state.settings.appearance);
changeThemeColor(store.state.settings.themeColor);

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => {
    if (store.state.settings.appearance === 'auto') {
      changeAppearance(store.state.settings.appearance);
      changeThemeColor(store.state.settings.themeColor);
    }
  });

let playerSaveTimer;
let playerIpcTimer;
const schedulePlayerSave = target => {
  clearTimeout(playerSaveTimer);
  playerSaveTimer = setTimeout(() => target.saveSelfToLocalStorage(), 250);
};
const schedulePlayerIpc = target => {
  clearTimeout(playerIpcTimer);
  playerIpcTimer = setTimeout(() => target.sendSelfToIpcMain(), 100);
};
const flushPlayerState = target => {
  clearTimeout(playerSaveTimer);
  clearTimeout(playerIpcTimer);
  target.flushState();
};

let player = new Player();
player = new Proxy(player, {
  set(target, prop, val) {
    // console.log({ prop, val });
    target[prop] = val;
    if (prop === '_howler') return true;
    if (PLAYER_PERSISTED_KEYS.has(prop)) schedulePlayerSave(target);
    if (PLAYER_IPC_KEYS.has(prop)) schedulePlayerIpc(target);
    return true;
  },
});
window.addEventListener('beforeunload', () => flushPlayerState(player));
store.state.player = player;
store.$karaokeManager = createKaraokeRuntime(player, store);
player.initialize().catch(error => {
  console.warn('[player] initialization deferred:', error);
});

export default store;
