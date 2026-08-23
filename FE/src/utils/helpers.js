export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatJson(val) {
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return String(val);
  }
}

export function isMobileView() {
  return (
    window.innerWidth < 768 ||
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window
  );
}
