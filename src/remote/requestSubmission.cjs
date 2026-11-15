'use strict';

const REQUEST_TIMEOUT_MS = 10000;
const AUTOMATIC_ATTEMPTS = 2;
const DUPLICATE_WINDOW_MS = 800;

function defaultCrypto() {
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  return null;
}

function createRequestId(cryptoObject = defaultCrypto()) {
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== 'function')
    throw new Error('SECURE_RANDOM_UNAVAILABLE');

  const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

function isOutcomeUnknown(error) {
  const status = Number(error && error.status);
  if (
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408
  )
    return false;
  return true;
}

function timeoutError() {
  const error = new Error('REQUEST_TIMEOUT');
  error.name = 'AbortError';
  error.code = 'REQUEST_TIMEOUT';
  return error;
}

function createRequestSubmission({
  send,
  createId = createRequestId,
  timeoutMs = REQUEST_TIMEOUT_MS,
  duplicateWindowMs = DUPLICATE_WINDOW_MS,
  now = Date.now,
}) {
  if (typeof send !== 'function') throw new Error('REQUEST_SENDER_REQUIRED');

  const intents = new Map();
  const inFlight = new Set();
  const recentlyConfirmed = new Map();

  function pruneRecentlyConfirmed(at = now()) {
    for (const [trackId, item] of recentlyConfirmed) {
      if (item.expiresAt <= at) recentlyConfirmed.delete(trackId);
    }
  }

  function getState(trackId) {
    const key = String(trackId);
    const intent = intents.get(key);
    if (intent) {
      return {
        requestId: intent.requestId,
        priority: intent.priority,
        status: inFlight.has(key) ? 'inFlight' : 'unknown',
      };
    }
    const recent = recentlyConfirmed.get(key);
    if (!recent || recent.expiresAt <= now()) {
      recentlyConfirmed.delete(key);
      return null;
    }
    return { priority: recent.priority, status: 'cooldown' };
  }

  function sendAttempt(intent) {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const payload = {
      trackId: intent.trackId,
      priority: intent.priority,
      requestId: intent.requestId,
    };
    const request = Promise.resolve().then(() =>
      send(payload, controller ? controller.signal : undefined)
    );
    if (!(timeoutMs > 0)) return request;

    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(timeoutError());
      }, timeoutMs);
    });
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  }

  async function submit(trackId, priority) {
    const key = String(trackId);
    if (inFlight.has(key)) return { status: 'pending' };

    const at = now();
    pruneRecentlyConfirmed(at);
    let intent = intents.get(key);
    if (!intent) {
      const recent = recentlyConfirmed.get(key);
      if (recent && recent.expiresAt > at) return { status: 'duplicate' };
      intent = {
        trackId: key,
        priority: Boolean(priority),
        requestId: createId(),
      };
      intents.set(key, intent);
    }

    inFlight.add(key);
    try {
      for (let attempt = 0; attempt < AUTOMATIC_ATTEMPTS; attempt += 1) {
        try {
          const response = await sendAttempt(intent);
          if (!response || !response.item || !response.item.queueItemId)
            throw new Error('REQUEST_RECEIPT_MISSING');
          intents.delete(key);
          if (duplicateWindowMs > 0) {
            recentlyConfirmed.set(key, {
              priority: intent.priority,
              expiresAt: now() + duplicateWindowMs,
            });
          }
          return { status: 'confirmed', response };
        } catch (error) {
          if (!isOutcomeUnknown(error)) {
            intents.delete(key);
            throw error;
          }
          if (attempt === AUTOMATIC_ATTEMPTS - 1) {
            return { status: 'unknown', requestId: intent.requestId };
          }
        }
      }
    } finally {
      inFlight.delete(key);
    }
    return { status: 'unknown', requestId: intent.requestId };
  }

  return { submit, getState };
}

module.exports = { createRequestId, createRequestSubmission };
