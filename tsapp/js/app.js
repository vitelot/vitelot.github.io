// The entry screen. Decisions live in the other modules; this file connects
// them to the page.
import { formatDate, isoToDmy, dmyToIso, parseDate, scoreFromLoser, validateGame, MAX_LOSER_GOALS } from './rules.js';
import { suggest, todayChips, resolveName } from './suggest.js';
import { toTsv, findRecentDuplicate, duplicateIds, copyStatus, markCopied, uncopiedDays } from './games.js';
import { settleDate } from './day.js';
import { decodeSetup } from './setupcode.js';
import { makeStore } from './store.js';
import { makeApi } from './api.js';
import { makeSync } from './sync.js';

const BOXES = ['rd', 'rf', 'bd', 'bf'];
const NO_LINK = 'Ask for the link in the WhatsApp group.';
const BAD_LINK = 'This link is no longer valid. Ask for the new one in the WhatsApp group.';
const RETRY_MS = 30000;

const $ = (id) => document.getElementById(id);
const el = {
  gate: $('gate'), entry: $('entry'), day: $('day'), date: $('date'),
  box: Object.fromEntries(BOXES.map((b) => [b, $('box-' + b)])),
  suggestions: $('suggestions'), newPlayer: $('new-player'), newPlayerText: $('new-player-text'),
  addPlayer: $('add-player'), cancelPlayer: $('cancel-player'),
  chipsRow: $('chips-row'), chips: $('chips'),
  swap: $('swap-sides'), clear: $('clear-players'),
  winRed: $('win-red'), winBlue: $('win-blue'), beads: $('beads'),
  stepper: $('stepper'), loserValue: $('loser-value'), minus: $('loser-minus'), plus: $('loser-plus'),
  preview: $('score-preview'), save: $('save'), cancelEdit: $('cancel-edit'), message: $('message'),
  dayTitle: $('day-title'), copy: $('copy'), copyAll: $('copy-all'), status: $('status'),
  empty: $('empty'), games: $('games'), syncNote: $('sync-note'), otherDays: $('other-days'),
  dateField: document.querySelector('.date-field'),
  confirm: $('confirm'), confirmText: $('confirm-text'), confirmYes: $('confirm-yes'), confirmNo: $('confirm-no'),
};

const today = () => formatDate(new Date());
const lower = (s) => s.toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Some browsers forbid storage altogether (blocked cookies). The store then
// keeps things in memory for the visit; the link still carries the setup.
function phoneStorage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem() { throw new Error('storage is forbidden'); }, removeItem() {} };
  }
}

const store = makeStore(phoneStorage());
let api = null;
let sync = null;

const state = {
  date: today(),
  followToday: true,        // the date moves on by itself at midnight
  names: { rd: '', rf: '', bd: '', bf: '' },   // names chosen for sure
  activeBox: null,
  askNew: null,             // { box, name } while "Add new player?" is shown
  winner: null,
  loser: null,
  more: false,              // the 9+ stepper is open
  editing: null,            // { id, savedAt } of the game being changed
  addedPlayers: [],         // new names accepted during this visit
  offline: false,
  changes: 0,               // grows whenever the queue changes
  freshId: null,
  hiddenAt: null,           // when the page went to the background
  loading: null,            // the date being asked to the shared sheet
  loaded: new Set(),        // dates received from the shared sheet in this visit
  loadProblem: null,        // { date, kind } of the last failed request
  recent: [],               // games of the last days, as the shared sheet has them
};

// ------------------------------------------------------------------ start

function start() {
  const fromLink = decodeSetup(location.hash.slice(1));
  if (fromLink) store.setSetup(location.hash.slice(1));
  const setup = fromLink || decodeSetup(store.getSetup());
  if (!setup) {
    showGate(NO_LINK);
    return;
  }
  api = makeApi(setup);
  sync = makeSync({ api, store, onChange: () => { state.changes++; render(); } });

  buildBeads();
  bind();
  el.entry.hidden = false;
  el.day.hidden = false;
  render();
  refresh();
  flush();

  setInterval(() => {
    keepTheDay();
    if (sync.pending().length) flush();
  }, RETRY_MS);
  window.addEventListener('online', () => { flush(); refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      state.hiddenAt = Date.now();
      return;
    }
    const away = state.hiddenAt === null ? 0 : Date.now() - state.hiddenAt;
    state.hiddenAt = null;
    if (!keepTheDay(away)) refresh();
    flush();
  });
}

