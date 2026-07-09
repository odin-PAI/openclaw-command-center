# Command Center Refactor — Forge Handoff

**Created:** 2026-07-09
**Purpose:** Pick up the open-source readiness refactor where Sindri left off.
**Code Review:** `vaults/Odins Relics/Projects/Command-Center-Code-Review.md`
**Branch:** `fix/sqlite-cron-fallback` (22 commits ahead of `main`)
**Project:** `~/.openclaw/workspace/command-center/`

---

## Background

Fable (claude-fable-5) ran a full code review on 2026-07-08 identifying hardcoded paths, broken logic, phantom config keys, and a python3 dependency that should be native Node. Sindri (gpt-5.5) was spawned to implement all fixes but **failed mid-run** (~59 min, likely context/timeout). It got roughly 60% done — modules extracted, some wiring incomplete, several items untouched.

---

## What's DONE (committed on branch)

22 commits on `fix/sqlite-cron-fallback`. Key completed work:

1. ✅ Replaced all OpenClaw CLI calls with Gateway HTTP API (huge perf win: 12s → 0.1s)
2. ✅ Quick Action buttons with inline results + loading spinners
3. ✅ LLM usage aggregated from Gateway API session data
4. ✅ API spend cards replaced with real OpenClaw instance usage
5. ✅ Tailscale serve status panel with service labels
6. ✅ PM2 endpoint implemented (was 404)
7. ✅ Sessions section repositioned, agent panel label fix

## What's DONE (uncommitted — staged by Sindri before crash)

These changes exist as uncommitted diffs. They look correct but need verification:

| File | Change | Status |
|------|--------|--------|
| `src/pm2.js` | **NEW** — extracted PM2 logic with proper candidate fallback loop (58 lines) | ✅ Complete, clean |
| `src/tailscale.js` | **NEW** — extracted Tailscale logic with JSON + plaintext parsers (176 lines) | ✅ Complete, clean |
| `src/cron.js` | Replaced python3 inline SQLite with `node:sqlite` (`DatabaseSync`). Uses `getOpenClawDir()` from config. | ✅ Complete, clean |
| `src/config.js` | Added `tools.pm2Binary`, `tools.tailscaleBinary`, `tailscale.portLabels`, `integrations.apiCosts`, `server.gatewayPort`, `billing.blendedRates`, `billing.defaultRate` | ✅ Complete, clean |
| `src/gateway-api.js` | Replaced `/home/odin` fallback with `getOpenClawDir()`. Uses `CONFIG.server.gatewayPort`. | ✅ Complete, clean |
| `src/llm-usage.js` | Renamed `BLENDED_RATES` → `DEFAULT_BLENDED_RATES`. Added `getBlendedRates()` that merges config overrides. Imports `CONFIG`. | ✅ Complete, clean |
| `src/index.js` | Imports `getPm2Processes` and `getTailscaleServes`. Removed inline PM2/Tailscale handlers (~200 lines deleted). Fixed `getLlmUsage()` call to drop stale `PATHS.state` arg. | ✅ Partial — see remaining items below |

---

## What's NOT DONE — Remaining Tasks

These items from the code review were **not implemented** by Sindri:

### 1. `src/index.js` — MTD response keys still snake_case
**Lines 587–594.** Rename to camelCase:
```
days_included  →  daysIncluded
anthropic_mtd  →  anthropicMtd
openai_mtd     →  openaiMtd
combined_mtd   →  combinedMtd
anthropic_detail → anthropicDetail
openai_detail  →  openaiDetail
```
⚠️ Check if the frontend (`public/index.html`) references these keys and update there too.

### 2. `src/index.js` — Remove `/api/llm-quota` duplicate route
**Line 357.** `/api/llm-quota` and `/api/llm-usage` (line 622) are duplicate handlers. Keep `/api/llm-usage`, delete `/api/llm-quota`.

### 3. `src/index.js` — Gate `/api/api-costs` behind config
**Lines 567–618.** Currently hard-depends on `skills/api-costs/scripts/api-costs.js`. When `CONFIG.integrations.apiCosts.enabled` is falsy, return:
```json
{ "enabled": false, "note": "Configure integrations.apiCosts to enable billing data" }
```
When enabled, use `CONFIG.integrations.apiCosts.scriptPath` instead of hardcoded path.

