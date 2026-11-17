window.esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
window.pageToken = location.pathname.split('/').filter(Boolean).pop();
window.voteUrlOf = (st) => (st.publicUrl || location.origin) + '/v/' + st.voteToken;
window.pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
