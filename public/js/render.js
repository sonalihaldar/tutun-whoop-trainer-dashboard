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
  const latestCycle = data.cycles[data.cycles.length - 1];

  const recoveryVal = latestRecovery?.recovery_score;
  const strainVal = latestCycle?.strain;

  gaugesEl.innerHTML = `
    ${gaugeCard('Recovery', recoveryVal, '%', zoneColorForRecovery(recoveryVal), latestRecovery ? fmtDate(latestRecovery.date) : '—')}
    ${gaugeCard('Day Strain', strainVal !== undefined ? Number(strainVal).toFixed(1) : null, '', zoneColorForStrain(strainVal), latestCycle ? fmtDate(latestCycle.start) : '—')}
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

const ZONE_LABELS = ['Zone 0', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4', 'Zone 5'];
const ZONE_COLORS = ['var(--hrz0)', 'var(--hrz1)', 'var(--hrz2)', 'var(--hrz3)', 'var(--hrz4)', 'var(--hrz5)'];

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function titleCaseSport(s) {
  return String(s || 'activity').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderZoneBreakdown(data) {
  const container = document.getElementById('zone-breakdown');
  if (!container) return;

  const breakdown = data.zoneBreakdown || [];
  if (!breakdown.length) {
    container.innerHTML = '<div class="empty-state"><div class="desc">No workouts with heart rate zone data in this range yet.</div></div>';
    return;
  }

  const maxMinutes = Math.max(...breakdown.map((a) => a.totalMinutes), 1);

  const legend = `<div class="zone-legend">${ZONE_LABELS.map((label, i) =>
    `<span class="zone-legend-item"><i style="background:${ZONE_COLORS[i]}"></i>${label}</span>`
  ).join('')}</div>`;

  const rows = breakdown.map((activity) => {
    const barWidthPct = Math.max(6, (activity.totalMinutes / maxMinutes) * 100);
    const segments = activity.zonesMinutes.map((min, i) => {
      if (min <= 0) return '';
      const pct = (min / activity.totalMinutes) * 100;
      const title = `${ZONE_LABELS[i]}: ${formatMinutes(min)}`;
      return `<div class="zone-seg" style="width:${pct}%;background:${ZONE_COLORS[i]}" title="${title}"></div>`;
    }).join('');

    return `
      <div class="zone-row">
        <div class="zone-row-label">
          <span class="zone-row-name">${escapeHtml(titleCaseSport(activity.sport_name))}</span>
          <span class="zone-row-meta">${activity.workoutCount} ${activity.workoutCount === 1 ? 'workout' : 'workouts'} · ${formatMinutes(activity.totalMinutes)}</span>
        </div>
        <div class="zone-bar-track" style="width:${barWidthPct}%">${segments}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = legend + `<div class="zone-rows">${rows}</div>`;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderWeeklyPattern(data) {
  const container = document.getElementById('weekly-pattern');
  if (!container) return;

  const pattern = data.weeklyPattern || [];
  if (!pattern.length) {
    container.innerHTML = '<div class="empty-state"><div class="desc">Not enough workout history yet to show a weekly pattern.</div></div>';
    return;
  }

  const maxCount = Math.max(...pattern.flatMap((p) => p.days), 1);

  const header = `<div class="weekly-row weekly-header-row"><div class="weekly-label"></div>${WEEKDAY_LABELS.map((d) => `<div class="weekly-daylabel">${d}</div>`).join('')}</div>`;

  const rows = pattern.map((activity) => {
    const cells = activity.days.map((count) => {
      const intensity = count / maxCount;
      const bg = count === 0 ? 'transparent' : `rgba(95, 227, 192, ${(0.15 + intensity * 0.65).toFixed(2)})`;
      return `<div class="weekly-cell" style="background:${bg}">${count > 0 ? count : ''}</div>`;
    }).join('');
    return `<div class="weekly-row"><div class="weekly-label">${escapeHtml(titleCaseSport(activity.sport_name))}</div>${cells}</div>`;
  }).join('');

  container.innerHTML = `<div class="weekly-grid">${header}${rows}</div>`;
}

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = 'none'; });
      const panel = document.getElementById('tab-' + btn.dataset.tab);
      if (panel) panel.style.display = 'block';
    });
  });
}

function renderWeeklyTrends(data) {
  const container = document.getElementById('weekly-trends');
  if (!container) return;

  const trends = data.weeklyTrends || [];
  if (!trends.length) {
    container.innerHTML = '<div class="empty-state"><div class="desc">No weekly trend data yet.</div></div>';
    return;
  }

  const zoneLegend = `<div class="zone-legend">${ZONE_LABELS.map((label, i) =>
    `<span class="zone-legend-item"><i style="background:${ZONE_COLORS[i]}"></i>${label}</span>`
  ).join('')}</div>`;

  container.innerHTML = trends.map((activity) => {
    const dates = activity.weeks.map((w) => w.weekStart);
    const totalWorkouts = activity.weeks.reduce((sum, w) => sum + w.workoutCount, 0);

    if (totalWorkouts === 0) {
      return `
        <div class="section">
          <div class="section-head">
            <div class="section-title">${escapeHtml(activity.label)}</div>
            <div class="section-note">no workouts logged in this range</div>
          </div>
        </div>
      `;
    }

    const strainSvg = lineChartSVG(
      activity.weeks.map((w) => ({ date: w.weekStart, value: w.strain })),
      { min: 0, max: 21, colorFn: zoneColorForStrain }
    );

    const zoneMax = Math.max(1, ...activity.weeks.flatMap((w) => w.zonesMinutes)) * 1.1;
    const zoneSeries = [0, 1, 2, 3, 4, 5].map((zi) => activity.weeks.map((w) => w.zonesMinutes[zi]));
    const zonesSvg = multiLineChartSVG(zoneSeries, { min: 0, max: zoneMax, colors: ZONE_COLORS, dates });

    return `
      <div class="section">
        <div class="section-head">
          <div class="section-title">${escapeHtml(activity.label)}</div>
          <div class="section-note">weekly · ${totalWorkouts} ${totalWorkouts === 1 ? 'workout' : 'workouts'} in range</div>
        </div>
        <div class="weekly-trend-subhead">Strain</div>
        <div class="chart-wrap">${strainSvg}</div>
        <div class="weekly-trend-subhead">Heart Rate Zones (minutes/week)</div>
        ${zoneLegend}
        <div class="chart-wrap">${zonesSvg}</div>
      </div>
    `;
  }).join('');
}

function renderAll(data) {
  renderConnectionDot(data.connected);
  renderLastSync(data);
  renderGauges(data);
  renderCharts(data);
  renderZoneBreakdown(data);
  renderWeeklyPattern(data);
  renderWeeklyTrends(data);
  renderWorkoutTable(data);
}