### 4. `src/index.js` — Use `CONFIG.server.host` in `server.listen()`
**Line 684.** Currently hardcoded to `127.0.0.1`. Change to:
```javascript
server.listen(PORT, CONFIG.server.host, () => { ... });
```

### 5. `package.json` — Raise `engines.node` to `>=22.5`
Required because `node:sqlite` (`DatabaseSync`) needs Node 22.5+. Current: `>=18.0.0`.

### 6. `config/dashboard.example.json` — Clean up phantom keys
Remove keys the code never reads:
- `sessions.*`, `cache.*`, `health.*`, `analytics.*`, `security.*`, `logging.*`

Add keys the code now actually reads:
- `tools.pm2Binary`, `tools.tailscaleBinary`
- `tailscale.portLabels`
- `billing.blendedRates`, `billing.defaultRate`
- `integrations.apiCosts.enabled`, `integrations.apiCosts.scriptPath`
- `server.gatewayPort`

Remove the `$schema` reference to nonexistent `dashboard.schema.json`.

### 7. `README.md` — Update configuration docs
- Document the new config keys added in step 6
- Soften or remove "ES Modules — clean component architecture" claim (app.js is a stub)
- Add note about `dashboard.local.json` for local overrides
- Note `node:sqlite` requirement (Node ≥ 22.5)

### 8. `src/index.js` — Rename `handleApi()` → `handleLegacyStatus()`
Low priority cosmetic rename. The function handles `/api/status` specifically.

### 9. Frontend — `public/index.html` key references
After renaming MTD keys (task 1), grep `public/index.html` and `public/js/` for the old snake_case names and update. The frontend is a ~5000-line monolith — search carefully.

---

## Build & Verify Checklist

After all changes:

```bash
cd ~/.openclaw/workspace/command-center

# 1. Bundle
npx esbuild src/index.js --bundle --platform=node --outfile=lib/server.js

# 2. Check no hardcoded paths leaked into bundle
grep -c "/home/odin" lib/server.js
# Expected: 0

# 3. Restart
pm2 restart command-center
sleep 2

# 4. Test endpoints
curl -s http://127.0.0.1:3333/api/pm2 | python3 -m json.tool | head -5
curl -s http://127.0.0.1:3333/api/tailscale | python3 -m json.tool | head -5
curl -s http://127.0.0.1:3333/api/cron | python3 -m json.tool | head -5
curl -s http://127.0.0.1:3333/api/api-costs | python3 -m json.tool
# api-costs should return { "enabled": false } unless configured

# 5. Verify MTD keys are camelCase
curl -s http://127.0.0.1:3333/api/api-costs/mtd | python3 -m json.tool | head -10
# Should show daysIncluded, anthropicMtd, etc. (or { "enabled": false })

# 6. Verify /api/llm-quota is gone
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3333/api/llm-quota
# Expected: 404
```

## Commit Message

```
refactor: open-source readiness pass

- Extract PM2 logic to src/pm2.js with correct candidate fallback loop
- Extract Tailscale logic to src/tailscale.js; port labels via config
- Replace python3 inline SQLite with node:sqlite (Node 22.5+)
- Add tools/tailscale/apiCosts sections to src/config.js
- Fix gateway-api.js HOME fallback (os.homedir + profile-aware path)
- Merge billing.blendedRates from config into llm-usage.js rates table
- Gate /api/api-costs behind integrations.apiCosts.enabled
- Camel-case MTD response keys; drop /api/llm-quota duplicate
- Use CONFIG.server.host in server.listen()
- Sync dashboard.example.json to implemented keys
- Raise engines.node to >=22.5 for node:sqlite
- Update README configuration docs
```

---

## Forge Instructions

**For Mots:** Scope the task to ONLY the 9 remaining items above. The uncommitted diffs are good — commit them first, then tackle the remaining list.

**For Sindri:** Read this file first. Do NOT redo work that's already done. Start by:
1. `git add -A && git commit -m "refactor: extract pm2/tailscale modules, native sqlite, config cleanup"` (commit Sindri's partial work)
2. Then implement tasks 1–9 from the "NOT DONE" section
3. Build, verify, commit, push

**Model note:** Sindri failed on gpt-5.5 after ~59 min. Consider using a model with larger context or breaking into two passes if needed.
