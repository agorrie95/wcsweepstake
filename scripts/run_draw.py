"""
run_draw.py
===========
Randomly assigns teams to participants with the constraint that
no two participants share the same team in more than one bracket.

i.e. every (FR, LS), (FR, NAC), and (LS, NAC) pair is unique.
"""

import json, random, pathlib, sys

ROOT = pathlib.Path(__file__).parent.parent

participants_raw = [
    ('Adam El Balawi','Dubai'),('Benjamin Prickett','Dubai'),
    ('Edward Nethersole','Hong Kong'),('Sze Tung Lam','Hong Kong'),
    ('William Bown','Hong Kong'),('Yebin Nam','Hong Kong'),('Yuejuan (Natalie) Zeng','Hong Kong'),
    ('Adam Turner','London'),('Alfie Donkin','London'),('Angus Gorrie','London'),
    ('Aren Besim','London'),('Charles Steel','London'),('Charles Betts','London'),
    ('Cher Vyn Goh','London'),('Chloë Hunt','London'),('Devraj Harilela','London'),
    ('Elliott Campbell','London'),('Eloise Tilbury','London'),('Gaurav Sethi','London'),
    ('Griffin Godsick','London'),('Hannah Louise Carleton-Jepson','London'),
    ('Hiral Patel','London'),('Jack Mulloy','London'),('James Rudofsky','London'),
    ('Jane Nash','London'),('Jessica Wakefield','London'),('Johnny Barker','London'),
    ('Justin Pearson','London'),('Lewis Ward','London'),('Lucy Whyte','London'),
    ('Luisa Blanco-Bush','London'),('Max Denton','London'),('Nataliia Zinets','London'),
    ('Neha Vivek','London'),('Oliver Thompson','London'),('Rohan Lakhani','London'),
    ('Rohit Parmar','London'),('Sabrina Walsh','London'),('Sebastian Coughlin','London'),
    ('Tara Shaw','London'),('Thomas Chambers','London'),('Thomas Walsh','London'),
    ('Thomas Wilkie','London'),('Wendy Martin','London'),('William Hannaford','London'),
    ('Yasra Khurram','London'),
    ('Benjamin Bach','New York'),('Adrian Hadley','New York'),('Caitlyn Stevens','New York'),
    ('Cassidy Tsakoniatis','New York'),('Charles Buchan','New York'),('Chimuanya Okafor','New York'),
    ('Daniel Kalish','New York'),('Del-Ann Henry','New York'),('Devin Orgettas','New York'),
    ('Ellie Bartley','New York'),('Evan Dwinell','New York'),('Flora Tissier','New York'),
    ('George Roberts','New York'),('Kriti Nandi','New York'),('Lindsey Cruikshank','New York'),
    ('Lisa Kennedy','New York'),('Madeline Schmitt','New York'),('Maria Llenas','New York'),
    ('Matthew Healy','New York'),('Mitchell Myers II','New York'),('Nicholas Guerriero','New York'),
    ('Rizwaan Ahmed','New York'),('Sabah Reina','New York'),('Samuel Jacobwitz','New York'),
    ('Sean Helverson','New York'),('Seema Brin','New York'),('Shawn Glacbach','New York'),
    ('Shaylin Castro','New York'),('Sheldon VanKooten','New York'),('Szabolcs Wiksell','New York'),
    ('Thomas Bradbeer','West Palm Beach'),('Carolina Sotomayor','West Palm Beach'),
]

with open(ROOT / 'data' / 'teams.json', encoding='utf-8') as f:
    teams = json.load(f)

front_runners  = [t['name'] for t in teams if t['bracket'] == 'front-runner']
long_shots     = [t['name'] for t in teams if t['bracket'] == 'long-shot']
not_a_chancers = [t['name'] for t in teams if t['bracket'] == 'not-a-chancer']
team_lookup    = {t['name']: t for t in teams}

n = len(participants_raw)

# Feasibility check
fr_ls_pairs  = len(front_runners)  * len(long_shots)      # 8 x 13 = 104
fr_nac_pairs = len(front_runners)  * len(not_a_chancers)  # 8 x 28 = 224
ls_nac_pairs = len(long_shots)     * len(not_a_chancers)  # 13 x 28 = 364
print(f"Participants: {n}")
print(f"Available FR×LS pairs:  {fr_ls_pairs}  (need {n})")
print(f"Available FR×NAC pairs: {fr_nac_pairs} (need {n})")
print(f"Available LS×NAC pairs: {ls_nac_pairs} (need {n})")

def try_draw(seed):
    rng = random.Random(seed)
    used_fr_ls  = set()
    used_fr_nac = set()
    used_ls_nac = set()
    result = []

    shuffled = list(participants_raw)
    rng.shuffle(shuffled)

    for name, office in shuffled:
        # Build list of valid (fr, ls, nac) triples
        # Shuffle each pool to randomise selection
        frs  = front_runners[:]
        lss  = long_shots[:]
        nacs = not_a_chancers[:]
        rng.shuffle(frs)
        rng.shuffle(lss)
        rng.shuffle(nacs)

        assigned = None
        for fr in frs:
            for ls in lss:
                if (fr, ls) in used_fr_ls:
                    continue
                for nac in nacs:
                    if (fr, nac) in used_fr_nac:
                        continue
                    if (ls, nac) in used_ls_nac:
                        continue
                    assigned = (fr, ls, nac)
                    break
                if assigned:
                    break
            if assigned:
                break

        if not assigned:
            return None  # Dead end — retry with different seed

        used_fr_ls.add((assigned[0], assigned[1]))
        used_fr_nac.add((assigned[0], assigned[2]))
        used_ls_nac.add((assigned[1], assigned[2]))
        result.append({'name': name, 'office': office,
                       'teams': [team_lookup[assigned[0]],
                                 team_lookup[assigned[1]],
                                 team_lookup[assigned[2]]]})

    # Re-sort back to original order
    order = {name: i for i, (name, _) in enumerate(participants_raw)}
    result.sort(key=lambda p: order[p['name']])
    return result


print("\nRunning draw...")
result = None
for attempt in range(1, 10001):
    result = try_draw(seed=attempt)
    if result:
        print(f"Valid draw found on attempt {attempt} (seed={attempt})")
        break

if not result:
    print("ERROR: Could not find a valid draw after 10000 attempts.")
    sys.exit(1)

# Save
out_path = ROOT / 'data' / 'participants.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

# Print results
print()
print(f"{'Name':<40} {'Front-Runner':<22} {'Long-Shot':<22} {'Not-A-Chancer'}")
print('-' * 100)
for p in result:
    t = p['teams']
    print(f"{p['name']:<40} {t[0]['name']:<22} {t[1]['name']:<22} {t[2]['name']}")

# Verify constraint
print("\nVerifying constraint (no pair of participants shares >1 team)...")
violations = 0
for i in range(len(result)):
    for j in range(i+1, len(result)):
        a = {result[i]['teams'][0]['name'], result[i]['teams'][1]['name'], result[i]['teams'][2]['name']}
        b = {result[j]['teams'][0]['name'], result[j]['teams'][1]['name'], result[j]['teams'][2]['name']}
        shared = a & b
        if len(shared) > 1:
            print(f"  VIOLATION: {result[i]['name']} & {result[j]['name']} share {shared}")
            violations += 1
if violations == 0:
    print("  All clear - no violations found.")