function showGate(text) {
  el.gate.textContent = text;
  el.gate.hidden = false;
  el.entry.hidden = true;
  el.day.hidden = true;
  document.documentElement.dataset.loaded = '1';
}

// Moves the form to today when the day has changed, or when a past date was
// left selected and the phone was put away. True when the date changed.
function keepTheDay(awayMs = 0) {
  const next = settleDate({
    date: state.date, followToday: state.followToday, today: today(), awayMs, editing: !!state.editing,
  });
  if (next.date === state.date && next.followToday === state.followToday) return false;
  state.date = next.date;
  state.followToday = next.followToday;
  render();
  refresh();
  return true;
}

function showDate(date) {
  state.date = date;
  state.followToday = date === today();
  render();
  refresh();
}

// ------------------------------------------------------------------ the shared sheet

async function refresh() {
  const date = state.date;
  const seen = state.changes;
  state.loading = date;
  render();
  try {
    const data = await api.load(date);
    if (seen !== state.changes) {
      // Something was sent while this answer was on its way: ask again.
      return refresh();
    }
    store.setPlayers(data.players);
    store.setDay(date, data.games);
    state.recent = data.recent;
    state.loaded.add(date);
    state.loadProblem = null;
    state.offline = false;
  } catch (err) {
    const kind = (err && err.kind) || 'network';
    if (kind === 'bad_key') {
      showGate(BAD_LINK);
      return undefined;
    }
    state.loadProblem = { date, kind };
    state.offline = kind === 'network';
  }
  if (state.loading === date) state.loading = null;
  document.documentElement.dataset.loaded = '1';
  render();
  return undefined;
}

// Whether the list of the shown date is known to be what the shared sheet has.
function listProblem() {
  const date = state.date;
  if (state.loadProblem && state.loadProblem.date === date) {
    return state.loadProblem.kind === 'network'
      ? 'Could not update: this list may be incomplete.'
      : 'The shared sheet answered with an error: this list may be incomplete.';
  }
  if (!state.loaded.has(date)) return state.loading === date ? 'Updating…' : 'Not updated yet: this list may be incomplete.';
  return '';
}

async function flush() {
  const result = await sync.flush();
  if (result.stopped === 'bad_key') {
    showGate(BAD_LINK);
    return;
  }
  state.offline = result.stopped === 'network';
  if (result.dropped) say('A game was refused by the shared sheet and removed.', true);
  if (result.sent) refresh();
  render();
}

// ------------------------------------------------------------------ players

function players() {
  const list = [...(store.getPlayers() || [])];
  const known = new Set(list.map((p) => lower(p.name)));
  const add = (name) => {
    if (known.has(lower(name))) return;
    known.add(lower(name));
    list.push({ name, last: '', games: 0 });
  };
  state.addedPlayers.forEach((p) => add(p.name));
  for (const op of sync.pending()) {
    if (op.op === 'put') [op.game.rd, op.game.rf, op.game.bd, op.game.bf].forEach(add);
  }
  return list;
}

const takenExcept = (box) => BOXES.filter((b) => b !== box).map((b) => state.names[b]).filter(Boolean);
const firstEmptyBox = () => BOXES.find((b) => !state.names[b] && el.box[b].value.trim() === '') || null;

function setBox(box, name) {
  state.names[box] = name;
  el.box[box].value = name;
}

function choose(box, name) {
  setBox(box, name);
  state.askNew = null;
  const next = firstEmptyBox();
  if (next) {
    el.box[next].focus();
  } else {
    state.activeBox = null;
    el.box[box].blur();
  }
  render();
}

