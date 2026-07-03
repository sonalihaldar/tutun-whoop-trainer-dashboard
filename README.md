# WHOOP Recovery Dashboard

A self-hosted dashboard that connects to your WHOOP account, pulls your recovery, sleep, strain, and workout data, and gives your trainer a read-only link to view it.

- **Your view** (`/`) — password-protected. Connect WHOOP, sync data, manage the share link.
- **Trainer view** (`/share/<token>`) — read-only, no login. Anyone with the link can see the dashboard; no one can edit anything or see your WHOOP login.

No native database, no paid services required — runs entirely on Node.js with a small JSON file for storage.

---

## 1. Register a WHOOP developer app (~5 minutes)

1. Go to the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com) and sign in with your normal WHOOP account (you need an active WHOOP membership).
2. Create a Team, then create an App.
3. Under **Redirect URIs**, add:
   - `http://localhost:3000/auth/whoop/callback` (for local testing)
   - `https://YOUR-APP-NAME.onrender.com/auth/whoop/callback` (once you know your Render URL — you can add this after step 3 below)
4. Copy the **Client ID** and **Client Secret** — you'll need them in the next step.

You do **not** need to request any special approval — this only ever reads your own data.

## 2. Run it locally first (recommended)

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` — from step 1
- `WHOOP_REDIRECT_URI=http://localhost:3000/auth/whoop/callback`
- `ADMIN_PASSWORD` — a password only you will use to log into your dashboard
- `SESSION_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Then:

```bash
npm start
```

Visit `http://localhost:3000`, log in with your `ADMIN_PASSWORD`, click **Connect WHOOP**, and authorize. Your data should sync automatically.

## 3. Deploy for free on Render

1. Push this project to a GitHub repo (see `.gitignore` — it already excludes `.env` and local data).
2. On [Render](https://render.com), click **New → Web Service**, connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under **Environment**, add the same variables from your `.env` file — except set:
   ```
   WHOOP_REDIRECT_URI=https://YOUR-APP-NAME.onrender.com/auth/whoop/callback
   NODE_ENV=production
   ```
   (Render shows you the `.onrender.com` URL after the first deploy — you can edit the env var and redeploy once you know it.)
5. Go back to the [WHOOP Developer Dashboard](https://developer-dashboard.whoop.com) and add that same `https://YOUR-APP-NAME.onrender.com/auth/whoop/callback` as a Redirect URI on your app.
6. Deploy. Visit your `.onrender.com` URL, log in, and click **Connect WHOOP**.

**Free tier notes:**
- The app sleeps after 15 minutes of no traffic and takes ~20–30s to wake on the next request — totally fine for a personal dashboard.
- The filesystem resets on redeploy (not on sleep/wake — only on a new deploy). If that happens, just click **Sync now** once you reconnect WHOOP to pull your history back in; nothing is lost from WHOOP's side.

## 4. Share it with your trainer

On your dashboard, copy the **read-only link** shown at the top and send it to your trainer directly (text, email, whatever). They don't need an account. If you ever want to cut off access, click **Regenerate** to invalidate the old link.

---

## How it works

- **OAuth**: standard Authorization Code flow against WHOOP's API (`https://api.prod.whoop.com/oauth/oauth2`). Tokens are stored server-side only; refresh tokens rotate automatically per WHOOP's requirements.
- **Sync**: pulls `/v2/recovery`, `/v2/cycle`, `/v2/activity/sleep`, `/v2/activity/workout` (paginated), on a timer (`SYNC_INTERVAL_MINUTES`, default 30) plus on-demand via the **Sync now** button.
- **Storage**: a single JSON file (`data/db.json`) — no native modules, so it builds reliably on free hosts.
- **Access control**: your dashboard requires `ADMIN_PASSWORD`; the share view requires only knowing the unguessable token in the URL.

## Project structure

```
server.js              Express app + all routes
src/whoopClient.js      OAuth + WHOOP API calls
src/sync.js             Pulls data from WHOOP, upserts into the store
src/store.js             JSON file storage
src/dataView.js         Shapes raw records into the dashboard payload
src/auth.js              Admin password check + share-token helpers
views/                  HTML pages (login, dashboard, share view)
public/css/style.css     Design system
public/js/               Chart rendering + page controllers
```

## Extending it

- **Webhooks instead of polling**: WHOOP supports webhooks for near-real-time updates. The current polling approach is simpler and sufficient for coaching check-ins, but see [WHOOP's webhook docs](https://developer.whoop.com/docs/developing/webhooks/) if you want instant updates.
- **Multiple athletes**: this is built for one WHOOP account. Supporting several people would mean per-user token storage and per-user share tokens — a bigger change, happy to help if you want to go there.
