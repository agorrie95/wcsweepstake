/* ===================================================
   admin.js  –  Admin results entry widget
   =================================================== */

const PASSWORD    = '123sausages';
const STORAGE_KEY = 'wc2026_matches';
const PROG_KEY    = 'wc2026_progression';

const PROG_STAGES = [
  { value: 'group stage',    label: 'Group Stage' },
  { value: 'knocked out',    label: 'Knocked Out' },
  { value: 'round of 32',    label: 'Round of 32' },
  { value: 'round of 16',    label: 'Round of 16' },
  { value: 'quarter-finals', label: 'Quarter-Finals' },
  { value: 'semi-finals',    label: 'Semi-Finals' },
  { value: 'final',          label: 'Final' },
  { value: 'winner',         label: 'Winner 🏆' },
];

const BRACKET_LABELS = {
  'front-runner':  'Front-Runners',
  'long-shot':     'Long-Shots',
  'not-a-chancer': 'Not-A-Chancers',
};

let allTeams      = [];
let matches       = [];    // in-memory, synced to localStorage
let progressionMap = {};
let participants  = [];    // in-memory, exported as participants.json
let pendingTeams  = null;  // teams staged by randomiser, not yet confirmed
let homeScore    = 0;
let awayScore    = 0;
let homeRed      = 0;
let awayRed      = 0;
let homePenSave  = 0;
let awayPenSave  = 0;

// ── Auth ──────────────────────────────────────────────────────────────────

function checkPassword() {
  const val = document.getElementById('gate-pw').value;
  if (val === PASSWORD) {
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('admin-ui').classList.remove('hidden');
    init();
  } else {
    document.getElementById('gate-error').classList.remove('hidden');
    document.getElementById('gate-pw').value = '';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('gate').classList.contains('hidden')) {
    checkPassword();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  // Load teams
  const res = await fetch('data/teams.json?_=' + Date.now());
  allTeams = await res.json();

  // Load matches from localStorage, then try to merge with data/matches.json
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { matches = JSON.parse(stored); } catch(e) { matches = []; }
  }

  // Also try fetching current data/matches.json to pre-populate if localStorage is empty
  if (!matches.length) {
    try {
      const r = await fetch('data/matches.json?_=' + Date.now());
      const data = await r.json();
      if (Array.isArray(data) && data.length) {
        matches = data;
        saveToStorage();
      }
    } catch(e) {}
  }

  // Load progression from localStorage
  const storedProg = localStorage.getItem(PROG_KEY);
  if (storedProg) {
    try { progressionMap = JSON.parse(storedProg); } catch(e) { progressionMap = {}; }
  }

  // Load participants
  try {
    const pr = await fetch('data/participants.json?_=' + Date.now());
    participants = await pr.json();
  } catch(e) { participants = []; }

  populateTeamDropdowns();
  setDefaultDate();
  resetCounters();
  renderHistory();
  renderExportStats();
  updatePreview();
}

function populateTeamDropdowns() {
  const sorted = [...allTeams].sort((a, b) => a.name.localeCompare(b.name));
  ['f-home-team', 'f-away-team'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = sorted.map(t =>
      `<option value="${t.name}">${t.name}</option>`
    ).join('');
  });
  // Default away to second team so they differ
  if (sorted.length > 1) document.getElementById('f-away-team').value = sorted[1].name;
  syncGoalRows();
  syncTeamLabels();
}

function setDefaultDate() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-date').value = today;
}

function resetCounters() {
  homeScore = awayScore = homeRed = awayRed = homePenSave = awayPenSave = 0;
  updateScoreDisplays();
  updateEventDisplays();
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function showTab(id) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
  document.getElementById(id).classList.remove('hidden');
  event.target.classList.add('tab-btn--active');
  if (id === 'tab-history')      renderHistory();
  if (id === 'tab-export')       renderExportStats();
  if (id === 'tab-progression')  renderProgressionTab();
  if (id === 'tab-participants') renderParticipantsTab();
}

