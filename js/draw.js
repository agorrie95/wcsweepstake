/* ===================================================
   draw.js  –  Admin draw page logic
   Loads teams.json, lets admin enter names,
   randomly assigns 1 team per bracket per person,
   then saves participants.json via a manual file
   download (since we have no server here).
   =================================================== */

let allTeams = [];
let participants = [];
let drawResult = [];

async function fetchJSON(path) {
  const res = await fetch(path + '?_=' + Date.now());
  if (!res.ok) throw new Error('Failed to load ' + path);
  return res.json();
}

// Shuffle array in-place (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Init ----
async function init() {
  allTeams = await fetchJSON('data/teams.json');
  participants = await fetchJSON('data/participants.json');
  renderExisting();
}

// ---- Step 1: Parse names ----
function loadParticipants() {
  const raw = document.getElementById('names-input').value.trim();
  if (!raw) { alert('Please enter at least one name.'); return; }
  const names = raw.split('\n').map(n => n.trim()).filter(Boolean);
  if (names.length === 0) { alert('No valid names found.'); return; }

  document.getElementById('step-participants').classList.add('hidden');
  document.getElementById('step-draw').classList.remove('hidden');

  // Check bracket sizes
  const brackets = ['front-runner', 'long-shot', 'not-a-chancer'];
  const bracketStatus = document.getElementById('bracket-status');
  const infoEl = document.getElementById('draw-info');
  infoEl.textContent = `Ready to draw for ${names.length} participant${names.length > 1 ? 's' : ''}.`;

  let warnings = 0;
  bracketStatus.innerHTML = brackets.map(b => {
    const count = allTeams.filter(t => t.bracket === b).length;
    const label = { 'front-runner': '⭐ Front-Runners', 'long-shot': '🎯 Long-Shots', 'not-a-chancer': '🤞 Not-A-Chancers' }[b];
    const ok = count >= names.length;
    if (!ok) warnings++;
    return `<span class="bracket-pill bracket-pill--${ok ? 'ok' : 'warning'}">${label}: ${count} teams for ${names.length} players ${ok ? '✓' : '⚠ Not enough!'}</span>`;
  }).join('');

  // Store names on window for draw step
  window._pendingNames = names;
}

// ---- Step 2: Run draw ----
function runDraw() {
  const names = window._pendingNames;
  if (!names) return;

  const brackets = ['front-runner', 'long-shot', 'not-a-chancer'];
  const pools = {};
  brackets.forEach(b => {
    pools[b] = shuffle([...allTeams.filter(t => t.bracket === b)]);
  });

  drawResult = names.map((name, i) => ({
    name,
    teams: brackets.map(b => pools[b][i] || null).filter(Boolean),
  }));

  renderDrawResults();
}

function rerunDraw() { runDraw(); }

function renderDrawResults() {
  document.getElementById('step-draw').classList.add('hidden');
  document.getElementById('step-results').classList.remove('hidden');

  const container = document.getElementById('draw-results');
  container.innerHTML = drawResult.map(p => `
    <div class="draw-card">
      <div class="draw-card__name">👤 ${p.name}</div>
      <div class="draw-card__teams">
        ${p.teams.map(t => `
          <span class="team-chip team-chip--${t.bracket}">
            ${t.name}
            <span class="team-chip__mult">×${t.multiplier}</span>
          </span>`).join('')}
      </div>
    </div>`).join('');
}

// ---- Step 3: Save ----
function saveDrawResults() {
  if (!drawResult.length) return;

  // Merge with existing (overwrite if same name)
  const existingMap = {};
  participants.forEach(p => { existingMap[p.name] = p; });
  drawResult.forEach(p => { existingMap[p.name] = p; });
  const merged = Object.values(existingMap);

  // Trigger download of participants.json
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'participants.json';
  a.click();
  URL.revokeObjectURL(url);

  alert('participants.json downloaded!\n\nReplace the file at data/participants.json in your project and redeploy.\n\nAlso run: python scripts/calculate_scores.py to regenerate scores.');

  // Also initialise a blank scores.json download
  const initialScores = merged.map(p => ({
    name: p.name,
    total: 0,
    breakdown: { goals_pts: 0, results_pts: 0, progression_pts: 0 },
  }));
  const blob2 = new Blob([JSON.stringify(initialScores, null, 2)], { type: 'application/json' });
  const url2 = URL.createObjectURL(blob2);
  const a2 = document.createElement('a');
  a2.href = url2;
  a2.download = 'scores.json';
  a2.click();
  URL.revokeObjectURL(url2);
}

// ---- Reset ----
function resetDraw() {
  drawResult = [];
  window._pendingNames = null;
  document.getElementById('step-draw').classList.add('hidden');
  document.getElementById('step-results').classList.add('hidden');
  document.getElementById('step-participants').classList.remove('hidden');
  document.getElementById('names-input').value = '';
}

// ---- Clear all ----
function clearAll() {
  if (!confirm('This will download an empty participants.json and scores.json. Are you sure?')) return;
  const blob  = new Blob(['[]'], { type: 'application/json' });
  const blob2 = new Blob(['[]'], { type: 'application/json' });
  [['participants.json', blob], ['scores.json', blob2]].forEach(([name, b]) => {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  });
}

// ---- Render existing participants ----
function renderExisting() {
  const el = document.getElementById('existing-participants');
  if (!participants.length) {
    el.innerHTML = '<p class="muted">No draw has been run yet.</p>';
    return;
  }
  const rows = participants.map(p => `
    <tr>
      <td>${p.name}</td>
      ${p.teams.map(t => `<td><span class="team-chip team-chip--${t.bracket}">${t.name} <span class="team-chip__mult">×${t.multiplier}</span></span></td>`).join('')}
    </tr>`).join('');
  el.innerHTML = `
    <table class="existing-table">
      <thead><tr><th>Name</th><th>Front-Runner</th><th>Long-Shot</th><th>Not-A-Chancer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Boot
init();
