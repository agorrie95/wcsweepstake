/* ===================================================
   leaderboard.js  –  Renders the sweepstake leaderboard.
   Fetches data/participants.json + data/matches.json,
   calculates scores client-side via scoring.js.
   =================================================== */

const REFRESH_MS   = 15 * 1000;   // re-render every 15 s
const STORAGE_KEY  = 'wc2026_matches';

async function fetchJSON(path) {
  const res = await fetch(path + '?_=' + Date.now());
  if (!res.ok) throw new Error('Failed: ' + path);
  return res.json();
}

function getMatches() {
  // Prefer localStorage (written by admin.html) over the static JSON file
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch(e) {}
  }
  return null;   // caller will fall back to fetching matches.json
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

function renderLeaderboard(scores, participants) {
  const container = document.getElementById('leaderboard-container');

  if (!scores.length) {
    container.innerHTML = `
      <div class="lb-empty">
        <h2>No scores yet</h2>
        <p>The draw hasn't been run, or no match results have been entered yet.<br>
           Head to <a href="admin.html">the admin page</a> to add results.</p>
      </div>`;
    return;
  }

  // Assign ranks (handle ties)
  let rank = 0, prevTotal = null, counter = 0;
  const ranked = scores.map(row => {
    counter++;
    if (row.total !== prevTotal) { rank = counter; prevTotal = row.total; }
    return { ...row, rank };
  });

  const rows = ranked.map(row => {
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
  }).join('');

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
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadAndRender() {
  try {
    const participants = await fetchJSON('data/participants.json');

    // Use localStorage matches if present (live admin edits),
    // otherwise fall back to the committed data/matches.json
    let matches = getMatches();
    if (!matches) {
      matches = await fetchJSON('data/matches.json');
    }

    const scores = computeScores(matches, participants);
    renderLeaderboard(scores, participants);

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

// ── Trophy → admin (secret tap) ──────────────────────────────────────────
document.getElementById('trophy-btn').addEventListener('click', () => {
  window.location.href = 'admin.html';
});

// ── Auto-scroll for signage ───────────────────────────────────────────────
const SCROLL_SPEED_PX_S  = 40;    // pixels per second — raise to scroll faster
const PAUSE_AT_BOTTOM_MS = 3000;
const PAUSE_AT_TOP_MS    = 2000;

function startAutoScroll() {
  // Use window scroll if lb-main isn't independently scrollable
  // Interval-based (simpler and more reliable than rAF for signage)
  const STEP_PX       = 1;     // px per tick
  const TICK_MS       = 25;    // ms per tick  →  1px / 25ms = 40px/s

  let paused = false;

  function doScroll() {
    if (paused) return;

    const el = document.querySelector('.lb-main');
    if (!el) return;

    const canScroll = el.scrollHeight > el.clientHeight;

    if (canScroll) {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (atBottom) {
        paused = true;
        setTimeout(() => {
          el.scrollTop = 0;
          setTimeout(() => { paused = false; }, PAUSE_AT_TOP_MS);
        }, PAUSE_AT_BOTTOM_MS);
      } else {
        el.scrollTop += STEP_PX;
      }
    } else {
      // lb-main isn't scrollable — try scrolling the whole page instead
      const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
      if (atBottom) {
        paused = true;
        setTimeout(() => {
          window.scrollTo(0, 0);
          setTimeout(() => { paused = false; }, PAUSE_AT_TOP_MS);
        }, PAUSE_AT_BOTTOM_MS);
      } else {
        window.scrollBy(0, STEP_PX);
      }
    }
  }

  // Wait for first render, then start
  setTimeout(() => setInterval(doScroll, TICK_MS), 2000);
}

startAutoScroll();