// Settles what was typed in a box when the person leaves it.
function settle(box) {
  const input = el.box[box];
  if (state.names[box] && input.value === state.names[box]) return;
  const found = resolveName(players(), input.value);
  if (found.kind === 'empty') {
    setBox(box, '');
  } else if (found.kind === 'existing') {
    if (takenExcept(box).map(lower).includes(lower(found.name))) {
      setBox(box, '');
      say(`${found.name} is already playing.`, true);
    } else {
      setBox(box, found.name);
    }
  } else if (found.kind === 'new') {
    state.names[box] = '';
    state.askNew = { box, name: found.name };
  } else {
    state.names[box] = '';
    say('One word, letters and digits, e.g. MartaB', true);
  }
  render();
}

function bindBox(box) {
  const input = el.box[box];
  input.addEventListener('focus', () => {
    state.activeBox = box;
    input.select();
    render();
  });
  input.addEventListener('input', () => {
    state.names[box] = '';
    state.askNew = null;      // typing anywhere takes the question away
    say('');
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    // A name typed in full is that player, whoever else starts the same way.
    const found = resolveName(players(), input.value);
    const offered = currentSuggestions();
    if (found.kind === 'existing' || input.value.trim() === '' || offered.length === 0) {
      settle(box);
      if (state.names[box]) choose(box, state.names[box]);
    } else {
      choose(box, offered[0]);
    }
  });
  input.addEventListener('blur', () => {
    // Wait a moment: the tap on a suggestion arrives just after the blur.
    setTimeout(() => {
      if (state.activeBox === box && document.activeElement !== input) state.activeBox = null;
      settle(box);
    }, 200);
  });
}

// The box the suggestions are for: the one being asked about, else the one
// being typed in.
const suggestionBox = () => (state.askNew ? state.askNew.box : state.activeBox);

function currentSuggestions() {
  const box = suggestionBox();
  if (!box) return [];
  const typed = el.box[box].value;
  if (state.names[box] && typed === state.names[box]) return [];
  return suggest(players(), typed, takenExcept(box), today());
}

const isUnsettled = (box) => !state.names[box] && el.box[box].value.trim() !== '';

// Buttons that put a name in a box must not take the focus away from it.
function nameButton(name, testid, onTap) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.dataset.testid = testid;
  button.tabIndex = -1;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', onTap);
  return button;
}

// ------------------------------------------------------------------ score

function buildBeads() {
  for (let n = 0; n <= 9; n++) {
    const bead = document.createElement('button');
    bead.type = 'button';
    bead.className = 'bead';
    bead.textContent = n === 9 ? '9+' : String(n);
    bead.dataset.testid = n === 9 ? 'loser-more' : 'loser-' + n;
    bead.setAttribute('aria-label', n === 9 ? '9 goals or more' : plural(n, 'goal'));
    bead.addEventListener('click', () => {
      state.more = n === 9;
      state.loser = n;
      render();
    });
    el.beads.append(bead);
  }
}

function currentScore() {
  if (!state.winner || state.loser === null) return null;
  return scoreFromLoser(state.winner, state.loser);
}

function clearScore() {
  state.winner = null;
  state.loser = null;
  state.more = false;
}

// ------------------------------------------------------------------ saving

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function canSave() {
  return !!parseDate(state.date)
    && !state.askNew
    && BOXES.every((b) => state.names[b] && el.box[b].value === state.names[b])
    && currentScore() !== null;
}

// What is still needed before the game can be saved, in the order of the screen.
function missingStep() {
  if (BOXES.some((b) => isUnsettled(b) && b !== state.activeBox)) return 'Finish the name in the marked box';
  if (!BOXES.every((b) => state.names[b] && el.box[b].value === state.names[b])) return 'Four players, then the score';
  if (!state.winner) return 'Who won?';
  if (state.loser === null) return 'How many goals for the losing team?';
  return '';
}

function minutesAgo(savedAt) {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  return minutes < 1 ? 'less than a minute' : `${minutes} min`;
}