// ── Progression ───────────────────────────────────────────────────────────

function renderProgressionTab() {
  const wrap = document.getElementById('progression-table-wrap');
  if (!allTeams.length) { wrap.innerHTML = '<p class="muted">Loading teams…</p>'; return; }

  const stageOpts = PROG_STAGES.map(s =>
    `<option value="${s.value}">${s.label}</option>`
  ).join('');

  const optionsFor = teamName => PROG_STAGES.map(s => {
    const sel = (progressionMap[teamName] || 'group stage') === s.value ? ' selected' : '';
    return `<option value="${s.value}"${sel}>${s.label}</option>`;
  }).join('');

  let html = '';
  for (const bracket of ['front-runner', 'long-shot', 'not-a-chancer']) {
    const teams = allTeams
      .filter(t => t.bracket === bracket)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!teams.length) continue;

    html += `
      <h3 class="prog-bracket-heading">${BRACKET_LABELS[bracket]}</h3>
      <table class="existing-table prog-table">
        <thead>
          <tr>
            <th>Team</th>
            <th style="width:60px">×Mult</th>
            <th style="width:210px">Stage Reached</th>
            <th style="width:90px;text-align:right">Prog Pts</th>
          </tr>
        </thead>
        <tbody>`;

    for (const team of teams) {
      const stage = progressionMap[team.name] || 'group stage';
      const pts   = computeProgressionPts(stage);
      html += `
          <tr id="prog-row-${team.name.replace(/\W/g,'_')}">
            <td>${team.name}</td>
            <td style="color:var(--text-muted)">×${team.multiplier}</td>
            <td>
              <select class="form-input" style="padding:5px 8px;font-size:13px"
                  data-team="${team.name}"
                  onchange="onProgressionChange(this)">
                ${optionsFor(team.name)}
              </select>
            </td>
            <td style="text-align:right;font-weight:700;color:var(--accent2)" id="prog-pts-${team.name.replace(/\W/g,'_')}">${pts}</td>
          </tr>`;
    }

    html += `</tbody></table>`;
  }

  wrap.innerHTML = html;
}

function onProgressionChange(sel) {
  const teamName = sel.dataset.team;
  const stage    = sel.value;
  progressionMap[teamName] = stage;
  localStorage.setItem(PROG_KEY, JSON.stringify(progressionMap));

  // Update the pts display in the same row without a full re-render
  const safeId = teamName.replace(/\W/g, '_');
  const ptsEl  = document.getElementById('prog-pts-' + safeId);
  if (ptsEl) ptsEl.textContent = computeProgressionPts(stage);
}

