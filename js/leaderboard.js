/* ===================================================
   leaderboard.js  –  Renders the sweepstake leaderboard.
   Fetches data/participants.json + data/matches.json,
   calculates scores client-side via scoring.js.
   =================================================== */

const REFRESH_MS  = 15 * 1000;
const STORAGE_KEY = 'wc2026_matches';
const PROG_KEY    = 'wc2026_progression';

// Module-scope data — kept fresh after every loadAndRender, used by modals
let _matches = [], _participants = [], _progressionMap = {}, _teamMultiplierMap = {}, _teamInfoMap = {};

// ── Data helpers ──────────────────────────────────────────────────────────

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

// ── Scoring helpers ───────────────────────────────────────────────────────

function matchSides(m) {
  const isNilNil = m.home.goals === 0 && m.away.goals === 0;
  const homeResult = m.home.goals > m.away.goals ? 'win' : m.home.goals < m.away.goals ? 'loss' : 'draw';
  const awayResult = homeResult === 'win' ? 'loss' : homeResult === 'loss' ? 'win' : 'draw';
  return {
    isNilNil,
    homeSide: { ...m.home, goalsConceded: m.away.goals, result: homeResult },
    awaySide: { ...m.away, goalsConceded: m.home.goals, result: awayResult },
    homeResult, awayResult
  };
}

function rawTotal(ptsObj) {
  return Object.values(ptsObj).reduce((s, v) => s + v, 0);
}

function multipliedPts(ptsObj, multiplier) {
  const raw = rawTotal(ptsObj);
  return raw < 0 ? raw : raw * multiplier;
}

function buildEventsStr(pts, side, result, isNilNil) {
  const parts = [];
  if (side.goals > 0)        parts.push(`⚽ ${side.goals} goal${side.goals > 1 ? 's' : ''}`);
  if (pts.hatTrickBonus > 0) parts.push('🎩 hat-trick');
  if (pts.cleanSheet > 0)    parts.push('🧤 clean sheet');
  if (pts.penSaves > 0)      parts.push(`🛑 ×${side.penaltySaves}`);
  if (pts.redCards < 0)      parts.push(`🟥 ×${side.redCards}`);
  if (result === 'win')      parts.push('✅ win');
  else if (result === 'draw') parts.push(isNilNil ? '😴 0-0' : '🤝 draw');
  return parts.join(' · ') || '—';
}

// ── Leaderboard rendering ─────────────────────────────────────────────────

function rankDisplay(rank) {
  if (rank === 1) return '<span class="rank-medal">🥇</span>';
  if (rank === 2) return '<span class="rank-medal">🥈</span>';
  if (rank === 3) return '<span class="rank-medal">🥉</span>';
  return `<span class="rank--other">${rank}</span>`;
}

function rowClass(rank) {
  return rank <= 3 ? `top-${rank}` : '';
}

function deltaIndicator(delta) {
  if (delta === null)  return '<span class="rank-delta rank-delta--new">NEW</span>';
  if (delta > 0) return `<span class="rank-delta rank-delta--up">▲${delta}</span>`;
  if (delta < 0) return `<span class="rank-delta rank-delta--down">▼${Math.abs(delta)}</span>`;
  return '<span class="rank-delta rank-delta--same">—</span>';
}

