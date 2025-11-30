/**
 * Crop Mode Module
 *
 * Handles crop functionality including:
 * - Crop rectangle creation and manipulation
 * - Drag handling
 * - Applying crop with vpype
 */

import { state } from './state.js';
import { getElements } from './dom-elements.js';
import { updateMapStats } from './stats.js';
import { generateSVG, startPan } from './map-preview.js';

// ============================================
// Crop Mode Toggle
// ============================================

export function toggleCropMode() {
  const elements = getElements();
  state.cropModeEnabled = !state.cropModeEnabled;

  if (state.cropModeEnabled) {
    elements.cropModeLabel.textContent = 'Disable Crop';
    elements.cropModeBtn.style.background = '#dc3545';
    elements.cropControls.style.display = 'block';

    createCropRectangle();

    elements.mapPreviewDiv.removeEventListener('mousedown', startPan);
    updateMapStats();
  } else {
    elements.cropModeLabel.textContent = 'Crop';
    elements.cropModeBtn.style.background = '';
    elements.cropControls.style.display = 'none';

    removeCropRectangle();

    elements.mapPreviewDiv.addEventListener('mousedown', startPan);
    updateMapStats();
  }
}

// ============================================
// Crop Rectangle Management
// ============================================

export function createCropRectangle() {
  const { mapPreviewDiv } = getElements();
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  const pageBoxes = state.currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;

  let referenceWidth;
  if (cropBoxData) {
    referenceWidth = cropBoxData.width;
  } else {
    referenceWidth = vbWidth;
  }

  const mmToSVGRatio = referenceWidth / 1000;
  const rectWidth = state.cropWidth * mmToSVGRatio * state.cropScale;
  const rectHeight = state.cropHeight * mmToSVGRatio * state.cropScale;

  state.cropX = vbMinX + (vbWidth - rectWidth) / 2;
  state.cropY = vbMinY + (vbHeight - rectHeight) / 2;

  const cropGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  cropGroup.id = 'crop-overlay';
  cropGroup.style.pointerEvents = 'all';

  state.cropRectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  state.cropRectangle.setAttribute('id', 'crop-rectangle');
  state.cropRectangle.setAttribute('x', state.cropX);
  state.cropRectangle.setAttribute('y', state.cropY);
  state.cropRectangle.setAttribute('width', rectWidth);
  state.cropRectangle.setAttribute('height', rectHeight);
  state.cropRectangle.setAttribute('fill', 'rgba(255, 0, 0, 0.05)');
  state.cropRectangle.setAttribute('stroke', '#ff0000');
  state.cropRectangle.setAttribute('stroke-width', '3');
  state.cropRectangle.setAttribute('stroke-dasharray', '10,5');
  state.cropRectangle.style.cursor = 'move';
  state.cropRectangle.style.pointerEvents = 'all';

  const handleSize = 12;
  const corners = [
    { x: 0, y: 0, cursor: 'nw-resize' },
    { x: 1, y: 0, cursor: 'ne-resize' },
    { x: 0, y: 1, cursor: 'sw-resize' },
    { x: 1, y: 1, cursor: 'se-resize' }
  ];

  corners.forEach((corner, index) => {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    handle.setAttribute('width', handleSize);
    handle.setAttribute('height', handleSize);
    handle.setAttribute('fill', '#ff0000');
    handle.setAttribute('stroke', '#ffffff');
    handle.setAttribute('stroke-width', '2');
    handle.style.cursor = corner.cursor;
    handle.style.pointerEvents = 'all';
    handle.dataset.corner = index;
    cropGroup.appendChild(handle);
  });

  cropGroup.appendChild(state.cropRectangle);
  svgElement.appendChild(cropGroup);

  state.cropRectangle.addEventListener('mousedown', startCropDrag);

  updatePositionDisplay();
  updateActualSizeDisplay();
}

export function removeCropRectangle() {
  const { mapPreviewDiv } = getElements();
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const cropGroup = svgElement.querySelector('#crop-overlay');
  if (cropGroup) {
    cropGroup.remove();
  }
  state.cropRectangle = null;
}

// ============================================
// Drag Handling
// ============================================