function exportProgression() {
  const blob = new Blob([JSON.stringify(progressionMap, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'progression.json'; a.click();
  URL.revokeObjectURL(url);
}

// ── Score steppers ────────────────────────────────────────────────────────

function stepScore(side, delta) {
  if (side === 'home') homeScore = Math.max(0, homeScore + delta);
  else                 awayScore = Math.max(0, awayScore + delta);
  updateScoreDisplays();
  syncGoalRows();
  updatePreview();
}

function updateScoreDisplays() {
  document.getElementById('home-score-display').textContent = homeScore;
  document.getElementById('away-score-display').textContent = awayScore;
}

function stepEvent(side, type, delta) {
  if (side === 'home' && type === 'red')     homeRed     = Math.max(0, homeRed     + delta);
  if (side === 'away' && type === 'red')     awayRed     = Math.max(0, awayRed     + delta);
  if (side === 'home' && type === 'pensave') homePenSave = Math.max(0, homePenSave + delta);
  if (side === 'away' && type === 'pensave') awayPenSave = Math.max(0, awayPenSave + delta);
  updateEventDisplays();
  updatePreview();
}

function updateEventDisplays() {
  document.getElementById('home-red-count').textContent     = homeRed;
  document.getElementById('away-red-count').textContent     = awayRed;
  document.getElementById('home-pensave-count').textContent = homePenSave;
  document.getElementById('away-pensave-count').textContent = awayPenSave;
}

// ── Goal scorer rows ──────────────────────────────────────────────────────

function syncGoalRows() {
  syncScorerList('home-scorers-list', homeScore);
  syncScorerList('away-scorers-list', awayScore);
  syncTeamLabels();
  updatePreview();
}

function syncScorerList(containerId, count) {
  const list = document.getElementById(containerId);
  const existing = list.querySelectorAll('.scorer-input');
  // Add rows if needed
  while (list.children.length < count) {
    const idx = list.children.length + 1;
    const row = document.createElement('div');
    row.className = 'scorer-row';
    row.innerHTML = `<span class="scorer-num">Goal ${idx}</span>
      <input type="text" class="scorer-input form-input" placeholder="Player name (optional)" oninput="updatePreview()" />`;
    list.appendChild(row);
  }
  // Remove excess rows
  while (list.children.length > count) {
    list.removeChild(list.lastChild);
  }
}

function syncTeamLabels() {
  const homeName = document.getElementById('f-home-team').value || 'Home';
  const awayName = document.getElementById('f-away-team').value || 'Away';
  document.getElementById('home-scorers-label').textContent = `${homeName} – Goal Scorers`;
  document.getElementById('away-scorers-label').textContent = `${awayName} – Goal Scorers`;
  document.getElementById('home-red-label').textContent     = homeName;
  document.getElementById('away-red-label').textContent     = awayName;
  document.getElementById('home-pensave-label').textContent = homeName;
  document.getElementById('away-pensave-label').textContent = awayName;
}

function getScorerNames(listId) {
  return Array.from(document.querySelectorAll(`#${listId} .scorer-input`))
    .map(inp => inp.value.trim() || 'Unknown');
}

// ── Preview ───────────────────────────────────────────────────────────────

function updatePreview() {
  const preview = document.getElementById('match-preview');
  const homeName = document.getElementById('f-home-team').value;
  const awayName = document.getElementById('f-away-team').value;
  if (!homeName || !awayName) { preview.classList.add('hidden'); return; }
  if (homeName === awayName)  { preview.classList.add('hidden'); return; }

  const round = document.getElementById('f-round').value;
  const isNilNil = homeScore === 0 && awayScore === 0;
  const homeResult = homeScore > awayScore ? 'win' : homeScore < awayScore ? 'loss' : 'draw';
  const awayResult = homeResult === 'win' ? 'loss' : homeResult === 'loss' ? 'win' : 'draw';

  const homeSide = {
    goalScorers: getScorerNames('home-scorers-list').map(p => ({player: p})),
    goalsConceded: awayScore,
    redCards: homeRed,
    penaltySaves: homePenSave,
    result: homeResult,
  };
  const awaySide = {
    goalScorers: getScorerNames('away-scorers-list').map(p => ({player: p})),
    goalsConceded: homeScore,
    redCards: awayRed,
    penaltySaves: awayPenSave,
    result: awayResult,
  };

  function calcPts(side) {
    const pts = scoreTeamInMatch(side, isNilNil);
    return Object.values(pts).reduce((a,b) => a+b, 0);
  }

  const homeTeam = allTeams.find(t => t.name === homeName) || {};
  const awayTeam = allTeams.find(t => t.name === awayName) || {};
  const homeRawPts = calcPts(homeSide);
  const awayRawPts = calcPts(awaySide);
  const homeFinalPts = (homeRawPts * (homeTeam.multiplier || 1)).toFixed(2);
  const awayFinalPts = (awayRawPts * (awayTeam.multiplier || 1)).toFixed(2);

  const resultLabel = homeResult === 'win' ? `<span style="color:var(--green)">Win</span>` :
                      homeResult === 'loss' ? `<span style="color:var(--red)">Loss</span>` :
                      isNilNil ? `<span style="color:var(--red)">0-0 😴</span>` : `<span style="color:var(--accent)">Draw</span>`;

  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-header">
      <span class="preview-team">${homeName} <span class="preview-mult">×${homeTeam.multiplier||1}</span></span>
      <span class="preview-score">${homeScore} – ${awayScore}</span>
      <span class="preview-team">${awayName} <span class="preview-mult">×${awayTeam.multiplier||1}</span></span>
    </div>
    <div class="preview-pts">
      <span class="preview-pts-val">${homeFinalPts} pts</span>
      <span class="preview-pts-label">${resultLabel} &nbsp;|&nbsp; <em>${round}</em></span>
      <span class="preview-pts-val">${awayFinalPts} pts</span>
    </div>`;
}

// ── Save match ────────────────────────────────────────────────────────────

function addMatch() {
  const homeName = document.getElementById('f-home-team').value;
  const awayName = document.getElementById('f-away-team').value;

  if (homeName === awayName) {
    alert('Home and away teams must be different.');
    return;
  }

  const match = {
    id:       Date.now().toString(),
    date:     document.getElementById('f-date').value,
    round:    document.getElementById('f-round').value,
    finished: true,
    home: {
      name:          homeName,
      goals:         homeScore,
      goalScorers:   getScorerNames('home-scorers-list').map(p => ({ player: p })),
      redCards:      homeRed,
      penaltySaves:  homePenSave,
    },
    away: {
      name:          awayName,
      goals:         awayScore,
      goalScorers:   getScorerNames('away-scorers-list').map(p => ({ player: p })),
      redCards:      awayRed,
      penaltySaves:  awayPenSave,
    },
  };

  matches.push(match);
  saveToStorage();
  resetForm();
  renderExportStats();

  // Show confirmation
  const btn = document.querySelector('[onclick="addMatch()"]');
  const orig = btn.textContent;
  btn.textContent = '✓ Saved!';
  btn.style.background = 'var(--green)';
  setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
}

function resetForm() {
  resetCounters();
  setDefaultDate();
  document.getElementById('f-round').value = 'group stage';
  document.getElementById('home-scorers-list').innerHTML = '';
  document.getElementById('away-scorers-list').innerHTML = '';
  syncTeamLabels();
  document.getElementById('match-preview').classList.add('hidden');
}

// ── History ───────────────────────────────────────────────────────────────

function renderHistory() {
  const list  = document.getElementById('match-history-list');
  const count = document.getElementById('history-count');

  if (!matches.length) {
    count.textContent = 'No matches entered yet.';
    list.innerHTML = '';
    return;
  }

  count.textContent = `${matches.length} match${matches.length > 1 ? 'es' : ''} recorded.`;

  const sorted = [...matches].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  list.innerHTML = sorted.map(m => {
    const hg = m.home.goals, ag = m.away.goals;
    const isNilNil = hg === 0 && ag === 0;
    const homeResult = hg > ag ? 'W' : hg < ag ? 'L' : 'D';
    const awayResult = hg < ag ? 'W' : hg > ag ? 'L' : 'D';
    const resultColor = r => r === 'W' ? 'var(--green)' : r === 'L' ? 'var(--red)' : 'var(--accent)';

    const homeHT = detectHatTrick(m.home.goalScorers);
    const awayHT = detectHatTrick(m.away.goalScorers);

    const badges = parts => parts.filter(Boolean).join(' ');
    const homeBadges = badges([
      m.home.redCards   ? `🟥×${m.home.redCards}` : '',
      m.home.penaltySaves ? `🧤×${m.home.penaltySaves}` : '',
      homeHT            ? '🎩 Hat-trick!' : '',
      ag === 0          ? '🧤 Clean sheet' : '',
    ]);
    const awayBadges = badges([
      m.away.redCards   ? `🟥×${m.away.redCards}` : '',
      m.away.penaltySaves ? `🧤×${m.away.penaltySaves}` : '',
      awayHT            ? '🎩 Hat-trick!' : '',
      hg === 0          ? '🧤 Clean sheet' : '',
    ]);

    return `
      <div class="history-item">
        <div class="history-meta">${m.date || '—'} &nbsp;|&nbsp; <em>${m.round}</em></div>
        <div class="history-match">
          <div class="history-side">
            <span class="history-team">${m.home.name}</span>
            <span class="history-result" style="color:${resultColor(homeResult)}">${homeResult}</span>
            ${homeBadges ? `<span class="history-badges">${homeBadges}</span>` : ''}
          </div>
          <div class="history-scoreline">${hg} – ${ag}${isNilNil ? ' 😴' : ''}</div>
          <div class="history-side history-side--right">
            <span class="history-team">${m.away.name}</span>
            <span class="history-result" style="color:${resultColor(awayResult)}">${awayResult}</span>
            ${awayBadges ? `<span class="history-badges">${awayBadges}</span>` : ''}
          </div>
        </div>
        <div class="history-actions">
          <button class="btn btn--danger btn--sm" onclick="deleteMatch('${m.id}')">🗑 Delete</button>
        </div>
      </div>`;
  }).join('');
}

function detectHatTrick(scorers) {
  if (!scorers || !scorers.length) return false;
  const counts = {};
  scorers.forEach(g => { if (g.player && g.player !== 'Unknown') counts[g.player] = (counts[g.player]||0) + 1; });
  return Object.values(counts).some(c => c >= 3);
}

function deleteMatch(id) {
  if (!confirm('Delete this match result?')) return;
  matches = matches.filter(m => m.id !== id);
  saveToStorage();
  renderHistory();
  renderExportStats();
}

// ── Export / Import ───────────────────────────────────────────────────────

async function syncFromDeployed() {
  const statusEl = document.getElementById('sync-status');
  statusEl.textContent = 'Fetching…';
  try {
    const bust = '?_=' + Date.now();
    const [matchesRes, progRes] = await Promise.all([
      fetch('data/matches.json' + bust),
      fetch('data/progression.json' + bust),
    ]);
    if (!matchesRes.ok) throw new Error('matches.json: ' + matchesRes.status);
    if (!progRes.ok)    throw new Error('progression.json: ' + progRes.status);

    const matchesData = await matchesRes.json();
    const progData    = await progRes.json();

    if (!Array.isArray(matchesData)) throw new Error('matches.json is not an array');

    localStorage.setItem(STORAGE_KEY, JSON.stringify(matchesData));
    localStorage.setItem(PROG_KEY,    JSON.stringify(progData));

    matches       = matchesData;
    progressionMap = progData;
    renderHistory();
    renderExportStats();
    statusEl.style.color = 'var(--green, #22c55e)';
    statusEl.textContent = `Synced ${matchesData.length} match${matchesData.length !== 1 ? 'es' : ''} and progression data.`;
  } catch (err) {
    statusEl.style.color = 'var(--red, #ef4444)';
    statusEl.textContent = 'Sync failed: ' + err.message;
  }
}

function exportMatches() {
  const blob = new Blob([JSON.stringify(matches, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'matches.json'; a.click();
  URL.revokeObjectURL(url);
}

function importMatches(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Not an array');
      // Ensure all imported matches have an id
      data.forEach(m => { if (!m.id) m.id = Date.now().toString() + Math.random(); });
      matches = data;
      saveToStorage();
      renderHistory();
      renderExportStats();
      alert(`Imported ${data.length} match${data.length !== 1 ? 'es' : ''} successfully.`);
    } catch(err) {
      alert('Invalid matches.json file.');
    }
  };
  reader.readAsText(file);
}

function renderExportStats() {
  const el = document.getElementById('export-stats');
  if (!el) return;
  const finished = matches.filter(m => m.finished).length;
  const rounds = [...new Set(matches.map(m => m.round))].join(', ') || '—';
  el.innerHTML = `
    <div class="stat-pill">📋 ${matches.length} total matches</div>
    <div class="stat-pill">✅ ${finished} finished</div>
    <div class="stat-pill">📍 Rounds: ${rounds}</div>`;
}

// ── Participants ──────────────────────────────────────────────────────────

function renderParticipantsTab() {
  const countEl = document.getElementById('p-count');
  if (countEl) countEl.textContent = `(${participants.length})`;
  renderParticipantsList();
}

function renderParticipantsList() {
  const el = document.getElementById('participants-list');
  if (!el) return;
  if (!participants.length) {
    el.innerHTML = '<p class="muted">No participants loaded.</p>';
    return;
  }
  const sorted = [...participants].sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = sorted.map(p => {
    const teamChips = p.teams.map(t =>
      `<span class="team-chip team-chip--${t.bracket}">${t.name}<span class="team-chip__mult"> ×${t.multiplier}</span></span>`
    ).join('');
    return `
      <div class="p-list-row">
        <div class="p-list-name">${p.name}<span class="p-list-office">${p.office ? ' · ' + p.office : ''}</span></div>
        <div class="p-list-teams">${teamChips}</div>
        <button class="btn btn--danger btn--sm" onclick="removeParticipant('${p.name.replace(/'/g, "\\'")}')">✕</button>
      </div>`;
  }).join('');
}

function randomiseTeams() {
  const name   = document.getElementById('p-name').value.trim();
  const office = document.getElementById('p-office').value.trim();
  const statusEl = document.getElementById('p-status');

  if (!name) {
    statusEl.style.color = 'var(--red, #ef4444)';
    statusEl.textContent = 'Please enter a name first.';
    return;
  }
  statusEl.textContent = '';

  const byBracket = { 'front-runner': [], 'long-shot': [], 'not-a-chancer': [] };
  allTeams.forEach(t => { if (byBracket[t.bracket]) byBracket[t.bracket].push(t); });

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  pendingTeams = [
    pick(byBracket['front-runner']),
    pick(byBracket['long-shot']),
    pick(byBracket['not-a-chancer']),
  ];

  const bracketLabel = { 'front-runner': 'Front-Runner', 'long-shot': 'Long-Shot', 'not-a-chancer': 'Not-A-Chancer' };
  document.getElementById('p-team-cards').innerHTML = pendingTeams.map(t => `
    <div class="p-team-card team-chip--${t.bracket}">
      <div class="p-team-card__bracket">${bracketLabel[t.bracket]}</div>
      <div class="p-team-card__name">${t.name}</div>
      <div class="p-team-card__mult">×${t.multiplier}</div>
    </div>`).join('');

  document.getElementById('p-team-preview').classList.remove('hidden');
}

function confirmParticipant() {
  const name   = document.getElementById('p-name').value.trim();
  const office = document.getElementById('p-office').value.trim();
  const statusEl = document.getElementById('p-status');

  if (!name || !pendingTeams) return;

  if (participants.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    statusEl.style.color = 'var(--red, #ef4444)';
    statusEl.textContent = `"${name}" already exists.`;
    return;
  }

  participants.push({
    name,
    office: office || '',
    teams: pendingTeams.map(t => ({
      name: t.name,
      group: t.group,
      multiplier: t.multiplier,
      bracket: t.bracket,
    })),
  });
  participants.sort((a, b) => a.name.localeCompare(b.name));

  // Reset form
  document.getElementById('p-name').value  = '';
  document.getElementById('p-office').value = '';
  document.getElementById('p-team-preview').classList.add('hidden');
  pendingTeams = null;

  statusEl.style.color = 'var(--green, #22c55e)';
  statusEl.textContent = `✓ ${name} added. Download participants.json below to deploy.`;

  const countEl = document.getElementById('p-count');
  if (countEl) countEl.textContent = `(${participants.length})`;
  renderParticipantsList();
}

function removeParticipant(name) {
  if (!confirm(`Remove ${name} from participants?`)) return;
  participants = participants.filter(p => p.name !== name);
  const countEl = document.getElementById('p-count');
  if (countEl) countEl.textContent = `(${participants.length})`;
  renderParticipantsList();
}

function exportParticipants() {
  const blob = new Blob([JSON.stringify(participants, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'participants.json'; a.click();
  URL.revokeObjectURL(url);
}

// ── Storage ───────────────────────────────────────────────────────────────

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
}
