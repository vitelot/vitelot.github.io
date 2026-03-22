// --- State ---
let snapshot = null;
let history  = null;
let h2h      = null;
let games    = null;

let rankSort = { col: 'skill', dir: 'desc' };
let p1Pos = 'agg', p2Pos = 'agg';
let showP2 = false;

// --- Helpers ---
function switchTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-bar button').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
  if (id === 'history') updateChart();
}

function fmt(v, decimals=0) {
  if (v == null || v === undefined) return '—';
  return typeof v === 'number' ? v.toFixed(decimals) : v;
}

// --- Rankings Tab ---
function renderRankings() {
  const players = snapshot.players
    .filter(p => p.qualified)
    .sort((a, b) => {
      const av = a[rankSort.col], bv = b[rankSort.col];
      return rankSort.dir === 'asc' ? av - bv : bv - av;
    });

  const tbody = document.getElementById('rankings-body');
  tbody.innerHTML = players.map((p, i) => `
    <tr>
      <td>${p.skill}</td>
      <td><span class="player-link" onclick="goToHistory('${p.name}')">${p.name}</span></td>
      <td>${p.vitelo} <span style="color:var(--muted);font-size:12px">±${p.delta_vitelo}</span></td>
      <td>${fmt(p.elo, 0)}</td>
      <td>${fmt(p.trueskill_conservative, 1)}</td>
      <td>${fmt(p.win_rate, 3)}</td>
      <td>${fmt(p.atmwr, 3)}</td>
      <td>${fmt(p.entropy, 3)}</td>
      <td>${p.games}</td>
      <td>${p.inactivity}d</td>
    </tr>
  `).join('');

  // Column sort listeners
  document.querySelectorAll('#rankings-table th[data-col]').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (rankSort.col === col) {
        rankSort.dir = rankSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        rankSort.col = col;
        rankSort.dir = col === 'name' ? 'asc' : 'desc';
      }
      document.querySelectorAll('#rankings-table th').forEach(t => {
        t.classList.remove('sorted-asc','sorted-desc');
      });
      th.classList.add(rankSort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      renderRankings();
    };
  });
}

function goToHistory(name) {
  document.getElementById('p1-select').value = name;
  switchTab('history', document.querySelector('.tab-bar button:nth-child(2)'));
}

// --- Player selectors ---
function populatePlayerSelects() {
  const players = snapshot.players.filter(p => p.qualified).map(p => p.name);

  [document.getElementById('p1-select'),
   document.getElementById('p2-select'),
   document.getElementById('h2h-a-select'),
   document.getElementById('h2h-b-select')].forEach(sel => {
    sel.innerHTML = players.map(n => `<option value="${n}">${n}</option>`).join('');
  });

  // Default: p2 selects second player
  if (players.length > 1) {
    document.getElementById('p2-select').value = players[1];
    document.getElementById('h2h-b-select').value = players[1];
  }

  document.getElementById('p1-select').addEventListener('change', () => { updateChips(1); updateChart(); });
  document.getElementById('p2-select').addEventListener('change', () => { updateChips(2); updateChart(); });
}

function updateChips(playerNum) {
  const name = document.getElementById(`p${playerNum}-select`).value;
  const p = snapshot.players.find(x => x.name === name);
  if (!p) return;
  document.getElementById(`p${playerNum}-chips`).innerHTML = `
    <div class="chip">Skill <strong>${p.skill}</strong></div>
    <div class="chip">WR <strong>${fmt(p.win_rate,3)}</strong></div>
    <div class="chip">Games <strong>${p.games}</strong></div>
    <div class="chip">ATMWR <strong>${fmt(p.atmwr,3)}</strong></div>
  `;
}

