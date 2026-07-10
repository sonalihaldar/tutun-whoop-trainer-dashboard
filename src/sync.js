const whoop = require('./whoopClient');
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

module.exports = { runSync, startScheduledSync, syncIfStale };
