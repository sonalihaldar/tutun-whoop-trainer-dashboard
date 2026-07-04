// Minimal dependency-free SVG chart helpers, themed to the app's design tokens.

function zoneColorForRecovery(score) {
  if (score === null || score === undefined) return 'var(--ink-dim)';
  if (score >= 67) return 'var(--zone-good)';
  if (score >= 34) return 'var(--zone-mid)';
  return 'var(--zone-low)';
}

function zoneColorForStrain(strain) {
  if (strain === null || strain === undefined) return 'var(--ink-dim)';
  if (strain >= 14) return 'var(--zone-low)';
  if (strain >= 10) return 'var(--zone-mid)';
  return 'var(--zone-good)';
}

function zoneColorForSleep(pct) {
  if (pct === null || pct === undefined) return 'var(--ink-dim)';
  if (pct >= 80) return 'var(--zone-good)';
  if (pct >= 60) return 'var(--zone-mid)';
  return 'var(--zone-low)';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Renders a line chart with an optional colored dot per point (by zone).
function lineChartSVG(points, { width = 900, height = 180, min = 0, max = 100, colorFn = null, unit = '' } = {}) {
  if (!points.length) return emptyChartSVG(width, height);
  const padL = 34, padR = 14, padT = 14, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const xs = points.map((_, i) => padL + (i / Math.max(1, points.length - 1)) * innerW);
  const ys = points.map((p) => {
    const v = p.value === null || p.value === undefined ? null : p.value;
    if (v === null) return null;
    const clamped = Math.max(min, Math.min(max, v));
    return padT + innerH - ((clamped - min) / (max - min)) * innerH;
  });

  let pathD = '';
  let started = false;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y === null) { started = false; return; }
    pathD += (started ? ' L ' : ' M ') + x.toFixed(1) + ' ' + y.toFixed(1);
    started = true;
  });

  const gridLines = [0.25, 0.5, 0.75].map((f) => {
    const y = padT + innerH * f;
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" />`;
  }).join('');

  const dots = xs.map((x, i) => {
    const y = ys[i];
    if (y === null) return '';
    const p = points[i];
    const color = colorFn ? colorFn(p.value) : 'var(--accent)';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"><title>${fmtDate(p.date)}: ${p.value ?? '—'}${unit}</title></circle>`;
  }).join('');

  // Sparse x-axis labels (first, middle, last)
  const labelIdxs = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  const labels = [...new Set(labelIdxs)].map((i) => {
    return `<text x="${xs[i].toFixed(1)}" y="${height - 6}" font-family="var(--mono)" font-size="10" fill="var(--ink-dim)" text-anchor="middle">${fmtDate(points[i].date)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
    ${gridLines}
    <path d="${pathD}" fill="none" stroke="var(--accent-dim)" stroke-width="2" />
    ${dots}
    ${labels}
  </svg>`;
}

function barChartSVG(points, { width = 900, height = 180, min = 0, max = 21, colorFn = null, unit = '' } = {}) {
  if (!points.length) return emptyChartSVG(width, height);
  const padL = 34, padR = 14, padT = 14, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const barW = Math.max(2, (innerW / points.length) * 0.55);

  const gridLines = [0.25, 0.5, 0.75].map((f) => {
    const y = padT + innerH * f;
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" />`;
  }).join('');

  const bars = points.map((p, i) => {
    const x = padL + (i / Math.max(1, points.length - 1)) * (innerW - barW) + (points.length === 1 ? innerW / 2 - barW / 2 : 0);
    const v = p.value === null || p.value === undefined ? 0 : Math.max(min, Math.min(max, p.value));
    const barH = ((v - min) / (max - min)) * innerH;
    const y = padT + innerH - barH;
    const color = colorFn ? colorFn(p.value) : 'var(--accent)';
    if (p.value === null || p.value === undefined) return '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${color}"><title>${fmtDate(p.date)}: ${p.value ?? '—'}${unit}</title></rect>`;
  }).join('');

  const labelIdxs = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  const labels = [...new Set(labelIdxs)].map((i) => {
    const x = padL + (i / Math.max(1, points.length - 1)) * innerW;
    return `<text x="${x.toFixed(1)}" y="${height - 6}" font-family="var(--mono)" font-size="10" fill="var(--ink-dim)" text-anchor="middle">${fmtDate(points[i].date)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
    ${gridLines}
    ${bars}
    ${labels}
  </svg>`;
}

// Draws several line series sharing one axis — used for HR-zone-over-time
// charts, where each of the 6 zones is its own line.
function multiLineChartSVG(seriesList, { width = 900, height = 200, min = 0, max = 100, colors = [], dates = [] } = {}) {
  if (!dates.length) return emptyChartSVG(width, height);
  const padL = 34, padR = 14, padT = 14, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const xs = dates.map((_, i) => padL + (i / Math.max(1, dates.length - 1)) * innerW);

  const gridLines = [0.25, 0.5, 0.75].map((f) => {
    const y = padT + innerH * f;
    return `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" />`;
  }).join('');

  const paths = seriesList.map((series, si) => {
    let d = '';
    let started = false;
    series.forEach((val, i) => {
      if (val === null || val === undefined) { started = false; return; }
      const clamped = Math.max(min, Math.min(max, val));
      const x = xs[i];
      const y = padT + innerH - ((clamped - min) / (max - min)) * innerH;
      d += (started ? ' L ' : ' M ') + x.toFixed(1) + ' ' + y.toFixed(1);
      started = true;
    });
    const color = colors[si] || 'var(--accent)';
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" />`;
  }).join('');

  const labelIdxs = dates.length > 1 ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1] : [0];
  const labels = [...new Set(labelIdxs)].map((i) => {
    return `<text x="${xs[i].toFixed(1)}" y="${height - 6}" font-family="var(--mono)" font-size="10" fill="var(--ink-dim)" text-anchor="middle">${fmtDate(dates[i])}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
    ${gridLines}
    ${paths}
    ${labels}
  </svg>`;
}

function emptyChartSVG(width, height) {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <text x="${width / 2}" y="${height / 2}" font-family="var(--mono)" font-size="12" fill="var(--ink-dim)" text-anchor="middle">No data in this range yet</text>
  </svg>`;
}
