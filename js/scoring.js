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
};

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
 * Compute total points per team across all finished matches.
 * @param {Array} matches
 * @returns {object} teamName -> { raw totals, progression }
 */
function computeTeamTotals(matches) {
  const totals = {};   // teamName -> { goals, hatTrickBonus, cleanSheet, penSaves, redCards, result, progression }
  const teamRounds = {};  // teamName -> Set of rounds
  let winner = null;

  const ensure = name => {
    if (!totals[name]) totals[name] = { goals:0, hatTrickBonus:0, cleanSheet:0, penSaves:0, redCards:0, result:0, progression:0, matchBreakdowns:[] };
    if (!teamRounds[name]) teamRounds[name] = new Set();
  };

  for (const match of matches) {
    if (!match.finished) continue;
    const { home, away, round } = match;
    const roundKey = (round || '').toLowerCase();
    const isNilNil = home.goals === 0 && away.goals === 0;

    // Determine results
    const homeResult = home.goals > away.goals ? 'win' : home.goals < away.goals ? 'loss' : 'draw';
    const awayResult = homeResult === 'win' ? 'loss' : homeResult === 'loss' ? 'win' : 'draw';

    const homeSide = { ...home, goalsConceded: away.goals, result: homeResult };
    const awaySide = { ...away, goalsConceded: home.goals, result: awayResult };

    for (const [side, name] of [[homeSide, home.name], [awaySide, away.name]]) {
      ensure(name);
      const pts = scoreTeamInMatch(side, isNilNil);
      Object.keys(pts).forEach(k => { totals[name][k] += pts[k]; });
      const inGame = pts.goals + pts.hatTrickBonus + pts.cleanSheet + pts.penSaves + pts.redCards;
      totals[name].matchBreakdowns.push({ inGame, result: pts.result });
      teamRounds[name].add(roundKey);
      if (roundKey === 'final' && side.result === 'win') winner = name;
    }
  }

  // Progression points (cumulative per round reached)
  const ROUND_ORDER = ['group stage','round of 32','round of 16','quarter-finals','semi-finals','final'];
  for (const [name, rounds] of Object.entries(teamRounds)) {
    ensure(name);
    let prog = 0;
    ROUND_ORDER.forEach(r => { if (rounds.has(r)) prog += (SCORING.PROGRESSION[r] || 0); });
    if (name === winner) prog += SCORING.WINNER;
    totals[name].progression = prog;
  }

  return totals;
}

/**
 * Compute per-participant scores.
 * @param {Array} matches
 * @param {Array} participants  – [{ name, teams:[{name, multiplier, bracket}] }]
 * @returns {Array} sorted scores array
 */
function computeScores(matches, participants) {
  const teamTotals = computeTeamTotals(matches);

  return participants.map(p => {
    let totalGoalsPts = 0, totalResultsPts = 0, totalProgressionPts = 0;
    const teamDetails = [];

    for (const team of (p.teams || [])) {
      const mult = parseFloat(team.multiplier) || 1;
      const raw = teamTotals[team.name] || {};

      // Apply multiplier per match; if a match's raw total is negative, cap at ×1
      // so the multiplier never amplifies a bad game further
      let teamInGamePts = 0, teamResultPts = 0;
      for (const { inGame, result } of (raw.matchBreakdowns || [])) {
        const effectiveMult = (inGame + result) < 0 ? 1 : mult;
        teamInGamePts += inGame * effectiveMult;
        teamResultPts += result * effectiveMult;
      }

      const progRaw = raw.progression || 0;
      const teamProgPts = progRaw * mult;

      totalGoalsPts       += teamInGamePts;
      totalResultsPts     += teamResultPts;
      totalProgressionPts += teamProgPts;

      teamDetails.push({
        name:       team.name,
        bracket:    team.bracket,
        multiplier: mult,
        total:      Math.round((teamInGamePts + teamResultPts + teamProgPts) * 100) / 100,
        raw,
      });
    }

    const total = Math.round((totalGoalsPts + totalResultsPts + totalProgressionPts) * 100) / 100;
    return {
      name: p.name,
      office: p.office || '',
      total,
      breakdown: {
        goals_pts:       Math.round(totalGoalsPts * 100) / 100,
        results_pts:     Math.round(totalResultsPts * 100) / 100,
        progression_pts: Math.round(totalProgressionPts * 100) / 100,
      },
      teams: teamDetails,
    };
  }).sort((a, b) => b.total - a.total);
}
