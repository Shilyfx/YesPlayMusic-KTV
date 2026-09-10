import Vue from 'vue';
import VueClipboard from 'vue-clipboard2';
import VueI18n from 'vue-i18n';

import en from './lang/en.js';
import zhCN from './lang/zh-CN.js';
import zhTW from './lang/zh-TW.js';
import tr from './lang/tr.js';

Vue.use(VueClipboard);
Vue.use(VueI18n);

// Locale is loaded during the renderer bootstrap. Read only the persisted
// primitive here so i18n never imports Vuex (which would recreate the store
// initialization cycle).
let initialLocale = 'zh-CN';
try {
  const persisted = JSON.parse(localStorage.getItem('settings') || '{}');
  if (typeof persisted.lang === 'string' && persisted.lang) {
    initialLocale = persisted.lang;
  }
} catch (_) {
  // Vuex safe storage validation will recover malformed settings later.
}

const i18n = new VueI18n({
  locale: initialLocale,
  messages: {
    en,
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    tr,
  },
  silentTranslationWarn: true,
});

export default i18n;
