# Maven WC2026 Sweepstake

A hosted leaderboard for the Maven Partnership World Cup 2026 sweepstake.
Embeds cleanly as an iframe on digital signage.

---

## Setup (one-time, ~15 minutes)

### 1 – Get an API-Football key

1. Go to [rapidapi.com/api-sports/api/api-football](https://rapidapi.com/api-sports/api/api-football)
2. Sign up for the **free tier** (100 requests/day – plenty)
3. Copy your key from the RapidAPI dashboard

### 2 – Push to GitHub

```bash
cd wc2026-sweepstake
git init
git add .
git commit -m "Initial sweepstake setup"
git remote add origin https://github.com/YOUR_ORG/wc2026-sweepstake.git
git push -u origin main
```

### 3 – Add the API key to GitHub Secrets

1. Go to your repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `API_FOOTBALL_KEY`, Value: your key from step 1

### 4 – Deploy to Netlify

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub repo
3. Build settings: leave blank (it's a static site, no build command)
4. Click **Deploy**
5. Note your Netlify URL (e.g. `https://maven-wc2026.netlify.app`)

### 5 – Connect Netlify deploy to GitHub Actions

So the leaderboard updates automatically after each nightly data refresh:

1. In Netlify: **Site settings → Build & deploy → Build hooks**
2. Create a hook named `GitHub Actions`
3. Copy the hook URL
4. In GitHub: **Settings → Secrets → Actions → New secret**
   - Name: `NETLIFY_DEPLOY_HOOK`, Value: the URL from above
5. Add this step to `.github/workflows/update-results.yml` after the `git push` step:

```yaml
      - name: Trigger Netlify redeploy
        run: curl -X POST "${{ secrets.NETLIFY_DEPLOY_HOOK }}"
```

### 6 – Run the draw

1. Open `https://your-site.netlify.app/draw.html`
2. Enter all participant names (one per line)
3. Click **Continue**, then **Run Draw**
4. Review assignments, then click **Save**
5. This downloads two files: `participants.json` and `scores.json`
6. Replace `data/participants.json` and `data/scores.json` in the repo
7. Commit and push – Netlify redeploys automatically

### 7 – Add the iframe to your digital signage

```html
<iframe
  src="https://your-site.netlify.app"
  width="1920"
  height="1080"
  frameborder="0"
  scrolling="no"
></iframe>
```

---

## How scores work

All points are **multiplied by the team's multiplier** (1× for Spain, up to 10× for minnows).

| Event | Points |
|---|---|
| Goal | +1 |
| Hat-trick bonus | +2 (on top of the 3 goal points) |
| Clean sheet | +2 |
| Penalty save | +2 |
| Red card | -2 |
| Win | +3 |
| Win with a red card | +4 extra (counteracts the -2) |
| Draw | +1 |
| 0-0 draw | -3 |
| Through group stage | +5 |
| Round of 32 | +5 |
| Round of 16 | +10 |
| Quarter-final | +20 |
| Semi-final | +35 |
| Final | +50 |
| Winner | +80 |

---

## Manual score refresh

```bash
export API_FOOTBALL_KEY=your_key_here
python scripts/fetch_results.py
python scripts/calculate_scores.py
```

Commit and push `data/matches.json` and `data/scores.json`.

---

## File structure

```
wc2026-sweepstake/
├── index.html                  # Leaderboard (signage-ready)
├── draw.html                   # Admin draw page
├── style.css
├── js/
│   ├── leaderboard.js
│   └── draw.js
├── data/
│   ├── teams.json              # 48 teams with brackets + multipliers
│   ├── participants.json       # Populated after draw
│   ├── matches.json            # Updated nightly by GitHub Actions
│   └── scores.json             # Calculated from matches + participants
├── scripts/
│   ├── fetch_results.py        # API-Football fetcher
│   └── calculate_scores.py     # Score calculator
├── .github/workflows/
│   └── update-results.yml      # Daily cron job
├── netlify.toml                # Iframe-friendly headers
└── requirements.txt
```
