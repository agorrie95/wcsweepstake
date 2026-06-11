"""
fix_participants.py
Rebuilds data/participants.json using:
  - Excel spreadsheet as the source of truth for team assignments
  - Existing participants.json for office info and canonical name spellings
  - data/teams.json for team metadata (group, multiplier, bracket)
"""
import json, pathlib, unicodedata, re

ROOT = pathlib.Path(__file__).parent.parent

# ── 1. Load teams lookup ───────────────────────────────────────────────────
with open(ROOT / "data/teams.json", encoding="utf-8") as f:
    teams_list = json.load(f)
TEAMS = {t["name"]: t for t in teams_list}

def team_obj(name):
    t = TEAMS.get(name)
    if not t:
        raise ValueError(f"Unknown team: {name!r}")
    return {"name": t["name"], "group": t["group"],
            "multiplier": t["multiplier"], "bracket": t["bracket"]}

# ── 2. Excel draw (source of truth) ────────────────────────────────────────
# [Front-Runner, Long-Shot, Not-A-Chancer]
EXCEL = {
    "Adam El Balawi":               ["Argentina",    "Belgium",       "Jordan"],
    "Adam Turner":                  ["Brazil",        "Algeria",       "South Korea"],
    "Adrian Hadley":                ["Spain",         "Japan",         "Czechia"],
    "Alfie Donkin":                 ["Brazil",        "Croatia",       "Czechia"],
    "Angus Gorrie":                 ["England",       "Senegal",       "Australia"],
    "Aren Besim":                   ["Spain",         "Egypt",         "Panama"],
    "Benjamin Bach":                ["Netherlands",   "Senegal",       "DR Congo"],
    "Benjamin Prickett":            ["Netherlands",   "Japan",         "South Korea"],
    "Caitlyn Stevens":              ["Argentina",     "Egypt",         "South Africa"],
    "Carolina Sotomayor":           ["France",        "Sweden",        "Curaçao"],
    "Cassidy Tsakoniatis":          ["Germany",       "Japan",         "Saudi Arabia"],
    "Charles Betts":                ["Argentina",     "Japan",         "Cape Verde"],
    "Charles Buchan":               ["Netherlands",   "Switzerland",   "New Zealand"],
    "Charles Steel":                ["Spain",         "Ghana",         "Cape Verde"],
    "Chimuanya Okafor":             ["France",        "Canada",        "Tunisia"],
    "Chloé Hunt":                   ["Argentina",     "Austria",       "Bosnia & Herzegovina"],
    "Daniel Kalish":                ["Argentina",     "Mexico",        "Tunisia"],
    "Del-Ann Henry":                ["Netherlands",   "Norway",        "Iran"],
    "Devin Orgettas":               ["Netherlands",   "Croatia",       "Qatar"],
    "Devraj Harilela":              ["Argentina",     "Ghana",         "Panama"],
    "Edward Nethersole":            ["Netherlands",   "Ecuador",       "Panama"],
    "Ellie Bartley":                ["England",       "Egypt",         "South Korea"],
    "Elliott Campbell":             ["Portugal",      "Sweden",        "Czechia"],
    "Eloise Tilbury":               ["Spain",         "Mexico",        "Jordan"],
    "Evan Dwinell":                 ["Brazil",        "Ecuador",       "Iran"],
    "Flora Tissier":                ["Portugal",      "Ecuador",       "Uzbekistan"],
    "Gaurav Sethi":                 ["Netherlands",   "Sweden",        "South Africa"],
    "George Roberts":               ["Netherlands",   "Austria",       "Jordan"],
    "Griffin Godsick":              ["Netherlands",   "Ivory Coast",   "Bosnia & Herzegovina"],
    "Hannah Louise Carleton-Jepson":["Spain",         "Ecuador",       "Curaçao"],
    "Hiral Patel":                  ["Netherlands",   "Ghana",         "Saudi Arabia"],
    "Jack Mulloy":                  ["England",       "Algeria",       "Qatar"],
    "James Rudofsky":               ["Brazil",        "Uruguay",       "New Zealand"],
    "Jane Nash":                    ["Spain",         "Austria",       "Haiti"],
    "Jessica Wakefield":            ["Spain",         "Ivory Coast",   "Iraq"],
    "Johnny Barker":                ["Argentina",     "Colombia",      "Australia"],
    "Justin Pearson":               ["Spain",         "Switzerland",   "Qatar"],
    "Kriti Nandi":                  ["Argentina",     "Croatia",       "Haiti"],
    "Lewis Ward":                   ["France",        "Austria",       "Iran"],
    "Lindsey Cruikshank":           ["Spain",         "Senegal",       "South Korea"],
    "Lisa Kennedy":                 ["England",       "Sweden",        "Haiti"],
    "Lucy Whyte":                   ["Germany",       "Switzerland",   "Bosnia & Herzegovina"],
    "Luisa Blanco-Bush":            ["Argentina",     "Norway",        "DR Congo"],
    "Madeline Schmitt":             ["Brazil",        "Mexico",        "Haiti"],
    "Maria Llenas":                 ["Spain",         "Croatia",       "Iran"],
    "Matthew Healy":                ["France",        "Colombia",      "New Zealand"],
    "Max Denton":                   ["Germany",       "Senegal",       "New Zealand"],
    "Mitchell Myers II":            ["France",        "Switzerland",   "Saudi Arabia"],
    "Natalie Zeng":                 ["Netherlands",   "Belgium",       "Australia"],
    "Nataliia Zinets":              ["Germany",       "Canada",        "Czechia"],
    "Neha Vivek":                   ["Brazil",        "Austria",       "Saudi Arabia"],
    "Nicholas Guerriero":           ["Germany",       "Austria",       "Uzbekistan"],
    "Oliver Thompson":              ["Argentina",     "Scotland",      "Saudi Arabia"],
    "Rizwaan Ahmed":                ["Netherlands",   "Egypt",         "Curaçao"],
    "Rohan Lakhani":                ["Brazil",        "Scotland",      "Iraq"],
    "Rohit Parmar":                 ["Argentina",     "Algeria",       "Czechia"],
    "Sabah Reina":                  ["France",        "Ecuador",       "Cape Verde"],
    "Sabrina Walsh":                ["Netherlands",   "Uruguay",       "Tunisia"],
    "Samuel Jacobwitz":             ["Spain",         "USA",           "Saudi Arabia"],
    "Sean Helverson":               ["England",       "Austria",       "Iraq"],
    "Sebastian Coughlin":           ["England",       "Switzerland",   "Iran"],
    "Seema Brin":                   ["Spain",         "Algeria",       "Australia"],
    "Shawn Glacbach":               ["England",       "Uruguay",       "DR Congo"],
    "Shaylin Castro":               ["Argentina",     "Sweden",        "South Korea"],
    "Sheldon VanKooten":            ["France",        "Paraguay",      "Haiti"],
    "Szabolcs Wiksell":             ["Spain",         "Sweden",        "Tunisia"],
    "Sze Tung Lam":                 ["Spain",         "Colombia",      "DR Congo"],
    "Tara Shaw":                    ["Germany",       "Egypt",         "DR Congo"],
    "Thomas Bradbeer":              ["Brazil",        "USA",           "Qatar"],
    "Thomas Chambers":              ["England",       "Norway",        "Tunisia"],
    "Thomas Walsh":                 ["Portugal",      "Austria",       "DR Congo"],
    "Thomas Wilkie":                ["France",        "Japan",         "South Africa"],
    "Vyn Goh":                      ["England",       "Paraguay",      "Cape Verde"],
    "Wendy Martin":                 ["Spain",         "Paraguay",      "South Africa"],
    "William Bown":                 ["England",       "Ecuador",       "Saudi Arabia"],
    "William Hannaford":            ["Netherlands",   "Paraguay",      "Czechia"],
    "Yasra Khurram":                ["Spain",         "Norway",        "New Zealand"],
    "Yebin Nam":                    ["Brazil",        "Senegal",       "Tunisia"],
}

