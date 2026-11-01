/* eslint-disable no-console */

if (
  !process.env.IS_ELECTRON &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator
) {
  navigator.serviceWorker
    .getRegistrations()
    .then(registrations => {
      registrations.forEach(registration => {
        registration.unregister().catch(() => {});
      });
    })
    .catch(() => {});
  if ('caches' in window) {
    window.caches
      .keys()
      .then(keys => {
        keys.forEach(key => {
          window.caches.delete(key).catch(() => {});
        });
      })
      .catch(() => {});
  }
}
