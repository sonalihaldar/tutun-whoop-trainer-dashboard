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

## 9. Self-healing sync trigger

**Root problem identified:** the scheduled sync depends entirely on an in-memory `setInterval` timer staying alive continuously. Any process restart (Render maintenance, a crash, anything short of a full redeploy) silently resets that timer to zero with nothing to bring it back except time — a single point of failure on a free tier where restarts aren't fully within your control.

**Fix:** added a second, independent sync trigger (`syncIfStale` in `src/sync.js`) that runs on every dashboard or trainer share-page load. If the last sync is over an hour old, or the last attempt errored, it kicks off a fresh sync in the background without blocking the page — so simply opening the dashboard (by you or your trainer) is now enough to catch up a stalled sync, regardless of whether the background timer survived. Tested directly: confirmed a stale sync triggers a background attempt without slowing the page load (~100ms), and confirmed fresh data correctly triggers nothing extra.

## 10. Token refresh race condition (the "400 invalid_request" saga)

A report of `"Sync failed: Request failed with status code 400"` led to a multi-step investigation:

1. **First hypothesis, confirmed by simulation:** a sync fetches recovery/cycle/sleep/workout from WHOOP in parallel. WHOOP access tokens expire hourly, and each of those 4 parallel calls independently checked "is my token expired?" and refreshed it if so. When the token happened to be expired right as a sync ran, all 4 fired their own refresh request simultaneously — but WHOOP rotates refresh tokens on every use, so only the first request WHOOP processed succeeded; the other 3 were rejected for reusing an already-consumed refresh token. **Fix:** added a shared refresh lock in `src/whoopClient.js` so concurrent callers await one in-flight refresh instead of racing each other. Verified with a simulated concurrency test (4 parallel calls against an expired token) confirming only one actual refresh request fires.
2. **Second hypothesis, ruled out:** WHOOP's own error hint mentioned trimming parameters, suggesting stray whitespace in a Render environment variable (`WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`) copy-pasted at some point. Added defensive `.trim()` on all WHOOP credential env vars regardless — cheap insurance even though it turned out not to be the root cause here.
3. **Actual root cause:** the stored refresh token had already been permanently invalidated — a casualty of the original race condition from *before* the lock in step 1 was deployed. Once a refresh token is consumed (or lost in a race), no request-formatting fix can revive it; the only way forward is minting a completely new token pair. **Resolution:** Disconnect WHOOP → Connect WHOOP again → confirmed `last_sync_status: "success"` immediately after.

This is a good illustration of layered debugging: the race-condition fix and the trim fix were both legitimate, worthwhile hardening — but the specific failure the person was hitting needed the token itself replaced, not just the code fixed going forward.

## 11. Google Drive Excel export

Added a second, independent OAuth integration (parallel to the WHOOP one) so the person can keep a running Excel file of their workouts in Google Drive:

- **Scoping decisions, clarified up front:** workouts-only (not recovery/sleep), updates both automatically on every WHOOP sync and via a manual "Export now" button, and maintains a single continuously-updated file rather than creating a new one each time.
- **Avoided a foreseeable recurrence of the WHOOP reconnect problem:** researched Google's OAuth token lifetime rules before building — apps left in "Testing" publishing status have their refresh tokens expire every 7 days, which would have recreated the exact reconnect-treadmill issue already solved for WHOOP. Documented the fix (set Publishing status to "In production", which for a personal single-user app doesn't require Google's full verification review) prominently in the setup instructions.
- **Built:** `src/googleClient.js` (OAuth flow, token refresh via `googleapis`'s built-in auto-refresh + a listener that persists refreshed tokens back to the store, and the actual Excel generation via the `xlsx` library + Drive API upload), wired into `src/sync.js` as a best-effort step after every successful WHOOP sync (a Drive failure never fails the WHOOP sync itself), plus new admin-only routes and a dashboard UI section (deliberately not shown on the trainer's share view, since it's an owner-only feature).
- **Tested with mocked Google API calls** (real network calls to Google aren't reachable from the build sandbox): verified the OAuth consent URL is correctly formed, verified the file is created exactly once and updated (not recreated) on every subsequent export, and verified the generated `.xlsx` file's actual cell contents are correct by reading the buffer back with the same library.

---

## Current setup checklist

- [ ] WHOOP developer app registered, Client ID/Secret in Render env vars
- [ ] `WHOOP_REDIRECT_URI` matches the real Render URL exactly, and is also registered in the WHOOP dashboard
- [ ] `SESSION_SECRET` set (random, generated via `crypto.randomBytes`)
- [ ] `ADMIN_PASSWORD` set (or intentionally left blank if login is disabled by choice)
- [ ] `SHARE_TOKEN` set, if a permanent trainer link is wanted
- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` set, so data survives redeploys
- [ ] cron-job.org (or similar) pinging `/healthz` every ~10 minutes to prevent sleep-induced sync gaps
- [ ] `/api/status` currently shows `last_sync_status: "success"` with no error
- [ ] (Optional) `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` set, with the OAuth consent screen's Publishing status set to **In production** (not Testing)
