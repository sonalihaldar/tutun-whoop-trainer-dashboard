(function () {
  const loadingMsg = document.getElementById('loading-msg');
  const notConnected = document.getElementById('not-connected');
  const dashboardContent = document.getElementById('dashboard-content');
  const rangeSelect = document.getElementById('range-select');

  async function loadStatus() {
    const res = await fetch('/api/status');
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  }

  async function loadData(days) {
    const res = await fetch(`/api/data?days=${days}`);
    if (res.status === 401) { window.location.href = '/login'; return null; }
    return res.json();
  }

  async function refresh() {
    const status = await loadStatus();
    if (!status) return;

    if (!status.connected) {
      loadingMsg.style.display = 'none';
      notConnected.style.display = 'block';
      dashboardContent.style.display = 'none';
      return;
    }

    document.getElementById('share-url').textContent = window.location.origin + status.share_url_path;

    const logoutForm = document.getElementById('logout-form');
    if (logoutForm) logoutForm.style.display = status.login_required ? 'block' : 'none';

    const regenBtn = document.getElementById('regen-share-btn');
    const fixedNote = document.getElementById('share-fixed-note');
    if (status.share_token_fixed) {
      regenBtn.disabled = true;
      regenBtn.title = 'This link is fixed via the SHARE_TOKEN environment variable — it will not change on redeploy.';
      if (fixedNote) fixedNote.style.display = 'inline';
    } else {
      regenBtn.disabled = false;
      regenBtn.title = '';
      if (fixedNote) fixedNote.style.display = 'none';
    }

    renderDriveSection(status);

    const days = rangeSelect.value;
    const data = await loadData(days);
    if (!data) return;

    loadingMsg.style.display = 'none';
    notConnected.style.display = 'none';
    dashboardContent.style.display = 'block';
    renderAll(data);
  }

  rangeSelect.addEventListener('change', refresh);

  document.getElementById('sync-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const result = await res.json();
      if (!result.ok) throw new Error(result.error || 'Sync failed');
      await refresh();
    } catch (err) {
      alert('Sync failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync now';
    }
  });

  document.getElementById('copy-share-btn').addEventListener('click', async (e) => {
    const url = document.getElementById('share-url').textContent;
    if (url === '—') return;
    await navigator.clipboard.writeText(url);
    const btn = e.target;
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  document.getElementById('regen-share-btn').addEventListener('click', async () => {
    if (!confirm('This will invalidate the current share link. Anyone with the old link (including your trainer) will lose access until you send them the new one. Continue?')) return;
    const res = await fetch('/api/share/regenerate', { method: 'POST' });
    const result = await res.json();
    if (result.ok) {
      document.getElementById('share-url').textContent = window.location.origin + result.share_url_path;
    }
  });

  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    if (!confirm('This disconnects your WHOOP account. You can reconnect any time, but you will need to re-authorize.')) return;
    await fetch('/api/whoop/disconnect', { method: 'POST' });
    refresh();
  });

  function renderDriveSection(status) {
    const notConfiguredEl = document.getElementById('drive-not-configured');
    const notConnectedEl = document.getElementById('drive-not-connected');
    const connectedEl = document.getElementById('drive-connected');

    notConfiguredEl.style.display = 'none';
    notConnectedEl.style.display = 'none';
    connectedEl.style.display = 'none';

    if (!status.google_configured) {
      notConfiguredEl.style.display = 'flex';
      return;
    }
    if (!status.google_connected) {
      notConnectedEl.style.display = 'flex';
      return;
    }

    connectedEl.style.display = 'flex';
    document.getElementById('drive-email').textContent = status.google_user_email || 'connected account';

    const statusEl = document.getElementById('drive-export-status');
    if (status.last_drive_export_status === 'error') {
      statusEl.textContent = 'export error';
      statusEl.style.color = 'var(--zone-low)';
    } else if (status.last_drive_export_at) {
      statusEl.textContent = 'exported ' + fmtDateTime(status.last_drive_export_at);
      statusEl.style.color = '';
    } else {
      statusEl.textContent = 'not exported yet';
      statusEl.style.color = '';
    }
    if (status.last_drive_export_status === 'error' && status.last_drive_export_error) {
      statusEl.title = status.last_drive_export_error;
    } else {
      statusEl.title = '';
    }

    const openLink = document.getElementById('drive-open-link');
    if (status.google_drive_file_url) {
      openLink.href = status.google_drive_file_url;
      openLink.style.display = 'inline-block';
    } else {
      openLink.style.display = 'none';
    }
  }

  document.getElementById('drive-export-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const res = await fetch('/api/drive/export', { method: 'POST' });
      const result = await res.json();
      if (!result.ok) throw new Error(result.error || 'Export failed');
      await refresh();
    } catch (err) {
      alert('Export failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export now';
    }
  });

  document.getElementById('drive-disconnect-btn').addEventListener('click', async () => {
    if (!confirm('This disconnects Google Drive. Your existing exported file stays in your Drive, but auto-export will stop until you reconnect.')) return;
    await fetch('/api/google/disconnect', { method: 'POST' });
    refresh();
  });

  refresh();
  initTabs();
  initWeekSelect();
})();