async function save() {
  keepTheDay();
  if (!canSave()) return;
  const game = {
    id: state.editing ? state.editing.id : newId(),
    savedAt: state.editing ? state.editing.savedAt : Date.now(),
    date: state.date,
    ...state.names,
    ...currentScore(),
    status: 'ok',
  };
  if (validateGame(game).length) {
    say('This game cannot be saved: check players and score.', true);
    return;
  }
  const twin = findRecentDuplicate(game, sync.viewDay(game.date));
  if (twin && !(await ask(`Already entered ${minutesAgo(twin.savedAt)} ago. Save anyway?`, 'Save anyway', 'No'))) return;

  const wasEdit = !!state.editing;
  state.editing = null;
  state.freshId = game.id;
  clearScore();
  sync.enqueue({ op: 'put', game });
  say(wasEdit ? 'Changes saved' : 'Game saved');
  flush();
}

function edit(game) {
  state.editing = { id: game.id, savedAt: game.savedAt };
  state.askNew = null;
  for (const b of BOXES) setBox(b, game[b]);
  state.winner = game.red > game.blue ? 'red' : 'blue';
  state.loser = Math.min(game.red, game.blue);
  state.more = state.loser >= 9;
  say('');
  render();
  el.entry.scrollIntoView({ block: 'start' });
}

async function remove(game) {
  if (!(await ask('Delete this game?', 'Delete', 'Keep'))) return;
  if (state.editing && state.editing.id === game.id) state.editing = null;
  sync.enqueue({ op: 'delete', id: game.id });
  say('Game deleted');
  flush();
}

// ------------------------------------------------------------------ copying

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page that is not allowed to use the clipboard.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { done = false; }
    area.remove();
    return done;
  }
}

function copyPlan() {
  const day = sync.viewDay(state.date);
  const live = day.filter((g) => g.status === 'ok');
  const copied = store.getCopied();
  const status = copyStatus(day, copied);
  const fresh = live.filter((g) => status.byId.get(g.id) === 'new');
  const partial = fresh.length >= 1 && fresh.length < live.length;
  return { day, live, copied, status, fresh, partial };
}

async function copy(all) {
  const plan = copyPlan();
  const games = all || !plan.partial ? plan.live : plan.fresh;
  if (!games.length) return;
  if (listProblem() && !(await ask('This list could not be updated and may be incomplete. Copy anyway?', 'Copy anyway', 'No'))) return;
  if (duplicateIds(plan.day).size && !(await ask('This day has possible duplicates. Copy anyway?', 'Copy anyway', 'No'))) return;
  if (!(await writeClipboard(toTsv(games)))) {
    say('Copying is not allowed in this browser.', true);
    return;
  }
  store.setCopied(markCopied(plan.copied, games));
  say(`Copied ${plural(games.length, 'game')}`);
  render();
}

// ------------------------------------------------------------------ questions and messages

let answer = null;

function ask(text, yes, no) {
  el.confirmText.textContent = text;
  el.confirmYes.textContent = yes;
  el.confirmNo.textContent = no;
  el.confirm.hidden = false;
  el.confirmNo.focus();
  return new Promise((resolve) => { answer = resolve; });
}

function reply(value) {
  el.confirm.hidden = true;
  if (answer) answer(value);
  answer = null;
}

function say(text, bad = false) {
  el.message.textContent = text;
  el.message.classList.toggle('bad', bad);
}

// ------------------------------------------------------------------ drawing

