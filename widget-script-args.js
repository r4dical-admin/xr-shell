'use strict';

(function expose(factory) {
  const runtime = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = runtime;
  if (typeof window !== 'undefined') window.XR_WIDGET_SCRIPT_ARGS = runtime;
})(() => {
function materializeScriptArgs(template) {
  if (!Array.isArray(template) || template.length > 24) throw new Error('Script widget args must be an array of at most 24 items');
  const args = [];
  for (const entry of template) {
    let value = entry;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (!Object.hasOwn(entry, 'value') || Object.keys(entry).some((key) => !['value', 'when'].includes(key))) throw new Error('Invalid script widget argument');
      if (Object.hasOwn(entry, 'when') && typeof entry.when !== 'boolean') throw new Error('Invalid script widget condition');
      if (entry.when === false) continue;
      value = entry.value;
    }
    if (typeof value !== 'string' || value.length > 400 || value.includes('\0')) throw new Error('Script widget arguments must resolve to short strings');
    args.push(value);
  }
  return args;
}

return { materializeScriptArgs };
});
