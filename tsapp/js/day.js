// Which date the entry form should be on. A game filed under the wrong day is
// a game the organiser may never copy, so the form drifts back to today.

export const AWAY_MS = 10 * 60 * 1000;

export function settleDate({ date, followToday, today, awayMs = 0, editing = false }) {
  if (followToday) return { date: today, followToday: true };
  // A past date was picked on purpose. It stays while games are being
  // entered, and is dropped once the phone has been put away for a while.
  if (!editing && awayMs >= AWAY_MS) return { date: today, followToday: true };
  return { date, followToday };
}
