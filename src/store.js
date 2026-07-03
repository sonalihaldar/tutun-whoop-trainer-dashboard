// Lightweight JSON-file-backed data store.
//
// We deliberately avoid native-module databases (e.g. better-sqlite3) so this
// app builds reliably on free hosting tiers without a compilation step.
// Data volume here is tiny (a handful of records per day for one user), so a
// single JSON file loaded into memory and flushed to disk is more than enough.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  tokens: null, // { access_token, refresh_token, expires_at, scope }
  settings: {
    share_token: null,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_error: null,
    whoop_user: null // { user_id, first_name, last_name, email }
  },
  recovery: {}, // keyed by cycle_id
  cycle: {},    // keyed by id
  sleep: {},    // keyed by id
  workout: {}   // keyed by id
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

let cache = null;

function load() {
  if (cache) return cache;
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    cache = { ...DEFAULT_DATA, ...JSON.parse(raw) };
    cache.settings = { ...DEFAULT_DATA.settings, ...(cache.settings || {}) };
  } catch (err) {
    console.error('Failed to read data file, starting fresh:', err.message);
    cache = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  return cache;
}

function save() {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
}

function getTokens() {
  return load().tokens;
}

function setTokens(tokens) {
  const db = load();
  db.tokens = tokens;
  save();
}

function getSettings() {
  return load().settings;
}

function updateSettings(patch) {
  const db = load();
  db.settings = { ...db.settings, ...patch };
  save();
  return db.settings;
}

function upsertMany(collectionName, records, idField = 'id') {
  const db = load();
  const collection = db[collectionName];
  for (const record of records) {
    const id = record[idField];
    if (id === undefined || id === null) continue;
    collection[String(id)] = record;
  }
  save();
}

function getAll(collectionName) {
  const db = load();
  return Object.values(db[collectionName] || {});
}

module.exports = {
  getTokens,
  setTokens,
  getSettings,
  updateSettings,
  upsertMany,
  getAll
};
