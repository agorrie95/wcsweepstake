import json

data = json.load(open("data/participants.json", encoding="utf-8"))

# Spot-check against known values from the spreadsheet
expected = {
    "Hannah Louise Carleton-Jepson": ["Spain", "Ecuador", "Curaçao"],
    "Angus Gorrie":                  ["England", "Senegal", "Australia"],
    "Adam Turner":                   ["Brazil", "Algeria", "South Korea"],
    "Carolina Sotomayor":            ["France", "Sweden", "Curaçao"],
    "Cher Vyn Goh":                  ["England", "Paraguay", "Cape Verde"],
    "Yuejuan (Natalie) Zeng":        ["Netherlands", "Belgium", "Australia"],
    "Devraj Harilela":               ["Argentina", "Ghana", "Panama"],
}

lookup = {p["name"]: [t["name"] for t in p["teams"]] for p in data}

all_ok = True
for name, exp_teams in expected.items():
    actual = lookup.get(name)
    ok = actual == exp_teams
    status = "OK" if ok else "MISMATCH"
    print(f"[{status}] {name}")
    if not ok:
        print(f"       Expected: {exp_teams}")
        print(f"       Got:      {actual}")
        all_ok = False

print(f"\nTotal participants: {len(data)}")
if all_ok:
    print("All spot-checks passed.")
