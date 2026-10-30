export function writePreferenceIfChanged(storage, key, serializedValue) {
  try {
    const getItem = storage && storage.getItem;
    if (
      typeof getItem === 'function' &&
      getItem.call(storage, key) === serializedValue
    ) {
      return true;
    }
  } catch (_) {
    // Reading is only an optimization; keep the original write attempt.
  }

  try {
    storage.setItem(key, serializedValue);
    return true;
  } catch (_) {
    return false;
  }
}
