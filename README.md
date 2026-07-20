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

## 4. Make your data survive redeploys (fixes "why do I have to reconnect WHOOP every time?")

By default, your WHOOP tokens and synced history live in a local JSON file. On Render's free tier, that file is **wiped on every redeploy** — meaning every `git push` forces you to redo the WHOOP OAuth screen. Fix this once with a free Upstash Redis database (a separate service from Render, so it isn't affected by Render's redeploys):

1. Go to [upstash.com](https://upstash.com), sign up free, and create a Redis database (any region — pick one close to your Render region if given a choice).
2. On that database's page, copy the **REST URL** and **REST TOKEN**.
3. In Render → your service → **Environment**, add:
   ```
   UPSTASH_REDIS_REST_URL=<paste REST URL>
   UPSTASH_REDIS_REST_TOKEN=<paste REST TOKEN>
   ```
4. Redeploy once. From then on, your WHOOP connection, synced history, and trainer share link (unless already fixed via `SHARE_TOKEN`) all persist across every future deploy — no more re-authorizing WHOOP after a code update.

If you skip this, the app still works fine — it just falls back to the local file, which is perfectly adequate for running locally on your own machine, but will keep resetting on Render every time you push new code.

## 5. Share it with your trainer

On your dashboard, copy the **read-only link** shown at the top and send it to your trainer directly (text, email, whatever). They don't need an account.

**Important — make the link permanent.** By default, the link's token is auto-generated and stored in the app's local data file. On Render's free tier, that file resets every time the app redeploys (e.g. every time you `git push`), which silently changes your trainer's link without telling you. To avoid that, set a `SHARE_TOKEN` environment variable — this comes from Render's environment config instead of the data file, so it survives redeploys.

1. Generate a token:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. In Render → your service → **Environment**, add `SHARE_TOKEN` with that value.
3. Redeploy. Your trainer's link (`/share/<that value>`) will now stay the same forever, no matter how many times you update the app.

With `SHARE_TOKEN` set, the **Regenerate** button on your dashboard is disabled (since the link is controlled by the environment variable, not the app). To change the link later, just set a new `SHARE_TOKEN` value in Render and redeploy.

If you'd rather not set this and are fine with the link changing occasionally, you can skip it — the app still works, and you can always copy the current link from your dashboard and re-send it to your trainer after a redeploy.

## 6. Export your activity log to Google Drive (optional)

Keeps a single Excel file (`WHOOP Activity Log.xlsx`) in your Google Drive with one row per workout, updated automatically every time the app syncs with WHOOP — plus an **Export now** button on your dashboard for on-demand updates. This is entirely separate from the trainer's dashboard; it's just for you.

**1. Create a Google Cloud project and enable the Drive API**
- Go to [console.cloud.google.com](https://console.cloud.google.com), create a new project (or reuse one).
- Go to **APIs & Services → Library**, search for **Google Drive API**, click **Enable**.

**2. Configure the OAuth consent screen**
- **APIs & Services → OAuth consent screen**. User type: **External**.
- Fill in the required app name/support email fields.
- Under **Scopes**, add:
  - `https://www.googleapis.com/auth/drive.file` (lets the app create/edit only the file it creates — not your whole Drive)
  - `https://www.googleapis.com/auth/userinfo.email`
- **Critical step:** once set up, set **Publishing status** to **In production** — not "Testing". This is the whole app, so you don't need Google's full verification review to do this; you'll just see a one-time "Google hasn't verified this app" warning when you first connect, which is safe to click through ("Advanced" → "Go to [app name] (unsafe)") for your own app. **Skipping this step means Google will silently expire your connection every 7 days**, which defeats the point of "auto-updates on every sync."

**3. Create OAuth credentials**
- **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
- Application type: **Web application**.
- Under **Authorized redirect URIs**, add:
  - `http://localhost:3000/auth/google/callback` (for local testing)
  - `https://YOUR-APP-NAME.onrender.com/auth/google/callback` (your deployed app)
- Copy the **Client ID** and **Client Secret** shown after creating it.

**4. Add the env vars**
In Render (and/or your local `.env`):
```
GOOGLE_CLIENT_ID=<paste it>
GOOGLE_CLIENT_SECRET=<paste it>
GOOGLE_REDIRECT_URI=https://YOUR-APP-NAME.onrender.com/auth/google/callback
```

**5. Connect it**
Redeploy, open your dashboard, and click **Connect Google Drive** in the new export section. After that first connection, the file appears in your Drive and updates itself on every future sync — no more manual steps needed.

---

## How it works

- **OAuth**: standard Authorization Code flow against WHOOP's API (`https://api.prod.whoop.com/oauth/oauth2`) and, if configured, Google's OAuth endpoints for Drive access. Tokens are stored server-side only; WHOOP refresh tokens rotate automatically per WHOOP's requirements, Google's do not.
- **Sync**: pulls `/v2/recovery`, `/v2/cycle`, `/v2/activity/sleep`, `/v2/activity/workout` from WHOOP (paginated), on a timer (`SYNC_INTERVAL_MINUTES`, default 30), on-demand via **Sync now**, and opportunistically whenever the dashboard or share link is loaded if the last sync looks stale. A successful sync also triggers a best-effort Google Drive export if that's connected.
- **Storage**: Upstash Redis if configured (survives redeploys), otherwise a local JSON file (`data/db.json`, resets on Render redeploys) — no native modules either way, so it builds reliably on free hosts.
- **Access control**: your dashboard requires `ADMIN_PASSWORD` (optional — can be disabled); the share view requires only knowing the unguessable token in the URL.

## Project structure

```
server.js              Express app + all routes
src/whoopClient.js      OAuth + WHOOP API calls
src/googleClient.js     Google OAuth + Drive export (Excel generation, upload)
src/sync.js             Pulls data from WHOOP, upserts into the store, triggers Drive export
src/store.js             Upstash Redis or local JSON file storage
src/dataView.js         Shapes raw records into the dashboard payload
src/auth.js              Admin password check + share-token helpers
views/                  HTML pages (login, dashboard, share view)
public/css/style.css     Design system
public/js/               Chart rendering + page controllers
```

## Extending it

- **Webhooks instead of polling**: WHOOP supports webhooks for near-real-time updates. The current polling approach is simpler and sufficient for coaching check-ins, but see [WHOOP's webhook docs](https://developer.whoop.com/docs/developing/webhooks/) if you want instant updates.
- **Multiple athletes**: this is built for one WHOOP account. Supporting several people would mean per-user token storage and per-user share tokens — a bigger change, happy to help if you want to go there.
