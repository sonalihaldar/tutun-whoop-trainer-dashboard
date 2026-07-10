require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const store = require('./src/store');
const whoop = require('./src/whoopClient');
const { runSync, startScheduledSync, syncIfStale } = require('./src/sync');
const { buildDashboardPayload } = require('./src/dataView');
const { checkAdminPassword, requireAdmin, getOrCreateShareToken, regenerateShareToken, isShareTokenFixed, isLoginRequired } = require('./src/auth');

const REQUIRED_ENV = ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REDIRECT_URI', 'SESSION_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in before starting the server.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // needed on Render/behind a proxy for secure cookies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// index: false stops static from auto-serving public/index.html (or any
// other page) for directory-style requests, which would otherwise bypass
// the requireAdmin / share-token checks on those routes below.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    }
  })
);

// ---------- Health check (for external keep-alive pingers) ----------
// Public, no auth, does no work beyond confirming the process is up — safe
// and cheap to hit every few minutes from an external uptime service to
// stop Render's free tier from spinning the app down.
app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true, uptime_seconds: Math.round(process.uptime()) });
});

// ---------- Admin login ----------

app.get('/login', (req, res) => {
  if (!isLoginRequired()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (checkAdminPassword(password)) {
    req.session.isAdmin = true;
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Admin dashboard ----------

app.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/api/status', requireAdmin, async (req, res) => {
  try {
    const settings = await store.getSettings();
    const tokens = await store.getTokens();
    const shareToken = await getOrCreateShareToken();
    res.json({
      connected: !!tokens,
      whoop_user: settings.whoop_user,
      last_sync_at: settings.last_sync_at,
      last_sync_status: settings.last_sync_status,
      last_sync_error: settings.last_sync_error,
      share_url_path: `/share/${shareToken}`,
      share_token_fixed: isShareTokenFixed(),
      login_required: isLoginRequired()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data', requireAdmin, async (req, res) => {
  try {
    await syncIfStale();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    res.json(await buildDashboardPayload({ days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync', requireAdmin, async (req, res) => {
  try {
    const result = await runSync();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/share/regenerate', requireAdmin, async (req, res) => {
  const token = await regenerateShareToken();
  res.json({ ok: true, share_url_path: `/share/${token}` });
});

app.post('/api/whoop/disconnect', requireAdmin, async (req, res) => {
  try {
    await whoop.revokeAccess();
    res.json({ ok: true });
  } catch (err) {
    // Even if the remote revoke call fails, drop local tokens so the app
    // stops trying to use them.
    await store.setTokens(null);
    res.json({ ok: true, warning: err.message });
  }
});

// ---------- WHOOP OAuth ----------

app.get('/auth/whoop', requireAdmin, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(whoop.getAuthorizationUrl(state));
});

app.get('/auth/whoop/callback', requireAdmin, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`/?whoopError=${encodeURIComponent(error)}`);
  }
  if (!state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state. Please try connecting again.');
  }
  delete req.session.oauthState;
  try {
    await whoop.exchangeCodeForToken(code);
    await runSync().catch((err) => console.error('Initial sync after connect failed:', err.message));
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback failed:', err.response?.data || err.message);
    res.redirect('/?whoopError=token_exchange_failed');
  }
});

// ---------- Trainer share view (public, token-gated) ----------

app.get('/share/:token', async (req, res) => {
  try {
    const validToken = await getOrCreateShareToken();
    if (!validToken || req.params.token !== validToken) {
      return res.status(404).send('Not found');
    }
    res.sendFile(path.join(__dirname, 'views', 'share.html'));
  } catch (err) {
    res.status(500).send('Something went wrong loading this page.');
  }
});

app.get('/api/share/:token/data', async (req, res) => {
  try {
    const validToken = await getOrCreateShareToken();
    if (!validToken || req.params.token !== validToken) {
      return res.status(404).json({ error: 'Not found' });
    }
    await syncIfStale();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    res.json(await buildDashboardPayload({ days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Whoop trainer dashboard running on port ${PORT}`);
  const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 30;
  startScheduledSync(interval);
});
