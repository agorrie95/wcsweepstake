/* ===================================================
   scoring.js  –  Shared scoring logic (used by
                  leaderboard.js and admin.js)
   =================================================== */

const SCORING = {
  GOAL:               1,
  HAT_TRICK_BONUS:    2,
  CLEAN_SHEET:        2,
  PEN_SAVE:           2,
  RED_CARD:          -2,
  WIN:                3,
  WIN_RED_CARD_BONUS: 4,   // counterbalance on top of WIN
  DRAW:               1,
  NIL_NIL:           -3,
  PROGRESSION: {
    'group stage':    5,
    'round of 32':    5,
    'round of 16':   10,
    'quarter-finals':20,
    'semi-finals':   35,
    'final':         50,
  },
  WINNER: 80,

  // Upset rule: front-runner (≤3×) vs minnow (10×)
  UPSET_DRAW_BONUS:            3,
  UPSET_WIN_BONUS:             5,
  UPSET_FRONT_RUNNER_MAX_MULT: 3,
  UPSET_MINNOW_MIN_MULT:       10,
};

// Stages in order from earliest to latest
const PROG_STAGE_ORDER = [
  'group stage',
  'round of 32',
  'round of 16',
  'quarter-finals',
  'semi-finals',
  'final',
  'winner',
];

/**
 * Compute cumulative progression points for the furthest stage a team reached.
 * "knocked out" and "group stage" both return 0 — you earn progression pts only
 * by advancing past the group stage.
 *
 * Points represent passing each previous round:
 *   round of 32   → passed groups              → +5
 *   round of 16   → also passed R32             → +5+5 = 10
 *   quarter-finals → also passed R16            → +20
 *   semi-finals   → also passed QF              → +40
 *   final         → also passed SF              → +75
 *   winner        → also played and won final   → +205
 */
function computeProgressionPts(stage) {
  if (!stage || stage === 'group stage') return 0;
  const s = stage === 'winner' ? 'final' : stage;
  const idx = PROG_STAGE_ORDER.indexOf(s);
  if (idx < 1) return 0;
  // Award the progression bonus for each round passed to get here
  let pts = 0;
  for (let i = 0; i < idx; i++) {
    pts += SCORING.PROGRESSION[PROG_STAGE_ORDER[i]] || 0;
  }
  if (stage === 'winner') pts += SCORING.PROGRESSION['final'] + SCORING.WINNER;
  return pts;
}

/**
 * Score one team's performance in one finished match.
 * @param {object} side  - { goals, goalScorers:[{player}], redCards, penaltySaves, result }
 * @param {boolean} isNilNil
 * @returns {object} breakdown of raw (pre-multiplier) points
 */
function scoreTeamInMatch(side, isNilNil) {
  const pts = { goals: 0, hatTrickBonus: 0, cleanSheet: 0, penSaves: 0, redCards: 0, result: 0 };

  // Goals
  pts.goals = (side.goalScorers || []).length * SCORING.GOAL;

  // Hat-trick bonus – any player with 3+ goals in this match
  const counts = {};
  (side.goalScorers || []).forEach(g => {
    if (g.player) counts[g.player] = (counts[g.player] || 0) + 1;
  });
  const hatTricks = Object.values(counts).filter(c => c >= 3).length;
  pts.hatTrickBonus = hatTricks * SCORING.HAT_TRICK_BONUS;

  // Clean sheet (goals conceded = 0)
  if (side.goalsConceded === 0) pts.cleanSheet = SCORING.CLEAN_SHEET;

  // Penalty saves
  pts.penSaves = (side.penaltySaves || 0) * SCORING.PEN_SAVE;

  // Red cards
  pts.redCards = (side.redCards || 0) * SCORING.RED_CARD;

  // Match result
  const hadRed = (side.redCards || 0) > 0;
  if (side.result === 'win') {
    pts.result = SCORING.WIN + (hadRed ? SCORING.WIN_RED_CARD_BONUS : 0);
  } else if (side.result === 'draw') {
    pts.result = isNilNil ? SCORING.NIL_NIL : SCORING.DRAW;
  }

  return pts;
}

/**
 * Flat upset bonus for a match between a front-runner (≤3×) and a minnow (10×).
 * Draw:      front-runner −3, minnow +3
 * Minnow win: front-runner −5, minnow +5
 * Front-runner win: no adjustment
 * @returns {{ home: number, away: number }}
 */
function upsetBonuses(homeMultiplier, awayMultiplier, homeGoals, awayGoals) {
  const FR  = SCORING.UPSET_FRONT_RUNNER_MAX_MULT;
  const MIN = SCORING.UPSET_MINNOW_MIN_MULT;

  const homeFR   = homeMultiplier <= FR;
  const awayFR   = awayMultiplier <= FR;
  const homeMinn = homeMultiplier >= MIN;
  const awayMinn = awayMultiplier >= MIN;

  if (!((homeFR && awayMinn) || (awayFR && homeMinn))) return { home: 0, away: 0 };

  const isDraw   = homeGoals === awayGoals;
  const DB = SCORING.UPSET_DRAW_BONUS;
  const WB = SCORING.UPSET_WIN_BONUS;

  if (isDraw) {
    return {
      home: homeFR ? -DB : DB,
      away: awayFR ? -DB : DB,
    };
  }

  const minnowWon = (homeMinn && homeGoals > awayGoals) || (awayMinn && awayGoals > homeGoals);
  if (minnowWon) {
    return {
      home: homeFR ? -WB : WB,
      away: awayFR ? -WB : WB,
    };
  }

  return { home: 0, away: 0 };
}

/**
 * Compute total points per team across all finished matches.
 * @param {Array} matches
 * @param {object} progressionMap  - { teamName: stage } — if provided, used for progression pts
 * @returns {object} teamName -> totals incl. matchBreakdowns array
 */
