// Which names to offer, and in which order. No DOM, no network.
import { daysBetween, isValidName, parseDate } from './rules.js';

const lower = (s) => String(s).toLowerCase();

// 0: played in the last 7 days, 1: in the last 30 days, 2: everyone else.
function group(player, today) {
  const days = daysBetween(player.last, today);
  if (Number.isNaN(days) || days < 0) return 2;
  if (days <= 7) return 0;
  if (days <= 30) return 1;
  return 2;
}

// Sortable form of a DD-MM-YYYY date; '' for none.
function sortableDate(dmy) {
  const p = parseDate(dmy);
  return p ? `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}` : '';
}

export function rankPlayers(players, today) {
  return players
    .map((p) => ({ p, g: group(p, today), d: sortableDate(p.last) }))
    .sort((a, b) =>
      a.g - b.g
      || (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)
      || (b.p.games || 0) - (a.p.games || 0)
      || (a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : 0))
    .map((x) => x.p);
}

export function suggest(players, typed, taken, today, limit = 8) {
  const prefix = lower(typed || '').trim();
  const used = new Set((taken || []).map(lower));
  const matches = rankPlayers(players, today)
    .filter((p) => !used.has(lower(p.name)) && lower(p.name).startsWith(prefix));
  // A name typed in full comes first, whoever else starts with the same letters.
  const exact = matches.filter((p) => lower(p.name) === prefix);
  const longer = matches.filter((p) => lower(p.name) !== prefix);
  return [...exact, ...longer].slice(0, limit).map((p) => p.name);
}

export function todayChips(dayGames, taken) {
  const used = new Set((taken || []).map(lower));
  const out = [];
  const latestFirst = dayGames
    .filter((g) => g.status === 'ok')
    .sort((a, b) => b.savedAt - a.savedAt);
  for (const g of latestFirst) {
    for (const name of [g.rd, g.rf, g.bd, g.bf]) {
      if (used.has(lower(name))) continue;
      used.add(lower(name));
      out.push(name);
    }
  }
  return out;
}

export function resolveName(players, typed) {
  const text = String(typed == null ? '' : typed).trim();
  if (text === '') return { kind: 'empty' };
  const match = players.find((p) => lower(p.name) === lower(text));
  if (match) return { kind: 'existing', name: match.name };
  const name = text[0].toUpperCase() + text.slice(1);
  return isValidName(name) ? { kind: 'new', name } : { kind: 'invalid' };
}
