const store = require('./store');

function buildDashboardPayload({ days = 30 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const recovery = store
    .getAll('recovery')
    .filter((r) => r.score_state === 'SCORED')
    .map((r) => ({
      cycle_id: r.cycle_id,
      date: r.created_at,
      recovery_score: r.score?.recovery_score ?? null,
      resting_heart_rate: r.score?.resting_heart_rate ?? null,
      hrv_rmssd_milli: r.score?.hrv_rmssd_milli ?? null,
      spo2_percentage: r.score?.spo2_percentage ?? null,
      skin_temp_celsius: r.score?.skin_temp_celsius ?? null
    }))
    .filter((r) => new Date(r.date).getTime() >= cutoff)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const cycles = store
    .getAll('cycle')
    .filter((c) => c.score_state === 'SCORED')
    .map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      strain: c.score?.strain ?? null,
      average_heart_rate: c.score?.average_heart_rate ?? null,
      max_heart_rate: c.score?.max_heart_rate ?? null,
      kilojoule: c.score?.kilojoule ?? null
    }))
    .filter((c) => new Date(c.start).getTime() >= cutoff)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const sleep = store
    .getAll('sleep')
    .filter((s) => s.score_state === 'SCORED')
    .map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      nap: s.nap,
      sleep_performance_percentage: s.score?.sleep_performance_percentage ?? null,
      sleep_efficiency_percentage: s.score?.sleep_efficiency_percentage ?? null,
      sleep_consistency_percentage: s.score?.sleep_consistency_percentage ?? null,
      respiratory_rate: s.score?.respiratory_rate ?? null,
      total_sleep_time_hours: s.score?.stage_summary
        ? sumSleepStagesMillis(s.score.stage_summary) / 3600000
        : null
    }))
    .filter((s) => new Date(s.start).getTime() >= cutoff)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const workouts = store
    .getAll('workout')
    .filter((w) => w.score_state === 'SCORED')
    .map((w) => ({
      id: w.id,
      start: w.start,
      end: w.end,
      sport_name: w.sport_name,
      strain: w.score?.strain ?? null,
      average_heart_rate: w.score?.average_heart_rate ?? null,
      max_heart_rate: w.score?.max_heart_rate ?? null,
      kilojoule: w.score?.kilojoule ?? null,
      distance_meter: w.score?.distance_meter ?? null,
      zone_durations: w.score?.zone_durations ?? null
    }))
    .filter((w) => new Date(w.start).getTime() >= cutoff)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const settings = store.getSettings();

  return {
    connected: !!store.getTokens(),
    whoop_user: settings.whoop_user,
    last_sync_at: settings.last_sync_at,
    last_sync_status: settings.last_sync_status,
    last_sync_error: settings.last_sync_error,
    recovery,
    cycles,
    sleep,
    workouts
  };
}

function sumSleepStagesMillis(stageSummary) {
  return (
    (stageSummary.total_light_sleep_time_milli || 0) +
    (stageSummary.total_slow_wave_sleep_time_milli || 0) +
    (stageSummary.total_rem_sleep_time_milli || 0)
  );
}

module.exports = { buildDashboardPayload };
