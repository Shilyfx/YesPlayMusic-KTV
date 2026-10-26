export default function createWebRoomBridge({
  manager,
  execute,
  origin = window.location.origin,
  request = null,
  schedule = setTimeout,
  cancel = clearTimeout,
  onError = () => {},
  getPresentation = () => null,
  hostName = '主电脑',
}) {
  let hostToken = '';
  let room = null;
  let timer;
  let inFlight = null;
  let startPromise = null;
  let generation = 0;
  let lastRevision = -1;
  const completed = new Map();
  const outbox = new Map();
  const running = new Map();
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
    const results = [...outbox.values()];
    const data = await call('exchange', {
      results,
      presentation: getPresentation(),
      ...(state.revision !== lastRevision ? { snapshot: state } : {}),
    });
    if (version !== generation) return;
    lastRevision = state.revision;
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
    } catch (error) {
      if (version !== generation) return;
      if (error.status === 401 || error.status === 410) {
        reset();
        onError(new Error('房间已断开，请重新生成二维码'));
      }
    }
    if (hostToken && version === generation) timer = schedule(loop, 1000);
  }
  function reset() {
    hostToken = '';
    room = null;
    generation++;
    lastRevision = -1;
    cancel(timer);
    outbox.clear();
    completed.clear();
    running.clear();
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
      const opened = await call('open', {
        snapshot: snapshot(),
        hostName,
        presentation: getPresentation(),
      });
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
        default:
          throw new Error('UNSUPPORTED_CHANNEL');
      }
    },
  };
}