function computeTeamTotals(matches, progressionMap, teamMultiplierMap) {
  const totals = {};
  const teamRounds = {};
  let winner = null;

  const ensure = name => {
    if (!totals[name]) totals[name] = { goals:0, hatTrickBonus:0, cleanSheet:0, penSaves:0, redCards:0, result:0, progression:0, upsetPts:0, matchBreakdowns:[] };
    if (!teamRounds[name]) teamRounds[name] = new Set();
  };

  for (const match of matches) {
    if (!match.finished) continue;
    const { home, away, round } = match;
    const roundKey = (round || '').toLowerCase();
    const isNilNil = home.goals === 0 && away.goals === 0;

    const homeResult = home.goals > away.goals ? 'win' : home.goals < away.goals ? 'loss' : 'draw';
    const awayResult = homeResult === 'win' ? 'loss' : homeResult === 'loss' ? 'win' : 'draw';

    const homeSide = { ...home, goalsConceded: away.goals, result: homeResult };
    const awaySide = { ...away, goalsConceded: home.goals, result: awayResult };

    const homeMult = (teamMultiplierMap && teamMultiplierMap[home.name]) || 1;
    const awayMult = (teamMultiplierMap && teamMultiplierMap[away.name]) || 1;
    const upset    = upsetBonuses(homeMult, awayMult, home.goals, away.goals);

    for (const [side, name, upsetBonus] of [
      [homeSide, home.name, upset.home],
      [awaySide, away.name, upset.away],
    ]) {
      ensure(name);
      const pts = scoreTeamInMatch(side, isNilNil);
      Object.keys(pts).forEach(k => { totals[name][k] += pts[k]; });
      const inGame = pts.goals + pts.hatTrickBonus + pts.cleanSheet + pts.penSaves + pts.redCards;
      totals[name].matchBreakdowns.push({ inGame, result: pts.result, upsetBonus });
      totals[name].upsetPts += upsetBonus;
      teamRounds[name].add(roundKey);
      if (roundKey === 'final' && side.result === 'win') winner = name;
    }
  }

  // Progression points
  if (progressionMap && Object.keys(progressionMap).length > 0) {
    // Use explicit admin-set progression stages
    for (const [name, stage] of Object.entries(progressionMap)) {
      ensure(name);
      totals[name].progression = computeProgressionPts(stage);
    }
  } else {
    // Fallback: derive from rounds seen in match data (legacy behaviour)
    const ROUND_ORDER = ['group stage','round of 32','round of 16','quarter-finals','semi-finals','final'];
    for (const [name, rounds] of Object.entries(teamRounds)) {
      ensure(name);
      let prog = 0;
      ROUND_ORDER.forEach(r => { if (rounds.has(r)) prog += (SCORING.PROGRESSION[r] || 0); });
      if (name === winner) prog += SCORING.WINNER;
      totals[name].progression = prog;
    }
  }

  return totals;
}

/**
 * Compute per-participant scores.
 * @param {Array} matches
 * @param {Array} participants  – [{ name, teams:[{name, multiplier, bracket}] }]
 * @param {object} progressionMap  – { teamName: stage }
 * @returns {Array} sorted scores array
 */
function computeScores(matches, participants, progressionMap) {
  const teamMultiplierMap = {};
  for (const p of participants) {
    for (const t of (p.teams || [])) {
      if (!teamMultiplierMap[t.name]) teamMultiplierMap[t.name] = parseFloat(t.multiplier) || 1;
    }
  }

  const teamTotals = computeTeamTotals(matches, progressionMap, teamMultiplierMap);

  return participants.map(p => {
    let totalGoalsPts = 0, totalResultsPts = 0, totalProgressionPts = 0, totalUpsetPts = 0;
    const teamDetails = [];

    for (const team of (p.teams || [])) {
      const mult = parseFloat(team.multiplier) || 1;
      const raw = teamTotals[team.name] || {};

      // Upset bonus is added to raw BEFORE multiplying, so it affects whether the
      // ×1 negative cap triggers and is itself amplified by the team multiplier.
      let teamInGamePts = 0, teamResultPts = 0, teamUpsetPts = 0;
      for (const { inGame, result, upsetBonus } of (raw.matchBreakdowns || [])) {
        const matchRaw    = inGame + result + (upsetBonus || 0);
        const effectiveMult = matchRaw < 0 ? 1 : mult;
        teamInGamePts += inGame * effectiveMult;
        teamResultPts += result * effectiveMult;
        teamUpsetPts  += (upsetBonus || 0) * effectiveMult;
      }

      const progRaw = raw.progression || 0;
      const teamProgPts = progRaw * mult;

      totalGoalsPts       += teamInGamePts;
      totalResultsPts     += teamResultPts;
      totalProgressionPts += teamProgPts;
      totalUpsetPts       += teamUpsetPts;

      teamDetails.push({
        name:       team.name,
        bracket:    team.bracket,
        multiplier: mult,
        total:      Math.round((teamInGamePts + teamResultPts + teamProgPts + teamUpsetPts) * 100) / 100,
        raw,
        upsetPts:   teamUpsetPts,
      });
    }

    const total = Math.round((totalGoalsPts + totalResultsPts + totalProgressionPts + totalUpsetPts) * 100) / 100;
    return {
      name: p.name,
      office: p.office || '',
      total,
      breakdown: {
        goals_pts:       Math.round(totalGoalsPts * 100) / 100,
        results_pts:     Math.round(totalResultsPts * 100) / 100,
        progression_pts: Math.round(totalProgressionPts * 100) / 100,
        upset_pts:       Math.round(totalUpsetPts * 100) / 100,
      },
      teams: teamDetails,
    };
  }).sort((a, b) => b.total - a.total);
}
