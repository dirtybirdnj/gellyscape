/**
 * Export Module
 *
 * Handles export functionality including:
 * - SVG export
 * - Text extraction and export
 */

import { state } from './state.js';
import { getElements } from './dom-elements.js';
import { showLoadingGear, hideLoadingGear } from './ui-helpers.js';
import { updateMapStats } from './stats.js';

// ============================================
// SVG Export
// ============================================

export async function handleExportSVG() {
  const { whiteBackgroundCheck } = getElements();

  // If crop was applied, open the file in Finder
  if (state.cropApplied && state.lastSavedFilePath) {
    try {
      await window.electronAPI.showInFinder(state.lastSavedFilePath);
      updateMapStats('Opening file in Finder...');
    } catch (error) {
      console.error('Error opening file in Finder:', error);
      updateMapStats(`Error: Could not open file - ${error.message}`);
    }
    return;
  }

  if (state.enabledLayers.size === 0) {
    updateMapStats('Error: No layers selected for export');
    return;
  }

  showLoadingGear();
  updateMapStats('Generating SVG...');

  try {
    const svgResult = await window.electronAPI.generateSVG({
      enabledLayers: Array.from(state.enabledLayers),
      bounds: state.cachedBounds,
      options: { whiteBackground: whiteBackgroundCheck?.checked || false }
    });

    if (!svgResult.success) {
      updateMapStats(`Error: ${svgResult.error}`);
      hideLoadingGear();
      return;
    }

    const defaultName = state.currentFilePath
      ? state.currentFilePath.split('/').pop().replace('.pdf', '_export.svg')
      : 'map_export.svg';

    const savePath = await window.electronAPI.showSaveDialog({
      title: 'Save SVG',
      defaultPath: defaultName,
      filters: [{ name: 'SVG Files', extensions: ['svg'] }]
    });

    if (!savePath) {
      updateMapStats('Export cancelled');
      hideLoadingGear();
      return;
    }

    const writeResult = await window.electronAPI.writeFile({
      filePath: savePath,
      content: svgResult.svg
    });

    if (writeResult.success) {
      state.lastSavedFilePath = savePath;
      updateMapStats(`Exported ${svgResult.stats.pathCount.toLocaleString()} paths to SVG`);
      await window.electronAPI.showInFinder(savePath);
    } else {
      updateMapStats(`Error: Failed to save - ${writeResult.error}`);
    }
  } catch (error) {
    console.error('Export error:', error);
    updateMapStats(`Error: ${error.message}`);
  } finally {
    hideLoadingGear();
  }
}

// ============================================
// Text Extraction
// ============================================

export async function handleExtractText() {
  const { extractTextBtn, exportTextJsonBtn, exportTextSvgBtn, textCountBadge, textElementListDiv } = getElements();

  if (!state.currentFilePath) {
    console.log("No PDF loaded");
    return;
  }

  showLoadingGear();

  if (extractTextBtn) {
    extractTextBtn.disabled = true;
    extractTextBtn.textContent = "Extracting...";
  }

  try {
    const result = await window.electronAPI.extractText(state.currentFilePath);

    if (result.success) {
      state.extractedTextData = result.data;
      displayExtractedText(result.data);

      if (exportTextJsonBtn) exportTextJsonBtn.disabled = false;
      if (exportTextSvgBtn) exportTextSvgBtn.disabled = false;

      if (textCountBadge) {
        textCountBadge.textContent = `(${result.data.textElements?.length || 0})`;
      }
    } else {
      console.error("Text extraction failed:", result.error);
      if (textElementListDiv) {
        textElementListDiv.innerHTML = `<div style="color: #dc3545; font-size: 0.85em;">Error: ${result.error}</div>`;
      }
    }
  } catch (error) {
    console.error("Text extraction error:", error);
    if (textElementListDiv) {
      textElementListDiv.innerHTML = `<div style="color: #dc3545; font-size: 0.85em;">Error: ${error.message}</div>`;
    }
  } finally {
    hideLoadingGear();
    if (extractTextBtn) {
      extractTextBtn.disabled = false;
      extractTextBtn.textContent = "Extract";
    }
  }
}

