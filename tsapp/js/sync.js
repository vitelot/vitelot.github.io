// Games waiting to reach the script. A game is stored on the phone first and
// sent afterwards, again and again until the script has answered.
import { ApiError } from './api.js';
import { sortDay } from './games.js';

export function makeSync({ api, store, onChange = () => {} }) {
  let running = null;

  // A game the script has accepted goes into the cached day it belongs to.
  function remember(game) {
    for (const date of store.listDays()) {
      if (date === game.date) continue;
      const day = store.getDay(date);
      if (day && day.some((g) => g.id === game.id)) store.setDay(date, day.filter((g) => g.id !== game.id));
    }
    const day = (store.getDay(game.date) || []).filter((g) => g.id !== game.id);
    day.push(game);
    store.setDay(game.date, day);
  }

  // Takes one handled operation out of the stored queue, whatever was added meanwhile.
  function removeFromQueue(op) {
    const wanted = JSON.stringify(op);
    const queue = store.getQueue();
    const at = queue.findIndex((o) => JSON.stringify(o) === wanted);
    if (at >= 0) {
      queue.splice(at, 1);
      store.setQueue(queue);
    }
  }

  async function run() {
    let sent = 0;
    let dropped = 0;
    let stopped = null;
    for (;;) {
      const op = store.getQueue()[0];
      if (!op) break;
      try {
        remember(await api.send(op));
        sent++;
      } catch (err) {
        const kind = err instanceof ApiError ? err.kind : 'network';
        if (kind !== 'invalid' && kind !== 'not_found') {
          stopped = kind;       // try again later, nothing is lost
          break;
        }
        dropped++;              // the script will never accept it
      }
      removeFromQueue(op);
      onChange();
    }
    return { sent, dropped, stopped };
  }

  function flush() {
    if (!running) {
      running = run().finally(() => { running = null; });
    }
    return running;
  }

  return {
    enqueue(op) {
      store.setQueue([...store.getQueue(), op]);
      onChange();
      flush().catch(() => {});
    },

    flush,

    pending: () => store.getQueue(),

    // The day as the person should see it: what the script has, with the
    // operations still waiting applied on top.
    viewDay(date) {
      const byId = new Map((store.getDay(date) || []).map((g) => [g.id, g]));
      for (const op of store.getQueue()) {
        if (op.op === 'put' && op.game) {
          byId.delete(op.game.id);
          if (op.game.date === date) byId.set(op.game.id, { ...op.game, status: 'ok', pending: true });
        } else if (op.op === 'delete' && byId.has(op.id)) {
          byId.set(op.id, { ...byId.get(op.id), status: 'deleted', pending: true });
        }
      }
      return sortDay([...byId.values()]);
    },
  };
}
