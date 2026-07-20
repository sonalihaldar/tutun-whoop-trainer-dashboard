const whoop = require('./whoopClient');
const google = require('./googleClient');
const store = require('./store');

let syncInProgress = false;

async function runSync({ daysBack = 90 } = {}) {
  if (syncInProgress) {
    return { skipped: true, reason: 'Sync already in progress' };
  }
  syncInProgress = true;
  try {
    const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const [recoveries, cycles, sleeps, workouts] = await Promise.all([
      whoop.getRecoveryCollection({ start }),
      whoop.getCycleCollection({ start }),
      whoop.getSleepCollection({ start }),
      whoop.getWorkoutCollection({ start })
    ]);

    await store.upsertMany('recovery', recoveries, 'cycle_id');
    await store.upsertMany('cycle', cycles, 'id');
    await store.upsertMany('sleep', sleeps, 'id');
    await store.upsertMany('workout', workouts, 'id');

    // Best-effort profile refresh; don't fail the whole sync if this errors.
    try {
      const profile = await whoop.getBasicProfile();
      await store.updateSettings({ whoop_user: profile });
    } catch (err) {
      console.warn('Could not refresh profile:', err.message);
    }

    await store.updateSettings({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_sync_error: null
    });

    // Best-effort Google Drive export; a failure here should never mark the
    // WHOOP sync itself as failed — they're independent concerns.
    exportWorkoutsToDriveIfConnected().catch((err) => {
      console.error('Drive export after sync failed:', err.message);
    });

    return {
      skipped: false,
      counts: {
        recovery: recoveries.length,
        cycle: cycles.length,
        sleep: sleeps.length,
        workout: workouts.length
      }
    };
  } catch (err) {
    const message = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data)}`
      : err.message;
    await store.updateSettings({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'error',
      last_sync_error: message
    });
    throw err;
  } finally {
    syncInProgress = false;
  }
}

// Exports the full synced workout history to the person's Google Drive
// activity log, if Drive is connected. Called automatically after every
// successful WHOOP sync, and also callable directly for the manual
// "Export now" button.
async function exportWorkoutsToDriveIfConnected() {
  if (!google.isConfigured()) return { skipped: true, reason: 'not_configured' };
  const connected = await google.isConnected();
  if (!connected) return { skipped: true, reason: 'not_connected' };

  try {
    const allWorkouts = await store.getAll('workout');
    const workouts = allWorkouts
      .filter((w) => w.score_state === 'SCORED')
      .map((w) => ({
        start: w.start,
        end: w.end,
        sport_name: w.sport_name,
        strain: w.score?.strain ?? null,
        average_heart_rate: w.score?.average_heart_rate ?? null,
        max_heart_rate: w.score?.max_heart_rate ?? null,
        distance_meter: w.score?.distance_meter ?? null,
        zone_durations: w.score?.zone_durations ?? null
      }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const file = await google.exportWorkoutsToDrive(workouts);

    await store.updateSettings({
      last_drive_export_at: new Date().toISOString(),
      last_drive_export_status: 'success',
      last_drive_export_error: null
    });

    return { skipped: false, file, count: workouts.length };
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    await store.updateSettings({
      last_drive_export_at: new Date().toISOString(),
      last_drive_export_status: 'error',
      last_drive_export_error: message
    });
    throw err;
  }
}

function startScheduledSync(intervalMinutes) {
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
  setInterval(async () => {
    try {
      const tokens = await store.getTokens();
      if (!tokens) return; // nothing to sync until WHOOP is connected
      await runSync();
    } catch (err) {
      console.error('Scheduled sync failed:', err.message);
    }
  }, intervalMs);
}

// Second, independent path to trigger a sync — doesn't depend on the
// in-memory setInterval timer above having survived. Render's free tier can
// restart the process for reasons other than a full sleep/wake cycle (and
// even the keep-alive ping only prevents idling, not every kind of
// restart), which silently resets that timer to zero with nothing to bring
// it back except time. This runs on every dashboard/share-page load
// instead: if the last sync is old (or last attempt failed), it kicks off
// a fresh one in the background without blocking the current page load —
// the person just sees last sync's data this one time, and the next load
// will have caught up.
async function syncIfStale({ healthyMaxAgeMinutes = 60, errorRetryMinutes = 10 } = {}) {
  try {
    if (syncInProgress) return;
    const tokens = await store.getTokens();
    if (!tokens) return;

    const settings = await store.getSettings();
    if (!settings.last_sync_at) {
      runSync().catch((err) => console.error('Stale-triggered sync failed:', err.message));
      return;
    }

    const ageMinutes = (Date.now() - new Date(settings.last_sync_at).getTime()) / 60000;
    const threshold = settings.last_sync_status === 'error' ? errorRetryMinutes : healthyMaxAgeMinutes;
    if (ageMinutes >= threshold) {
      runSync().catch((err) => console.error('Stale-triggered sync failed:', err.message));
    }
  } catch (err) {
    console.error('syncIfStale check failed:', err.message);
  }
}

module.exports = { runSync, startScheduledSync, syncIfStale, exportWorkoutsToDriveIfConnected };