function startCropDrag(e) {
  e.preventDefault();
  e.stopPropagation();

  state.isDraggingCrop = true;

  const { mapPreviewDiv } = getElements();
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);
  const svgRect = svgElement.getBoundingClientRect();

  const mouseX = e.clientX - svgRect.left;
  const mouseY = e.clientY - svgRect.top;

  const scaleX = vbWidth / svgRect.width;
  const scaleY = vbHeight / svgRect.height;

  const mouseSVGX = vbMinX + (mouseX * scaleX);
  const mouseSVGY = vbMinY + (mouseY * scaleY);

  state.cropDragStartX = mouseSVGX - state.cropX;
  state.cropDragStartY = mouseSVGY - state.cropY;

  document.addEventListener('mousemove', handleCropDrag);
  document.addEventListener('mouseup', endCropDrag);
}

function handleCropDrag(e) {
  if (!state.isDraggingCrop) return;

  const { mapPreviewDiv } = getElements();
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement || !state.cropRectangle) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);
  const svgRect = svgElement.getBoundingClientRect();

  const mouseX = e.clientX - svgRect.left;
  const mouseY = e.clientY - svgRect.top;

  const scaleX = vbWidth / svgRect.width;
  const scaleY = vbHeight / svgRect.height;

  const mouseSVGX = vbMinX + (mouseX * scaleX);
  const mouseSVGY = vbMinY + (mouseY * scaleY);

  state.cropX = mouseSVGX - state.cropDragStartX;
  state.cropY = mouseSVGY - state.cropDragStartY;

  const rectWidth = parseFloat(state.cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(state.cropRectangle.getAttribute('height'));
  state.cropX = Math.max(vbMinX, Math.min(state.cropX, vbMinX + vbWidth - rectWidth));
  state.cropY = Math.max(vbMinY, Math.min(state.cropY, vbMinY + vbHeight - rectHeight));

  state.cropRectangle.setAttribute('x', state.cropX);
  state.cropRectangle.setAttribute('y', state.cropY);

  updateCornerHandles();
  updatePositionDisplay();
  updateMapStats();
}

function endCropDrag() {
  state.isDraggingCrop = false;
  document.removeEventListener('mousemove', handleCropDrag);
  document.removeEventListener('mouseup', endCropDrag);
}

// ============================================
// UI Updates
// ============================================

function updateCornerHandles() {
  const { mapPreviewDiv } = getElements();
  const cropGroup = mapPreviewDiv.querySelector('#crop-overlay');
  if (!cropGroup || !state.cropRectangle) return;

  const handles = cropGroup.querySelectorAll('rect:not(#crop-rectangle)');
  const rectWidth = parseFloat(state.cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(state.cropRectangle.getAttribute('height'));
  const handleSize = 12;

  const positions = [
    { x: state.cropX - handleSize / 2, y: state.cropY - handleSize / 2 },
    { x: state.cropX + rectWidth - handleSize / 2, y: state.cropY - handleSize / 2 },
    { x: state.cropX - handleSize / 2, y: state.cropY + rectHeight - handleSize / 2 },
    { x: state.cropX + rectWidth - handleSize / 2, y: state.cropY + rectHeight - handleSize / 2 }
  ];

  handles.forEach((handle, index) => {
    if (positions[index]) {
      handle.setAttribute('x', positions[index].x);
      handle.setAttribute('y', positions[index].y);
    }
  });
}

function updatePositionDisplay() {
  const { cropPositionDisplay, mapPreviewDiv } = getElements();

  if (!state.cropRectangle) {
    cropPositionDisplay.textContent = 'Drag rectangle to position';
    return;
  }

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth] = viewBox.split(' ').map(parseFloat);

  const pageBoxes = state.currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;

  let referenceWidth = cropBoxData ? cropBoxData.width : vbWidth;
  const mmToSVGRatio = referenceWidth / 1000;

  const xMM = Math.round((state.cropX - vbMinX) / mmToSVGRatio);
  const yMM = Math.round((state.cropY - vbMinY) / mmToSVGRatio);

  cropPositionDisplay.textContent = `X: ${xMM}mm, Y: ${yMM}mm`;
}

function updateActualSizeDisplay() {
  const { cropActualSize } = getElements();
  const actualWidth = Math.round(state.cropWidth * state.cropScale);
  const actualHeight = Math.round(state.cropHeight * state.cropScale);
  cropActualSize.textContent = `${actualWidth} x ${actualHeight} mm`;
}

