import Vue from 'vue';
import VueClipboard from 'vue-clipboard2';
import VueI18n from 'vue-i18n';
import store from '@/store';

import en from './lang/en.js';
import zhCN from './lang/zh-CN.js';
import zhTW from './lang/zh-TW.js';
import tr from './lang/tr.js';

Vue.use(VueClipboard);
Vue.use(VueI18n);

// Some renderer entry points import locale while Vuex is still resolving a
// circular dependency. Do not let that transient module state abort the app.
const initialLocale = store?.state?.settings?.lang || 'zh-CN';

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
