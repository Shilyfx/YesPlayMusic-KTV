import { normalizeVisualConfig, normalizeVisualPatch } from './visualConfig';
import { stageModeOptions } from '../utils/lyricStageModes';
import {
  backgroundModeOptions,
  getVisualBackgroundMetadata,
  getVisualModeMetadata,
} from './visualCatalog';
import { writePreferenceIfChanged } from './preferenceStorage';

const MASTER_APPEARANCE_KEY = 'lumasing.ktv.appearance.master.v1';
const BACKGROUND_MODES = backgroundModeOptions.map(option => option.value);
const OPTIONS = {
  modeOptions: stageModeOptions,
  backgroundModes: BACKGROUND_MODES,
  preserveAppearanceCandidates: true,
};
const MAX_APPEARANCE_BYTES = 16 * 1024;
const INLINE_VALUE_PATTERN =
  /^(?:(?:https?|file|ftp):\/\/|(?:data|blob|javascript):)/i;
const BASE64_VALUE_PATTERN =
  /^(?:[A-Za-z0-9+/]{64,}={0,2}|[A-Za-z0-9_-]{64,})$/;
const INLINE_KEY_PATTERN =
  /^(?:asset(?:id|url|data)?|blob|dataurl|image(?:data|url)?|cover(?:data|url)?|src|url)$/i;
const SHA256_ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_ID_PATHS = new Set([
  'background.assetId',
  'tuningByMode.monet.portraitAssetId',
  'tuningByMode.cappella.emojiAssetIds',
  'tuningByMode.cappella.avatarAssetIds',
  'tuningByMode.tempera.layerImageAssetIds',
  'tuningByMode.tempera.layerImages.[].id',
]);

const noBackgroundOptions = Object.freeze([]);
const availableBackgroundOptions = backgroundModeOptions;

function normalizedPath(path) {
  return path.map(part => (typeof part === 'number' ? '[]' : part)).join('.');
}

function safeConfigValue(value, path = []) {
  const pathKey = normalizedPath(path);
  if (ASSET_ID_PATHS.has(pathKey)) {
    if (pathKey.endsWith('AssetIds')) {
      return Array.isArray(value)
        ? value
            .filter(
              item =>
                typeof item === 'string' && SHA256_ASSET_ID_PATTERN.test(item)
            )
            .slice(0, 16)
        : [];
    }
    if (value === null) return null;
    if (typeof value === 'string' && SHA256_ASSET_ID_PATTERN.test(value))
      return value;
    return undefined;
  }
  if (typeof value === 'string') {
    return INLINE_VALUE_PATTERN.test(value.trim()) ||
      BASE64_VALUE_PATTERN.test(value.trim())
      ? undefined
      : value;
  }
  if (Array.isArray(value)) {
    return value.reduce((result, item) => {
      const clean = safeConfigValue(item, [...path, result.length]);
      if (clean !== undefined) result.push(clean);
      return result;
    }, []);
  }
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).forEach(key => {
    const childPath = [...path, key];
    if (
      INLINE_KEY_PATTERN.test(key) &&
      !ASSET_ID_PATHS.has(normalizedPath(childPath))
    )
      return;
    const clean = safeConfigValue(value[key], childPath);
    if (clean !== undefined) result[key] = clean;
  });
  return result;
}

function utf8Size(value) {
  const serialized = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined')
    return new TextEncoder().encode(serialized).length;
  return unescape(encodeURIComponent(serialized)).length;
}

function removeInlineValues(config) {
  const urlItems =
    config.background && config.background.mode === 'url'
      ? config.background.tuning.items
      : null;
  const selectedUrlId =
    config.background && config.background.mode === 'url'
      ? config.background.tuning.selectedId
      : null;
  const clean = safeConfigValue(config);
  if (clean.background.mode === 'url') {
    clean.background.tuning.items = Array.isArray(urlItems)
      ? urlItems.map(item => ({ id: item.id, url: item.url }))
      : [];
    clean.background.tuning.selectedId = selectedUrlId;
  }
  return clean;
}

const ESSENTIAL_MODE_FIELDS = {
  monet: ['portraitAssetId', 'portraitSource'],
  cappella: [
    'emojiAssetIds',
    'avatarAssetIds',
    'emojiPackSource',
    'avatarSource',
  ],
  tempera: ['layerImageAssetIds', 'layerImages', 'layerImageNames'],
};

