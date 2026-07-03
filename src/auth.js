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

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

function getOrCreateShareToken() {
  const settings = store.getSettings();
  if (settings.share_token) return settings.share_token;
  const token = crypto.randomBytes(24).toString('base64url');
  store.updateSettings({ share_token: token });
  return token;
}

function regenerateShareToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  store.updateSettings({ share_token: token });
  return token;
}

module.exports = {
  checkAdminPassword,
  requireAdmin,
  getOrCreateShareToken,
  regenerateShareToken
};
