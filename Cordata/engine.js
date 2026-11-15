// Motore delle regole di "Cordata", scacchi 5×8 con batterie di pedoni (REGOLE.md v1.2).
// I numeri fra parentesi nei commenti rimandano ai paragrafi di REGOLE.md.
// Funziona sia nel browser (globale `Engine`) sia in Node (module.exports).
(function (root, factory) {
  const E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.Engine = E;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NF = 5, NR = 8, N = NF * NR;                      // (1.1)
  const KING = 'R', ROOK = 'T', KNIGHT = 'C', BISHOP = 'A', PAWN = 'P'; // re, torre, cavallo, alfiere, pedone
  const FILE_NAMES = 'abcde';
  const CLASSIC = 'TCRCT';                                     // (2.4) disposizione classica della prima traversa
  const START = 'tcrct/ppppp/p1p1p/5/5/P1P1P/PPPPP/TCRCT B -'; // (2.1) con la disposizione classica

  const sq = (f, r) => r * NF + f;
  const fileOf = s => s % NF;
  const rankOf = s => (s - (s % NF)) / NF;
  const onBoard = (f, r) => f >= 0 && f < NF && r >= 0 && r < NR;
  const sqName = s => FILE_NAMES[fileOf(s)] + (rankOf(s) + 1);
  const colorOf = p => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b');
  const typeOf = p => p.toUpperCase();
  const other = c => (c === 'w' ? 'b' : 'w');
  const dirOf = c => (c === 'w' ? 1 : -1);                // (1.3) "in avanti"
  const startRank = c => (c === 'w' ? 1 : NR - 2);
  const lastRank = c => (c === 'w' ? NR - 1 : 0);
  const pawnOf = c => (c === 'w' ? 'P' : 'p');

  const KING_STEPS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const KNIGHT_STEPS = [[-2, -1], [-1, -2], [1, -2], [2, -1], [-2, 1], [-1, 2], [1, 2], [2, 1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP_DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

  // ---------------------------------------------------------------- posizioni

  // Formato: traverse dall'ottava alla prima separate da "/", cifre per le case
  // vuote, T C A R P (maiuscole = Bianco, minuscole = Nero); poi chi muove (B o N)
  // e la casa di presa en passant ("-" se non c'è).
  function parse(text) {
    const parts = String(text).trim().split(/\s+/);
    const rows = (parts[0] || '').split('/');
    if (rows.length !== NR) throw new Error(`Servono ${NR} traverse separate da "/".`);
    const board = new Array(N).fill('.');
    rows.forEach((row, i) => {
      const r = NR - 1 - i;
      let f = 0;
      for (const ch of row) {
        if (/[1-5]/.test(ch)) { f += Number(ch); continue; }
        if (!/[TCARPtcarp]/.test(ch)) throw new Error(`Simbolo non valido "${ch}" nella traversa ${r + 1}.`);
        if (f >= NF) throw new Error(`La traversa ${r + 1} ha più di ${NF} case.`);
        board[sq(f, r)] = ch;
        f++;
      }
      if (f !== NF) throw new Error(`La traversa ${r + 1} deve avere ${NF} case.`);
    });
    const t = (parts[1] || 'B').toUpperCase();
    if (!'BWN'.includes(t) || t.length !== 1) throw new Error('Chi muove: scrivi B (Bianco) o N (Nero).');
    const turn = t === 'N' ? 'b' : 'w';
    let ep = -1;
    const e = parts[2] || '-';
    if (e !== '-') {
      const m = /^([a-e])([1-8])$/.exec(e);
      if (!m) throw new Error(`Casa en passant non valida: "${e}".`);
      ep = sq(FILE_NAMES.indexOf(m[1]), Number(m[2]) - 1);
    }
    return { board, turn, ep, half: 0, full: 1 };
  }

  function serialize(st) {
    const rows = [];
    for (let r = NR - 1; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < NF; f++) {
        const p = st.board[sq(f, r)];
        if (p === '.') { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} ${st.turn === 'w' ? 'B' : 'N'} ${st.ep >= 0 ? sqName(st.ep) : '-'}`;
  }

  const initial = () => parse(START);

  // (2.2) Errori nella scelta dei cinque pezzi della prima traversa, scritti dalla
  // colonna a alla colonna e (per esempio "TCRCT"); elenco vuoto se la scelta è valida.
  function rankErrors(text) {
    const rank = String(text).toUpperCase(), errors = [];
    if (rank.length !== NF || /[^TCAR]/.test(rank)) {
      return [`Servono ${NF} pezzi scelti fra re (R), torre (T), cavallo (C) e alfiere (A).`];
    }
    const count = t => rank.split(t).length - 1;
    if (count(KING) !== 1) errors.push(`Serve esattamente un re (ce ne sono ${count(KING)}).`);
    if (count(ROOK) > 2) errors.push(`Al massimo due torri (ce ne sono ${count(ROOK)}).`);
    return errors;        // con cinque case e un re, cavalli e alfieri sono al massimo quattro
  }

  // (2) Posizione iniziale con le prime traverse scelte dai due giocatori, entrambe
  // scritte dalla colonna a alla colonna e. I pedoni sono fissi (2.1).
  function startPosition(white, black) {
    for (const [name, rank] of [['Bianco', white], ['Nero', black]]) {
      const errors = rankErrors(rank);
      if (errors.length) throw new Error(`${name}: ${errors.join(' ')}`);
    }
    return parse(`${String(black).toLowerCase()}/ppppp/p1p1p/5/5/P1P1P/PPPPP/${String(white).toUpperCase()} B -`);
  }
  const keyOf = st => st.board.join('') + st.turn + st.ep;
  const findKing = (board, c) => board.indexOf(c === 'w' ? 'R' : 'r');

  // Controlli su una posizione costruita a mano.
  function validate(st) {
    const errors = [];
    for (const c of ['w', 'b']) {
      const n = st.board.filter(p => p === (c === 'w' ? 'R' : 'r')).length;
      if (n !== 1) errors.push(`Il ${c === 'w' ? 'Bianco' : 'Nero'} deve avere esattamente un re (ne ha ${n}).`);
    }
    for (let s = 0; s < N; s++) {
      if (typeOf(st.board[s]) === PAWN && (rankOf(s) === 0 || rankOf(s) === NR - 1)) {
        errors.push(`Pedone in ${sqName(s)}: un pedone non può stare sulla prima o sull'ottava traversa.`);
      }
    }
    if (!errors.length && inCheck(st.board, other(st.turn))) {
      errors.push(`Il re del ${st.turn === 'w' ? 'Nero' : 'Bianco'} è sotto scacco ma la mossa è all'avversario: il re potrebbe essere catturato (6.2).`);
    }
    return errors;
  }

  // ------------------------------------------------------------------ attacchi

  // Elenco dei pezzi del colore `by` che attaccano la casa `s`.
  // kind 'battery' = attacco frontale di una batteria (5.4); `from` è il pedone di testa.
  function attackers(board, s, by) {
    const out = [];
    const f = fileOf(s), r = rankOf(s);
    const has = (ff, rr, t) => onBoard(ff, rr) && board[sq(ff, rr)] === (by === 'w' ? t : t.toLowerCase());
    for (const [df, dr] of KNIGHT_STEPS) if (has(f + df, r + dr, KNIGHT)) out.push({ kind: 'piece', from: sq(f + df, r + dr) });
    for (const [df, dr] of KING_STEPS) if (has(f + df, r + dr, KING)) out.push({ kind: 'piece', from: sq(f + df, r + dr) });
    for (const [df, dr] of ROOK_DIRS) {
      let ff = f + df, rr = r + dr;
      while (onBoard(ff, rr) && board[sq(ff, rr)] === '.') { ff += df; rr += dr; }
      if (has(ff, rr, ROOK)) out.push({ kind: 'piece', from: sq(ff, rr) });
    }
    for (const [df, dr] of BISHOP_DIRS) {
      let ff = f + df, rr = r + dr;
      while (onBoard(ff, rr) && board[sq(ff, rr)] === '.') { ff += df; rr += dr; }
      if (has(ff, rr, BISHOP)) out.push({ kind: 'piece', from: sq(ff, rr) });
    }
    const d = dirOf(by);
    for (const df of [-1, 1]) if (has(f + df, r - d, PAWN)) out.push({ kind: 'piece', from: sq(f + df, r - d) }); // (4.3)
    if (has(f, r - d, PAWN) && has(f, r - 2 * d, PAWN)) out.push({ kind: 'battery', from: sq(f, r - d) });          // (5.4)
    return out;
  }

  const isAttacked = (board, s, by) => attackers(board, s, by).length > 0;

  function inCheck(board, c) {
    const k = findKing(board, c);
    return k >= 0 && isAttacked(board, k, other(c));
  }

  // Batterie presenti sulla scacchiera (5.1): gruppi massimali di due o più
  // pedoni dello stesso colore su case consecutive di una colonna.
  function batteries(board) {
    const out = [];
    for (let s = 0; s < N; s++) {
      const p = board[s];
      if (typeOf(p) !== PAWN) continue;
      const c = colorOf(p), d = dirOf(c), f = fileOf(s), r = rankOf(s);
      if (onBoard(f, r + d) && board[sq(f, r + d)] === p) continue; // non è il pedone di testa
      const squares = [s];
      while (onBoard(f, r - squares.length * d) && board[sq(f, r - squares.length * d)] === p) {
        squares.push(sq(f, r - squares.length * d));
      }
      if (squares.length >= 2) out.push({ color: c, squares, front: onBoard(f, r + d) ? sq(f, r + d) : -1 });
    }
    return out;
  }

  // --------------------------------------------------------------------- mosse

  // Una mossa: { from, to, piece, kind, k, captured, capSq }
  //   kind 'move'   mossa o cattura normale
  //   kind 'double' passo doppio del pedone (4.2)
  //   kind 'ep'     presa en passant (4.4); capSq = casa del pedone catturato
  //   kind 'join'   aggancio (4.6): passo diagonale senza cattura accanto a un compagno
  //   kind 'block'  avanzata in blocco dei k pedoni più avanzati (5.2);
  //                 from/to si riferiscono al pedone di testa
  function pseudoMoves(st) {
    const b = st.board, c = st.turn, out = [];
    const add = (from, to, kind, extra) => out.push(Object.assign(
      { from, to, piece: b[from], kind, k: 1, captured: b[to], capSq: b[to] === '.' ? -1 : to }, extra));

    for (let s = 0; s < N; s++) {
      const p = b[s];
      if (colorOf(p) !== c) continue;
      const t = typeOf(p), f = fileOf(s), r = rankOf(s);

      if (t === KING || t === KNIGHT) {                               // (3.2)
        for (const [df, dr] of t === KING ? KING_STEPS : KNIGHT_STEPS) {
          if (onBoard(f + df, r + dr) && colorOf(b[sq(f + df, r + dr)]) !== c) add(s, sq(f + df, r + dr), 'move');
        }
      } else if (t === ROOK || t === BISHOP) {                        // (3.2)
        for (const [df, dr] of t === ROOK ? ROOK_DIRS : BISHOP_DIRS) {
          let ff = f + df, rr = r + dr;
          while (onBoard(ff, rr)) {
            const q = b[sq(ff, rr)];
            if (colorOf(q) !== c) add(s, sq(ff, rr), 'move');
            if (q !== '.') break;
            ff += df; rr += dr;
          }
        }
      } else {
        const d = dirOf(c), r1 = r + d;
        if (!onBoard(f, r1)) continue;
        const fwd = sq(f, r1);
        if (b[fwd] === '.') {
          add(s, fwd, 'move');                                        // (4.1) e (5.3)
          if (r === startRank(c) && b[sq(f, r + 2 * d)] === '.') add(s, sq(f, r + 2 * d), 'double'); // (4.2)
        }
        for (const df of [-1, 1]) {                                   // (4.3), (5.6)
          if (!onBoard(f + df, r1)) continue;
          const to = sq(f + df, r1);
          if (b[to] !== '.' && colorOf(b[to]) !== c) add(s, to, 'move');
          else if (b[to] === '.' && to === st.ep) {                   // (4.4)
            add(s, to, 'ep', { captured: b[sq(f + df, r)], capSq: sq(f + df, r) });
          } else if (b[to] === '.') {
            // (4.6) aggancio: la casa d'arrivo è subito dietro o subito davanti a un pedone compagno.
            const behindMate = onBoard(f + df, r1 + d) && b[sq(f + df, r1 + d)] === p;
            const aheadOfMate = b[sq(f + df, r)] === p;
            if (behindMate || aheadOfMate) add(s, to, 'join');
          }
        }
        // (5.2) avanzata in blocco: s è il pedone di testa se davanti non c'è un pezzo proprio.
        if (colorOf(b[fwd]) !== c) {
          let n = 1;
          while (onBoard(f, r - n * d) && b[sq(f, r - n * d)] === p) n++;
          for (let k = 2; k <= n; k++) add(s, fwd, 'block', { k });   // sempre di una sola casa (5.8)
        }
      }
    }
    return out;
  }

  // Vero se la mossa porta un pedone sull'ultima traversa (6.1c).
  const arrives = m => typeOf(m.piece) === PAWN && rankOf(m.to) === lastRank(colorOf(m.piece));

  function apply(st, m) {
    const b = st.board.slice(), c = st.turn, step = dirOf(c) * NF;
    let ep = -1;
    if (m.kind === 'block') {
      for (let i = 0; i < m.k; i++) { const s = m.from - i * step; b[s + step] = b[s]; b[s] = '.'; }
    } else {
      if (m.kind === 'ep') b[m.capSq] = '.';
      b[m.to] = b[m.from];
      b[m.from] = '.';
      if (m.kind === 'double') {
        // La casa en passant si registra solo se un pedone avversario può usarla.
        const f = fileOf(m.to), r = rankOf(m.to);
        for (const df of [-1, 1]) if (onBoard(f + df, r) && b[sq(f + df, r)] === pawnOf(other(c))) ep = m.from + step;
      }
    }
    const resets = typeOf(m.piece) === PAWN || m.captured !== '.';
    return { board: b, turn: other(c), ep, half: resets ? 0 : st.half + 1, full: st.full + (c === 'b' ? 1 : 0) };
  }

  // (3.3) è illegale lasciare il proprio re sotto scacco;
  // (3.4) tranne quando la mossa porta un pedone sull'ultima traversa.
  function legalMoves(st) {
    return pseudoMoves(st).filter(m => arrives(m) || !inCheck(apply(st, m).board, st.turn));
  }

  // ------------------------------------------------------------ fine partita

  // Esito della posizione `st`, raggiunta con `lastMove` (null per una posizione
  // di partenza). `count` = quante volte la posizione è comparsa finora.
  function judge(st, lastMove, count) {
    const mover = other(st.turn);
    if (lastMove && arrives(lastMove)) return { winner: mover, reason: 'arrivo' };      // (6.1c)
    if (legalMoves(st).length === 0) {
      return { winner: mover, reason: inCheck(st.board, st.turn) ? 'matto' : 'stallo' }; // (6.1a), (6.1b)
    }
    if (st.board.every(p => p === '.' || typeOf(p) === KING)) return { winner: null, reason: 'morta' }; // (6.3)
    if (count >= 3) return { winner: null, reason: 'ripetizione' };                     // (6.3)
    if (st.half >= 100) return { winner: null, reason: '50mosse' };                     // (6.3)
    return null;
  }

  // ---------------------------------------------------------------- notazione

  // Pezzi: R re, T torre, C cavallo, A alfiere. "×" cattura. Avanzata in blocco di k pedoni:
  // casa d'arrivo del pedone di testa seguita da [k], per esempio b5[2] o b×b5[2].
  // Aggancio: colonna di partenza e casa d'arrivo senza "×", per esempio bc4.
  function san(st, m, legal) {
    const t = typeOf(m.piece), cap = m.captured !== '.';
    if (t === PAWN) {
      const head = cap ? FILE_NAMES[fileOf(m.from)] + '×' : m.kind === 'join' ? FILE_NAMES[fileOf(m.from)] : '';
      return head + sqName(m.to) + (m.kind === 'block' ? `[${m.k}]` : '') + (m.kind === 'ep' ? ' e.p.' : '');
    }
    const rivals = (legal || legalMoves(st)).filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
    let dis = '';
    if (rivals.length) {
      if (!rivals.some(o => fileOf(o.from) === fileOf(m.from))) dis = FILE_NAMES[fileOf(m.from)];
      else if (!rivals.some(o => rankOf(o.from) === rankOf(m.from))) dis = String(rankOf(m.from) + 1);
      else dis = sqName(m.from);
    }
    return t + dis + (cap ? '×' : '') + sqName(m.to);
  }

  // ------------------------------------------------------------------ partita

  function createGame(start) {
    const st = start || initial();
    return { states: [st], moves: [], sans: [], results: [judge(st, null, 1)] };
  }

  function play(game, m) {
    const last = game.states.length - 1;
    if (game.results[last]) throw new Error('La partita è finita.');
    const st = game.states[last];
    const legal = legalMoves(st);
    const move = legal.find(o => o.from === m.from && o.to === m.to && o.kind === m.kind && o.k === m.k);
    if (!move) throw new Error('Mossa illegale.');
    const next = apply(st, move);
    const key = keyOf(next);
    const count = 1 + game.states.filter(s => keyOf(s) === key).length;
    const result = judge(next, move, count);
    let text = san(st, move, legal);
    if (result && result.reason === 'matto') text += '#';
    else if (result && result.reason === 'arrivo') text += ' (arrivo)';
    else if (result && result.reason === 'stallo') text += ' (stallo)';
    else if (inCheck(next.board, next.turn)) text += '+';
    game.states.push(next);
    game.moves.push(move);
    game.sans.push(text);
    game.results.push(result);
    return result;
  }

  // Taglia la partita dopo `ply` semimosse.
  function truncate(game, ply) {
    game.states.length = ply + 1;
    game.results.length = ply + 1;
    game.moves.length = ply;
    game.sans.length = ply;
  }

  return {
    NF, NR, N, KING, ROOK, KNIGHT, BISHOP, PAWN, FILE_NAMES, START, CLASSIC,
    sq, fileOf, rankOf, sqName, colorOf, typeOf, other, dirOf,
    parse, serialize, initial, rankErrors, startPosition, validate, keyOf, findKing,
    attackers, isAttacked, inCheck, batteries,
    pseudoMoves, legalMoves, arrives, apply, judge, san,
    createGame, play, truncate,
  };
});
