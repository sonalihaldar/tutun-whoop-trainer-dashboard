// Shared rendering logic used by both the admin dashboard and the
// read-only trainer share view.

function renderConnectionDot(connected) {
  const el = document.getElementById('conn-dot');
  if (!el) return;
  el.classList.toggle('on', connected);
  el.classList.toggle('off', !connected);
}

function renderLastSync(data) {
  const el = document.getElementById('last-sync');
  if (!el) return;
  if (!data.last_sync_at) {
    el.textContent = 'never synced';
    return;
  }
  const when = fmtDateTime(data.last_sync_at);
  el.textContent = data.last_sync_status === 'error' ? `sync error · last ok before ${when}` : `synced ${when}`;
}

function renderGauges(data) {
  const gaugesEl = document.getElementById('gauges');
  if (!gaugesEl) return;

  const latestRecovery = data.recovery[data.recovery.length - 1];
  const latestSleep = data.sleep.filter((s) => !s.nap)[data.sleep.filter((s) => !s.nap).length - 1];
  const latestCycle = data.cycles[data.cycles.length - 1];

  const recoveryVal = latestRecovery?.recovery_score;
  const sleepVal = latestSleep?.sleep_performance_percentage;
  const strainVal = latestCycle?.strain;

  gaugesEl.innerHTML = `
    ${gaugeCard('Recovery', recoveryVal, '%', zoneColorForRecovery(recoveryVal), latestRecovery ? fmtDate(latestRecovery.date) : '—')}
    ${gaugeCard('Day Strain', strainVal !== undefined ? Number(strainVal).toFixed(1) : null, '', zoneColorForStrain(strainVal), latestCycle ? fmtDate(latestCycle.start) : '—')}
    ${gaugeCard('Sleep Performance', sleepVal, '%', zoneColorForSleep(sleepVal), latestSleep ? fmtDate(latestSleep.start) : '—')}
    ${gaugeCard('Resting HR', latestRecovery?.resting_heart_rate, ' bpm', 'var(--ink)', latestRecovery ? fmtDate(latestRecovery.date) : '—')}
  `;
}

function gaugeCard(label, value, unit, color, sub) {
  const display = value === null || value === undefined ? '—' : value;
  return `
    <div class="gauge" style="--zone-color:${color}">
      <div class="gauge-label">${label}</div>
      <div><span class="gauge-value">${display}</span><span class="gauge-unit">${unit}</span></div>
      <div class="gauge-sub">${sub}</div>
    </div>
  `;
}

function renderCharts(data) {
  const recoveryChart = document.getElementById('chart-recovery');
  if (recoveryChart) {
    recoveryChart.innerHTML = lineChartSVG(
      data.recovery.map((r) => ({ date: r.date, value: r.recovery_score })),
      { min: 0, max: 100, colorFn: zoneColorForRecovery, unit: '%' }
    );
  }

  const strainChart = document.getElementById('chart-strain');
  if (strainChart) {
    strainChart.innerHTML = barChartSVG(
      data.cycles.map((c) => ({ date: c.start, value: c.strain })),
      { min: 0, max: 21, colorFn: zoneColorForStrain }
    );
  }

  const sleepChart = document.getElementById('chart-sleep');
  if (sleepChart) {
    sleepChart.innerHTML = lineChartSVG(
      data.sleep.filter((s) => !s.nap).map((s) => ({ date: s.start, value: s.sleep_performance_percentage })),
      { min: 0, max: 100, colorFn: zoneColorForSleep, unit: '%' }
    );
  }

  const hrvChart = document.getElementById('chart-hrv');
  if (hrvChart) {
    const values = data.recovery.map((r) => r.hrv_rmssd_milli).filter((v) => v !== null && v !== undefined);
    const max = values.length ? Math.max(...values) * 1.2 : 100;
    hrvChart.innerHTML = lineChartSVG(
      data.recovery.map((r) => ({ date: r.date, value: r.hrv_rmssd_milli })),
      { min: 0, max, colorFn: () => 'var(--accent)', unit: 'ms' }
    );
  }
}

function renderWorkoutTable(data) {
  const tbody = document.getElementById('workout-tbody');
  const empty = document.getElementById('workout-empty');
  if (!tbody) return;

  const workouts = [...data.workouts].reverse().slice(0, 25);
  if (!workouts.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = workouts.map((w) => {
    const color = zoneColorForStrain(w.strain);
    const durationMin = w.start && w.end ? Math.round((new Date(w.end) - new Date(w.start)) / 60000) : null;
    return `
      <tr>
        <td>${fmtDate(w.start)}</td>
        <td>${escapeHtml(w.sport_name || 'activity')}</td>
        <td><span class="zone-chip" style="background:${color}22;color:${color}">${w.strain !== null ? Number(w.strain).toFixed(1) : '—'}</span></td>
        <td>${w.average_heart_rate ?? '—'} bpm</td>
        <td>${durationMin !== null ? durationMin + ' min' : '—'}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAll(data) {
  renderConnectionDot(data.connected);
  renderLastSync(data);
  renderGauges(data);
  renderCharts(data);
  renderWorkoutTable(data);
}
