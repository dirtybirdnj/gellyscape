/**
 * UI Helpers Module
 *
 * Utility functions for UI interactions including:
 * - Loading indicators
 * - Color swatches and tooltips
 * - Status messages
 * - Formatting utilities
 */

import { state } from './state.js';
import { getElements } from './dom-elements.js';

// ============================================
// Loading Indicator
// ============================================

export function showLoadingGear() {
  const { loadingGear } = getElements();
  if (loadingGear) {
    loadingGear.classList.add('spinning');
  }
}

export function hideLoadingGear() {
  const { loadingGear } = getElements();
  if (loadingGear) {
    loadingGear.classList.remove('spinning');
  }
}

// ============================================
// Color Utilities
// ============================================

/**
 * Convert RGB string to hex
 */
export function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return rgbStr;
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Create or get the color tooltip element
 */
export function getColorTooltip() {
  if (!state.colorTooltip) {
    state.colorTooltip = document.createElement('div');
    state.colorTooltip.className = 'color-tooltip';
    document.body.appendChild(state.colorTooltip);
  }
  return state.colorTooltip;
}

/**
 * Show tooltip for a color swatch
 */
export function showColorTooltip(swatch, color) {
  const tooltip = getColorTooltip();
  const hex = rgbToHex(color);
  tooltip.innerHTML = `${hex}<br>${color}`;

  const rect = swatch.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 8}px`;
  tooltip.style.transform = 'translate(-50%, -100%)';
  tooltip.classList.add('visible');
}

/**
 * Hide the color tooltip
 */
export function hideColorTooltip() {
  const tooltip = getColorTooltip();
  tooltip.classList.remove('visible');
}

/**
 * Copy color to clipboard and show feedback
 */
export async function copyColorToClipboard(color, event) {
  const hex = rgbToHex(color);
  try {
    await navigator.clipboard.writeText(hex);
    showCopyFeedback(event, `Copied ${hex}`);
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = hex;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showCopyFeedback(event, `Copied ${hex}`);
  }
}

/**
 * Show copy feedback popup
 */
export function showCopyFeedback(event, message) {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = message;
  feedback.style.left = `${event.clientX}px`;
  feedback.style.top = `${event.clientY - 30}px`;
  feedback.style.transform = 'translateX(-50%)';
  document.body.appendChild(feedback);

  setTimeout(() => {
    feedback.remove();
  }, 1500);
}

/**
 * Show color picker for changing a layer's color
 */
export function showColorPicker(layerName, currentColor, swatch, onColorChange) {
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = rgbToHex(currentColor);
  picker.style.position = 'absolute';
  picker.style.opacity = '0';
  picker.style.pointerEvents = 'none';
  document.body.appendChild(picker);

  picker.addEventListener('input', (e) => {
    const newColor = e.target.value;
    swatch.style.background = newColor;
    if (!window.layerColorOverrides) {
      window.layerColorOverrides = {};
    }
    window.layerColorOverrides[layerName] = newColor;
    if (onColorChange) {
      onColorChange();
    }
  });

  picker.addEventListener('change', () => {
    setTimeout(() => picker.remove(), 100);
  });

  picker.click();
}

// ============================================
// Status Messages
// ============================================

export function showStatus(message, type) {
  const { statusDiv } = getElements();
  statusDiv.innerHTML = message.replace(/\n/g, '<br>');
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

export function hideStatus() {
  const { statusDiv } = getElements();
  statusDiv.style.display = 'none';
}

export function showStatusWithProgress(message, type) {
  const { statusDiv } = getElements();
  statusDiv.innerHTML = `
    <div style="margin-bottom: 10px; font-weight: 600;">${message}</div>
    <div style="margin-bottom: 8px; font-size: 0.85em; color: #666;">This may take 1-2 minutes for large files. Please wait...</div>
    <div style="width: 100%; background: #e0e0e0; border-radius: 4px; overflow: hidden; height: 12px; position: relative;">
      <div class="progress-bar" style="width: 100%; height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #667eea 100%); background-size: 200% 100%; animation: progressAnimation 1.5s linear infinite;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 0.75em; color: #999; text-align: center;">Processing PDF layers and content streams...</div>
  `;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';

  // Add keyframes if not already added
  if (!document.getElementById('progress-animation-style')) {
    const style = document.createElement('style');
    style.id = 'progress-animation-style';
    style.textContent = `
      @keyframes progressAnimation {
        0% { background-position: 0% 0%; }
        100% { background-position: 200% 0%; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(style);
  }
}

export function showExportStatus(message, type) {
  const { exportStatusDiv } = getElements();
  exportStatusDiv.textContent = message;
  exportStatusDiv.className = `export-status ${type}`;
}

export function hideExportStatus() {
  const { exportStatusDiv } = getElements();
  exportStatusDiv.className = 'export-status';
}

// ============================================
// Formatting Utilities
// ============================================

export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export function formatDate(dateString) {
  if (!dateString) return 'Unknown';

  try {
    // PDF dates are in format: D:YYYYMMDDHHmmSS
    if (dateString.startsWith('D:')) {
      const year = dateString.substring(2, 6);
      const month = dateString.substring(6, 8);
      const day = dateString.substring(8, 10);
      return `${year}-${month}-${day}`;
    }

    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }

    return dateString;
  } catch (error) {
    return dateString;
  }
}

export function formatMemorySize(kb) {
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  } else if (kb < 1024 * 1024) {
    return `${(kb / 1024).toFixed(1)} MB`;
  } else {
    return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  }
}

/**
 * Estimate memory usage from path data
 */
export function estimateMemoryUsage(pathCount, layerCount) {
  const pathMemory = pathCount * 0.2;
  const layerOverhead = layerCount * 2;
  const baseOverhead = 100;
  return Math.round(pathMemory + layerOverhead + baseOverhead);
}

// ============================================
// Collapsible Sections
// ============================================

export function toggleCollapse(contentId) {
  const content = document.getElementById(contentId);
  const icon = document.getElementById(`${contentId}-icon`);

  if (content && icon) {
    content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed');
  }
}

// Make toggleCollapse available globally for inline onclick handlers
window.toggleCollapse = toggleCollapse;