# ── 3. Office info from existing participants.json ─────────────────────────
with open(ROOT / "data/participants.json", encoding="utf-8") as f:
    existing = json.load(f)

# Build a normalised-name → office map from the existing file
def normalise(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()

office_map = {normalise(p["name"]): p["office"] for p in existing}

# Also map the display name we want to use (canonical JSON name if it differs
# from the Excel name, e.g. accent variants or "Yuejuan (Natalie) Zeng")
json_name_map = {normalise(p["name"]): p["name"] for p in existing}

# ── 4. Build corrected participants list ───────────────────────────────────
participants = []
unmatched = []

for excel_name, (fr, ls, nac) in EXCEL.items():
    key = normalise(excel_name)

    # Office lookup (try exact normalised, then partial)
    office = office_map.get(key)
    canonical = json_name_map.get(key, excel_name)

    if office is None:
        # Try stripping middle names / parenthetical parts
        for stored_key, stored_office in office_map.items():
            words_excel = set(key.split())
            words_stored = set(stored_key.split())
            if words_excel & words_stored and len(words_excel & words_stored) >= 2:
                office = stored_office
                canonical = json_name_map[stored_key]
                break

    if office is None:
        unmatched.append(excel_name)
        office = "Unknown"

    participants.append({
        "name": canonical,
        "office": office,
        "teams": [team_obj(fr), team_obj(ls), team_obj(nac)],
    })

# ── 5. Write output ────────────────────────────────────────────────────────
out_path = ROOT / "data/participants.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(participants, f, indent=2, ensure_ascii=False)

print(f"Written {len(participants)} participants to {out_path}")
if unmatched:
    print(f"\nWARNING — could not find office for: {unmatched}")
else:
    print("All offices matched successfully.")
