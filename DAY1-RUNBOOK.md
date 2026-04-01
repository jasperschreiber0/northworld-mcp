# Day 1 Runbook — NorthWorld MCP Server

**Goal:** Live MCP server on Railway, all 4 tools responding, API key auth working.
**Estimated time:** ~4h following this runbook.

---

## Pre-flight (do this first, 15 mins)

### 1. ABR GUID ✅ DONE
GUID registered and confirmed working: `15ec10c0-824d-4eaa-8692-fb1202933977`
Already pre-filled in `.env.example`. Just copy to `.env`.

### 2. Create `.env` from template
```bash
cd C:\Users\jaspe\northworld-mcp
copy .env.example .env
```
Fill in:
```
ABR_GUID=<from email>
APOLLO_API_KEY=kIyube9j7yrx7ftjhMutlg   # from Lead Jen
PORT=3000
MCP_API_KEYS=                              # leave empty for now, add after deployment
FREE_CALL_LIMIT=10
DB_PATH=./data/mcp.db
ADMIN_KEY=<make something up — used for /admin/stats>
STRIPE_PAYMENT_LINK=https://northworld.com.au/mcp-api  # update after Day 4
```

### 3. Install deps and smoke test locally
```bash
cd C:\Users\jaspe\northworld-mcp
npm install
node src/server.js
```
In another terminal:
```bash
# Health check
curl http://localhost:3000/health

# Manifest
curl http://localhost:3000/mcp

# ABR lookup (once GUID is set)
curl -X POST http://localhost:3000/tools/abr \
  -H "Content-Type: application/json" \
  -d '{"abn":"51824753556"}'

# NDIS lookup
curl -X POST http://localhost:3000/tools/ndis \
  -H "Content-Type: application/json" \
  -d '{"postcode":"2000","supportCategory":"07"}'
```

---

## Deploy to Railway (~30 mins)

### Option A: GitHub (recommended)
```bash
cd C:\Users\jaspe\northworld-mcp
git init
git add .
git commit -m "Day 1: NorthWorld MCP Server scaffold"
git remote add origin https://github.com/yourorg/northworld-mcp.git
git push -u origin main
```
Then in Railway:
1. New Project → Deploy from GitHub repo → `northworld-mcp`
2. Add environment variables (copy from `.env`)
3. Railway auto-detects `Procfile` and deploys

### Option B: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init   # creates new project
railway up     # deploys current directory
railway vars set ABR_GUID=xxx APOLLO_API_KEY=yyy ...
```

### After deploy
1. Copy the Railway URL (e.g. `https://northworld-mcp-prod.up.railway.app`)
2. Run smoke tests:
   ```bash
   bash smoke-test.sh https://northworld-mcp-prod.up.railway.app
   ```
3. Should get 10+ passes, 0 fails

---

## Wire Lead Jen to use MCP server (~1h)

Once the MCP server is live, Lead Jen's ABR calls should go through it instead of direct calls.

In `leadjen/services/`, the `warmth.js` file does ABR lookups directly.
Wire it to call `POST https://northworld-mcp-prod.up.railway.app/tools/abr` with the MCP key header.

Add to Lead Jen `.env`:
```
MCP_SERVER_URL=https://northworld-mcp-prod.up.railway.app
MCP_API_KEY=<internal key you add to MCP_API_KEYS as paid tier>
```

---

## API Key Management

To provision an internal key (for Lead Jen, NERVA, etc.):
1. Open `data/mcp.db` with any SQLite browser
2. Insert into `api_keys`:
   ```sql
   INSERT INTO api_keys (id, key, owner, tier)
   VALUES ('uuid-here', 'your-internal-key', 'lead-jen', 'paid');
   ```
   Or use the future `/admin/provision` endpoint (Day 4).

---

## Day 1 Success Criteria Checklist

- [ ] `curl /health` returns `{"status":"ok"}`
- [ ] `curl /mcp` returns manifest with all 4 tools listed
- [ ] ABR lookup returns structured JSON for a test ABN (requires GUID)
- [ ] AHPRA lookup returns search URL/params (no public API — this is expected)
- [ ] NDIS lookup returns provider records or graceful fallback for a test postcode
- [ ] Apollo enrichment works (reuses Lead Jen key)
- [ ] Invalid API key returns `401 invalid_api_key`
- [ ] Unauthenticated (no key) allows first 10 calls then returns `402 free_tier_exhausted`
- [ ] Railway deployment live and stable
- [ ] Smoke test script passes all checks

---

## Known Limitations (document now, fix later)

### AHPRA
- No public REST API exists. The tool returns a structured "manual lookup" response with the verification URL and params.
- Options for Day 2+:
  1. **Browser automation** (Playwright) to submit the search form and parse HTML results — reliable but slow
  2. **Contact AHPRA directly** for a data access agreement (enterprise route)
  3. **For now:** tool returns the URL → human or browser agent completes verification
- This is fine for the ClawHub skill — document it clearly in the skill description

### NDIS
- Uses the undocumented API that powers the public search form
- May break if NDIS updates their site (monitor)
- Graceful fallback is already in place (returns manual URL)
- Consider: scrape `https://www.ndis.gov.au/participants/working-with-providers/find-registered-provider` with Playwright if API goes down

### ABR
- Requires GUID registration (free, usually instant)
- GUID is tied to an email address — register under a NorthWorld email

---

## Files in this repo

```
northworld-mcp/
├── src/
│   ├── server.js              # Express app, all routes
│   ├── db/
│   │   └── database.js        # SQLite setup, usage logging, key management
│   ├── middleware/
│   │   └── auth.js            # API key auth + freemium gate
│   └── tools/
│       ├── abr.js             # ABR lookup (ABN, ACN, name search)
│       ├── ahpra.js           # AHPRA practitioner lookup
│       ├── ndis.js            # NDIS provider search
│       └── apollo.js          # Apollo enrichment passthrough
├── .env.example               # Template — copy to .env
├── .gitignore
├── DAY1-RUNBOOK.md            # This file
├── Procfile                   # Railway start command
├── nixpacks.toml              # Railway build config
├── package.json
└── smoke-test.sh              # Post-deploy verification
```
