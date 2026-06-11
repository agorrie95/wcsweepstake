# Claude Daily Routine — WC2026 Results Updater

## Setup instructions (do once)

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Create a token scoped to repo `agorrie95/wcsweepstake` with **Contents: Read and Write** permission
3. Copy the token (you only see it once)
4. In Claude.ai, go to Settings → Custom Instructions (or wherever you store the routine),
   and replace `GITHUB_PAT_HERE` in the prompt below with your token.
   Alternatively store it in Claude's memory: "My WC2026 GitHub token is ghp_xxxx"
5. Schedule this prompt to run daily at 09:00 GMT

---

## Prompt to paste into your Claude routine

```
You are a World Cup 2026 sweepstake results updater. Run through the following steps precisely.

---

**STEP 1 — Work out yesterday's date**

Use your code execution tool to get yesterday's date in YYYY-MM-DD format:

```python
from datetime import date, timedelta
yesterday = (date.today() - timedelta(days=1)).isoformat()
print(yesterday)
```

---

**STEP 2 — Search for yesterday's WC2026 match results**

Search the web for:
- "FIFA World Cup 2026 results [yesterday's date]"
- "World Cup 2026 [yesterday's date] scores goalscorers"

For every match played, extract:
- Home team name and goals scored
- Away team name and goals scored  
- Goal scorers for each team (player names)
- Red cards for each team (count)
- Penalty saves for each team (count)
- Which round (group stage / round of 32 / round of 16 / quarter-finals / semi-finals / final)

If no matches were played yesterday, stop here and say "No WC2026 matches yesterday."

---

**STEP 3 — Fetch the current matches.json from GitHub**

Make a GET request to:
```
https://api.github.com/repos/agorrie95/wcsweepstake/contents/data/matches.json
```
Headers:
```
Authorization: Bearer GITHUB_PAT_HERE
Accept: application/vnd.github+json
```

Save the `sha` field from the response — you need it in Step 5.
Decode the base64 `content` field to get the current JSON array of matches.

---

**STEP 4 — Build the updated matches array**

Parse the decoded JSON array. For each match you found in Step 2, check whether a match with the same home team, away team, and date already exists. If it does, skip it. If it doesn't, append a new match object:

```json
{
  "id": "<unix timestamp in milliseconds as a string>",
  "date": "<yesterday YYYY-MM-DD>",
  "round": "<round name>",
  "finished": true,
  "home": {
    "name": "<home team — exact name from list below>",
    "goals": <number>,
    "goalScorers": [{"player": "Firstname Lastname"}, {"player": "..."}],
    "redCards": <number>,
    "penaltySaves": <number>
  },
  "away": {
    "name": "<away team — exact name from list below>",
    "goals": <number>,
    "goalScorers": [{"player": "Firstname Lastname"}, {"player": "..."}],
    "redCards": <number>,
    "penaltySaves": <number>
  }
}
```

**Valid round values (use exactly):**
`group stage` | `round of 32` | `round of 16` | `quarter-finals` | `semi-finals` | `final`

**Valid team names (use exactly):**
Spain, France, England, Brazil, Portugal, Argentina, Germany, Netherlands,
Belgium, Norway, Japan, Colombia, Morocco, USA, Mexico, Uruguay, Türkiye,
Croatia, Switzerland, Austria, Ecuador, Senegal, Canada, Ivory Coast, Scotland,
Sweden, Ghana, Paraguay, Algeria, Egypt, Australia, Cape Verde, Curaçao,
DR Congo, Haiti, Iran, Iraq, Jordan, New Zealand, Panama, Qatar, Saudi Arabia,
South Africa, Tunisia, Uzbekistan, Czechia, Bosnia & Herzegovina, South Korea

If a team name from the search results doesn't match exactly, find the closest match from the list above.

---

**STEP 5 — Push the updated file to GitHub**

Encode the updated JSON array (pretty-printed with 2-space indent) as base64.

Make a PUT request to:
```
https://api.github.com/repos/agorrie95/wcsweepstake/contents/data/matches.json
```
Headers:
```
Authorization: Bearer GITHUB_PAT_HERE
Content-Type: application/json
Accept: application/vnd.github+json
```
Body:
```json
{
  "message": "Auto-update: WC2026 results <yesterday's date>",
  "content": "<base64-encoded updated JSON>",
  "sha": "<sha from Step 3>"
}
```

---

**STEP 6 — Report**

Tell me:
- Which matches were added (home team, score, away team)
- How many matches are now in the file total
- Whether the push succeeded (HTTP 200 or 201 = success)

If no new matches were found or all were duplicates, say so and do NOT make a PUT request.
```

---

## Notes

- Vercel redeploys automatically after every push, so the leaderboard on the signage
  updates itself within ~60 seconds of the routine completing.
- If a match result was wrong or needs editing, use the admin panel at `/admin.html`
  and re-export `matches.json` to overwrite the auto-committed version.
- The routine does NOT update `progression.json` — manage knockouts manually via
  the Progression tab in the admin panel, then export and commit that file separately.
