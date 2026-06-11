"""
fetch_results.py
================
Fetches WC 2026 match results and events from API-Football,
then saves them to data/matches.json.

Usage:
    python scripts/fetch_results.py

Required env var:
    API_FOOTBALL_KEY  – your API-Football key (RapidAPI)
"""

import os, sys, json, time, pathlib, logging
from datetime import datetime, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────
ROOT       = pathlib.Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
MATCHES_F  = DATA_DIR / "matches.json"

API_KEY    = os.environ.get("API_FOOTBALL_KEY", "")
BASE_URL   = "https://v3.football.api-sports.io"
# WC 2026 identifiers in API-Football
LEAGUE_ID  = 1      # FIFA World Cup
SEASON     = 2026

HEADERS = {
    "x-rapidapi-host": "v3.football.api-sports.io",
    "x-rapidapi-key":  API_KEY,
}

# ── Scoring constants ───────────────────────────────────────────────────────
ROUND_PROGRESSION_PTS = {
    "group stage":      5,
    "round of 32":      5,
    "round of 16":     10,
    "quarter-finals":  20,
    "semi-finals":     35,
    "final":           50,
    "world cup final": 50,  # alternate label
}
WINNER_BONUS = 80


def api_get(endpoint: str, params: dict) -> dict:
    url = f"{BASE_URL}/{endpoint}"
    resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_fixtures() -> list[dict]:
    """Return all WC 2026 fixtures (played + scheduled)."""
    data = api_get("fixtures", {"league": LEAGUE_ID, "season": SEASON})
    return data.get("response", [])


def get_events(fixture_id: int) -> list[dict]:
    """Return all in-game events for a fixture."""
    data = api_get("fixtures/events", {"fixture": fixture_id})
    return data.get("response", [])


def parse_fixture(fix: dict, events: list[dict]) -> dict:
    """
    Convert API response into our canonical match dict.
    """
    f      = fix["fixture"]
    league = fix["league"]
    teams  = fix["teams"]
    goals  = fix["goals"]
    score  = fix["score"]

    home_name = teams["home"]["name"]
    away_name = teams["away"]["name"]
    home_goals = goals["home"] if goals["home"] is not None else 0
    away_goals = goals["away"] if goals["away"] is not None else 0
    status = f["status"]["short"]   # FT, NS, HT, etc.
    finished = status in ("FT", "AET", "PEN")

    # --- Determine result per team ---
    if finished:
        if home_goals > away_goals:
            home_result, away_result = "win", "loss"
        elif home_goals < away_goals:
            home_result, away_result = "loss", "win"
        else:
            home_result = away_result = "draw"
    else:
        home_result = away_result = None

    # --- Process events ---
    home_goals_events = []
    away_goals_events = []
    home_red_cards = 0
    away_red_cards = 0
    home_penalty_saves = 0
    away_penalty_saves = 0

    for ev in events:
        t      = ev.get("team", {}).get("name", "")
        etype  = ev.get("type", "")
        detail = ev.get("detail", "")
        player = ev.get("player", {}).get("name", "Unknown")
        minute = ev.get("time", {}).get("elapsed", 0)

        is_home = (t == home_name)

        if etype == "Goal":
            if detail in ("Normal Goal", "Own Goal", "Penalty"):
                if detail == "Own Goal":
                    # Own goal: goes to OTHER team
                    if is_home:
                        away_goals_events.append({"player": player, "minute": minute, "type": "own_goal"})
                    else:
                        home_goals_events.append({"player": player, "minute": minute, "type": "own_goal"})
                else:
                    if is_home:
                        home_goals_events.append({"player": player, "minute": minute, "type": detail.lower().replace(" ", "_")})
                    else:
                        away_goals_events.append({"player": player, "minute": minute, "type": detail.lower().replace(" ", "_")})

        elif etype == "Card" and detail == "Red Card":
            if is_home: home_red_cards += 1
            else:       away_red_cards += 1

        elif etype == "Goal" and detail == "Missed Penalty":
            # Penalty save goes to the goalkeeper's team (opposite of the team that missed)
            if is_home: away_penalty_saves += 1
            else:       home_penalty_saves += 1

    # Hat-tricks: find any player with 3+ goals
    def find_hat_tricks(goal_events):
        from collections import Counter
        counts = Counter(g["player"] for g in goal_events if g["type"] != "own_goal")
        return sum(1 for c in counts.values() if c >= 3)

    home_hat_tricks = find_hat_tricks(home_goals_events)
    away_hat_tricks = find_hat_tricks(away_goals_events)

    # Clean sheets
    home_clean_sheet = finished and away_goals == 0
    away_clean_sheet = finished and home_goals == 0

    # Round label (normalised to lowercase)
    round_label = league.get("round", "").lower()

    return {
        "fixture_id":  f["id"],
        "date":        f["date"],
        "round":       round_label,
        "status":      status,
        "finished":    finished,
        "home": {
            "name":          home_name,
            "goals":         home_goals if finished else None,
            "result":        home_result,
            "goal_events":   home_goals_events,
            "hat_tricks":    home_hat_tricks,
            "clean_sheet":   home_clean_sheet,
            "red_cards":     home_red_cards,
            "penalty_saves": home_penalty_saves,
        },
        "away": {
            "name":          away_name,
            "goals":         away_goals if finished else None,
            "result":        away_result,
            "goal_events":   away_goals_events,
            "hat_tricks":    away_hat_tricks,
            "clean_sheet":   away_clean_sheet,
            "red_cards":     away_red_cards,
            "penalty_saves": away_penalty_saves,
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    if not API_KEY:
        log.error("API_FOOTBALL_KEY environment variable not set.")
        sys.exit(1)

    log.info("Fetching WC 2026 fixtures...")
    fixtures = get_fixtures()
    log.info(f"  Found {len(fixtures)} fixtures total")

    # Only process finished games
    finished = [f for f in fixtures if f["fixture"]["status"]["short"] in ("FT", "AET", "PEN")]
    log.info(f"  {len(finished)} finished fixtures to process")

    # Load existing to avoid re-fetching unchanged games
    if MATCHES_F.exists():
        with open(MATCHES_F) as fh:
            existing = json.load(fh)
        existing_ids = {m["fixture_id"] for m in existing}
    else:
        existing = []
        existing_ids = set()

    matches = {m["fixture_id"]: m for m in existing}

    for fix in finished:
        fid = fix["fixture"]["id"]
        # Always re-fetch recent games (last 3 days) in case events were updated
        log.info(f"  Processing fixture {fid}: {fix['teams']['home']['name']} vs {fix['teams']['away']['name']}")
        events = get_events(fid)
        matches[fid] = parse_fixture(fix, events)
        time.sleep(0.4)  # Respect rate limit (~150 req/min on free tier)

    result = sorted(matches.values(), key=lambda m: m.get("date", ""))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(MATCHES_F, "w") as fh:
        json.dump(result, fh, indent=2)

    log.info(f"Saved {len(result)} matches to {MATCHES_F}")


if __name__ == "__main__":
    main()
