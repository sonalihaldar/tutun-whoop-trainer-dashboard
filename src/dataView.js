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
    workouts,
    zoneBreakdown: buildZoneBreakdown(workouts),
    weeklyPattern: buildWeeklyPattern(workouts),
    weeklyTrends: buildWeeklyTrends(workouts, cutoff)
  };
}

// The 5 activities tracked on the Weekly Trends tab. Sport names from WHOOP
// can vary in casing/spacing (e.g. "Functional Fitness" vs "functional_fitness"),
// so matching is done against a normalized key, not an exact string.
const TRACKED_ACTIVITIES = [
  { key: 'walking', label: 'Walking' },
  { key: 'functional_fitness', label: 'Functional Fitness' },
  { key: 'running', label: 'Running' },
  { key: 'stairmaster', label: 'Stairmaster' },
  { key: 'elliptical', label: 'Elliptical' }
];

function normalizeSportKey(name) {
  return String(name || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
}

function mondayOf(dateInput) {
  const d = new Date(dateInput);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
}

// For each tracked activity, buckets its workouts into Monday-start weeks
// spanning the selected date range, and computes average strain and total
// heart-rate-zone minutes per week — the data behind the Weekly Trends tab.
function buildWeeklyTrends(workouts, cutoffMs) {
  const firstWeek = mondayOf(cutoffMs);
  const lastWeek = mondayOf(Date.now());

  const weekKeys = [];
  for (let d = new Date(firstWeek); d <= lastWeek; d.setDate(d.getDate() + 7)) {
    weekKeys.push(new Date(d).toISOString().slice(0, 10));
  }
  if (!weekKeys.length) weekKeys.push(firstWeek.toISOString().slice(0, 10));

  const byActivity = {};
  TRACKED_ACTIVITIES.forEach(({ key }) => {
    byActivity[key] = {};
    weekKeys.forEach((wk) => {
      byActivity[key][wk] = { strainSum: 0, strainCount: 0, zonesMilli: [0, 0, 0, 0, 0, 0], workoutCount: 0 };
    });
  });

  for (const w of workouts) {
    const key = normalizeSportKey(w.sport_name);
    if (!byActivity[key]) continue;
    const wk = mondayOf(w.start).toISOString().slice(0, 10);
    const bucket = byActivity[key][wk];
    if (!bucket) continue; // outside the generated week range
    bucket.workoutCount += 1;
    if (w.strain !== null && w.strain !== undefined) {
      bucket.strainSum += w.strain;
      bucket.strainCount += 1;
    }
    if (w.zone_durations) {
      const zd = w.zone_durations;
      const vals = [
        zd.zone_zero_milli || 0,
        zd.zone_one_milli || 0,
        zd.zone_two_milli || 0,
        zd.zone_three_milli || 0,
        zd.zone_four_milli || 0,
        zd.zone_five_milli || 0
      ];
      vals.forEach((v, i) => { bucket.zonesMilli[i] += v; });
    }
  }

  return TRACKED_ACTIVITIES.map(({ key, label }) => {
    const weeks = weekKeys.map((wk) => {
      const b = byActivity[key][wk];
      return {
        weekStart: wk,
        strain: b.strainCount > 0 ? b.strainSum / b.strainCount : null,
        workoutCount: b.workoutCount,
        zonesMinutes: b.zonesMilli.map((ms) => ms / 60000)
      };
    });
    return { key, label, weeks };
  });
}

// For each of the 5 most-frequent activity types, counts how many times
// that activity happened on each day of the week (Mon-first).
function buildWeeklyPattern(workouts) {
  const bySport = {};

  for (const w of workouts) {
    const key = w.sport_name || 'other';
    if (!bySport[key]) {
      bySport[key] = { sport_name: key, days: [0, 0, 0, 0, 0, 0, 0], total: 0 };
    }
    const jsDay = new Date(w.start).getDay(); // 0 = Sunday
    const mondayFirstIndex = (jsDay + 6) % 7; // 0 = Monday ... 6 = Sunday
    bySport[key].days[mondayFirstIndex] += 1;
    bySport[key].total += 1;
  }

  return Object.values(bySport)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

// Aggregates time-in-heart-rate-zone across all workouts, grouped by sport,
// so the dashboard can show "how much of this person's running is Zone 2
// vs. how much of their lifting is Zone 4/5", etc.
function buildZoneBreakdown(workouts) {
  const bySport = {};

  for (const w of workouts) {
    if (!w.zone_durations) continue;
    const key = w.sport_name || 'other';
    if (!bySport[key]) {
      bySport[key] = { sport_name: key, workoutCount: 0, zonesMilli: [0, 0, 0, 0, 0, 0] };
    }
    const zd = w.zone_durations;
    const vals = [
      zd.zone_zero_milli || 0,
      zd.zone_one_milli || 0,
      zd.zone_two_milli || 0,
      zd.zone_three_milli || 0,
      zd.zone_four_milli || 0,
      zd.zone_five_milli || 0
    ];
    bySport[key].workoutCount += 1;
    vals.forEach((v, i) => { bySport[key].zonesMilli[i] += v; });
  }

  return Object.values(bySport)
    .map((entry) => {
      const zonesMinutes = entry.zonesMilli.map((ms) => ms / 60000);
      const totalMinutes = zonesMinutes.reduce((sum, v) => sum + v, 0);
      return {
        sport_name: entry.sport_name,
        workoutCount: entry.workoutCount,
        zonesMinutes,
        totalMinutes
      };
    })
    .filter((entry) => entry.totalMinutes > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function sumSleepStagesMillis(stageSummary) {
  return (
    (stageSummary.total_light_sleep_time_milli || 0) +
    (stageSummary.total_slow_wave_sleep_time_milli || 0) +
    (stageSummary.total_rem_sleep_time_milli || 0)
  );
}

module.exports = { buildDashboardPayload };