function trimAppearance(config, options, maxBytes) {
  const removable = [];
  Object.keys(config.tuningByMode).forEach(mode => {
    if (mode === config.mode) return;
    const tuning = config.tuningByMode[mode];
    Object.keys(tuning).forEach(key => {
      if ((ESSENTIAL_MODE_FIELDS[mode] || []).includes(key)) return;
      removable.push({
        priority: 0,
        path: `tuningByMode.${mode}.${key}`,
        size: utf8Size(tuning[key]),
        remove() {
          delete tuning[key];
          if (!Object.keys(tuning).length) delete config.tuningByMode[mode];
        },
      });
    });
  });
  const background = config.background;
  if (background.mode === 'url') {
    background.tuning.items.forEach(item => {
      if (item.id === background.tuning.selectedId) return;
      removable.push({
        priority: 1,
        path: `background.tuning.items.${item.id}`,
        size: utf8Size(item),
        remove() {
          background.tuning.items = background.tuning.items.filter(
            entry => entry.id !== item.id
          );
        },
      });
    });
  }
  const backgroundFields =
    (getVisualBackgroundMetadata(background.mode) || {}).tuningDefaults || {};
  Object.keys(background.tuning).forEach(key => {
    if (
      key === 'items' ||
      key === 'selectedId' ||
      Object.prototype.hasOwnProperty.call(backgroundFields, key)
    )
      return;
    removable.push({
      priority: 1,
      path: `background.tuning.${key}`,
      size: utf8Size(background.tuning[key]),
      remove() {
        delete background.tuning[key];
      },
    });
  });
  removable.sort(
    (left, right) =>
      left.priority - right.priority ||
      right.size - left.size ||
      left.path.localeCompare(right.path)
  );
  const removedPaths = (options.candidateRemovedPaths || []).slice();
  for (const entry of removable) {
    if (utf8Size(config) <= maxBytes) break;
    entry.remove();
    removedPaths.push(entry.path);
  }
  if (utf8Size(config) > maxBytes) {
    const error = new Error(
      '当前样式和素材配置超过 16 KiB，请先减少当前样式参数或素材'
    );
    error.code = 'APPEARANCE_CONFIG_TOO_LARGE';
    throw error;
  }
  if (removedPaths.length && options.onTrim) options.onTrim({ removedPaths });
  return config;
}

export function normalizeAppearanceConfig(value, options = {}) {
  const candidateRemovedPaths = (options.candidateRemovedPaths || []).slice();
  const config = removeInlineValues(
    normalizeVisualConfig(value, {
      ...OPTIONS,
      onCandidateTrim: path => candidateRemovedPaths.push(path),
    })
  );
  const maxBytes = Number.isFinite(options.maxBytes)
    ? Math.max(
        256,
        Math.min(MAX_APPEARANCE_BYTES, Math.floor(options.maxBytes))
      )
    : MAX_APPEARANCE_BYTES;
  if (utf8Size(config) <= maxBytes) {
    if (candidateRemovedPaths.length && options.onTrim)
      options.onTrim({ removedPaths: candidateRemovedPaths });
    return config;
  }
  return trimAppearance(
    config,
    { ...options, candidateRemovedPaths },
    maxBytes
  );
}

export function normalizeAppearancePreferences(value, options = {}) {
  const config = normalizeAppearanceConfig(value, options);
  return {
    animationIntensity: config.animationIntensity,
    background: config.background,
    tuningByMode: config.tuningByMode,
    random: config.random,
    customTheme: config.customTheme,
  };
}

export function normalizeAppearancePatch(current, patch, options = {}) {
  const candidateRemovedPaths = [];
  return normalizeAppearanceConfig(
    normalizeVisualPatch(current, patch, {
      ...OPTIONS,
      onCandidateTrim: path => candidateRemovedPaths.push(path),
    }),
    { ...options, candidateRemovedPaths }
  );
}

