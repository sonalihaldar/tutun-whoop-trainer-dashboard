const crypto = require('crypto');
const store = require('./store');

function checkAdminPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  // Timing-safe comparison to avoid leaking password length/content via timing.
  const a = Buffer.from(candidate || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a comparison against something of matching length to keep
    // timing roughly constant, then return false.
    crypto.timingSafeEqual(Buffer.alloc(b.length), Buffer.alloc(b.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// If ADMIN_PASSWORD is unset (or blank), login is disabled entirely and
// every request is treated as authenticated — no password, no session
// needed, no re-login after redeploys. This trades away the only barrier
// between a stranger with your URL and your WHOOP connection, so it's
// meant for personal convenience, not for anything more exposed.
function isLoginRequired() {
  return !!(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length);
}

function requireAdmin(req, res, next) {
  if (!isLoginRequired()) return next();
  if (req.session && req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

// If SHARE_TOKEN is set in the environment, the trainer's link is fixed and
// permanent — it comes from Render's environment config, which survives
// redeploys, unlike the JSON data file (which resets on Render's free tier
// whenever the app redeploys). Without it, the token is auto-generated and
// stored on disk, which means it WILL change on the next redeploy.
function isShareTokenFixed() {
  return !!process.env.SHARE_TOKEN;
}

async function getOrCreateShareToken() {
  if (process.env.SHARE_TOKEN) return process.env.SHARE_TOKEN;
  const settings = await store.getSettings();
  if (settings.share_token) return settings.share_token;
  const token = crypto.randomBytes(24).toString('base64url');
  await store.updateSettings({ share_token: token });
  return token;
}

async function regenerateShareToken() {
  if (process.env.SHARE_TOKEN) {
    // Fixed via environment variable — regenerating here would have no
    // effect since getOrCreateShareToken always prefers the env value.
    return process.env.SHARE_TOKEN;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  await store.updateSettings({ share_token: token });
  return token;
}

module.exports = {
  checkAdminPassword,
  requireAdmin,
  getOrCreateShareToken,
  regenerateShareToken,
  isShareTokenFixed,
  isLoginRequired
};
