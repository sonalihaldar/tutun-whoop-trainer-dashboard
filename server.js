require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const store = require('./src/store');
const whoop = require('./src/whoopClient');
const { runSync, startScheduledSync } = require('./src/sync');
const { buildDashboardPayload } = require('./src/dataView');
const { checkAdminPassword, requireAdmin, getOrCreateShareToken, regenerateShareToken } = require('./src/auth');

const REQUIRED_ENV = ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REDIRECT_URI', 'ADMIN_PASSWORD', 'SESSION_SECRET'];
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

// ---------- Admin login ----------

app.get('/login', (req, res) => {
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

app.get('/api/status', requireAdmin, (req, res) => {
  const settings = store.getSettings();
  res.json({
    connected: !!store.getTokens(),
    whoop_user: settings.whoop_user,
    last_sync_at: settings.last_sync_at,
    last_sync_status: settings.last_sync_status,
    last_sync_error: settings.last_sync_error,
    share_url_path: `/share/${getOrCreateShareToken()}`
  });
});

app.get('/api/data', requireAdmin, (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  res.json(buildDashboardPayload({ days }));
});

app.post('/api/sync', requireAdmin, async (req, res) => {
  try {
    const result = await runSync();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/share/regenerate', requireAdmin, (req, res) => {
  const token = regenerateShareToken();
  res.json({ ok: true, share_url_path: `/share/${token}` });
});

app.post('/api/whoop/disconnect', requireAdmin, async (req, res) => {
  try {
    await whoop.revokeAccess();
    res.json({ ok: true });
  } catch (err) {
    // Even if the remote revoke call fails, drop local tokens so the app
    // stops trying to use them.
    store.setTokens(null);
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

app.get('/share/:token', (req, res) => {
  const settings = store.getSettings();
  if (!settings.share_token || req.params.token !== settings.share_token) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'views', 'share.html'));
});

app.get('/api/share/:token/data', (req, res) => {
  const settings = store.getSettings();
  if (!settings.share_token || req.params.token !== settings.share_token) {
    return res.status(404).json({ error: 'Not found' });
  }
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  res.json(buildDashboardPayload({ days }));
});

app.listen(PORT, () => {
  console.log(`Whoop trainer dashboard running on port ${PORT}`);
  const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 30;
  startScheduledSync(interval);
});