const UPLOAD_ROLES = ['background', 'portrait', 'emoji', 'avatar', 'tempera'];
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function assetRoleIds(config, role) {
  const modes = config.tuningByMode || {};
  const value =
    role === 'emoji'
      ? modes.cappella?.emojiAssetIds
      : role === 'avatar'
      ? modes.cappella?.avatarAssetIds
      : role === 'tempera'
      ? [
          ...(modes.tempera?.layerImageAssetIds || []),
          ...(modes.tempera?.layerImages || []).map(image => image.id),
        ]
      : [];
  return Array.from(
    new Set((value || []).filter(id => SHA256_ASSET_ID_PATTERN.test(id)))
  );
}

function assetUploadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanAssetName(value) {
  return (
    Array.from(String(value || 'Image'))
      .filter(
        character =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
      )
      .join('')
      .trim()
      .slice(0, 80) || 'Image'
  );
}

export function appendVisualAsset(config, role, id, name) {
  if (!UPLOAD_ROLES.includes(role) || !SHA256_ASSET_ID_PATTERN.test(id))
    throw assetUploadError('INVALID_ASSET', '无效的图片素材');
  const next = { ...config, tuningByMode: { ...config.tuningByMode } };
  if (role === 'background') {
    const background = config.background;
    const tuning = { ...background.tuning };
    if (background.mode === 'monet')
      tuning.backgroundSource = 'uploaded-global';
    if (background.mode === 'nomand') tuning.imageSource = 'uploaded-global';
    next.background = { ...background, assetId: id, tuning };
    return next;
  }
  const mode =
    role === 'portrait' ? 'monet' : role === 'tempera' ? 'tempera' : 'cappella';
  const tuning = { ...(config.tuningByMode[mode] || {}) };
  next.tuningByMode[mode] = tuning;
  if (role === 'portrait') {
    tuning.portraitAssetId = id;
    tuning.portraitSource = 'custom';
    return next;
  }
  const ids = assetRoleIds(config, role);
  if (ids.includes(id)) return next;
  if (ids.length >= 16)
    throw assetUploadError('ASSET_ROLE_FULL', '该素材组最多可保存 16 张图片');
  ids.push(id);
  if (role === 'tempera') {
    tuning.layerImageAssetIds = ids;
    tuning.layerImages = [
      ...(tuning.layerImages || []),
      {
        id,
        name: cleanAssetName(name),
        align: 'free',
        verticalAlign: 'bottom',
        scale: 0.7,
        opacity: 1,
      },
    ];
  } else {
    tuning[role === 'emoji' ? 'emojiAssetIds' : 'avatarAssetIds'] = ids;
    tuning[role === 'emoji' ? 'emojiPackSource' : 'avatarSource'] = 'custom';
  }
  return next;
}