function render() {
  if (!sync) return;
  const isToday = state.date === today();

  el.date.max = dmyToIso(today());
  if (el.date.value !== dmyToIso(state.date)) el.date.value = dmyToIso(state.date);
  el.dateField.classList.toggle('past', !isToday);
  for (const b of BOXES) {
    const waiting = b === state.activeBox || (state.askNew && state.askNew.box === b);
    el.box[b].classList.toggle('unsettled', isUnsettled(b) && !waiting);
  }

  // names to tap
  const offered = currentSuggestions();
  el.suggestions.replaceChildren(...offered.map((name) =>
    nameButton(name, 'suggestion', () => { const box = suggestionBox(); if (box) choose(box, name); })));
  el.suggestions.hidden = offered.length === 0;

  el.newPlayer.hidden = !state.askNew;
  if (state.askNew) el.newPlayerText.textContent = `Add new player ${state.askNew.name}?`;

  const day = sync.viewDay(state.date);
  const empty = firstEmptyBox();
  const chips = empty ? todayChips(day, BOXES.map((b) => state.names[b]).filter(Boolean)) : [];
  el.chips.replaceChildren(...chips.map((name) =>
    nameButton(name, 'chip', () => { const box = firstEmptyBox(); if (box) choose(box, name); })));
  el.chipsRow.hidden = chips.length === 0;
  el.chipsRow.firstElementChild.textContent = isToday ? 'Today' : 'That day';

  // score
  el.winRed.setAttribute('aria-pressed', String(state.winner === 'red'));
  el.winBlue.setAttribute('aria-pressed', String(state.winner === 'blue'));
  [...el.beads.children].forEach((bead, n) => {
    const on = n === 9 ? state.more : (!state.more && state.loser === n);
    bead.setAttribute('aria-pressed', String(on));
  });
  el.stepper.hidden = !state.more;
  el.loserValue.textContent = state.more ? String(state.loser) : '9';
  el.minus.disabled = state.loser <= 9;
  el.plus.disabled = state.loser >= MAX_LOSER_GOALS;
  const score = currentScore();
  el.preview.textContent = score ? `RED ${score.red} – ${score.blue} BLUE` : '';
  el.preview.dataset.hint = missingStep();

  el.save.disabled = !canSave();
  el.save.textContent = state.editing ? 'Save changes' : (isToday ? 'Save game' : `Save game for ${state.date}`);
  el.cancelEdit.hidden = !state.editing;

  renderDay(day, isToday);
}

function renderDay(day, isToday) {
  const plan = copyPlan();
  // Copy marks are for the organiser: a phone that has never copied shows none.
  const marks = Object.keys(plan.copied).length > 0;
  const twins = duplicateIds(day);
  const shown = day.filter((g) => g.status === 'ok' || (marks && plan.status.byId.get(g.id) === 'deleted-after-copy'));

  el.dayTitle.textContent = `${isToday ? "Today's games" : 'Games of ' + state.date} (${plan.live.length})`;

  el.copy.hidden = plan.live.length === 0;
  el.copy.textContent = plan.partial ? `Copy ${plan.fresh.length} new` : 'Copy';
  el.copyAll.hidden = !plan.partial;

  const waiting = sync.pending().length;
  el.status.hidden = waiting === 0;
  el.status.textContent = `${plural(waiting, 'game')} waiting to be sent${state.offline ? ': no connection' : ''}`;

  const problem = listProblem();
  el.syncNote.hidden = problem === '';
  el.syncNote.textContent = problem;

  const others = uncopiedDays(state.recent, plan.copied, state.date);
  el.otherDays.hidden = others.length === 0;
  el.otherDays.replaceChildren(...others.map((d) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'other-day';
    button.textContent = `${d.date}: ${plural(d.count, 'game')} not copied yet`;
    button.addEventListener('click', () => showDate(d.date));
    return button;
  }));

  el.empty.hidden = shown.length > 0;
  if (state.loaded.has(state.date) || store.getDay(state.date)) {
    el.empty.textContent = isToday ? 'No games yet today.' : 'No games on this day.';
  } else {
    el.empty.textContent = state.loading === state.date ? 'Loading…' : 'Could not load the games of this day.';
  }

  el.games.replaceChildren(...shown.map((g) => gameRow(g, { twins, marks, plan })));
  state.freshId = null;
}

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function sideOf(className, first, second) {
  const side = span('side ' + className, '');
  side.append(span('', first + ' '), span('', second + ' '));
  return side;
}

function quietButton(label, testid, onTap) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet';
  button.textContent = label;
  button.dataset.testid = testid;
  button.addEventListener('click', onTap);
  return button;
}

