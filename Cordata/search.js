// Ricerca alfa-beta di "Cordata" in JavaScript: traduzione di src/rules.jl e
// src/search.jl, per far giocare e analizzare il motore nel browser, senza server.
// Stesso generatore di mosse (nello stesso ordine), stesse chiavi Zobrist, stessa
// valutazione e stessa ricerca del motore Julia: a profondità fissa i due motori
// visitano lo stesso numero di posizioni (test/search.test.js lo verifica).
// I numeri fra parentesi rimandano ai paragrafi di REGOLE.md.
//
// `factory` non usa nulla di esterno: la pagina ne prende il testo per avviare
// un Web Worker (workerSource), così funziona anche aperta da file://.
(function (root) {
  function factory() {
    'use strict';

    const NF = 5, NR = 8, NSQ = NF * NR;
    const PAWN = 1, KNIGHT = 2, ROOK = 3, KING = 4;        // codice sulla scacchiera: tipo + 4 * colore
    const NORMAL = 0, DOUBLE = 1, ENPASSANT = 2, BLOCK = 3, JOIN = 4;
    const KINDS = ['move', 'double', 'ep', 'block', 'join']; // i nomi usati da engine.js
    const START = 'tcrct/ppppp/p1p1p/5/5/P1P1P/PPPPP/TCRCT B -';
    const LETTERS = 'PCTR';

    const MATE = 30000, MATE_ZONE = MATE - 1000, INF = 32000, MAXPLY = 128, MAXMOVES = 256;
    const PIECE_VALUE = [0, 100, 300, 500, 0];
    const ADVANCE = [0, 6, 16, 34, 64, 110];               // premio per i passi fatti da un pedone (0…5)
    const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

    const COLOR_OF = new Int8Array([-1, 0, 0, 0, 0, 1, 1, 1, 1]);
    const TYPE_OF = new Int8Array([0, 1, 2, 3, 4, 1, 2, 3, 4]);

    function jumpTable(steps) {
      const out = [];
      for (let s = 0; s < NSQ; s++) {
        const f = s % NF, r = (s - f) / NF, list = [];
        for (const [df, dr] of steps) {
          if (f + df >= 0 && f + df < NF && r + dr >= 0 && r + dr < NR) list.push((r + dr) * NF + f + df);
        }
        out.push(list.sort((a, b) => a - b));
      }
      return out;
    }
    const KING_T = jumpTable([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]);
    const KNIGHT_T = jumpTable([[-2, -1], [-1, -2], [1, -2], [2, -1], [-2, 1], [-1, 2], [1, 2], [2, 1]]);

    // Chiavi Zobrist a 64 bit, in due metà da 32: le stesse di src/rules.jl (splitmix64).
    const NZ = 8 * NSQ + NSQ + 1, Z_EP = 8 * NSQ, Z_TURN = NZ - 1;
    const ZLO = new Int32Array(NZ), ZHI = new Int32Array(NZ);
    (function () {
      const M = (1n << 64n) - 1n;
      let state = 0x5a17c0de5eed0001n;
      for (let i = 0; i < NZ; i++) {
        state = (state + 0x9e3779b97f4a7c15n) & M;
        let z = state;
        z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
        z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
        z ^= z >> 31n;
        ZLO[i] = Number(BigInt.asIntN(32, z));
        ZHI[i] = Number(BigInt.asIntN(32, z >> 32n));
      }
    })();

    // ------------------------------------------------------------ posizioni
    // Una pila di posizioni, una per livello della ricerca: il livello 0 è la radice.
    const BRD = new Int8Array(MAXPLY * NSQ);
    const TURN = new Int8Array(MAXPLY);       // 0 = Bianco, 1 = Nero
    const EP = new Int8Array(MAXPLY);         // casa di presa en passant, −1 se non c'è
    const HALF = new Int16Array(MAXPLY);      // semimosse senza catture né mosse di pedone
    const KLO = new Int32Array(MAXPLY), KHI = new Int32Array(MAXPLY);
    const KSQ = new Int8Array(MAXPLY * 2);    // casa dei due re
    const MEN = new Int8Array(MAXPLY);        // pezzi che non sono re (0 = posizione morta, 6.3)
    const MOVES = [], ORDER = [];
    for (let i = 0; i < MAXPLY; i++) { MOVES.push(new Int32Array(MAXMOVES)); ORDER.push(new Int32Array(MAXMOVES)); }

    // Una mossa è un intero: da (6 bit), a (6), tipo di mossa (3), k (3), pezzo (3), pezzo catturato (3).
    const mk = (from, to, kind, k, piece, cap) => from | (to << 6) | (kind << 12) | (k << 15) | (piece << 18) | (cap << 21);
    const mFrom = m => m & 63, mTo = m => (m >> 6) & 63, mKind = m => (m >> 12) & 7;
    const mK = m => (m >> 15) & 7, mPiece = m => (m >> 18) & 7, mCap = m => (m >> 21) & 7;
    const NOMOVE = 0;
    const moveObject = m => ({ from: mFrom(m), to: mTo(m), kind: KINDS[mKind(m)], k: mK(m) });

    // Vero se la mossa porta un pedone sull'ultima traversa (6.1c).
    const arrives = (m, us) => mPiece(m) === PAWN && (us === 0 ? mTo(m) >= NSQ - NF : mTo(m) < NF);

    // Mette al livello 0 la posizione scritta nel formato di engine.js.
    function setPosition(text, half) {
      const parts = String(text).trim().split(/\s+/);
      const rows = (parts[0] || '').split('/');
      if (rows.length !== NR) throw new Error(`Servono ${NR} traverse separate da "/".`);
      BRD.fill(0, 0, NSQ);
      KSQ[0] = KSQ[1] = -1;
      let men = 0, lo = 0, hi = 0;
      rows.forEach((row, i) => {
        const r = NR - 1 - i;
        let f = 0;
        for (const ch of row) {
          if (ch >= '1' && ch <= '5') { f += Number(ch); continue; }
          const t = LETTERS.indexOf(ch.toUpperCase()) + 1;
          if (!t) throw new Error(`Simbolo non valido "${ch}" nella traversa ${r + 1}.`);
          if (f >= NF) throw new Error(`La traversa ${r + 1} ha più di ${NF} case.`);
          const c = ch === ch.toUpperCase() ? 0 : 1, code = t + 4 * c, s = r * NF + f;
          BRD[s] = code;
          lo ^= ZLO[(code - 1) * NSQ + s]; hi ^= ZHI[(code - 1) * NSQ + s];
          if (t === KING) KSQ[c] = s; else men++;
          f++;
        }
        if (f !== NF) throw new Error(`La traversa ${r + 1} deve avere ${NF} case.`);
      });
      const t = (parts[1] || 'B').toUpperCase();
      if (t !== 'B' && t !== 'W' && t !== 'N') throw new Error('Chi muove: scrivi B (Bianco) o N (Nero).');
      TURN[0] = t === 'N' ? 1 : 0;
      EP[0] = -1;
      const e = parts[2] || '-';
      if (e !== '-') {
        if (!/^[a-e][1-8]$/.test(e)) throw new Error(`Casa en passant non valida: "${e}".`);
        EP[0] = (e.charCodeAt(1) - 49) * NF + (e.charCodeAt(0) - 97);
      }
      if (TURN[0] === 1) { lo ^= ZLO[Z_TURN]; hi ^= ZHI[Z_TURN]; }
      if (EP[0] >= 0) { lo ^= ZLO[Z_EP + EP[0]]; hi ^= ZHI[Z_EP + EP[0]]; }
      HALF[0] = half || 0;
      MEN[0] = men;
      KLO[0] = lo; KHI[0] = hi;
    }

    // ------------------------------------------------------------- attacchi

    // Vero se la casa s è attaccata dal colore `by` nella posizione che comincia in BRD[o].
    function isAttacked(o, s, by) {
      const f = s % NF, pawn = by * 4 + PAWN, d = by === 0 ? NF : -NF;
      const t = s - d;                                     // la casa da cui un pedone guarda s
      if (t >= 0 && t < NSQ) {
        if (f > 0 && BRD[o + t - 1] === pawn) return true;            // (4.3)
        if (f < NF - 1 && BRD[o + t + 1] === pawn) return true;
        if (BRD[o + t] === pawn) {                                    // (5.4) attacco frontale della batteria
          const u = t - d;
          if (u >= 0 && u < NSQ && BRD[o + u] === pawn) return true;
        }
      }
      const knight = by * 4 + KNIGHT, king = by * 4 + KING, rook = by * 4 + ROOK;
      let list = KNIGHT_T[s];
      for (let i = 0; i < list.length; i++) if (BRD[o + list[i]] === knight) return true;
      list = KING_T[s];
      for (let i = 0; i < list.length; i++) if (BRD[o + list[i]] === king) return true;
      let c;
      for (let u = s + 1, g = f + 1; g < NF; u++, g++) { c = BRD[o + u]; if (c !== 0) { if (c === rook) return true; break; } }
      for (let u = s - 1, g = f - 1; g >= 0; u--, g--) { c = BRD[o + u]; if (c !== 0) { if (c === rook) return true; break; } }
      for (let u = s + NF; u < NSQ; u += NF) { c = BRD[o + u]; if (c !== 0) { if (c === rook) return true; break; } }
      for (let u = s - NF; u >= 0; u -= NF) { c = BRD[o + u]; if (c !== 0) { if (c === rook) return true; break; } }
      return false;
    }

    function inCheck(ply, c) {
      const k = KSQ[ply * 2 + c];
      return k >= 0 && isAttacked(ply * NSQ, k, 1 - c);
    }

    // ---------------------------------------------------------------- mosse

    const SQ_KING = new Int8Array(NSQ), SQ_KNIGHT = new Int8Array(NSQ), SQ_ROOK = new Int8Array(NSQ), SQ_PAWN = new Int8Array(NSQ);
    const RAY = new Int8Array(NR);

    // Mosse pseudo-legali del livello `ply` in MOVES[ply], nell'ordine di gen_moves! (Julia):
    // re, cavalli, torri, pedoni, ciascun gruppo per case crescenti. Restituisce quante sono.
    function genMoves(ply) {
      const o = ply * NSQ, list = MOVES[ply], us = TURN[ply];
      let n = 0, nKing = 0, nKnight = 0, nRook = 0, nPawn = 0;
      for (let s = 0; s < NSQ; s++) {
        const c = BRD[o + s];
        if (c === 0 || COLOR_OF[c] !== us) continue;
        const t = TYPE_OF[c];
        if (t === PAWN) SQ_PAWN[nPawn++] = s;
        else if (t === KNIGHT) SQ_KNIGHT[nKnight++] = s;
        else if (t === ROOK) SQ_ROOK[nRook++] = s;
        else SQ_KING[nKing++] = s;
      }
      const push = m => { if (n < MAXMOVES) list[n++] = m; };

      for (let i = 0; i < nKing; i++) {                                 // (3.2)
        const s = SQ_KING[i], targets = KING_T[s];
        for (let j = 0; j < targets.length; j++) {
          const c = BRD[o + targets[j]];
          if (c === 0 || COLOR_OF[c] !== us) push(mk(s, targets[j], NORMAL, 1, KING, TYPE_OF[c]));
        }
      }
      for (let i = 0; i < nKnight; i++) {
        const s = SQ_KNIGHT[i], targets = KNIGHT_T[s];
        for (let j = 0; j < targets.length; j++) {
          const c = BRD[o + targets[j]];
          if (c === 0 || COLOR_OF[c] !== us) push(mk(s, targets[j], NORMAL, 1, KNIGHT, TYPE_OF[c]));
        }
      }
      for (let i = 0; i < nRook; i++) {
        const s = SQ_ROOK[i], f = s % NF;
        let cnt = 0, c;
        for (let u = s - NF; u >= 0; u -= NF) {                         // verso il basso, poi in ordine crescente
          c = BRD[o + u];
          if (c === 0) RAY[cnt++] = u; else { if (COLOR_OF[c] !== us) RAY[cnt++] = u; break; }
        }
        while (cnt > 0) { const u = RAY[--cnt]; push(mk(s, u, NORMAL, 1, ROOK, TYPE_OF[BRD[o + u]])); }
        for (let u = s - 1, g = f - 1; g >= 0; u--, g--) {
          c = BRD[o + u];
          if (c === 0) RAY[cnt++] = u; else { if (COLOR_OF[c] !== us) RAY[cnt++] = u; break; }
        }
        while (cnt > 0) { const u = RAY[--cnt]; push(mk(s, u, NORMAL, 1, ROOK, TYPE_OF[BRD[o + u]])); }
        for (let u = s + 1, g = f + 1; g < NF; u++, g++) {
          c = BRD[o + u];
          if (c === 0) push(mk(s, u, NORMAL, 1, ROOK, 0)); else { if (COLOR_OF[c] !== us) push(mk(s, u, NORMAL, 1, ROOK, TYPE_OF[c])); break; }
        }
        for (let u = s + NF; u < NSQ; u += NF) {
          c = BRD[o + u];
          if (c === 0) push(mk(s, u, NORMAL, 1, ROOK, 0)); else { if (COLOR_OF[c] !== us) push(mk(s, u, NORMAL, 1, ROOK, TYPE_OF[c])); break; }
        }
      }

      const d = us === 0 ? NF : -NF, start = us === 0 ? 1 : NR - 2, own = us * 4 + PAWN, ep = EP[ply];
      for (let i = 0; i < nPawn; i++) {
        const s = SQ_PAWN[i], fwd = s + d;
        if (fwd < 0 || fwd >= NSQ) continue;
        const f = s % NF, ahead = BRD[o + fwd];
        if (ahead === 0) {
          push(mk(s, fwd, NORMAL, 1, PAWN, 0));                         // (4.1), (5.3)
          if ((s - f) / NF === start && BRD[o + fwd + d] === 0) push(mk(s, fwd + d, DOUBLE, 1, PAWN, 0)); // (4.2)
        }
        for (let df = -1; df <= 1; df += 2) {                           // (4.3), (5.6)
          if (f + df < 0 || f + df >= NF) continue;
          const to = fwd + df, c = BRD[o + to];
          if (c !== 0) {
            if (COLOR_OF[c] !== us) push(mk(s, to, NORMAL, 1, PAWN, TYPE_OF[c]));
          } else if (to === ep) {
            push(mk(s, to, ENPASSANT, 1, PAWN, PAWN));                  // (4.4)
          } else if ((to + d >= 0 && to + d < NSQ && BRD[o + to + d] === own) || BRD[o + to - d] === own) {
            // (4.6) aggancio: la casa d'arrivo è subito dietro o subito davanti a un pedone compagno.
            push(mk(s, to, JOIN, 1, PAWN, 0));
          }
        }
        // (5.2) avanzata in blocco: s è il pedone di testa se davanti non c'è un pezzo proprio.
        if (ahead === 0 || COLOR_OF[ahead] !== us) {
          let len = 1;
          for (let u = s - d; u >= 0 && u < NSQ && BRD[o + u] === own; u -= d) len++;
          for (let k = 2; k <= len; k++) push(mk(s, fwd, BLOCK, k, PAWN, TYPE_OF[ahead])); // sempre di una casa (5.8)
        }
      }
      return n;
    }

    // Gioca la mossa m dal livello `ply`: la nuova posizione va al livello ply + 1.
    function apply(ply, m) {
      const o = ply * NSQ, q = o + NSQ, us = TURN[ply], d = us === 0 ? NF : -NF;
      const from = mFrom(m), to = mTo(m), kind = mKind(m), piece = mPiece(m), cap = mCap(m);
      BRD.copyWithin(q, o, q);
      let lo = KLO[ply], hi = KHI[ply], ep = -1, men = MEN[ply];
      KSQ[ply * 2 + 2] = KSQ[ply * 2]; KSQ[ply * 2 + 3] = KSQ[ply * 2 + 1];
      if (EP[ply] >= 0) { lo ^= ZLO[Z_EP + EP[ply]]; hi ^= ZHI[Z_EP + EP[ply]]; }
      const code = us * 4 + piece;
      if (cap !== 0) {
        const at = kind === ENPASSANT ? to - d : to, z = ((1 - us) * 4 + cap - 1) * NSQ + at;
        lo ^= ZLO[z]; hi ^= ZHI[z];
        BRD[q + at] = 0;
        if (cap !== KING) men--;
      }
      // Il blocco che avanza di una casa equivale a spostare il pedone di coda davanti alla testa.
      const src = kind === BLOCK ? from - (mK(m) - 1) * d : from;
      const z1 = (code - 1) * NSQ + src, z2 = (code - 1) * NSQ + to;
      lo ^= ZLO[z1] ^ ZLO[z2]; hi ^= ZHI[z1] ^ ZHI[z2];
      BRD[q + src] = 0;
      BRD[q + to] = code;
      if (piece === KING) KSQ[ply * 2 + 2 + us] = to;
      if (kind === DOUBLE) {
        // La casa en passant si registra solo se un pedone avversario può usarla.
        const f = to % NF, enemy = (1 - us) * 4 + PAWN;
        if ((f > 0 && BRD[q + to - 1] === enemy) || (f < NF - 1 && BRD[q + to + 1] === enemy)) {
          ep = from + d;
          lo ^= ZLO[Z_EP + ep]; hi ^= ZHI[Z_EP + ep];
        }
      }
      TURN[ply + 1] = 1 - us;
      EP[ply + 1] = ep;
      HALF[ply + 1] = (piece === PAWN || cap !== 0) ? 0 : HALF[ply] + 1;
      MEN[ply + 1] = men;
      KLO[ply + 1] = lo ^ ZLO[Z_TURN]; KHI[ply + 1] = hi ^ ZHI[Z_TURN];
    }

    // (3.3) è illegale lasciare il proprio re sotto scacco;
    // (3.4) tranne quando la mossa porta un pedone sull'ultima traversa.
    function legalMovesAt(ply) {
      const n = genMoves(ply), us = TURN[ply], out = [];
      for (let i = 0; i < n; i++) {
        const m = MOVES[ply][i];
        if (arrives(m, us)) { out.push(m); continue; }
        apply(ply, m);
        if (!inCheck(ply + 1, us)) out.push(m);
      }
      return out;
    }

    // Numero di partite possibili di `depth` semimosse (una partita chiusa dall'arrivo
    // di un pedone conta 1): per il confronto con engine.js e con Cordata.perft.
    function perftAt(ply, depth) {
      if (depth === 0) return 1;
      const us = TURN[ply];
      let total = 0;
      for (const m of legalMovesAt(ply)) {
        if (arrives(m, us)) { total++; continue; }
        apply(ply, m);
        total += perftAt(ply + 1, depth - 1);
      }
      return total;
    }
    function perft(text, depth) { setPosition(text, 0); return perftAt(0, depth); }
    function legalMoves(text) { setPosition(text, 0); return legalMovesAt(0).map(moveObject); }

    // ---------------------------------------------------------- valutazione

    const HI_BLACK = new Int8Array(NF + 2), LO_WHITE = new Int8Array(NF + 2);

    // Valutazione statica dal punto di vista di chi muove, in centesimi di pedone:
    // materiale, avanzamento dei pedoni, pedoni passati, batterie.
    function evaluateAt(ply) {
      const o = ply * NSQ;
      HI_BLACK.fill(-1); LO_WHITE.fill(NR);
      let white = 0, black = 0;
      for (let s = 0; s < NSQ; s++) {
        const c = BRD[o + s];
        if (c === 0) continue;
        const t = TYPE_OF[c];
        if (t === PAWN) {
          const f = s % NF, r = (s - f) / NF;
          if (c === PAWN) { if (r < LO_WHITE[f + 1]) LO_WHITE[f + 1] = r; }
          else if (r > HI_BLACK[f + 1]) HI_BLACK[f + 1] = r;
        }
        if (c <= 4) white += PIECE_VALUE[t]; else black += PIECE_VALUE[t];
      }
      for (let s = NF; s < NSQ - NF; s++) {
        const c = BRD[o + s];
        if (TYPE_OF[c] !== PAWN) continue;
        const f = s % NF, r = (s - f) / NF;
        if (c === PAWN) {
          const a = Math.min(r - 1, 5);
          white += ADVANCE[a];
          if (HI_BLACK[f] <= r && HI_BLACK[f + 1] <= r && HI_BLACK[f + 2] <= r) white += 10 + 8 * a; // pedone passato
          if (BRD[o + s - NF] === c) white += 12;                                                   // in batteria
        } else {
          const a = Math.min(NR - 2 - r, 5);
          black += ADVANCE[a];
          if (LO_WHITE[f] >= r && LO_WHITE[f + 1] >= r && LO_WHITE[f + 2] >= r) black += 10 + 8 * a;
          if (BRD[o + s + NF] === c) black += 12;
        }
      }
      return (TURN[ply] === 0 ? white - black : black - white) + 8;
    }
    function evaluate(text) { setPosition(text, 0); return evaluateAt(0); }

    // -------------------------------------------------------------- ricerca

    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

    // Un cercatore possiede la tabella delle trasposizioni (2^bits voci), che resta
    // utile da una mossa alla successiva.
    function createSearcher(bits) {
      const size = 1 << (bits || 20), mask = size - 1;
      const ttLo = new Int32Array(size), ttHi = new Int32Array(size), ttMove = new Int32Array(size);
      const ttScore = new Int16Array(size), ttDepth = new Int8Array(size).fill(-1), ttFlag = new Int8Array(size);
      const killers = new Int32Array(2 * MAXPLY), hist = new Int32Array(8 * NSQ);
      const pv = new Int32Array(MAXPLY * MAXPLY), pvlen = new Int32Array(MAXPLY + 1);
      let keysLo = [], keysHi = [];         // posizioni della partita e del ramo in esame
      let nodes = 0, deadline = Infinity, stopped = false;
      let rootMove = NOMOVE, rootScore = 0, rootPv = [];

      // Patta nella ricerca: la posizione è già comparsa nel ramo o nella partita.
      function repeated(ply) {
        const n = keysLo.length, lo = KLO[ply], hi = KHI[ply];
        for (let i = n - 1, stop = Math.max(0, n - HALF[ply]); i >= stop; i--) {
          if (keysLo[i] === lo && keysHi[i] === hi) return true;
        }
        return false;
      }

      function scoreMoves(ply, n, ttmove) {
        const list = MOVES[ply], order = ORDER[ply], k1 = killers[2 * ply], k2 = killers[2 * ply + 1];
        const h = TURN[ply] * 4 * NSQ;
        for (let i = 0; i < n; i++) {
          const m = list[i], cap = mCap(m);
          order[i] = m === ttmove ? 2000000
            : cap !== 0 ? 1000000 + 16 * PIECE_VALUE[cap] - (PIECE_VALUE[mPiece(m)] >> 3)
            : m === k1 ? 900000
            : m === k2 ? 890000
            : Math.min(hist[h + (mPiece(m) - 1) * NSQ + mTo(m)], 800000);
        }
      }

      // Porta in posizione i la mossa migliore fra quelle non ancora esaminate.
      function pick(ply, n, i) {
        const list = MOVES[ply], order = ORDER[ply];
        let best = i;
        for (let j = i + 1; j < n; j++) if (order[j] > order[best]) best = j;
        if (best !== i) {
          const m = list[i]; list[i] = list[best]; list[best] = m;
          const v = order[i]; order[i] = order[best]; order[best] = v;
        }
        return list[i];
      }

      function quiesce(alpha, beta, ply, qply) {
        nodes++;
        if (ply >= MAXPLY - 1) return evaluateAt(ply);
        const us = TURN[ply], list = MOVES[ply];
        const n = genMoves(ply);
        for (let i = 0; i < n; i++) {
          if (arrives(list[i], us)) {
            if (qply === 0) { pv[ply * MAXPLY] = list[i]; pvlen[ply] = 1; }
            return MATE - ply - 1;
          }
        }
        // Sotto scacco non ci si può fermare alla valutazione statica: si provano tutte le mosse.
        const evasions = qply < 4 && inCheck(ply, us);
        let best = -INF;
        if (!evasions) {
          best = evaluateAt(ply);
          if (best >= beta) return best;
          if (best > alpha) alpha = best;
        }
        scoreMoves(ply, n, NOMOVE);
        let legal = 0;
        for (let i = 0; i < n; i++) {
          const m = pick(ply, n, i);
          if (!evasions && mCap(m) === 0) break;      // le catture sono ordinate per prime
          apply(ply, m);
          if (inCheck(ply + 1, us)) continue;
          legal++;
          const score = -quiesce(-beta, -alpha, ply + 1, qply + 1);
          if (score > best) {
            best = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
          }
        }
        if (evasions && legal === 0) return -(MATE - ply);
        return best;
      }

      function negamax(depth, alpha, beta, ply) {
        nodes++;
        pvlen[ply] = 0;
        if ((nodes & 2047) === 0 && now() > deadline) stopped = true;
        if (stopped) return 0;
        if (ply > 0 && (HALF[ply] >= 100 || MEN[ply] === 0 || repeated(ply))) return 0;   // (6.3)
        if (ply >= MAXPLY - 1) return evaluateAt(ply);

        const us = TURN[ply], alpha0 = alpha, lo = KLO[ply], hi = KHI[ply], slot = lo & mask;
        let ttmove = NOMOVE;
        if (ttLo[slot] === lo && ttHi[slot] === hi && ttDepth[slot] >= 0) {
          ttmove = ttMove[slot];
          // Nei nodi della variante principale (finestra piena) non si taglia, per averla completa.
          if (ply > 0 && beta - alpha === 1 && ttDepth[slot] >= depth) {
            let score = ttScore[slot];
            if (score > MATE_ZONE) score -= ply; else if (score < -MATE_ZONE) score += ply;
            const flag = ttFlag[slot];
            if (flag === TT_EXACT) return score;
            if (flag === TT_LOWER && score >= beta) return score;
            if (flag === TT_UPPER && score <= alpha) return score;
          }
        }
        if (depth <= 0) return quiesce(alpha, beta, ply, 0);

        const list = MOVES[ply];
        const n = genMoves(ply);
        for (let i = 0; i < n; i++) {                   // (3.4), (6.1c): arrivare in fondo vince subito
          const m = list[i];
          if (arrives(m, us)) {
            if (ply === 0) { rootMove = m; rootScore = MATE - 1; rootPv = [m]; }
            pv[ply * MAXPLY] = m;
            pvlen[ply] = 1;
            return MATE - ply - 1;
          }
        }
        scoreMoves(ply, n, ttmove);

        let best = -INF, bestMove = NOMOVE, legal = 0;
        keysLo.push(lo); keysHi.push(hi);
        for (let i = 0; i < n; i++) {
          const m = pick(ply, n, i);
          apply(ply, m);
          if (inCheck(ply + 1, us)) continue;           // (3.3)
          legal++;
          const next = depth - 1 + (inCheck(ply + 1, 1 - us) ? 1 : 0);   // gli scacchi allungano la ricerca di un livello
          let score;
          if (legal === 1) {
            score = -negamax(next, -beta, -alpha, ply + 1);
          } else {
            score = -negamax(next, -alpha - 1, -alpha, ply + 1);
            if (score > alpha && score < beta) score = -negamax(next, -beta, -alpha, ply + 1);
          }
          if (stopped) break;
          if (score > best) { best = score; bestMove = m; }
          if (score > alpha) {
            alpha = score;
            const len = pvlen[ply + 1], a = ply * MAXPLY, b = a + MAXPLY;   // variante principale: m e poi quella del figlio
            pv[a] = m;
            for (let j = 0; j < len; j++) pv[a + j + 1] = pv[b + j];
            pvlen[ply] = len + 1;
            if (ply === 0) { rootMove = m; rootScore = score; rootPv = Array.from(pv.subarray(0, len + 1)); }
          }
          if (alpha >= beta) {
            if (mCap(m) === 0) {
              if (killers[2 * ply] !== m) { killers[2 * ply + 1] = killers[2 * ply]; killers[2 * ply] = m; }
              hist[us * 4 * NSQ + (mPiece(m) - 1) * NSQ + mTo(m)] += depth * depth;
            }
            break;
          }
        }
        keysLo.pop(); keysHi.pop();
        if (stopped) return 0;
        if (legal === 0) return -(MATE - ply);          // (6.1a), (6.1b): chi non ha mosse perde

        ttLo[slot] = lo; ttHi[slot] = hi;
        ttMove[slot] = bestMove;
        ttScore[slot] = best > MATE_ZONE ? best + ply : best < -MATE_ZONE ? best - ply : best;
        ttDepth[slot] = depth;
        ttFlag[slot] = best <= alpha0 ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
        return best;
      }

      // Cerca la mossa migliore con approfondimento iterativo. `req`:
      //   pos       posizione nel formato di engine.js
      //   half      semimosse senza catture né mosse di pedone (regola delle 50 mosse)
      //   history   posizioni precedenti della partita, come testo (per le ripetizioni)
      //   seconds   tempo di riflessione (predefinito 1), depth profondità massima (64)
      // Restituisce move (null se la partita è finita), score dal punto di vista di
      // chi muove, depth raggiunta, pv, nodes, seconds.
      function search(req) {
        const t0 = now();
        const seconds = req.seconds === undefined ? 1 : req.seconds;
        const maxDepth = Math.min(req.depth || 64, MAXPLY - 2);
        nodes = 0; stopped = false; deadline = t0 + 1000 * seconds;
        killers.fill(NOMOVE); hist.fill(0);
        keysLo = []; keysHi = [];
        for (const text of req.history || []) { setPosition(text, 0); keysLo.push(KLO[0]); keysHi.push(KHI[0]); }
        setPosition(req.pos, req.half || 0);
        const legal = legalMovesAt(0);
        if (!legal.length) return { move: null, score: -MATE, depth: 0, pv: [], nodes: 0, seconds: 0 };
        let best = legal[0], bestScore = 0, reached = 0, line = [legal[0]];
        for (let d = 1; d <= maxDepth; d++) {
          rootMove = NOMOVE;
          negamax(d, -INF, INF, 0);
          // Anche un livello interrotto dà una mossa valida: la prima esaminata è la migliore del livello precedente.
          if (rootMove !== NOMOVE) { best = rootMove; bestScore = rootScore; line = rootPv; }
          if (stopped) break;
          reached = d;
          if (Math.abs(bestScore) > MATE_ZONE) break;          // vittoria o sconfitta forzata già trovata
          if (legal.length === 1) break;                       // mossa obbligata
          if (now() - t0 > 600 * seconds) break;               // il prossimo livello non finirebbe in tempo
        }
        return { move: moveObject(best), score: bestScore | 0, depth: reached, pv: line.map(moveObject),   // "| 0": mai −0
                 nodes, seconds: (now() - t0) / 1000 };
      }

      return { search };
    }

    // Testo della valutazione: pedoni di vantaggio, oppure in quante mosse si vince o si perde.
    function scoreText(score) {
      if (score > MATE_ZONE) return `vince in ${(MATE - score + 1) >> 1}`;
      if (score < -MATE_ZONE) return `perde in ${(MATE + score + 1) >> 1}`;
      const a = Math.abs(score);
      return `${score >= 0 ? '+' : '−'}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
    }

    return { MATE, MATE_ZONE, START, KINDS, createSearcher, perft, legalMoves, evaluate, scoreText };
  }

  // Testo del programma di un Web Worker: riceve le richieste di `search` (con un `id`)
  // e risponde con il risultato, o con { error }.
  function workerSource() {
    return `'use strict';
const S = (${factory.toString()})();
let searcher = null;
self.onmessage = ev => {
  let out;
  try { searcher = searcher || S.createSearcher(20); out = searcher.search(ev.data); }
  catch (err) { out = { error: String(err && err.message || err) }; }
  out.id = ev.data.id;
  self.postMessage(out);
};`;
  }

  const api = Object.assign(factory(), { factory, workerSource });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CordataSearch = api;
})(typeof self !== 'undefined' ? self : this);
