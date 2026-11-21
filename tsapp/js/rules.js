// Rules of the data: score, player names, dates. No DOM, no network.

export const NAME_RE = /^[A-Z][A-Za-z0-9]{1,19}$/;
export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_LOSER_GOALS = 97;

export function isValidName(s) {
  return typeof s === 'string' && NAME_RE.test(s);
}

// A game ends when a team has at least 10 goals and leads by at least 2:
// 10-x for x <= 8, or (x+2)-x for x >= 9.
export function isValidScore(red, blue) {
  if (!Number.isInteger(red) || !Number.isInteger(blue) || red < 0 || blue < 0) return false;
  const winner = Math.max(red, blue);
  const loser = Math.min(red, blue);
  return loser <= 8 ? winner === 10 : winner === loser + 2;
}

export function scoreFromLoser(winner, loserGoals) {
  if (winner !== 'red' && winner !== 'blue') throw new RangeError('winner must be red or blue');
  if (!Number.isInteger(loserGoals) || loserGoals < 0 || loserGoals > MAX_LOSER_GOALS) {
    throw new RangeError('loser goals must be a whole number from 0 to ' + MAX_LOSER_GOALS);
  }
  const winnerGoals = loserGoals <= 8 ? 10 : loserGoals + 2;
  return winner === 'red'
    ? { red: winnerGoals, blue: loserGoals }
    : { red: loserGoals, blue: winnerGoals };
}

export function parseDate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { d, m: mo, y };
}

const two = (n) => String(n).padStart(2, '0');

// The day as the person holding the phone sees it.
export function formatDate(date) {
  return `${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function isoToDmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export function dmyToIso(dmy) {
  const p = parseDate(dmy);
  return p ? `${p.y}-${two(p.m)}-${two(p.d)}` : '';
}

const dayNumber = (p) => Date.UTC(p.y, p.m - 1, p.d) / 86400000;

// Whole days from a to b; NaN when either is not a date.
export function daysBetween(dmyA, dmyB) {
  const a = parseDate(dmyA);
  const b = parseDate(dmyB);
  if (!a || !b) return NaN;
  return dayNumber(b) - dayNumber(a);
}

export function validateGame(game) {
  const errors = [];
  const g = game || {};
  if (typeof g.id !== 'string' || !ID_RE.test(g.id)) errors.push('id');
  if (typeof g.savedAt !== 'number' || !Number.isFinite(g.savedAt)) errors.push('savedAt');
  if (!parseDate(g.date)) errors.push('date');
  const names = [g.rd, g.rf, g.bd, g.bf];
  if (!names.every(isValidName)) errors.push('name');
  const present = names.filter((n) => typeof n === 'string' && n !== '');
  if (new Set(present.map((n) => n.toLowerCase())).size !== present.length) errors.push('distinct');
  if (!isValidScore(g.red, g.blue)) errors.push('score');
  return errors;
}
