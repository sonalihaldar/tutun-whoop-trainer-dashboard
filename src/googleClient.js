const { Readable } = require('stream');
const { google } = require('googleapis');
const XLSX = require('xlsx');
const store = require('./store');

// Defensive: same reasoning as whoopClient.js — trim env vars so a stray
// space copy-pasted into Render doesn't produce a malformed request.
function env(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : value;
}

// drive.file is a "sensitive" (not "restricted") scope: for a personal,
// single-user app this does NOT require Google's formal verification
// review, as long as the OAuth consent screen's Publishing status is set
// to "In production" rather than "Testing" — see the README for why that
// matters (Testing-mode refresh tokens expire every 7 days).
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email'
];

const DRIVE_FILE_NAME = 'WHOOP Activity Log.xlsx';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isConfigured() {
  return !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_REDIRECT_URI'));
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    env('GOOGLE_CLIENT_ID'),
    env('GOOGLE_CLIENT_SECRET'),
    env('GOOGLE_REDIRECT_URI')
  );
}

function getAuthorizationUrl(state) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures a refresh_token is issued even on a repeat connect
    scope: SCOPES,
    state
  });
}

async function exchangeCodeForToken(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  await store.setGoogleTokens(tokens);

  // Best-effort: fetch the connected account's email, just for display.
  try {
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    await store.updateSettings({ google_user_email: data.email || null });
  } catch (err) {
    console.warn('Could not fetch Google account email:', err.message);
  }

  return tokens;
}

async function isConnected() {
  const tokens = await store.getGoogleTokens();
  return !!(tokens && tokens.refresh_token);
}

// Builds an OAuth2 client authenticated with the stored tokens. If
// googleapis auto-refreshes the access token mid-call (Google access
// tokens expire hourly), the 'tokens' event fires and we persist the
// refreshed token immediately — Google typically does not resend a new
// refresh_token on refresh, so the original one is preserved.
async function getAuthenticatedClient() {
  const stored = await store.getGoogleTokens();
  if (!stored || !stored.refresh_token) {
    throw new Error('Google Drive is not connected yet.');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(stored);

  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...stored, ...newTokens };
    if (!newTokens.refresh_token) merged.refresh_token = stored.refresh_token;
    store.setGoogleTokens(merged).catch((err) => {
      console.error('Failed to persist refreshed Google token:', err.message);
    });
  });

  return oauth2Client;
}

async function disconnect() {
  try {
    const stored = await store.getGoogleTokens();
    if (stored && stored.access_token) {
      const oauth2Client = createOAuth2Client();
      await oauth2Client.revokeToken(stored.access_token).catch(() => {});
    }
  } finally {
    await store.setGoogleTokens(null);
    await store.updateSettings({
      google_user_email: null,
      google_drive_file_id: null,
      google_drive_file_url: null
    });
  }
}

function millisToMinutes(ms) {
  return ms === null || ms === undefined ? '' : Math.round(ms / 60000);
}

function buildWorkbookBuffer(workouts) {
  const rows = workouts.map((w) => {
    const zd = w.zone_durations || {};
    const durationMin = w.start && w.end
      ? Math.round((new Date(w.end) - new Date(w.start)) / 60000)
      : '';
    return {
      Date: w.start ? new Date(w.start).toISOString().slice(0, 10) : '',
      'Start Time': w.start || '',
      Activity: w.sport_name || '',
      Strain: w.strain ?? '',
      'Avg HR (bpm)': w.average_heart_rate ?? '',
      'Max HR (bpm)': w.max_heart_rate ?? '',
      'Duration (min)': durationMin,
      'Distance (m)': w.distance_meter ?? '',
      'Zone 0 (min)': millisToMinutes(zd.zone_zero_milli),
      'Zone 1 (min)': millisToMinutes(zd.zone_one_milli),
      'Zone 2 (min)': millisToMinutes(zd.zone_two_milli),
      'Zone 3 (min)': millisToMinutes(zd.zone_three_milli),
      'Zone 4 (min)': millisToMinutes(zd.zone_four_milli),
      'Zone 5 (min)': millisToMinutes(zd.zone_five_milli)
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // Reasonable default column widths so the file is readable without the
  // person having to manually resize every column on first open.
  ws['!cols'] = [
    { wch: 11 }, { wch: 21 }, { wch: 16 }, { wch: 8 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 11 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Workouts');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Creates the activity log file in Drive the first time, then overwrites
// that same file's content on every later call — one continuously-updated
// file, per the person's choice, rather than a new file per export.
async function exportWorkoutsToDrive(workouts) {
  const oauth2Client = await getAuthenticatedClient();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const buffer = buildWorkbookBuffer(workouts);
  const media = {
    mimeType: XLSX_MIME_TYPE,
    body: Readable.from(buffer)
  };

  const settings = await store.getSettings();
  let fileId = settings.google_drive_file_id;

  // Confirm the previously-created file still exists (it may have been
  // deleted/trashed in Drive since); fall back to creating a new one if not.
  if (fileId) {
    try {
      await drive.files.get({ fileId, fields: 'id, trashed' });
    } catch (err) {
      fileId = null;
    }
  }

  let file;
  if (fileId) {
    file = await drive.files.update({ fileId, media, fields: 'id, webViewLink' });
  } else {
    file = await drive.files.create({
      requestBody: { name: DRIVE_FILE_NAME, mimeType: XLSX_MIME_TYPE },
      media,
      fields: 'id, webViewLink'
    });
  }

  await store.updateSettings({
    google_drive_file_id: file.data.id,
    google_drive_file_url: file.data.webViewLink
  });

  return file.data;
}

module.exports = {
  isConfigured,
  getAuthorizationUrl,
  exchangeCodeForToken,
  isConnected,
  disconnect,
  exportWorkoutsToDrive
};
