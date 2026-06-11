/* ===================================================
   leaderboard.js  –  Renders the sweepstake leaderboard.
   Fetches data/participants.json + data/matches.json,
   calculates scores client-side via scoring.js.
   =================================================== */

const REFRESH_MS  = 15 * 1000;
const STORAGE_KEY = 'wc2026_matches';
const PROG_KEY    = 'wc2026_progression';

async function fetchJSON(path) {
  const res = await fetch(path + '?_=' + Date.now());
  if (!res.ok) throw new Error('Failed: ' + path);
  return res.json();
}

function getMatches() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) { try { return JSON.parse(stored); } catch(e) {} }
  return null;
}

function getProgression() {
  const stored = localStorage.getItem(PROG_KEY);
  if (stored) { try { return JSON.parse(stored); } catch(e) {} }
  return null;
}

function rankDisplay(rank) {
  if (rank === 1) return '<span class="rank-medal">🥇</span>';
  if (rank === 2) return '<span class="rank-medal">🥈</span>';
  if (rank === 3) return '<span class="rank-medal">🥉</span>';
  return `<span class="rank--other">${rank}</span>`;
}

function rowClass(rank) {
  return rank <= 3 ? `top-${rank}` : '';
}

// ── Assign ranks (handles ties) ──────────────────────────────────────────
function buildRanked(scores) {
  let rank = 0, prevTotal = null, counter = 0;
  return scores.map(row => {
    counter++;
    if (row.total !== prevTotal) { rank = counter; prevTotal = row.total; }
    return { ...row, rank };
  });
}

// ── Single row HTML ───────────────────────────────────────────────────────
function buildRow(row) {
  const teamChips = (row.teams || []).map(t =>
    `<span class="team-chip team-chip--${t.bracket}">${t.name}<span class="team-chip__mult"> ×${t.multiplier}</span></span>`
  ).join('');

  const bd = row.breakdown || {};
  const breakdown = `
    <span>⚽ ${(bd.goals_pts||0).toFixed(1)} goals</span>
    <span>✅ ${(bd.results_pts||0).toFixed(1)} results</span>
    <span>🏆 ${(bd.progression_pts||0).toFixed(1)} progress</span>`;

  return `
    <tr class="${rowClass(row.rank)}">
      <td class="rank-cell">${rankDisplay(row.rank)}</td>
      <td class="name-cell">${row.name}</td>
      <td><div class="teams-cell">${teamChips}</div></td>
      <td class="breakdown-cell">${breakdown}</td>
      <td class="score-cell">${row.total.toFixed(1)}<span class="score-pts"> pts</span></td>
    </tr>`;
}

