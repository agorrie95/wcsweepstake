"""
calculate_scores.py
===================
Reads data/matches.json + data/participants.json + data/teams.json
and writes data/scores.json with fully computed scores.

Run after fetch_results.py:
    python scripts/calculate_scores.py
"""

import json, pathlib, logging
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

ROOT         = pathlib.Path(__file__).parent.parent
DATA_DIR     = ROOT / "data"
MATCHES_F    = DATA_DIR / "matches.json"
PARTICIPANTS_F = DATA_DIR / "participants.json"
TEAMS_F      = DATA_DIR / "teams.json"
SCORES_F     = DATA_DIR / "scores.json"

# ── Scoring rules ───────────────────────────────────────────────────────────
PTS_GOAL          =  1
PTS_HAT_TRICK     =  2   # bonus on top of 3 goal points
PTS_CLEAN_SHEET   =  2
PTS_PEN_SAVE      =  2
PTS_RED_CARD      = -2
PTS_WIN           =  3
PTS_WIN_RED_CARD  =  4   # extra counterbalance (added to PTS_WIN)
PTS_DRAW          =  1
PTS_NIL_NIL       = -3   # replaces PTS_DRAW for 0-0 draws

# Progression (awarded once per team per round reached, cumulative)
ROUND_PTS = {
    "group stage":     5,
    "round of 32":     5,
    "round of 16":    10,
    "quarter-finals": 20,
    "semi-finals":    35,
    "final":          50,
}
WINNER_PTS = 80

# Round order (for determining progression)
ROUND_ORDER = [
    "group stage",
    "round of 32",
    "round of 16",
    "quarter-finals",
    "semi-finals",
    "final",
]


def load_json(path):
    with open(path) as f:
        return json.load(f)


def normalise_round(label: str) -> str:
    """Normalise the round label from API to our canonical keys."""
    label = label.lower()
    for key in ROUND_ORDER + ["final"]:
        if key in label:
            return key
    return label


def score_team_in_match(side: dict, opponent_goals: int, had_red_card: bool, is_nil_nil: bool) -> dict:
    """
    Compute raw (pre-multiplier) points for one team in one finished match.
    Returns dict with individual components.
    """
    pts = defaultdict(float)

    # Goals
    pts["goals"] += len(side["goal_events"]) * PTS_GOAL

    # Hat-trick bonus
    pts["goals"] += side.get("hat_tricks", 0) * PTS_HAT_TRICK

    # Clean sheet
    if side.get("clean_sheet"):
        pts["clean_sheet"] = PTS_CLEAN_SHEET

    # Penalty saves
    pts["pen_saves"] += side.get("penalty_saves", 0) * PTS_PEN_SAVE

    # Red cards
    pts["red_cards"] += side.get("red_cards", 0) * PTS_RED_CARD

    # Match result
    result = side.get("result")
    if result == "win":
        pts["result"] += PTS_WIN
        if had_red_card:
            pts["result"] += PTS_WIN_RED_CARD   # counterbalance
    elif result == "draw":
        if is_nil_nil:
            pts["result"] += PTS_NIL_NIL
        else:
            pts["result"] += PTS_DRAW
    # loss = 0

    return dict(pts)


def compute_scores(matches, participants, teams):
    # Build team lookup by name (lowercase for safety)
    team_info = {t["name"].lower(): t for t in teams}
    team_lookup = {t["name"]: t for t in teams}

    # Per-team raw point accumulators (before multiplier)
    team_raw = defaultdict(lambda: defaultdict(float))
    # Track which rounds each team participated in (to award progression pts)
    team_rounds = defaultdict(set)
    # Track winner
    winner_team = None

    for match in matches:
        if not match.get("finished"):
            continue

        home = match["home"]
        away = match["away"]
        round_norm = normalise_round(match.get("round", ""))
        home_goals = home.get("goals", 0) or 0
        away_goals = away.get("goals", 0) or 0
        is_nil_nil = (home_goals == 0 and away_goals == 0)

        for side, opp_goals in [(home, away_goals), (away, home_goals)]:
            name = side["name"]
            had_red = side.get("red_cards", 0) > 0
            pts = score_team_in_match(side, opp_goals, had_red, is_nil_nil)
            for k, v in pts.items():
                team_raw[name][k] += v
            # Track round
            team_rounds[name].add(round_norm)
            # If they won the final, note the winner
            if round_norm == "final" and side.get("result") == "win":
                winner_team = name

    # Add progression points
    for tname, rounds in team_rounds.items():
        prog = 0
        for r in ROUND_ORDER:
            if r in rounds:
                prog += ROUND_PTS.get(r, 0)
        if tname == winner_team:
            prog += WINNER_PTS
        team_raw[tname]["progression"] += prog

    # Now compute per-participant scores
    results = []
    for participant in participants:
        pname = participant["name"]
        assigned_teams = participant.get("teams", [])

        total_goals_pts       = 0.0
        total_results_pts     = 0.0
        total_progression_pts = 0.0

        team_details = []

        for team in assigned_teams:
            tname = team["name"]
            mult  = float(team.get("multiplier", 1.0))
            raw   = team_raw.get(tname, {})

            goals_raw      = raw.get("goals", 0) + raw.get("clean_sheet", 0) + raw.get("pen_saves", 0) + raw.get("red_cards", 0)
            results_raw    = raw.get("result", 0)
            prog_raw       = raw.get("progression", 0)

            team_total = (goals_raw + results_raw + prog_raw) * mult

            total_goals_pts       += goals_raw * mult
            total_results_pts     += results_raw * mult
            total_progression_pts += prog_raw * mult

            team_details.append({
                "team":        tname,
                "multiplier":  mult,
                "bracket":     team.get("bracket"),
                "raw": {
                    "goals":       raw.get("goals", 0),
                    "hat_tricks":  0,  # already bundled in goals
                    "clean_sheet": raw.get("clean_sheet", 0),
                    "pen_saves":   raw.get("pen_saves", 0),
                    "red_cards":   raw.get("red_cards", 0),
                    "result":      raw.get("result", 0),
                    "progression": raw.get("progression", 0),
                },
                "total":       round(team_total, 2),
            })

        results.append({
            "name":  pname,
            "total": round(total_goals_pts + total_results_pts + total_progression_pts, 2),
            "breakdown": {
                "goals_pts":       round(total_goals_pts, 2),
                "results_pts":     round(total_results_pts, 2),
                "progression_pts": round(total_progression_pts, 2),
            },
            "teams": team_details,
        })

    results.sort(key=lambda r: r["total"], reverse=True)
    return results


def main():
    log.info("Loading data...")
    matches      = load_json(MATCHES_F)   if MATCHES_F.exists()      else []
    participants = load_json(PARTICIPANTS_F) if PARTICIPANTS_F.exists() else []
    teams        = load_json(TEAMS_F)     if TEAMS_F.exists()        else []

    if not participants:
        log.warning("No participants found. Run the draw first.")

    log.info(f"Processing {len(matches)} matches for {len(participants)} participants...")
    scores = compute_scores(matches, participants, teams)

    with open(SCORES_F, "w") as f:
        json.dump(scores, f, indent=2)

    log.info(f"Scores written to {SCORES_F}")
    for r in scores:
        log.info(f"  {r['name']:25s} {r['total']:8.1f} pts")


if __name__ == "__main__":
    main()
