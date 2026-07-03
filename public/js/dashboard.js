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
    if (status.whoop_user?.first_name) {
      document.getElementById('user-name').textContent = `${status.whoop_user.first_name}'s Recovery Dashboard`;
    }

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

  refresh();
})();
