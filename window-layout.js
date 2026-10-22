'use strict';

(function expose(factory) {
  const layout = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = layout;
  if (typeof window !== 'undefined') window.XR_WINDOW_LAYOUT = layout;
})(() => {
  const MAX_WINDOWS = 12;
  const MAX_HORIZONTAL_SCALE = 7;
  const CHROME_HEIGHT = 94;

  function panelGap(widths) {
    // Reserve room for the apparent width added by the workspace perspective.
    return Math.max(48, Math.max(0, ...widths) * .06);
  }

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

  function horizontalSlotsForWidths(widths, viewportWidth, gap = panelGap(widths)) {
    const safeWidths = widths.map((width) => Math.max(1, Number(width) || 1));
    if (!safeWidths.length) return [];
    const spacing = Math.max(0, Number(gap) || 0);
    const total = safeWidths.reduce((sum, width) => sum + width, 0) + spacing * (safeWidths.length - 1);
    let left = -total / 2;
    return safeWidths.map((width) => {
      const center = left + width / 2;
      left += width + spacing;
      return center * 100 / Math.max(1, Number(viewportWidth) || 1);
    });
  }

  function requiredHorizontalScaleForWidths(widths, viewportWidth, currentScale, gap = panelGap(widths)) {
    const total = widths.reduce((sum, width) => sum + Math.max(1, Number(width) || 1), 0)
      + Math.max(0, widths.length - 1) * gap;
    const desired = (total + Math.max(120, viewportWidth * .35)) / Math.max(1, viewportWidth);
    return Math.min(MAX_HORIZONTAL_SCALE, Math.max(Number(currentScale) || 1.5, Math.ceil(desired * 4) / 4));
  }

  function concavePanelPose(position) {
    const distance = Math.abs(Number(position) || 0) / 48;
    return {
      tilt: Math.sign(position) * Math.min(1.5, distance * 1.5),
      depth: distance === 0 ? 0 : Math.min(12, distance * 12)
    };
  }

  function requiredCanvasScaleForPanel(panelExtent, viewportExtent, currentScale, maxScale, usableFraction) {
    const desired = Math.ceil((Math.max(1, Number(panelExtent) || 1)
      / (Math.max(1, Number(viewportExtent) || 1) * usableFraction)) * 4) / 4;
    return Math.min(maxScale, Math.max(currentScale, desired));
  }

  function shouldZoomBeyondOriginal(width, height, originalWidth, originalHeight) {
    return Number.isFinite(originalWidth) && Number.isFinite(originalHeight)
      && (width > originalWidth + 2 || height > originalHeight + 2);
  }

  function fittedPanelSize(mediaWidth, mediaHeight, stageWidth, stageHeight, cropTop = 0) {
    const sourceWidth = Math.max(1, Number(mediaWidth) || 1);
    const sourceHeight = Math.max(1, Number(mediaHeight) || 1);
    const safeCropTop = Math.min(sourceHeight * 0.3, Math.max(0, Number(cropTop) || 0));
    const visibleHeight = Math.max(1, sourceHeight - safeCropTop);
    const maxWidth = Math.max(420, Math.min(1100, Number(stageWidth) * 0.48));
    const maxHeight = Math.max(280, Number(stageHeight) * 0.9);
    const maxContentHeight = Math.max(1, maxHeight - CHROME_HEIGHT);
    const scale = Math.min(1, maxWidth / sourceWidth, maxContentHeight / visibleHeight);
    return {
      width: Math.max(420, sourceWidth * scale),
      height: Math.max(280, visibleHeight * scale + CHROME_HEIGHT)
    };
  }

  function manualPanelLimits(stageWidth, stageHeight) {
    return {
      maxWidth: Math.max(420, (Number(stageWidth) || 1) * 0.82),
      maxHeight: Math.max(280, (Number(stageHeight) || 1) * 0.96)
    };
  }

  function resizedPanelSize(width, height, deltaX, deltaY, limits) {
    const startWidth = Math.max(420, Number(width) || 420);
    const contentHeight = Math.max(1, (Number(height) || 280) - CHROME_HEIGHT);
    const horizontalScale = (startWidth + (Number(deltaX) || 0)) / startWidth;
    const verticalScale = (contentHeight + (Number(deltaY) || 0)) / contentHeight;
    const scale = Math.abs(Number(deltaX) || 0) / startWidth >= Math.abs(Number(deltaY) || 0) / contentHeight
      ? horizontalScale : verticalScale;
    const minScale = Math.max(420 / startWidth, (280 - CHROME_HEIGHT) / contentHeight);
    const maxScale = Math.min(Number(limits?.maxWidth) / startWidth, (Number(limits?.maxHeight) - CHROME_HEIGHT) / contentHeight);
    const safeScale = Math.max(minScale, Math.min(Math.max(minScale, maxScale), scale));
    return { width: startWidth * safeScale, height: contentHeight * safeScale + CHROME_HEIGHT };
  }

  function containedMediaRect(mediaWidth, mediaHeight, boxWidth, boxHeight, cropTop = 0) {
    const sourceWidth = Math.max(1, Number(mediaWidth) || 1);
    const sourceHeight = Math.max(1, Number(mediaHeight) || 1);
    const safeCropTop = Math.min(sourceHeight * 0.3, Math.max(0, Number(cropTop) || 0));
    const visibleHeight = Math.max(1, sourceHeight - safeCropTop);
    const scale = Math.min(Math.max(1, Number(boxWidth)) / sourceWidth, Math.max(1, Number(boxHeight)) / visibleHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      left: (Number(boxWidth) - width) / 2,
      top: (Number(boxHeight) - visibleHeight * scale) / 2 - safeCropTop * scale,
      width,
      height,
      scale,
      cropTop: safeCropTop
    };
  }

  return { MAX_WINDOWS, MAX_HORIZONTAL_SCALE, CHROME_HEIGHT, containedMediaRect, manualPanelLimits, resizedPanelSize, requiredCanvasScaleForPanel, shouldZoomBeyondOriginal, requiredHorizontalScale, requiredHorizontalScaleForWidths, horizontalSlots, horizontalSlotsForWidths, fittedPanelSize, concavePanelPose };
});
