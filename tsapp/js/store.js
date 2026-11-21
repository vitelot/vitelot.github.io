// Everything the page keeps on the phone. Storage that is full, forbidden or
// corrupted never breaks the page: values then live in memory for the visit.

const PREFIX = 'bil.';
const MAX_DAYS = 14;
const MAX_COPIED = 3000;

export function makeStore(storage) {
  const memory = new Map();

  function readRaw(key) {
    if (memory.has(key)) return memory.get(key);
    try { return storage.getItem(key); } catch { return null; }
  }

  function writeRaw(key, value) {
    try {
      storage.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  }

  function removeRaw(key) {
    memory.delete(key);
    try { storage.removeItem(key); } catch { /* nothing to do */ }
  }

  function read(name, isRight, fallback) {
    const raw = readRaw(PREFIX + name);
    if (raw === null || raw === undefined) return fallback;
    try {
      const value = JSON.parse(raw);
      return isRight(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  const write = (name, value) => writeRaw(PREFIX + name, JSON.stringify(value));
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isString = (v) => typeof v === 'string';

  return {
    getSetup: () => read('setup', isString, null),
    setSetup: (code) => write('setup', code),

    getPlayers: () => read('players', Array.isArray, null),
    setPlayers: (players) => write('players', players),

    getDay: (date) => read('day.' + date, Array.isArray, null),
    setDay(date, games) {
      const days = read('days', Array.isArray, []).filter((d) => d !== date);
      days.push(date);
      while (days.length > MAX_DAYS) removeRaw(PREFIX + 'day.' + days.shift());
      write('day.' + date, games);
      write('days', days);
    },
    listDays: () => read('days', Array.isArray, []),

    getQueue: () => read('queue', Array.isArray, []),
    setQueue: (ops) => write('queue', ops),

    getCopied: () => read('copied', isPlainObject, {}),
    setCopied(copied) {
      const entries = Object.entries(copied);
      write('copied', Object.fromEntries(entries.slice(-MAX_COPIED)));
    },
  };
}