function renderLeaderboard(scores) {
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
        <td class="rank-cell">${rankDisplay(row.rank)}${row.delta !== undefined ? deltaIndicator(row.delta) : ''}</td>
        <td class="name-cell lb-name-link" data-participant="${row.name}">${row.name}</td>
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

// ── Best-teams-by-bracket widget ─────────────────────────────────────────

const BRACKET_ORDER  = ['front-runner', 'long-shot', 'not-a-chancer'];
const BRACKET_LABELS = {
  'front-runner':  'Best Front-Runner',
  'long-shot':     'Best Long-Shot',
  'not-a-chancer': 'Best Not-A-Chancer',
};

function renderBestTeams(matches, participants, progressionMap, teamInfoMap) {
  const el = document.getElementById('best-teams-widget');
  if (!el) return;

  const best = computeBestTeamsByBracket(matches, participants, progressionMap);

  el.innerHTML = BRACKET_ORDER.filter(b => best[b]).map(b => {
    const t = best[b];
    const info = teamInfoMap[t.name] || {};
    const code = info.code || t.name.slice(0,3).toUpperCase();
    const flagImg = info.iso2
      ? `<img class="best-team-chip__flag" src="https://flagcdn.com/24x18/${info.iso2}.png" srcset="https://flagcdn.com/48x36/${info.iso2}.png 2x" alt="" />`
      : '';
    return `
      <div class="best-team-chip best-team-chip--${b}" title="${t.name}">
        <span class="best-team-chip__label">${BRACKET_LABELS[b]}</span>
        <span class="best-team-chip__name">${flagImg}${code}<span class="best-team-chip__mult"> ×${t.multiplier}</span></span>
        <span class="best-team-chip__pts">${t.total >= 0 ? '+' : ''}${t.total.toFixed(1)}pts</span>
      </div>`;
  }).join('');
}

// ── Sidebar ───────────────────────────────────────────────────────────────

function renderSidebar(matches) {
  const el = document.getElementById('sidebar-results');
  if (!el) return;

  const today = new Date();
  const isMonday = today.getDay() === 1;
  const toDateStr = d => d.toLocaleDateString('en-CA');
  let sidebarDates, sidebarTitle, emptyLabel;

  if (isMonday) {
    const fri = new Date(today); fri.setDate(today.getDate() - 3);
    const sat = new Date(today); sat.setDate(today.getDate() - 2);
    const sun = new Date(today); sun.setDate(today.getDate() - 1);
    sidebarDates = new Set([toDateStr(fri), toDateStr(sat), toDateStr(sun)]);
    sidebarTitle = "Weekend's Results";
    emptyLabel   = 'No matches played this weekend';
  } else {
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    sidebarDates = new Set([toDateStr(yesterday)]);
    sidebarTitle = "Yesterday's Results";
    emptyLabel   = 'No matches played yesterday';
  }

  const yMatches = matches.filter(m => m.finished && sidebarDates.has(m.date));

  if (!yMatches.length) {
    el.innerHTML = `
      <div class="sidebar-title">${sidebarTitle}</div>
      <div class="sidebar-empty">${emptyLabel}</div>`;
    return;
  }

  const matchCards = yMatches.map(m => {
    const { homeSide, awaySide, homeResult, awayResult, isNilNil } = matchSides(m);
    const homePts = scoreTeamInMatch(homeSide, isNilNil);
    const awayPts = scoreTeamInMatch(awaySide, isNilNil);
    const homeRaw = rawTotal(homePts);
    const awayRaw = rawTotal(awayPts);
    const ptClass = v => v < 0 ? 'sidebar-team-pts__total--neg' : '';

    const homeMult = _teamMultiplierMap[m.home.name] || 1;
    const awayMult = _teamMultiplierMap[m.away.name] || 1;
    const uBonuses = upsetBonuses(homeMult, awayMult, m.home.goals, m.away.goals);
    const isUpset  = uBonuses.home !== 0 || uBonuses.away !== 0;

    return `
      <div class="sidebar-match lb-match-link" data-match-id="${m.id}">
        <div class="sidebar-round">${m.round || 'Match'}${isUpset ? ' <span class="lb-modal-upset-badge">⚡ UPSET</span>' : ''}</div>
        <div class="sidebar-scoreline">
          <div class="sidebar-team-name">${m.home.name}</div>
          <div class="sidebar-score">${m.home.goals} - ${m.away.goals}</div>
          <div class="sidebar-team-name sidebar-team-name--away">${m.away.name}</div>
        </div>
        <div class="sidebar-pts">
          <div class="sidebar-team-pts">
            <div class="sidebar-team-pts__name">${m.home.name}</div>
            <div class="sidebar-team-pts__events">${buildEventsStr(homePts, m.home, homeResult, isNilNil)}</div>
            <div class="sidebar-team-pts__total ${ptClass(homeRaw)}">${homeRaw > 0 ? '+' : ''}${homeRaw} raw</div>
          </div>
          <div class="sidebar-team-pts">
            <div class="sidebar-team-pts__name">${m.away.name}</div>
            <div class="sidebar-team-pts__events">${buildEventsStr(awayPts, m.away, awayResult, isNilNil)}</div>
            <div class="sidebar-team-pts__total ${ptClass(awayRaw)}">${awayRaw > 0 ? '+' : ''}${awayRaw} raw</div>
          </div>
        </div>
        <div class="sidebar-match-tap-hint">Tap to see who scored points</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sidebar-title">${sidebarTitle}</div>
    ${matchCards}
    <div class="sidebar-empty" style="font-size:10px;padding-top:4px">Raw pts shown · multiply by your team's ×</div>`;
}

// ── Modal system ──────────────────────────────────────────────────────────

function ensureModal() {
  if (document.getElementById('lb-modal-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'lb-modal-overlay';
  overlay.className = 'lb-modal-overlay hidden';
  overlay.innerHTML = `
    <div class="lb-modal-box" id="lb-modal-box">
      <button class="lb-modal-close" id="lb-modal-close">✕</button>
      <div class="lb-modal-content" id="lb-modal-content"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('lb-modal-close').addEventListener('click', closeModal);
}

function openModal(html) {
  ensureModal();
  document.getElementById('lb-modal-content').innerHTML = html;
  document.getElementById('lb-modal-overlay').classList.remove('hidden');
}

function closeModal() {
  const el = document.getElementById('lb-modal-overlay');
  if (el) el.classList.add('hidden');
}

// ── Participant modal ─────────────────────────────────────────────────────

function openParticipantModal(name) {
  const participant = _participants.find(p => p.name === name);
  if (!participant) return;

  const scoreRow = _matches.length
    ? computeScores(_matches, _participants, _progressionMap).find(s => s.name === name)
    : null;

  let html = `
    <h2 class="lb-modal-title">${name}</h2>
    <div class="lb-modal-subtitle">${scoreRow ? scoreRow.total.toFixed(1) + ' pts total' : ''}</div>`;

  for (const team of participant.teams) {
    const stage      = _progressionMap[team.name] || 'group stage';
    const myMultForProg = parseFloat(team.multiplier) || 1;
    const progRaw    = computeProgressionPts(stage);
    const progPts    = progRaw * myMultForProg;
    const knocked    = stage === 'knocked out';
    const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);

    const teamMatches = _matches.filter(m =>
      m.finished && (m.home.name === team.name || m.away.name === team.name)
    );

    let matchTotal = 0;
    let matchRows  = '';

    for (const m of teamMatches) {
      const isHome = m.home.name === team.name;
      const { homeSide, awaySide, homeResult, awayResult, isNilNil } = matchSides(m);
      const side   = isHome ? homeSide : awaySide;
      const opp    = isHome ? m.away   : m.home;
      const result = isHome ? homeResult : awayResult;
      const pts          = scoreTeamInMatch(side, isNilNil);
      const raw          = rawTotal(pts);
      const oppName      = isHome ? m.away.name : m.home.name;
      const oppMult      = _teamMultiplierMap[oppName] || 1;
      const myMult       = parseFloat(team.multiplier) || 1;
      const uBonus       = upsetBonuses(
        isHome ? myMult : oppMult,
        isHome ? oppMult : myMult,
        m.home.goals, m.away.goals
      );
      const upsetBonus   = isHome ? uBonus.home : uBonus.away;
      const adjustedRaw  = raw + upsetBonus;
      const effectiveMult = adjustedRaw < 0 ? 1 : myMult;
      const final        = adjustedRaw * effectiveMult;
      matchTotal        += final;

      const score = isHome
        ? `${m.home.goals}–${m.away.goals}`
        : `${m.away.goals}–${m.home.goals}`;

      const events  = buildEventsStr(pts, side, result, isNilNil);
      const ptsCls  = final < 0 ? 'neg' : final > 0 ? 'pos' : '';
      const capNote = (adjustedRaw < 0 && myMult > 1) ? ' <span class="lb-modal-capped">(×1 cap)</span>' : '';
      const calcStr = adjustedRaw === 0
        ? '0'
        : upsetBonus !== 0
          ? `(${raw > 0 ? '+' : ''}${raw} <span class="lb-modal-upset-note">⚡${upsetBonus > 0 ? '+' : ''}${upsetBonus}</span>) × ${effectiveMult} = <strong>${final >= 0 ? '+' : ''}${final.toFixed(1)}</strong>${capNote}`
          : `${raw > 0 ? '+' : ''}${raw} × ${effectiveMult} = <strong>${final >= 0 ? '+' : ''}${final.toFixed(1)}</strong>${capNote}`;

      matchRows += `
        <div class="lb-modal-match-row lb-match-link" data-match-id="${m.id}">
          <span class="lb-modal-mr-date">${m.date}</span>
          <span class="lb-modal-mr-fixture">${team.name} ${score} ${opp.name}</span>
          <span class="lb-modal-mr-events">${events}</span>
          <span class="lb-modal-mr-pts ${ptsCls}">${calcStr}</span>
        </div>`;
    }

    // Subtotal for this team = match pts + progression pts
    const teamTotal = matchTotal + progPts;
    const bracketClass = `team-chip--${team.bracket}`;

    html += `
      <div class="lb-modal-team-block">
        <div class="lb-modal-team-hdr">
          <span class="team-chip ${bracketClass}">${team.name}<span class="team-chip__mult"> ×${team.multiplier}</span></span>
          <span class="lb-modal-stage-badge ${knocked ? 'lb-modal-stage-badge--knocked' : ''}">${stageLabel}${progRaw > 0 ? `: +${progRaw} ×${myMultForProg} = ${progPts.toFixed(1)}pts` : ''}</span>
        </div>
        ${teamMatches.length
          ? `<div class="lb-modal-match-list">${matchRows}</div>`
          : '<div class="lb-modal-no-matches">No matches played yet</div>'}
        <div class="lb-modal-team-subtotal">
          Team subtotal: <strong>${teamTotal >= 0 ? '+' : ''}${teamTotal.toFixed(1)}pts</strong>
        </div>
      </div>`;
  }

  openModal(html);
}

// ── Match modal ───────────────────────────────────────────────────────────

function openMatchModal(matchId) {
  const m = _matches.find(x => x.id === matchId);
  if (!m) return;

  const { homeSide, awaySide, homeResult, awayResult, isNilNil } = matchSides(m);

  const homeTeamMult = _teamMultiplierMap[m.home.name] || 1;
  const awayTeamMult = _teamMultiplierMap[m.away.name] || 1;
  const matchUpset   = upsetBonuses(homeTeamMult, awayTeamMult, m.home.goals, m.away.goals);
  const isUpsetMatch = matchUpset.home !== 0 || matchUpset.away !== 0;

  let html = `
    <div class="lb-modal-match-hdr">
      <div class="lb-modal-match-round-lbl">${m.round || 'Match'} · ${m.date}${isUpsetMatch ? ' <span class="lb-modal-upset-badge">⚡ UPSET</span>' : ''}</div>
      <div class="lb-modal-match-scoreline">
        <span class="lb-modal-match-team">${m.home.name}</span>
        <span class="lb-modal-match-score">${m.home.goals} – ${m.away.goals}</span>
        <span class="lb-modal-match-team">${m.away.name}</span>
      </div>
    </div>
    <h3 class="lb-modal-section-title">Points earned by participants</h3>`;

  // Find all participants who own either team
  const earners = [];
  for (const p of _participants) {
    for (const team of p.teams) {
      if (team.name !== m.home.name && team.name !== m.away.name) continue;
      const isHome    = team.name === m.home.name;
      const side      = isHome ? homeSide : awaySide;
      const result    = isHome ? homeResult : awayResult;
      const pts           = scoreTeamInMatch(side, isNilNil);
      const raw           = rawTotal(pts);
      const upsetBonus    = isHome ? matchUpset.home : matchUpset.away;
      const adjustedRaw   = raw + upsetBonus;
      const effectiveMult = adjustedRaw < 0 ? 1 : parseFloat(team.multiplier) || 1;
      const final         = adjustedRaw * effectiveMult;
      earners.push({ name: p.name, team, side, result, pts, raw, adjustedRaw, effectiveMult, upsetBonus, final });
    }
  }

  if (!earners.length) {
    html += '<div class="lb-modal-empty">No participants own either team in this match.</div>';
    openModal(html);
    return;
  }

  // Sort highest earners first
  earners.sort((a, b) => b.final - a.final);

  for (const e of earners) {
    const events       = buildEventsStr(e.pts, e.side, e.result, isNilNil);
    const ptsCls       = e.final < 0 ? 'neg' : e.final > 0 ? 'pos' : '';
    const bracketClass = `team-chip--${e.team.bracket}`;
    const capNote      = (e.adjustedRaw < 0 && e.team.multiplier > 1) ? ' <span class="lb-modal-capped">(×1 cap)</span>' : '';
    const calcStr      = e.adjustedRaw === 0
      ? '0'
      : e.upsetBonus !== 0
        ? `(${e.raw > 0 ? '+' : ''}${e.raw} <span class="lb-modal-upset-note">⚡${e.upsetBonus > 0 ? '+' : ''}${e.upsetBonus}</span>) × ${e.effectiveMult} = <strong>${e.final >= 0 ? '+' : ''}${e.final.toFixed(1)}</strong>${capNote}`
        : `${e.raw > 0 ? '+' : ''}${e.raw} × ${e.effectiveMult} = <strong>${e.final >= 0 ? '+' : ''}${e.final.toFixed(1)}</strong>${capNote}`;

    html += `
      <div class="lb-modal-earner-row lb-name-link" data-participant="${e.name}">
        <span class="lb-modal-earner-name">${e.name}</span>
        <span class="team-chip ${bracketClass} lb-modal-earner-chip">${e.team.name}<span class="team-chip__mult"> ×${e.team.multiplier}</span></span>
        <span class="lb-modal-earner-events">${events}</span>
        <span class="lb-modal-earner-pts ${ptsCls}">${calcStr}</span>
      </div>`;
  }

  openModal(html);
}

// ── Global click delegation ───────────────────────────────────────────────
// Handles name clicks (participant modal) and match clicks (match modal)
// anywhere on the page, including inside modals.

document.addEventListener('click', e => {
  const nameEl  = e.target.closest('[data-participant]');
  const matchEl = e.target.closest('[data-match-id]');

  // Participant click inside match modal → go back to participant modal
  if (nameEl && document.getElementById('lb-modal-overlay') &&
      !document.getElementById('lb-modal-overlay').classList.contains('hidden')) {
    openParticipantModal(nameEl.dataset.participant);
    return;
  }

  if (nameEl)  { openParticipantModal(nameEl.dataset.participant); return; }
  if (matchEl) { openMatchModal(matchEl.dataset.matchId); return; }
});

// ── Load, score, render ───────────────────────────────────────────────────

async function loadAndRender() {
  try {
    const participants = await fetchJSON('data/participants.json');

    let matches = getMatches();
    if (!matches) matches = await fetchJSON('data/matches.json');

    let progressionMap = getProgression();
    if (!progressionMap) {
      try { progressionMap = await fetchJSON('data/progression.json'); } catch(e) { progressionMap = {}; }
    }

    let teamInfoMap = {};
    try {
      const teamsList = await fetchJSON('data/teams.json');
      teamsList.forEach(t => { teamInfoMap[t.name] = { iso2: t.iso2 || '', code: t.code || t.name.slice(0,3).toUpperCase() }; });
    } catch(e) { teamInfoMap = {}; }

    // Store for modal access
    _matches        = matches;
    _participants   = participants;
    _progressionMap = progressionMap;
    _teamInfoMap    = teamInfoMap;
    _teamMultiplierMap = {};
    for (const p of participants) {
      for (const t of (p.teams || [])) {
        if (!_teamMultiplierMap[t.name]) _teamMultiplierMap[t.name] = parseFloat(t.multiplier) || 1;
      }
    }

    const scores = computeScores(matches, participants, progressionMap);

    // Position deltas — Monday covers full weekend, otherwise yesterday
    const now      = new Date();
    const isMonday = now.getDay() === 1;
    const toDS     = d => d.toLocaleDateString('en-CA');
    let excludeDates;
    if (isMonday) {
      const fri = new Date(now); fri.setDate(now.getDate() - 3);
      const sat = new Date(now); sat.setDate(now.getDate() - 2);
      const sun = new Date(now); sun.setDate(now.getDate() - 1);
      excludeDates = new Set([toDS(fri), toDS(sat), toDS(sun)]);
    } else {
      const yday = new Date(now); yday.setDate(now.getDate() - 1);
      excludeDates = new Set([toDS(yday)]);
    }
    const prevMatches = matches.filter(m => !excludeDates.has(m.date));
    if (prevMatches.length < matches.length) {
      const prevScores = computeScores(prevMatches, participants, progressionMap);
      const prevRankMap = {};
      let pr = 0, pp = null, pc = 0;
      prevScores.forEach(r => { pc++; if (r.total !== pp) { pr = pc; pp = r.total; } prevRankMap[r.name] = pr; });
      let cr = 0, cp = null, cc = 0;
      scores.forEach(r => { cc++; if (r.total !== cp) { cr = cc; cp = r.total; } r.delta = prevRankMap[r.name] === undefined ? null : prevRankMap[r.name] - cr; });
    }

    renderLeaderboard(scores);
    renderSidebar(matches);
    renderBestTeams(matches, participants, progressionMap, teamInfoMap);

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

// ── Auto-scroll for signage ───────────────────────────────────────────────
function startAutoScroll() {
  const SPEED_PX_S   = 50;
  const PAUSE_BOTTOM = 4000;
  const PAUSE_TOP    = 2000;
  const TICK_MS      = 16;
  const STEP         = SPEED_PX_S * TICK_MS / 1000;

  let state = 'scrolling';

  function tick() {
    if (state !== 'scrolling') return;
    const el = document.querySelector('.lb-main');
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    if (el.scrollTop >= max - 1) {
      state = 'paused';
      setTimeout(() => {
        el.scrollTop = 0;
        setTimeout(() => { state = 'scrolling'; }, PAUSE_TOP);
      }, PAUSE_BOTTOM);
    } else {
      el.scrollTop += STEP;
    }
  }

  setTimeout(() => setInterval(tick, TICK_MS), 3000);
}

startAutoScroll();