// Reserves the whole accepted batch synchronously, before any upload can persist bytes.
export function createVisualAssetUploadQueue({
  getConfig,
  getGeneration,
  upload,
  commit,
  notify = () => {},
  maxBytes = MAX_APPEARANCE_BYTES,
}) {
  const pending = new Set();
  let tail = Promise.resolve();
  let epoch = 0;
  let sequence = 0;
  let disposed = false;
  const current = task =>
    !disposed &&
    task.epoch === epoch &&
    task.generation !== null &&
    task.generation !== undefined &&
    task.generation === getGeneration(task.change) &&
    (task.change.role !== 'background' ||
      task.backgroundMode === getConfig().background.mode);
  const assertFits = config => {
    let candidate = config;
    for (const task of pending) {
      if (current(task))
        candidate = appendVisualAsset(
          candidate,
          task.change.role,
          task.placeholder,
          task.file.name
        );
    }
    normalizeAppearanceConfig(candidate, { maxBytes });
  };
  function run(change) {
    if (disposed || !change || !UPLOAD_ROLES.includes(change.role))
      return Promise.resolve([]);
    const role = change.role;
    const generation = getGeneration(change);
    if (generation === null || generation === undefined)
      return Promise.resolve([]);
    let config;
    try {
      config = getConfig();
    } catch (error) {
      notify(error.message);
      return Promise.resolve([]);
    }
    const multiple = ['emoji', 'avatar', 'tempera'].includes(role);
    const reserved = Array.from(pending).filter(
      task => current(task) && task.change.role === role
    ).length;
    const remaining = Math.max(
      0,
      (multiple ? 16 - assetRoleIds(config, role).length : 1) - reserved
    );
    const fileCount = (change.files || []).length;
    const files = Array.prototype.slice.call(change.files || [], 0, 16);
    const accepted = [];
    for (const file of files) {
      if (
        !file ||
        !Number.isInteger(file.size) ||
        file.size <= 0 ||
        file.size > 4 * 1024 * 1024 ||
        !UPLOAD_TYPES.includes(String(file.type).toLowerCase())
      ) {
        notify('请选择 4 MiB 以内的 PNG、JPEG、WebP 或 GIF 图片');
        continue;
      }
      if (accepted.length >= remaining) break;
      accepted.push(file);
    }
    if (fileCount > accepted.length)
      notify(`该素材组本次最多可再添加 ${remaining} 张图片`);
    const serializedConfig = JSON.stringify(config);
    const tasks = accepted.map(file => {
      let placeholder;
      do {
        placeholder = (++sequence).toString(16).padStart(64, 'f');
      } while (serializedConfig.includes(placeholder));
      return {
        change,
        file,
        generation,
        epoch,
        backgroundMode: config.background.mode,
        placeholder,
        controller: new AbortController(),
      };
    });
    tasks.forEach(task => pending.add(task));
    try {
      assertFits(config);
    } catch (error) {
      tasks.forEach(task => pending.delete(task));
      notify(error.message);
      return Promise.resolve([]);
    }
    return Promise.all(
      tasks.map(task => {
        let uploaded;
        let retained = false;
        const operation = tail
          .then(async () => {
            if (!current(task)) return false;
            assertFits(getConfig());
            uploaded = await upload(task.file, role, {
              signal: task.controller.signal,
              isCurrent: () => current(task),
              deferRetain: true,
            });
            if (!current(task)) return false;
            const notices = [];
            const next = normalizeAppearanceConfig(
              appendVisualAsset(
                getConfig(),
                role,
                uploaded.id,
                uploaded.name || task.file.name
              ),
              { maxBytes, onTrim: notice => notices.push(notice) }
            );
            pending.delete(task);
            assertFits(next);
            const commitReference = () => {
              if (commit(next, change) === false)
                throw assetUploadError(
                  'ASSET_CONFIG_NOT_SAVED',
                  '图片配置保存失败'
                );
              retained = true;
              return true;
            };
            if (uploaded.commitReference)
              await uploaded.commitReference(commitReference);
            else {
              commitReference();
              await uploaded.retain?.();
            }
            if (notices.length)
              notify(
                '配置达到 16 KiB，已精简可选参数或未选中的背景地址；当前样式与素材已保留'
              );
            return true;
          })
          .finally(async () => {
            pending.delete(task);
            if (!retained) await uploaded?.discard?.();
          })
          .catch(error => {
            if (error.name !== 'AbortError')
              notify(error.message || '图片上传失败');
            return false;
          });
        tail = operation;
        return operation;
      })
    );
  }
  return {
    run,
    assertFits,
    invalidate() {
      epoch++;
      pending.forEach(task => task.controller.abort());
      pending.clear();
    },
    dispose() {
      disposed = true;
      epoch++;
      pending.forEach(task => task.controller.abort());
      pending.clear();
    },
  };
}

export function backgroundOptionsForMode(mode) {
  const metadata = getVisualModeMetadata(mode);
  return metadata && metadata.value === 'still'
    ? noBackgroundOptions
    : availableBackgroundOptions;
}

export function readMasterAppearancePreferences(storage, options = {}) {
  try {
    const target =
      storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target) return normalizeAppearancePreferences({});
    return normalizeAppearancePreferences(
      JSON.parse(target.getItem(MASTER_APPEARANCE_KEY) || '{}'),
      options
    );
  } catch (error) {
    if (options.onInvalid) options.onInvalid(error);
    return normalizeAppearancePreferences({});
  }
}

export function writeMasterAppearancePreferences(value, storage) {
  try {
    const target =
      storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target) return false;
    return writePreferenceIfChanged(
      target,
      MASTER_APPEARANCE_KEY,
      JSON.stringify(normalizeAppearancePreferences(value))
    );
  } catch (_) {
    return false;
  }
}
