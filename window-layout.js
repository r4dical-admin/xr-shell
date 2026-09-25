'use strict';

(function expose(factory) {
  const layout = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = layout;
  if (typeof window !== 'undefined') window.XR_WINDOW_LAYOUT = layout;
})(() => {
  const MAX_WINDOWS = 12;
  const MAX_HORIZONTAL_SCALE = 7;
  const CHROME_HEIGHT = 94;

  function requiredHorizontalScale(count, currentScale) {
    const desired = 1.15 + Math.max(0, count) * 0.48;
    return Math.min(MAX_HORIZONTAL_SCALE, Math.max(Number(currentScale) || 1.5, Math.ceil(desired * 4) / 4));
  }

  function horizontalSlots(count, scale) {
    if (count <= 0) return [];
    if (count === 1) return [0];
    const usableSpan = Math.max(48, Number(scale) * 100 - 55);
    const span = Math.min(usableSpan, (count - 1) * 48);
    const spacing = span / (count - 1);
    return Array.from({ length: count }, (_value, index) => (index - (count - 1) / 2) * spacing);
  }

  function fittedPanelSize(mediaWidth, mediaHeight, stageWidth, stageHeight) {
    const sourceWidth = Math.max(1, Number(mediaWidth) || 1);
    const sourceHeight = Math.max(1, Number(mediaHeight) || 1);
    const maxWidth = Math.max(420, Math.min(1100, Number(stageWidth) * 0.48));
    const maxHeight = Math.max(280, Number(stageHeight) * 0.9);
    const maxContentHeight = Math.max(1, maxHeight - CHROME_HEIGHT);
    const scale = Math.min(1, maxWidth / sourceWidth, maxContentHeight / sourceHeight);
    return {
      width: Math.max(420, sourceWidth * scale),
      height: Math.max(280, sourceHeight * scale + CHROME_HEIGHT)
    };
  }

  return { MAX_WINDOWS, MAX_HORIZONTAL_SCALE, CHROME_HEIGHT, requiredHorizontalScale, horizontalSlots, fittedPanelSize };
});
