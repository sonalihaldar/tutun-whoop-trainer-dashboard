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

module.exports = { runSync, startScheduledSync };
