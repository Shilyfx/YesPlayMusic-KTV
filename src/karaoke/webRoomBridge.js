import { sanitizeLyricDocument } from './lyricDocument';
import { normalizeAppearanceConfig } from './appearanceConfig';
import { REACTION_UI_REVISION } from './reactions';
import { sanitizeSmartBeatTimeline } from './smartBeatTimeline';

const HOST_BODY_MAX_BYTES = 1024 * 1024;
const VISUAL_ASSET_MAX_BYTES = 4 * 1024 * 1024;
const VISUAL_ASSET_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export default function createWebRoomBridge({
  manager,
  execute,
  origin = window.location.origin,
  request = null,
  schedule = setTimeout,
  cancel = clearTimeout,
  onError = () => {},
  getPresentation = () => null,
  getPvLyrics = null,
  getAppearance = null,
  getSmartBeatState = null,
  onReactions = () => {},
  hostName = '主电脑',
}) {
  let hostToken = '';
  let room = null;
  let timer;
  let inFlight = null;
  let startPromise = null;
  let generation = 0;
  let lastRevision = -1;
  let lyricSource;
  let lyricDocument;
  let lastLyrics;
  let lastAppearanceKey = null;
  let lastSmartBeatRevision = -1;
  const completed = new Map();
  const outbox = new Map();
  const running = new Map();
  const visualAssetUploads = new Set();
  const snapshot = () => {
    const state = manager.getSnapshot();
    const item = value => {
      if (!value) return null;
      const safe = { ...value };
      delete safe.lyrics;
      return safe;
    };
    return {
      ...state,
      currentItem: item(state.currentItem),
      waitingItems: state.waitingItems.map(item),
      historyItems: state.historyItems.slice(0, 50).map(item),
    };
  };
  const lyricsFor = state => {
    try {
      const source = getPvLyrics();
      if (!source) return null;
      if (source !== lyricSource) {
        // Cache failures too: optional local lyrics must not block heartbeats
        // or repeatedly scan a rejected document. Changes use a new object.
        lyricSource = source;
        lyricDocument = null;
        lyricDocument = sanitizeLyricDocument(source);
      }
      return lyricDocument?.itemId === state.currentItem?.queueItemId
        ? lyricDocument
        : null;
    } catch (_) {
      // Retry the callback next heartbeat so transient loading errors recover.
      return null;
    }
  };
  const appearanceFor = () => {
    try {
      return normalizeAppearanceConfig(getAppearance());
    } catch (_) {
      return normalizeAppearanceConfig({});
    }
  };
  const smartBeatForTransport = () => {
    try {
      const state = getSmartBeatState?.();
      if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0)
        return null;
      return {
        revision: state.revision,
        timeline: state.timeline
          ? sanitizeSmartBeatTimeline(state.timeline)
          : null,
      };
    } catch (_) {
      return null;
    }
  };
  const fitPvLyrics = body => {
    // Only uploads need this scan; ordinary heartbeats omit the full document.
    if (
      body.pvLyrics &&
      new TextEncoder().encode(JSON.stringify(body)).length >
        HOST_BODY_MAX_BYTES
    )
      body.pvLyrics = null;
    return body;
  };
  const call = async (action, body = {}, token = hostToken) => {
    if (request) return request(action, body, token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/ktv/host/${action}`, {
        method: 'POST',
        signal: controller.signal,
        keepalive: action === 'close',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || '房间连接失败');
        error.status = response.status;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };
  async function performExchange() {
    if (!hostToken) return;
    const version = generation;
    const state = snapshot();
    const lyrics = getPvLyrics ? lyricsFor(state) : undefined;
    const appearance = getAppearance ? appearanceFor() : undefined;
    const smartBeat = getSmartBeatState ? smartBeatForTransport() : null;
    const appearanceKey = appearance ? JSON.stringify(appearance) : null;
    const results = [...outbox.values()];
    const body = fitPvLyrics({
      results,
      presentation: getPresentation(),
      ...(appearanceKey !== lastAppearanceKey ? { appearance } : {}),
      ...(smartBeat && smartBeat.revision !== lastSmartBeatRevision
        ? { smartBeatTimeline: smartBeat }
        : {}),
      ...(getPvLyrics && lyrics !== lastLyrics ? { pvLyrics: lyrics } : {}),
      ...(state.revision !== lastRevision ? { snapshot: state } : {}),
    });
    const data = await call('exchange', body);
    if (version !== generation) return;
    onReactions(data.reactions || [], data.reactionEpoch, data.serverTime);
    lastRevision = state.revision;
    if (body.smartBeatTimeline)
      lastSmartBeatRevision = body.smartBeatTimeline.revision;
    if ('appearance' in body)
      lastAppearanceKey = JSON.stringify(body.appearance);
    if ('pvLyrics' in body) lastLyrics = body.pvLyrics;
    results.forEach(result => outbox.delete(result.id));
    for (const command of data.commands || []) {
      if (version !== generation) return;
      const cached = completed.get(command.id);
      if (cached) {
        outbox.set(command.id, cached);
        continue;
      }
      if (running.has(command.id)) continue;
      // Execution cannot block heartbeat/snapshot delivery. The manager retains
      // its existing single transition owner for concurrent next commands.
      const task = Promise.resolve()
        .then(async () => {
          if (version !== generation) return;
          let result;
          try {
            if (command.expiresAt && Date.now() >= command.expiresAt)
              throw new Error('COMMAND_EXPIRED');
            result = {
              id: command.id,
              ok: true,
              result: await execute(command),
            };
          } catch (error) {
            result = { id: command.id, ok: false, error: error.message };
          }
          if (version !== generation) return;
          completed.set(command.id, result);
          if (completed.size > 128)
            completed.delete(completed.keys().next().value);
          outbox.set(command.id, result);
        })
        .finally(() => {
          if (running.get(command.id) === task) running.delete(command.id);
        });
      running.set(command.id, task);
    }
  }
  function exchange() {
    if (inFlight) return inFlight;
    const operation = performExchange();
    inFlight = operation;
    return operation.finally(() => {
      if (inFlight === operation) inFlight = null;
    });
  }
  async function loop() {
    const version = generation;
    try {
      await exchange();
      if (running.size && version === generation) {
        await Promise.race([
          Promise.allSettled([...running.values()]),
          new Promise(resolve => setTimeout(resolve, 180)),
        ]);
      }
      if (outbox.size && hostToken && version === generation) {
        await exchange();
      }
    } catch (error) {
      if (version !== generation) return;
      if (error.status === 401 || error.status === 410) {
        reset();
        onError(new Error('房间已断开，请重新生成二维码'));
      }
    }
    if (hostToken && version === generation)
      timer = schedule(loop, outbox.size || running.size ? 80 : 350);
  }
  function reset() {
    hostToken = '';
    room = null;
    generation++;
    visualAssetUploads.forEach(controller => controller.abort());
    visualAssetUploads.clear();
    lastRevision = -1;
    lyricSource = undefined;
    lyricDocument = undefined;
    lastLyrics = undefined;
    lastAppearanceKey = null;
    lastSmartBeatRevision = -1;
    inFlight = null;
    startPromise = null;
    cancel(timer);
    outbox.clear();
    completed.clear();
    running.clear();
  }
  async function uploadVisualAsset(file, role) {
    const token = hostToken;
    const version = generation;
    if (!token) throw new Error('ROOM_ENDED');
    if (!file || !Number.isInteger(file.size) || file.size <= 0)
      throw new Error('INVALID_IMAGE');
    if (file.size > VISUAL_ASSET_MAX_BYTES) throw new Error('ASSET_TOO_LARGE');
    const mime = String(file.type || '').toLowerCase();
    if (!VISUAL_ASSET_MIMES.includes(mime))
      throw new Error('UNSUPPORTED_IMAGE_TYPE');
    if (
      role !== undefined &&
      role !== null &&
      (typeof role !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/i.test(role))
    )
      throw new Error('INVALID_ASSET_ROLE');

    const controller = new AbortController();
    visualAssetUploads.add(controller);
    const timeout = setTimeout(() => controller.abort(), 60000);
    const headers = {
      'Content-Type': mime,
      Authorization: `Bearer ${token}`,
    };
    if (role) headers['X-KTV-Visual-Asset-Role'] = role;
    const options = {
      method: 'POST',
      mode: 'same-origin',
      credentials: 'same-origin',
      headers,
      body: file,
      signal: controller.signal,
    };
    try {
      let data;
      if (request) {
        data = await request('visual-assets', file, token, options);
      } else {
        const response = await fetch(
          new URL('/ktv/host/visual-assets', origin).toString(),
          options
        );
        data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data.error || '图片上传失败');
          error.status = response.status;
          throw error;
        }
      }
      if (version !== generation || token !== hostToken)
        throw new Error('ROOM_ENDED');
      const id = data?.id;
      const url = `/ktv/display/visual-assets/${id}`;
      if (
        !/^[a-f0-9]{64}$/.test(String(id || '')) ||
        data.url !== url ||
        !VISUAL_ASSET_MIMES.includes(data.mime)
      )
        throw new Error('INVALID_ASSET_RESPONSE');
      const name =
        typeof file.name === 'string'
          ? file.name
              .split('')
              .filter(character => {
                const code = character.charCodeAt(0);
                return code >= 32 && code !== 127;
              })
              .join('')
              .trim()
              .slice(0, 80)
          : '';
      return { id, url, mime: data.mime, ...(name ? { name } : {}) };
    } catch (error) {
      if (version !== generation || token !== hostToken)
        throw new Error('ROOM_ENDED');
      if (error.name === 'AbortError') throw new Error('ASSET_UPLOAD_ABORTED');
      throw error;
    } finally {
      clearTimeout(timeout);
      visualAssetUploads.delete(controller);
    }
  }
  async function dispose() {
    const previousToken = hostToken;
    reset();
    if (previousToken) {
      try {
        await call('close', {}, previousToken);
      } catch (_) {
        /* Server lease expires. */
      }
    }
  }
  function start() {
    if (hostToken) return Promise.resolve({ ok: true, room });
    if (startPromise) return startPromise;
    const version = generation;
    const operation = (async () => {
      const state = snapshot();
      const lyrics = getPvLyrics ? lyricsFor(state) : undefined;
      const appearance = getAppearance ? appearanceFor() : undefined;
      const smartBeat = getSmartBeatState ? smartBeatForTransport() : null;
      const body = fitPvLyrics({
        uiRevision: REACTION_UI_REVISION,
        snapshot: state,
        hostName,
        presentation: getPresentation(),
        ...(getAppearance ? { appearance } : {}),
        ...(smartBeat ? { smartBeatTimeline: smartBeat } : {}),
        ...(getPvLyrics ? { pvLyrics: lyrics } : {}),
      });
      const opened = await call('open', body);
      if (version !== generation) {
        try {
          await call('close', {}, opened.hostToken);
        } catch (_) {
          /* Lease fallback. */
        }
        throw new Error('ROOM_ENDED');
      }
      hostToken = opened.hostToken;
      room = opened.room;
      lastLyrics = body.pvLyrics;
      if (body.smartBeatTimeline)
        lastSmartBeatRevision = body.smartBeatTimeline.revision;
      lastAppearanceKey = appearance ? JSON.stringify(appearance) : null;
      generation++;
      timer = schedule(loop, 0);
      return { ok: true, room };
    })();
    startPromise = operation;
    return operation.finally(() => {
      if (startPromise === operation) startPromise = null;
    });
  }
  return {
    exchange,
    dispose,
    uploadVisualAsset,
    async invoke(channel, payload) {
      switch (channel) {
        case 'karaoke:lan:candidates':
          return {
            ok: true,
            candidates: [
              {
                address: new URL(origin).hostname,
                interfaceName: 'Docker 服务',
              },
            ],
          };
        case 'karaoke:lan:set-session-active':
          if (!payload) await dispose();
          return { ok: true };
        case 'karaoke:lan:start':
          return start();
        case 'karaoke:lan:stop':
          await dispose();
          return { ok: true };
        case 'karaoke:lan:status':
        case 'karaoke:lan:refresh-qr':
          if (hostToken) return call('status');
          return { ok: false, room: null };
        case 'karaoke:lan:self-test': {
          if (!hostToken) return { ok: false };
          await call('status');
          return { ok: true };
        }
        case 'karaoke:local:list': {
          const response = await fetch('/ktv/local/list');
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '本地歌单读取失败');
          return data;
        }
        case 'karaoke:local:scan': {
          const response = await fetch('/ktv/local/scan', { method: 'POST' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '本地歌单扫描失败');
          return data;
        }
        case 'karaoke:local:add-directory': {
          const response = await fetch('/ktv/local/add-directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory: payload }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok)
            throw new Error(data.error || '添加本地音乐目录失败');
          return data;
        }
        case 'karaoke:local:remove-directory': {
          const response = await fetch('/ktv/local/remove-directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory: payload }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok)
            throw new Error(data.error || '移除本地音乐目录失败');
          return data;
        }
        case 'karaoke:local:resolve': {
          const response = await fetch(
            `/ktv/local/resolve/${encodeURIComponent(String(payload || ''))}`
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok)
            return { ok: false, error: data.error || 'LOCAL_TRACK_NOT_FOUND' };
          return data;
        }
        default:
          throw new Error('UNSUPPORTED_CHANNEL');
      }
    },
  };
}
