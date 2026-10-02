'use strict';

(function expose(factory) {
  const semanticTheme = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = semanticTheme;
  if (typeof window !== 'undefined') window.XR_SEMANTIC_THEME = semanticTheme;
})(() => {
  const ROLE_LEVELS = new Map([
    ['AXButton', 1], ['AXMenuButton', 1], ['AXCheckBox', 1], ['AXRadioButton', 1], ['AXPopUpButton', 1],
    ['AXTextField', 2], ['AXComboBox', 2],
    ['AXLink', 3], ['AXTab', 3], ['AXSlider', 3],
    ['AXTextArea', 4], ['AXStaticText', 5]
  ]);
  const COMPLEX_ROLES = new Set(['AXGroup', 'AXToolbar', 'AXScrollArea', 'AXList', 'AXTable', 'AXOutline',
    'AXWebArea', 'AXRuler', 'AXSplitGroup']);

  function coverageLevel(intensity) {
    return Math.max(1, Math.min(5, Math.ceil((Number(intensity) || 15) / 20)));
  }

  function elementDepth(element) {
    return Math.max(0, String(element?.id || '0').split('.').length - 1);
  }

  function validFrame(frame) {
    return frame && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)
      && frame.width > 0.003 && frame.height > 0.003 && frame.width <= 1.05 && frame.height <= 1.05;
  }

  function classifyElement(element) {
    if (!validFrame(element?.frame)) return { mode: 'ignore', requiredLevel: 6 };
    const role = String(element.role || 'AXUnknown');
    const area = element.frame.width * element.frame.height;
    const depthLevel = Math.min(5, 1 + Math.floor(elementDepth(element) / 3));
    if (role === 'AXTextArea' && area > 0.45) return { mode: 'fx', requiredLevel: Math.max(3, depthLevel) };
    if (ROLE_LEVELS.has(role)) {
      const mode = ['AXTextField', 'AXTextArea', 'AXComboBox'].includes(role) ? 'a2ui-text-field'
        : role === 'AXStaticText' ? 'a2ui-text'
          : ['AXButton', 'AXMenuButton', 'AXCheckBox', 'AXRadioButton', 'AXPopUpButton'].includes(role) ? 'a2ui-button'
            : 'overlay';
      return { mode, requiredLevel: Math.max(ROLE_LEVELS.get(role), depthLevel) };
    }
    if (COMPLEX_ROLES.has(role) && area >= 0.012 && area <= 0.9) return { mode: 'fx', requiredLevel: depthLevel };
    return { mode: 'ignore', requiredLevel: 6 };
  }

  function buildCoveragePlan(elements, intensity) {
    const level = coverageLevel(intensity);
    const wrapped = [];
    const fx = [];
    const seenFx = new Set();
    let eligible = 0;
    for (const element of elements || []) {
      const classification = classifyElement(element);
      if (classification.mode === 'ignore') continue;
      eligible += 1;
      if (classification.requiredLevel > level) continue;
      const item = { ...element, semanticMode: classification.mode, requiredLevel: classification.requiredLevel };
      if (classification.mode !== 'fx') {
        if (wrapped.length < 140) wrapped.push(item);
        continue;
      }
      const frame = element.frame;
      const key = [frame.x, frame.y, frame.width, frame.height].map((value) => Number(value).toFixed(3)).join(':');
      if (!seenFx.has(key) && fx.length < 24) {
        seenFx.add(key);
        fx.push(item);
      }
    }
    return { level, wrapped, fx, eligible, pending: Math.max(0, eligible - wrapped.length - fx.length) };
  }

  return { ROLE_LEVELS, COMPLEX_ROLES, coverageLevel, elementDepth, classifyElement, buildCoveragePlan };
});