export function updateCropDimensions() {
  const { cropWidthInput, cropHeightInput, mapPreviewDiv } = getElements();

  state.cropWidth = parseFloat(cropWidthInput.value) || 300;
  state.cropHeight = parseFloat(cropHeightInput.value) || 400;

  if (!state.cropRectangle) return;

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth] = viewBox.split(' ').map(parseFloat);

  const pageBoxes = state.currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;

  let referenceWidth = cropBoxData ? cropBoxData.width : vbWidth;
  const mmToSVGRatio = referenceWidth / 1000;
  const rectWidth = state.cropWidth * mmToSVGRatio * state.cropScale;
  const rectHeight = state.cropHeight * mmToSVGRatio * state.cropScale;

  state.cropRectangle.setAttribute('width', rectWidth);
  state.cropRectangle.setAttribute('height', rectHeight);

  updateCornerHandles();
  updatePositionDisplay();
  updateActualSizeDisplay();
  updateMapStats();
}

export function updateCropScale() {
  const { cropScaleSlider, cropScaleValue } = getElements();
  const scalePercent = parseFloat(cropScaleSlider.value);
  state.cropScale = scalePercent / 100;
  cropScaleValue.textContent = scalePercent;

  updateCropDimensions();
}

// ============================================
// Apply Crop with vpype
// ============================================

export async function applyCrop() {
  const { mapPreviewDiv, whiteBackgroundCheck, exportSvgBtn } = getElements();

  if (!state.cropRectangle) {
    updateMapStats('Error: Please enable crop mode first');
    return;
  }

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) {
    updateMapStats('Error: No map preview available');
    return;
  }

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY] = viewBox.split(' ').map(parseFloat);

  const rectWidth = parseFloat(state.cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(state.cropRectangle.getAttribute('height'));

  const PT_TO_MM = 0.352778;
  const xMM = (state.cropX - vbMinX) * PT_TO_MM;
  const yMM = (state.cropY - vbMinY) * PT_TO_MM;
  const widthMM = rectWidth * PT_TO_MM;
  const heightMM = rectHeight * PT_TO_MM;

  updateMapStats('Checking for vpype...');

  const vpypeCheck = await window.electronAPI.checkVpype();
  if (!vpypeCheck.installed) {
    updateMapStats('Error: vpype is not installed. Please install vpype to use crop functionality.');
    return;
  }

  updateMapStats('Generating SVG...');

  let svgContent;

  if (window.electronAPI && window.electronAPI.generateSVG) {
    try {
      const svgResult = await window.electronAPI.generateSVG({
        enabledLayers: Array.from(state.enabledLayers),
        bounds: state.cachedBounds,
        options: { whiteBackground: whiteBackgroundCheck?.checked || false }
      });

      if (svgResult.success) {
        svgContent = svgResult.svg;
      } else if (state.currentPDFData?.contentPaths?.paths) {
        svgContent = generateSVG(true);
      }
    } catch (err) {
      if (state.currentPDFData?.contentPaths?.paths) {
        svgContent = generateSVG(true);
      }
    }
  } else if (state.currentPDFData?.contentPaths?.paths) {
    svgContent = generateSVG(true);
  }

  if (!svgContent) {
    updateMapStats('Error: Failed to generate SVG');
    return;
  }

  updateMapStats('Running vpype crop...');

  try {
    const result = await window.electronAPI.cropWithVpype({
      svgContent,
      cropX: xMM,
      cropY: yMM,
      cropWidth: widthMM,
      cropHeight: heightMM,
      paperSize: 'original'
    });

    if (!result.success) {
      updateMapStats(`Error: vpype failed - ${result.error}`);
      return;
    }

    const fileName = state.currentFilePath ? state.currentFilePath.split('/').pop().replace('.pdf', '') : 'map';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const croppedFileName = `cropped-${fileName}-${timestamp}.svg`;

    updateMapStats('Saving file...');

    const gellyScapePath = await window.electronAPI.getGellyScapePath();
    const fullPath = `${gellyScapePath}/${croppedFileName}`;

    const writeResult = await window.electronAPI.saveFile({
      filePath: fullPath,
      content: result.svg
    });

    if (writeResult.success) {
      const layerInfo = result.layersProcessed ? ` (${result.layersProcessed} layers)` : '';

      state.lastSavedFilePath = fullPath;
      state.cropApplied = true;

      exportSvgBtn.disabled = false;

      updateMapStats(`Crop complete! Saved ${layerInfo}`);
    } else {
      updateMapStats(`Error: Failed to save - ${writeResult.error}`);
    }
  } catch (error) {
    updateMapStats(`Error: ${error.message}`);
  }
}