function displayExtractedText(data) {
  const { fontListDiv, textElementListDiv, textElementCountSpan } = getElements();

  // Display fonts
  if (fontListDiv && data.fonts) {
    if (data.fonts.length > 0) {
      fontListDiv.innerHTML = data.fonts.map(font => `
        <div style="padding: 4px 8px; margin-bottom: 4px; background: white; border-radius: 4px; border: 1px solid #e0e4ff; font-size: 0.8em;">
          <div style="font-weight: 600; color: #333;">${font.name || font.ref}</div>
          <div style="font-size: 0.9em; color: #666;">
            ${font.baseFont ? `Base: ${font.baseFont}` : ""}
            ${font.encoding ? ` - Encoding: ${font.encoding}` : ""}
            ${font.subtype ? ` - Type: ${font.subtype}` : ""}
          </div>
        </div>
      `).join("");
    } else {
      fontListDiv.innerHTML = `<div style="color: #999; font-size: 0.85em; font-style: italic;">No embedded fonts found</div>`;
    }
  }

  // Display text elements
  if (textElementListDiv && data.textElements) {
    if (textElementCountSpan) {
      textElementCountSpan.textContent = `(${data.textElements.length})`;
    }

    if (data.textElements.length > 0) {
      const byLayer = {};
      data.textElements.forEach(el => {
        const layer = el.layer || "Unassigned";
        if (!byLayer[layer]) byLayer[layer] = [];
        byLayer[layer].push(el);
      });

      let html = "";
      Object.entries(byLayer).forEach(([layer, elements]) => {
        html += `
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 0.8em; color: #667eea; margin-bottom: 4px; padding: 4px 8px; background: #f0f2ff; border-radius: 4px;">
              ${layer} <span style="color: #999; font-weight: normal;">(${elements.length})</span>
            </div>
        `;

        elements.slice(0, 50).forEach(el => {
          const displayText = el.text.length > 40 ? el.text.substring(0, 40) + "..." : el.text;
          const posInfo = `(${el.x?.toFixed(1) || "?"}, ${el.y?.toFixed(1) || "?"})`;

          html += `
            <div style="padding: 4px 8px; margin-bottom: 2px; background: white; border-radius: 3px; border: 1px solid #eee; font-size: 0.75em; display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #333; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${el.text}">${displayText}</span>
              <span style="color: #999; font-size: 0.9em; margin-left: 8px; flex-shrink: 0;">${posInfo}</span>
            </div>
          `;
        });

        if (elements.length > 50) {
          html += `<div style="color: #999; font-size: 0.75em; font-style: italic; padding: 4px 8px;">... and ${elements.length - 50} more</div>`;
        }

        html += `</div>`;
      });

      textElementListDiv.innerHTML = html;
    } else {
      textElementListDiv.innerHTML = `<div style="color: #999; font-size: 0.85em; font-style: italic;">No text elements found</div>`;
    }
  }
}

export async function handleExportTextJson() {
  if (!state.extractedTextData) return;

  try {
    const defaultName = state.currentFilePath
      ? state.currentFilePath.split("/").pop().replace(".pdf", "_text.json")
      : "text_export.json";

    const savePath = await window.electronAPI.showSaveDialog({
      title: "Save Text Data as JSON",
      defaultPath: defaultName,
      filters: [{ name: "JSON Files", extensions: ["json"] }]
    });

    if (!savePath) return;

    const jsonContent = JSON.stringify(state.extractedTextData, null, 2);
    const writeResult = await window.electronAPI.writeFile({
      filePath: savePath,
      content: jsonContent
    });

    if (writeResult.success) {
      console.log("Text data exported to:", savePath);
      await window.electronAPI.showInFinder(savePath);
    }
  } catch (error) {
    console.error("Export error:", error);
  }
}

export async function handleExportTextSvg() {
  if (!state.extractedTextData) return;

  console.log("Text to SVG path export - not yet implemented");
  alert("Text to SVG path export is not yet implemented.\nUse JSON export to get text positions for your text rendering service.");
}