function gameRow(g, { twins, marks, plan }) {
  const gone = g.status !== 'ok';
  const copyMark = marks ? (plan.status.byId.get(g.id) || '') : '';
  const li = document.createElement('li');
  li.className = 'game' + (gone ? ' gone' : '') + (g.id === state.freshId ? ' fresh' : '');
  li.dataset.testid = 'game-row';
  li.dataset.id = g.id;
  li.dataset.state = g.pending ? 'pending' : (twins.has(g.id) ? 'duplicate' : 'ok');
  li.dataset.copy = copyMark;

  const line = document.createElement('div');
  line.className = 'game-line';
  const result = span('result', '');
  const red = document.createElement(g.red > g.blue ? 'b' : 'span');
  red.textContent = g.red;
  const blue = document.createElement(g.blue > g.red ? 'b' : 'span');
  blue.textContent = g.blue;
  result.append(red, ' – ', blue, ' ');
  line.append(sideOf('red', g.rd, g.rf), result, sideOf('blue', g.bd, g.bf));

  const meta = document.createElement('div');
  meta.className = 'game-meta';
  const when = new Date(g.savedAt);
  const notes = span('notes', '');
  notes.append(span('time', when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  if (g.pending) notes.append(span('flag', 'sending…'));
  if (!gone && twins.has(g.id)) notes.append(span('flag', 'possible duplicate'));
  const copyWords = { new: 'not copied yet', changed: 'changed after copy', 'deleted-after-copy': 'deleted after copy' };
  if (copyWords[copyMark]) notes.append(span('flag', copyWords[copyMark]));
  const actions = span('actions', '');
  // A game can be changed on the day it was entered.
  if (!gone && formatDate(when) === today()) {
    actions.append(quietButton('Edit', 'edit', () => edit(g)), quietButton('Delete', 'delete', () => remove(g)));
  }
  meta.append(notes, actions);

  li.append(line, meta);
  return li;
}

// ------------------------------------------------------------------ wiring

function bind() {
  BOXES.forEach(bindBox);

  el.date.addEventListener('change', () => {
    const picked = isoToDmy(el.date.value);
    if (!parseDate(picked) || dmyToIso(picked) > dmyToIso(today())) {
      el.date.value = dmyToIso(state.date);
      return;
    }
    showDate(picked);
  });

  el.addPlayer.addEventListener('click', () => {
    const { box, name } = state.askNew;
    state.addedPlayers.push({ name, last: '', games: 0 });
    choose(box, name);
  });
  el.cancelPlayer.addEventListener('click', () => {
    const { box } = state.askNew;
    state.askNew = null;
    setBox(box, '');
    el.box[box].focus();
    render();
  });

  // The teams change side and, inside each team, the defender goes forward.
  const ACROSS = { rd: 'bf', rf: 'bd', bd: 'rf', bf: 'rd' };
  el.swap.addEventListener('click', () => {
    const n = { ...state.names };
    const typed = Object.fromEntries(BOXES.map((b) => [b, el.box[b].value]));
    for (const b of BOXES) {
      state.names[ACROSS[b]] = n[b];
      el.box[ACROSS[b]].value = typed[b];
    }
    if (state.askNew) state.askNew.box = ACROSS[state.askNew.box];
    if (state.winner) state.winner = state.winner === 'red' ? 'blue' : 'red';
    render();
  });
  el.clear.addEventListener('click', () => {
    BOXES.forEach((b) => setBox(b, ''));
    state.askNew = null;
    render();
  });

  el.winRed.addEventListener('click', () => { state.winner = 'red'; render(); });
  el.winBlue.addEventListener('click', () => { state.winner = 'blue'; render(); });
  el.minus.addEventListener('click', () => { if (state.loser > 9) state.loser--; render(); });
  el.plus.addEventListener('click', () => { if (state.loser < MAX_LOSER_GOALS) state.loser++; render(); });

  el.entry.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  el.cancelEdit.addEventListener('click', () => {
    state.editing = null;
    clearScore();
    say('');
    render();
  });

  el.copy.addEventListener('click', () => copy(false));
  el.copyAll.addEventListener('click', () => copy(true));

  el.confirmYes.addEventListener('click', () => reply(true));
  el.confirmNo.addEventListener('click', () => reply(false));
  el.confirm.addEventListener('click', (event) => { if (event.target === el.confirm) reply(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !el.confirm.hidden) reply(false); });
}

// The link tapped again while the page is open (a new key, or a phone that
// first opened the plain address): take the setup it carries.
window.addEventListener('hashchange', () => {
  const code = location.hash.slice(1);
  if (decodeSetup(code) && code !== store.getSetup()) {
    store.setSetup(code);
    location.reload();
  }
});

// Keeps a copy of the page on the phone, for when there is no signal.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
