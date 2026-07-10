# WHOOP Recovery Dashboard — Development Log

A chronological record of how this app was built, deployed, and debugged.

---

## 1. Planning

Before writing code, agreed on the architecture:

- **Stack:** Node.js/Express backend, plain HTML/CSS/JS frontend (no framework), JSON file storage (later migrated — see Section 8).
- **Hosting:** Render free tier.
- **Auth model:** password-protected admin dashboard (later made optional — see Section 7) + an unguessable read-only link for the trainer.
- **Data source:** WHOOP's official Developer API (OAuth 2.0 Authorization Code flow).

## 2. Initial build

- Registered a WHOOP developer app at [developer-dashboard.whoop.com](https://developer-dashboard.whoop.com) to get a Client ID/Secret.
- Built the OAuth flow: `/auth/whoop` → WHOOP consent screen → `/auth/whoop/callback` → token exchange, with refresh-token rotation handled (WHOOP issues a new refresh token every time the old one is used).
- Built the sync engine (`src/sync.js`): pulls `/v2/recovery`, `/v2/cycle`, `/v2/activity/sleep`, `/v2/activity/workout` from WHOOP, paginating via `nextToken`, on a timer plus a manual "Sync now" button.
- Built the dashboard UI: gauges (Recovery %, Strain, Resting HR), trend charts (hand-drawn SVG, no chart library dependency), and a workout log — styled as a dark "biometric instrument panel" theme (IBM Plex Mono/Sans, phosphor-teal accent).
- Built the trainer share view: a read-only page at `/share/<random-token>`, no login required, with its own copy of the dashboard components.
- **Caught and fixed a real bug during testing:** `express.static` was serving `index.html` directly for `/`, bypassing the login check entirely. Fixed by moving all page templates (`index.html`, `login.html`, `share.html`) out of the public static folder into a separate `views/` directory only reachable through explicit, auth-checked routes.

## 3. First deployment to Render

- Pushed to GitHub, connected the repo to a new Render free web service.
- Debugged several real deployment issues along the way:
  - **Wrong password error** → traced to Render needing a restart after an env var change (env vars are only read at process start).
  - **GitHub push auth failures** → resolved by switching from password auth to a Personal Access Token.
  - **"Not Found" on WHOOP connect** → root cause was `WHOOP_REDIRECT_URI` pointing at a stale/incorrect Render URL (`mywhoopjourney.onrender.com`) instead of the actual live service domain.
  - **`invalid_scope` OAuth error** → the WHOOP developer app hadn't been granted all the scopes the app requests (`read:cycles` was missing); fixed in the WHOOP dashboard's Scopes section.
  - **Intermittent "Not Found" mid-OAuth-flow** → identified as a Render free-tier cold-start race: the service spun down mid-flow and the callback landed before it fully woke up.

## 4. Feature iteration

Built incrementally, in this order:

1. **Dashboard renamed** to a fixed custom title (not derived from the WHOOP profile name).
2. **Heart Rate Zones by Activity** — a stacked-bar breakdown of time-in-zone per sport, aggregated from WHOOP's `zone_durations` field.
3. Removed **Sleep Performance %**; added **Weekly Pattern** (workouts-per-weekday heatmap); split the dashboard into **Overview** and **Workouts** tabs.
4. Added a **"Last 7 days"** filter; moved Zone Breakdown into the Overview tab; added a **Weekly Trends** tab (per-activity Strain + HR Zone trend charts for 5 named activities: Walking, Functional Fitness, Running, Stairmaster, Elliptical), matched against WHOOP's `sport_name` via a normalized key (case/hyphen/space-insensitive).
5. Reordered tabs to **Overview → Weekly Trends → Workouts**; switched Weekly Trends charts from line charts to bar charts (including a new stacked-bar renderer for HR zones).
6. Added a **week picker** to Weekly Trends, defaulting to the current calendar week, rendering day-by-day (not aggregated) bars labeled by weekday + date.
7. **Fixed share link:** added an optional `SHARE_TOKEN` environment variable so the trainer's link can be pinned to a permanent value instead of an auto-generated one. While building this, found and fixed a related bug — the share routes were checking the stored token directly instead of the function that would respect the env override, so the fixed-link feature wouldn't have worked at all without the fix.
8. Removed **Weekly Pattern** entirely (HTML, JS rendering, backend aggregation function, and its CSS), per request, once Weekly Trends made it redundant.

## 5. Keeping the app awake

- Explained Render's free-tier behavior: the service spins down after ~15 minutes idle, with a ~30–50s cold start on the next request.
- Added a public `/healthz` endpoint (no auth, minimal work) as a safe target for external uptime pings.
- Provided step-by-step setup for a free external keep-alive pinger via **cron-job.org**, hitting `/healthz` every 10 minutes so the app never goes idle long enough to sleep.

## 6. Optional login

- Made the admin password (`ADMIN_PASSWORD`) fully optional: if unset, the dashboard requires no login at all, on any request, redeploy or not.
- Flagged the tradeoff explicitly: without a password, anyone with the app's URL can view data, sync, disconnect WHOOP, or regenerate the trainer's share link.
- Implemented as a toggle (env var presence), not a deletion of the auth code, so password protection can be turned back on anytime.

## 7. Persistent storage (the big infrastructure fix)

**Root problem identified:** WHOOP tokens and synced data lived in a local JSON file on Render's disk, which is not guaranteed to survive restarts of any kind on the free tier (redeploys, and evidently also some sleep/wake or restart cycles) — silently disconnecting WHOOP and losing sync history without warning.

**Fix:** migrated the entire storage layer to **Upstash Redis** (a free-tier hosted key-value store, external to Render, so Render restarting its own disk has no effect on it):

- Rewrote `src/store.js` with two backends behind the same interface: Upstash Redis (when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set) or the original local JSON file (fallback, used automatically for local development with no extra setup).
- Converted every storage call across the codebase (`whoopClient.js`, `sync.js`, `auth.js`, `dataView.js`, `server.js`) from synchronous to asynchronous to support the network-backed Redis calls, and tested both backends end-to-end afterward, including deliberately-broken Redis credentials to confirm the app fails gracefully (clean error response) rather than crashing.

## 8. Diagnosing sync gaps

- Investigated a report of data not refreshing since a specific date; walked through distinguishing two possible causes via `/api/status` (`last_sync_status`/`last_sync_error`):
  - A broken/expired WHOOP token (fix: disconnect and reconnect WHOOP), vs.
  - The app simply being asleep the whole time with no keep-alive configured, so its internal sync timer never ran (fix: set up the cron-job.org pinger from Section 5, then click "Sync now" once to catch up).

---

## Current setup checklist

- [ ] WHOOP developer app registered, Client ID/Secret in Render env vars
- [ ] `WHOOP_REDIRECT_URI` matches the real Render URL exactly, and is also registered in the WHOOP dashboard
- [ ] `SESSION_SECRET` set (random, generated via `crypto.randomBytes`)
- [ ] `ADMIN_PASSWORD` set (or intentionally left blank if login is disabled by choice)
- [ ] `SHARE_TOKEN` set, if a permanent trainer link is wanted
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` set, so data survives redeploys
- [ ] cron-job.org (or similar) pinging `/healthz` every ~10 minutes to prevent sleep-induced sync gaps
