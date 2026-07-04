// Data store. Two backends, same interface:
//
// 1. Upstash Redis (used when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//    are set) — a free-tier hosted key-value store. This is what makes your
//    WHOOP connection and synced data survive a Render redeploy: Render's
//    free-tier disk resets on every deploy, but Upstash is a separate service
//    entirely, so it doesn't.
// 2. A local JSON file (used otherwise) — fine for local development, but on
//    Render's free tier this resets on every redeploy.
//
// All functions are async regardless of backend, so callers don't need to
// know or care which one is active.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const REDIS_KEY = 'whoop-dashboard:db';

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

const usingRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let redisClient = null;
if (usingRedis) {
  const { Redis } = require('@upstash/redis');
  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
}

function isUsingRedis() {
  return usingRedis;
}

function freshDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function normalize(db) {
  return { ...DEFAULT_DATA, ...db, settings: { ...DEFAULT_DATA.settings, ...(db.settings || {}) } };
}

// ---- file backend (local dev fallback) ----

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

let fileCache = null;

function loadFromFile() {
  if (fileCache) return fileCache;
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    fileCache = normalize(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to read data file, starting fresh:', err.message);
    fileCache = freshDefaultData();
  }
  return fileCache;
}

function saveToFile(db) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  fileCache = db;
}

// ---- unified load/save ----

async function loadDb() {
  if (usingRedis) {
    const data = await redisClient.get(REDIS_KEY);
    if (!data) return freshDefaultData();
    return normalize(data);
  }
  return loadFromFile();
}

async function saveDb(db) {
  if (usingRedis) {
    await redisClient.set(REDIS_KEY, db);
    return;
  }
  saveToFile(db);
}

async function getTokens() {
  const db = await loadDb();
  return db.tokens;
}

async function setTokens(tokens) {
  const db = await loadDb();
  db.tokens = tokens;
  await saveDb(db);
}

async function getSettings() {
  const db = await loadDb();
  return db.settings;
}

async function updateSettings(patch) {
  const db = await loadDb();
  db.settings = { ...db.settings, ...patch };
  await saveDb(db);
  return db.settings;
}

async function upsertMany(collectionName, records, idField = 'id') {
  const db = await loadDb();
  const collection = db[collectionName];
  for (const record of records) {
    const id = record[idField];
    if (id === undefined || id === null) continue;
    collection[String(id)] = record;
  }
  await saveDb(db);
}

async function getAll(collectionName) {
  const db = await loadDb();
  return Object.values(db[collectionName] || {});
}

module.exports = {
  getTokens,
  setTokens,
  getSettings,
  updateSettings,
  upsertMany,
  getAll,
  isUsingRedis
};
