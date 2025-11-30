/**
 * Tabs Module
 *
 * Handles tab switching and navigation between different views.
 */

import { getElements } from './dom-elements.js';
import { state } from './state.js';
import { removeCropRectangle } from './crop-mode.js';
import { populateVectorDebugPanel } from './metadata.js';

// ============================================
// Tab Switching
// ============================================

export function switchTab(tabName) {
  const elements = getElements();

  // If switching away from export tab and crop mode is enabled, disable it
  if (state.cropModeEnabled) {
    state.cropModeEnabled = false;
    elements.cropModeLabel.textContent = 'Crop';
    elements.cropModeBtn.style.background = '';
    elements.cropControls.style.display = 'none';
    removeCropRectangle();
    elements.mapPreviewDiv.addEventListener('mousedown', window.startPan);
  }

  // Hide all tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Remove active state from all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show the selected tab panel
  const panel = document.getElementById(`${tabName}-panel`);
  if (panel) {
    panel.classList.add('active');
  }

  // Activate the selected tab button
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
  }

  // Toggle between map preview and vector debug panel
  if (tabName === 'metadata') {
    elements.mapPreviewPanel.style.display = 'none';
    elements.vectorDebugPanel.style.display = 'flex';
    populateVectorDebugPanel();
  } else {
    elements.mapPreviewPanel.style.display = 'flex';
    elements.vectorDebugPanel.style.display = 'none';
  }

  // Force a layout recalculation
  if (panel) {
    void panel.offsetHeight;
  }
}

/**
 * Initialize tab button click handlers
 */
export function initializeTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;
      const tabName = button.getAttribute('data-tab');
      if (tabName) {
        switchTab(tabName);
      }
    });
  });
}
