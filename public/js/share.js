(function () {
  const loadingMsg = document.getElementById('loading-msg');
  const notConnected = document.getElementById('not-connected');
  const dashboardContent = document.getElementById('dashboard-content');
  const rangeSelect = document.getElementById('range-select');

  const token = window.location.pathname.split('/share/')[1];

  async function loadData(days) {
    const res = await fetch(`/api/share/${token}/data?days=${days}`);
    if (!res.ok) return null;
    return res.json();
  }

  async function refresh() {
    const data = await loadData(rangeSelect.value);
    loadingMsg.style.display = 'none';

    if (!data || !data.connected || (!data.recovery.length && !data.workouts.length && !data.sleep.length)) {
      notConnected.style.display = 'block';
      dashboardContent.style.display = data && data.connected ? 'block' : 'none';
      if (data && data.connected) renderAll(data);
      return;
    }

    notConnected.style.display = 'none';
    dashboardContent.style.display = 'block';
    renderAll(data);
  }

  rangeSelect.addEventListener('change', refresh);
  refresh();
  initTabs();
})();
