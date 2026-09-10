import { safeJsonWrite } from '@/utils/safeStorage';

export default store => {
  store.subscribe((mutation, state) => {
    // console.log(mutation);
    safeJsonWrite('settings', state.settings);
    safeJsonWrite('data', state.data);
  });
};