// ── Render the full table structure (all rows) ────────────────────────────
function renderLeaderboard(ranked) {
  const container = document.getElementById('leaderboard-container');

  if (!ranked.length) {
    container.innerHTML = `
      <div class="lb-empty">
        <h2>No scores yet</h2>
        <p>The draw hasn't been run, or no match results have been entered yet.<br>
           Head to <a href="admin.html">the admin page</a> to add results.</p>
      </div>`;
    return false;
  }

  container.innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Participant</th>
          <th>Teams</th>
          <th class="right">Breakdown</th>
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${ranked.map(buildRow).join('')}</tbody>
    </table>`;

  return true;
}

// ── Gallery ───────────────────────────────────────────────────────────────
const GALLERY_INTERVAL_MS = 5000;

const gallery = { timer: null, page: 0, ranked: [], rowsPerPage: 10 };

function calcRowsPerPage() {
  const main     = document.querySelector('.lb-main');
  const thead    = document.querySelector('.lb-table thead');
  const firstRow = document.querySelector('.lb-table tbody tr');
  if (!main || !thead || !firstRow) return 10;

  // Vertical padding on .lb-main is 48px top + 48px bottom = 96px total
  const available = main.clientHeight - thead.offsetHeight - 96;
  return Math.max(1, Math.floor(available / firstRow.offsetHeight));
}

function showGalleryPage() {
  const tbody = document.querySelector('.lb-table tbody');
  if (!tbody) return;
  const { page, rowsPerPage, ranked } = gallery;
  const slice = ranked.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  tbody.innerHTML = slice.map(buildRow).join('');
}

function startGallery(ranked) {
  if (gallery.timer) clearInterval(gallery.timer);

  gallery.ranked      = ranked;
  gallery.page        = 0;
  gallery.rowsPerPage = calcRowsPerPage();

  showGalleryPage();

  const totalPages = Math.ceil(ranked.length / gallery.rowsPerPage);
  if (totalPages > 1) {
    gallery.timer = setInterval(() => {
      gallery.page = (gallery.page + 1) % totalPages;
      showGalleryPage();
    }, GALLERY_INTERVAL_MS);
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function renderSidebar(matches) {
  const el = document.getElementById('sidebar-results');
  if (!el) return;

  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = d.toLocaleDateString('en-CA');

  const yMatches = matches.filter(m => m.finished && m.date === yesterday);

  if (!yMatches.length) {
    el.innerHTML = `
      <div class="sidebar-title">Yesterday's Results</div>
      <div class="sidebar-empty">No matches played yesterday</div>`;
    return;
  }

  const matchCards = yMatches.map(m => {
    const { home, away, round } = m;
    const isNilNil = home.goals === 0 && away.goals === 0;
    const homeResult = home.goals > away.goals ? 'win' : home.goals < away.goals ? 'loss' : 'draw';
    const awayResult = homeResult === 'win' ? 'loss' : homeResult === 'loss' ? 'win' : 'draw';

    const homeSide = { ...home, goalsConceded: away.goals, result: homeResult };
    const awaySide = { ...away, goalsConceded: home.goals, result: awayResult };
    const homePts  = scoreTeamInMatch(homeSide, isNilNil);
    const awayPts  = scoreTeamInMatch(awaySide, isNilNil);

    const rawTotal = pts => Object.values(pts).reduce((s, v) => s + v, 0);

    const buildEvents = (pts, side, result) => {
      const parts = [];
      if (side.goals > 0)      parts.push(`⚽ ${side.goals} goal${side.goals > 1 ? 's' : ''}`);
      if (pts.hatTrickBonus > 0) parts.push('🎩 hat-trick');
      if (pts.cleanSheet > 0)  parts.push('🧤 clean sheet');
      if (pts.penSaves > 0)    parts.push(`🛑 ×${side.penaltySaves}`);
      if (pts.redCards < 0)    parts.push(`🟥 ×${side.redCards}`);
      if (result === 'win')    parts.push('✅ win');
      else if (result === 'draw') parts.push(isNilNil ? '😴 0-0' : '🤝 draw');
      return parts.join(' · ') || '—';
    };

    const homeRaw = rawTotal(homePts);
    const awayRaw = rawTotal(awayPts);
    const ptClass = v => v < 0 ? 'sidebar-team-pts__total--neg' : '';

    return `
      <div class="sidebar-match">
        <div class="sidebar-round">${round || 'Match'}</div>
        <div class="sidebar-scoreline">
          <div class="sidebar-team-name">${home.name}</div>
          <div class="sidebar-score">${home.goals} - ${away.goals}</div>
          <div class="sidebar-team-name sidebar-team-name--away">${away.name}</div>
        </div>
        <div class="sidebar-pts">
          <div class="sidebar-team-pts">
            <div class="sidebar-team-pts__name">${home.name}</div>
            <div class="sidebar-team-pts__events">${buildEvents(homePts, home, homeResult)}</div>
            <div class="sidebar-team-pts__total ${ptClass(homeRaw)}">${homeRaw > 0 ? '+' : ''}${homeRaw} raw</div>
          </div>
          <div class="sidebar-team-pts">
            <div class="sidebar-team-pts__name">${away.name}</div>
            <div class="sidebar-team-pts__events">${buildEvents(awayPts, away, awayResult)}</div>
            <div class="sidebar-team-pts__total ${ptClass(awayRaw)}">${awayRaw > 0 ? '+' : ''}${awayRaw} raw</div>
          </div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sidebar-title">Yesterday's Results</div>
    ${matchCards}
    <div class="sidebar-empty" style="font-size:10px;padding-top:4px">Raw pts shown · multiply by your team's ×</div>`;
}

// ── Load, score, render, start gallery ───────────────────────────────────
async function loadAndRender() {
  try {
    const participants = await fetchJSON('data/participants.json');

    let matches = getMatches();
    if (!matches) matches = await fetchJSON('data/matches.json');

    let progressionMap = getProgression();
    if (!progressionMap) {
      try { progressionMap = await fetchJSON('data/progression.json'); } catch(e) { progressionMap = {}; }
    }

    const scores = computeScores(matches, participants, progressionMap);
    const ranked = buildRanked(scores);

    const hasTable = renderLeaderboard(ranked);
    renderSidebar(matches);

    if (hasTable) startGallery(ranked);

    const source = localStorage.getItem(STORAGE_KEY) ? 'live' : 'deployed';
    const el = document.getElementById('last-updated');
    if (el) el.textContent = 'Updated: ' + new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) + ` (${source})`;
  } catch (err) {
    const c = document.getElementById('leaderboard-container');
    if (c) c.innerHTML = `<div class="lb-loading">Error loading data — will retry shortly</div>`;
    console.error(err);
  }
}

loadAndRender();
setInterval(loadAndRender, REFRESH_MS);
