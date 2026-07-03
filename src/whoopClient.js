const axios = require('axios');
const store = require('./store');

const AUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';
const API_BASE = 'https://api.prod.whoop.com/developer';

const SCOPES = [
  'offline',
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'read:body_measurement'
].join(' ');

function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID,
    redirect_uri: process.env.WHOOP_REDIRECT_URI,
    scope: SCOPES,
    state
  });
  return `${AUTH_BASE}/auth?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    redirect_uri: process.env.WHOOP_REDIRECT_URI
  });
  const res = await axios.post(`${AUTH_BASE}/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  persistTokenResponse(res.data);
  return res.data;
}

async function refreshAccessToken() {
  const tokens = store.getTokens();
  if (!tokens || !tokens.refresh_token) {
    throw new Error('No refresh token available. Please reconnect WHOOP.');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    scope: 'offline'
  });
  const res = await axios.post(`${AUTH_BASE}/token`, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  // WHOOP rotates refresh tokens: every refresh response includes a NEW
  // refresh_token that must replace the old one.
  persistTokenResponse(res.data);
  return res.data;
}

function persistTokenResponse(data) {
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000; // 60s safety margin
  store.setTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    scope: data.scope
  });
}

async function getValidAccessToken() {
  const tokens = store.getTokens();
  if (!tokens) {
    throw new Error('WHOOP is not connected yet.');
  }
  if (Date.now() >= tokens.expires_at) {
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  }
  return tokens.access_token;
}

async function apiGet(pathname, params = {}) {
  const accessToken = await getValidAccessToken();
  const res = await axios.get(`${API_BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params
  });
  return res.data;
}

// Fetches every page of a paginated collection endpoint (recovery, cycle,
// sleep, workout all share the same { records, next_token } shape).
async function fetchAllPages(pathname, { start, end, limit = 25 } = {}) {
  const all = [];
  let nextToken;
  do {
    const params = { limit };
    if (start) params.start = start;
    if (end) params.end = end;
    if (nextToken) params.nextToken = nextToken;
    const data = await apiGet(pathname, params);
    all.push(...(data.records || []));
    nextToken = data.next_token;
  } while (nextToken);
  return all;
}

async function getRecoveryCollection(range) {
  return fetchAllPages('/v2/recovery', range);
}

async function getCycleCollection(range) {
  return fetchAllPages('/v2/cycle', range);
}

async function getSleepCollection(range) {
  return fetchAllPages('/v2/activity/sleep', range);
}

async function getWorkoutCollection(range) {
  return fetchAllPages('/v2/activity/workout', range);
}

async function getBasicProfile() {
  return apiGet('/v2/user/profile/basic');
}

async function revokeAccess() {
  const accessToken = await getValidAccessToken();
  await axios.delete(`${API_BASE}/v2/user/access`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  store.setTokens(null);
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForToken,
  getRecoveryCollection,
  getCycleCollection,
  getSleepCollection,
  getWorkoutCollection,
  getBasicProfile,
  revokeAccess
};
