// The two calls to the Google Apps Script web app.
//
// The requests carry no custom header and the POST body is sent as plain
// text: that keeps them "simple" requests, the only kind an Apps Script web
// app can answer to a page on another site. The answer arrives through a
// redirect, which the browser follows.

const KINDS = ['bad_key', 'invalid', 'not_found', 'server'];
const TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

export function makeApi({ url, key }, fetchFn = (...args) => fetch(...args)) {
  async function call(target, init) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    let data;
    try {
      const response = await fetchFn(target, { ...init, redirect: 'follow', signal: controller ? controller.signal : undefined });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      data = JSON.parse(await response.text());
    } catch (err) {
      // No connection, a timeout, a Google sign-in or error page: not sent.
      throw new ApiError('network', (err && err.message) || 'No answer');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!data || typeof data !== 'object') throw new ApiError('network', 'Unreadable answer');
    if (data.ok !== true) {
      throw new ApiError(KINDS.includes(data.error) ? data.error : 'server', data.message);
    }
    return data;
  }

  return {
    async load(date) {
      const target = new URL(url);
      target.searchParams.set('key', key);
      target.searchParams.set('date', date);
      target.searchParams.set('t', String(Date.now()));   // never a cached answer
      const data = await call(target.toString(), { method: 'GET' });
      if (!Array.isArray(data.players) || !Array.isArray(data.games)) {
        throw new ApiError('network', 'Unreadable answer');
      }
      // `recent` (the games of the last days) is absent from older scripts.
      return { players: data.players, games: data.games, recent: Array.isArray(data.recent) ? data.recent : [] };
    },

    async send(op) {
      const data = await call(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key, ...op }),
      });
      if (!data.game || typeof data.game !== 'object') throw new ApiError('network', 'Unreadable answer');
      return data.game;
    },
  };
}
