// The games of one day: order, possible duplicates, text for the official sheet.
// No DOM, no network.

export const DUP_WINDOW_MS = 15 * 60 * 1000;

export function sortDay(games) {
  return [...games].sort((a, b) =>
    a.savedAt - b.savedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// One row of the official sheet: date, red defence, red forward, blue defence,
// blue forward, red goals, blue goals.
export function tsvLine(g) {
  return [g.date, g.rd, g.rf, g.bd, g.bf, g.red, g.blue].join('\t');
}

export function toTsv(games) {
  return sortDay(games.filter((g) => g.status === 'ok')).map(tsvLine).join('\n');
}

const sameGame = (a, b) => tsvLine(a).toLowerCase() === tsvLine(b).toLowerCase();

function isDuplicatePair(a, b) {
  return a.id !== b.id
    && a.status === 'ok' && b.status === 'ok'
    && Math.abs(a.savedAt - b.savedAt) <= DUP_WINDOW_MS
    && sameGame(a, b);
}

// The game already in the day that looks like the one about to be saved.
export function findRecentDuplicate(candidate, dayGames) {
  const probe = { ...candidate, status: 'ok' };
  return dayGames.find((g) => isDuplicatePair(probe, g)) || null;
}

export function duplicateIds(dayGames) {
  const ids = new Set();
  for (let i = 0; i < dayGames.length; i++) {
    for (let j = i + 1; j < dayGames.length; j++) {
      if (isDuplicatePair(dayGames[i], dayGames[j])) {
        ids.add(dayGames[i].id);
        ids.add(dayGames[j].id);
      }
    }
  }
  return ids;
}

// What this device has already copied, compared with the day as it is now.
export function copyStatus(dayGames, copied) {
  const byId = new Map();
  let newCount = 0;
  let changedCount = 0;
  let deletedCount = 0;
  const known = copied || {};
  for (const g of dayGames) {
    const wasCopied = Object.prototype.hasOwnProperty.call(known, g.id);
    if (g.status !== 'ok') {
      if (wasCopied) { byId.set(g.id, 'deleted-after-copy'); deletedCount++; }
    } else if (!wasCopied) {
      byId.set(g.id, 'new'); newCount++;
    } else if (known[g.id] === tsvLine(g)) {
      byId.set(g.id, 'copied');
    } else {
      byId.set(g.id, 'changed'); changedCount++;
    }
  }
  return { byId, newCount, changedCount, deletedCount };
}

// Other days that hold games this device has not copied (or that changed
// after it copied them). A device that never copied anything is not the
// organiser's, and gets no list.
export function uncopiedDays(recentGames, copied, exceptDate) {
  const known = copied || {};
  if (Object.keys(known).length === 0) return [];
  const byDate = new Map();
  for (const g of recentGames) {
    if (g.date === exceptDate) continue;
    if (!byDate.has(g.date)) byDate.set(g.date, []);
    byDate.get(g.date).push(g);
  }
  const sortable = (dmy) => dmy.split('-').reverse().join('');
  return [...byDate.entries()]
    .map(([date, games]) => {
      const s = copyStatus(games, known);
      return { date, count: s.newCount + s.changedCount + s.deletedCount };
    })
    .filter((d) => d.count > 0)
    .sort((a, b) => (sortable(a.date) < sortable(b.date) ? -1 : 1));
}

export function markCopied(copied, games) {
  const out = { ...(copied || {}) };
  for (const g of games) out[g.id] = tsvLine(g);
  return out;
}
