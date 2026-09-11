// Single source of truth for turning skillsMode into the wire value sent on
// messages and rebuild POSTs. Previously a wrong ternary
// (mode === 'all' ? 'all' : skillsList) was copy-pasted 5x: 'default' and
// 'none' both sent the stale custom list instead of null / [].
//
// NOTE: 'none' sends [], but the backend coerces [] to the SDK default until
// the SDK stops hanging on an empty skills list — the mode cannot truly
// disable skills yet.
export function skillsWireValue(mode, skillsList) {
  if (mode === 'all') return 'all';
  if (mode === 'none') return [];
  if (mode === 'custom') return skillsList ?? [];
  // 'default', null, and any legacy junk → SDK discovery.
  return null;
}