function setPosToggle(playerNum, pos, btn) {
  const card = btn.closest('.player-card');
  card.querySelectorAll('.pos-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (playerNum === 1) p1Pos = pos;
  else p2Pos = pos;
  updateChart();
}

function toggleP2() {
  showP2 = !showP2;
  document.getElementById('p2-card').style.display = showP2 ? '' : 'none';
  document.getElementById('add-p2-btn').textContent = showP2 ? '− Remove Player 2' : '+ Compare with Player 2';
  updateChart();
}

// --- History Tab ---
function getSeriesKey(metric, pos) {
  if (metric === 'vitelo') return pos === 'agg' ? 'vitelo_agg' : pos === 'def' ? 'vitelo_def' : 'vitelo_fwd';
  if (metric === 'elo') return 'elo';
  return 'trueskill';
}

function buildPlotlyTraces(playerName, pos, metric, color, dates) {
  const pd = history.players[playerName];
  if (!pd) return [];

  const seriesKey = getSeriesKey(metric, pos);
  const series = pd[seriesKey];
  if (!series || series.length === 0) return [];

  const xs = series.map(pt => dates[pt.i]);
  const traces = [];

  if (metric === 'vitelo') {
    const ys     = series.map(pt => pt.value);
    const ys_hi  = series.map(pt => pt.value + pt.delta);
    const ys_lo  = series.map(pt => pt.value - pt.delta);

    traces.push({ x: xs, y: ys_hi, name: playerName + ' upper', type: 'scatter',
      mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip',
      fill: 'none', marker: { color } });
    traces.push({ x: xs, y: ys_lo, name: playerName + ' lower', type: 'scatter',
      mode: 'lines', line: { width: 0 }, fill: 'tonexty',
      fillcolor: color.replace(')',',0.15)').replace('rgb','rgba'), showlegend: false,
      hoverinfo: 'skip', marker: { color } });
    traces.push({ x: xs, y: ys, name: playerName, type: 'scatter', mode: 'lines',
      line: { color, width: 2 },
      hovertemplate: '%{x}<br>' + playerName + ': %{y:.0f}<extra></extra>' });

  } else if (metric === 'elo') {
    const ys = series.map(pt => pt.value);
    traces.push({ x: xs, y: ys, name: playerName, type: 'scatter', mode: 'lines',
      line: { color, width: 2 },
      hovertemplate: '%{x}<br>' + playerName + ': %{y:.0f}<extra></extra>' });

  } else {  // trueskill
    const ys_mu  = series.map(pt => pt.mu);
    const ys_hi  = series.map(pt => pt.mu + pt.sigma);
    const ys_lo  = series.map(pt => pt.mu - pt.sigma);

    traces.push({ x: xs, y: ys_hi, name: playerName + ' +σ', type: 'scatter',
      mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip',
      fill: 'none', marker: { color } });
    traces.push({ x: xs, y: ys_lo, name: playerName + ' -σ', type: 'scatter',
      mode: 'lines', line: { width: 0 }, fill: 'tonexty',
      fillcolor: color.replace(')',',0.15)').replace('rgb','rgba'), showlegend: false,
      hoverinfo: 'skip', marker: { color } });
    traces.push({ x: xs, y: ys_mu, name: playerName + ' (μ)', type: 'scatter', mode: 'lines',
      line: { color, width: 2 },
      hovertemplate: '%{x}<br>' + playerName + ' μ: %{y:.2f}<extra></extra>' });
  }
  return traces;
}

function updateChart() {
  if (!history || !snapshot) return;
  const metric = document.querySelector('input[name="metric"]:checked')?.value || 'vitelo';
  const dates  = history.dates;

  const p1name = document.getElementById('p1-select').value;
  const p1color = 'rgb(126,184,247)';
  const traces = buildPlotlyTraces(p1name, p1Pos, metric, p1color, dates);

  if (showP2) {
    const p2name  = document.getElementById('p2-select').value;
    const p2color = 'rgb(247,169,126)';
    traces.push(...buildPlotlyTraces(p2name, p2Pos, metric, p2color, dates));
  }

  const yLabel = metric === 'vitelo' ? 'VitELO' : metric === 'elo' ? 'ELO' : 'TrueSkill μ';

  const layout = {
    paper_bgcolor: '#0f0f1a', plot_bgcolor: '#0d1020',
    font: { color: '#e0e4f0', family: 'Inter, system-ui, sans-serif' },
    xaxis: { gridcolor: '#1e2240', tickcolor: '#6b7099' },
    yaxis: { gridcolor: '#1e2240', tickcolor: '#6b7099', title: yLabel },
    legend: { bgcolor: '#16182a', bordercolor: '#2a2e50', borderwidth: 1 },
    margin: { l: 60, r: 20, t: 20, b: 40 },
    hovermode: 'x unified'
  };

  const config = { responsive: true, displayModeBar: false };
  Plotly.react('history-chart', traces, layout, config);
}

// --- Head-to-Head Tab ---
function updateH2H() {
  if (!h2h || !games) return;
  const a = document.getElementById('h2h-a-select').value;
  const b = document.getElementById('h2h-b-select').value;
  if (!a || !b || a === b) {
    document.getElementById('h2h-stats').innerHTML = '<p style="color:var(--muted)">Select two different players.</p>';
    return;
  }

  const record = h2h[a] && h2h[a][b] ? h2h[a][b] : {};
  const tm  = record.as_teammates  || { wins: 0, losses: 0, games: 0 };
  const opp = record.as_opponents  || { wins: 0, losses: 0, games: 0 };

  const tmWR  = tm.games  > 0 ? (tm.wins / tm.games * 100).toFixed(1)  : '—';
  const oppWR = opp.games > 0 ? (opp.wins / opp.games * 100).toFixed(1) : '—';

  document.getElementById('h2h-stats').innerHTML = `
    <div class="stat-box">
      <h3>As teammates</h3>
      <div class="big">${tm.wins}W – ${tm.losses}L</div>
      <div class="sub">${tm.games} games · WR ${tmWR}%</div>
    </div>
    <div class="stat-box">
      <h3>As opponents (${a}'s record)</h3>
      <div class="big">${opp.wins}W – ${opp.losses}L</div>
      <div class="sub">${opp.games} games · WR ${oppWR}%</div>
    </div>
  `;

  // Recent games together (filter from games.json)
  const shared = games.games
    .filter(g => [g.red_def, g.red_fwd, g.blue_def, g.blue_fwd].includes(a)
              && [g.red_def, g.red_fwd, g.blue_def, g.blue_fwd].includes(b))
    .slice(0, 10);

  document.getElementById('h2h-games-body').innerHTML = shared.map(g =>
    `<tr>
      <td>${g.date}</td>
      <td>${g.red_def}</td><td>${g.red_fwd}</td>
      <td>${g.blue_def}</td><td>${g.blue_fwd}</td>
      <td>${g.red_score} – ${g.blue_score}</td>
    </tr>`
  ).join('');
}

// --- Game Log Tab ---
function highlightName(name, filter) {
  if (!filter) return name;
  if (name.toLowerCase().includes(filter.toLowerCase())) {
    return `<span class="highlight">${name}</span>`;
  }
  return name;
}

function renderGameLog() {
  if (!games) return;
  filterGames();
}

function filterGames() {
  if (!games) return;
  const filter = document.getElementById('game-filter').value.trim();
  const filtered = filter
    ? games.games.filter(g =>
        [g.red_def, g.red_fwd, g.blue_def, g.blue_fwd]
          .some(n => n.toLowerCase().includes(filter.toLowerCase())))
    : games.games;

  document.getElementById('game-count').textContent = `${filtered.length} games`;

  document.getElementById('gamelog-body').innerHTML = filtered.map(g => `
    <tr>
      <td>${g.date}</td>
      <td>${highlightName(g.red_def, filter)}</td>
      <td>${highlightName(g.red_fwd, filter)}</td>
      <td>${highlightName(g.blue_def, filter)}</td>
      <td>${highlightName(g.blue_fwd, filter)}</td>
      <td><strong>${g.red_score}</strong> – <strong>${g.blue_score}</strong></td>
    </tr>
  `).join('');
}

// --- Init ---
async function init() {
  const [s, h, hh, g] = await Promise.all([
    fetch('data/snapshot.json').then(r => r.json()),
    fetch('data/history.json').then(r => r.json()),
    fetch('data/head_to_head.json').then(r => r.json()),
    fetch('data/games.json').then(r => r.json()),
  ]);
  snapshot = s; history = h; h2h = hh; games = g;

  populatePlayerSelects();
  renderRankings();
  updateChips(1); updateChips(2);
  renderGameLog();
  updateH2H();
}

document.addEventListener('DOMContentLoaded', init);
