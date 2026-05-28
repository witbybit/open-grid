/**
 * Structural and Visual CSS Styles for Open Grid.
 * Decoupled from core RenderEngine to allow direct customization slots.
 */
export const CORE_STYLES = `
  :root, .og-grid-container {
    --og-font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
    --og-bg-color: #0d0f12;
    --og-text-color: #e2e8f0;
    --og-border-color: #1e293b;
    --og-header-bg: #090a0f;
    --og-header-text: #94a3b8;
    --og-row-hover-bg: #161b22;
    --og-cell-border: rgba(30, 41, 59, 0.5);
    --og-selection-border: rgba(59, 130, 246, 0.6);
    --og-selection-bg: rgba(59, 130, 246, 0.04);
    --og-focus-ring: #3b82f6;

    /* Skeletons Styling */
    --og-skeleton-start: #1e293b;
    --og-skeleton-mid: #334155;
    --og-skeleton-end: #1e293b;
    --og-skeleton-width: 75%;
    --og-skeleton-height: 14px;
    --og-skeleton-border-radius: 4px;
    --og-skeleton-animation-duration: 1.5s;

    /* Group & Detail Rows Styling */
    --og-group-row-bg: rgba(15, 23, 42, 0.4);
    --og-group-row-hover-bg: rgba(30, 41, 59, 0.6);
    --og-group-row-text: #e2e8f0;
    --og-group-row-font-size: 13px;
    --og-group-row-font-weight: 600;
    --og-group-badge-bg: rgba(59, 130, 246, 0.2);
    --og-group-badge-border: rgba(59, 130, 246, 0.4);
    --og-group-badge-text: #60a5fa;
    --og-detail-row-bg: rgba(255, 255, 255, 0.02);
    --og-detail-row-border: rgba(255, 255, 255, 0.05);
    --og-detail-row-text: #a0aec0;
    --og-detail-row-font-size: 12px;
  }

  @keyframes og-shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  .og-cell-loading-skeleton {
    width: var(--og-skeleton-width);
    height: var(--og-skeleton-height);
    border-radius: var(--og-skeleton-border-radius);
    background: linear-gradient(90deg, 
      var(--og-skeleton-start) 25%, 
      var(--og-skeleton-mid) 50%, 
      var(--og-skeleton-end) 75%
    );
    background-size: 200% 100%;
    animation: og-shimmer var(--og-skeleton-animation-duration) infinite linear;
  }

  .og-row-loading {
    pointer-events: none;
  }

  .og-grid-container {
    position: relative;
    overflow: hidden;
    contain: strict;
    font-family: var(--og-font-family);
    background-color: var(--og-bg-color);
    color: var(--og-text-color);
    border: 1px solid var(--og-border-color);
    border-radius: 8px;
    box-sizing: border-box;
  }

  .og-scroll-viewport {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: auto;
    contain: strict;
    will-change: transform;
    z-index: 10;
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .og-scroll-spacer {
    grid-area: 1 / 1 / 2 / 2;
    pointer-events: none;
  }

  .og-layer-center {
    grid-area: 1 / 1 / 2 / 2;
    pointer-events: auto;
    z-index: 10;
    margin-top: 40px;
  }

  .og-layer-left {
    grid-area: 1 / 1 / 2 / 2;
    position: sticky;
    left: 0;
    z-index: 15;
    pointer-events: auto;
    margin-top: 40px;
  }

  .og-layer-right {
    grid-area: 1 / 1 / 2 / 2;
    position: sticky;
    right: 0;
    justify-self: end;
    z-index: 15;
    pointer-events: auto;
    margin-top: 40px;
  }

  .og-layer-header {
    grid-area: 1 / 1 / 2 / 2;
    position: sticky;
    top: 0;
    height: 40px;
    z-index: 30;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    background-color: var(--og-header-bg);
  }

  .og-layer-header-left {
    grid-area: 1 / 1 / 2 / 2;
    position: sticky;
    top: 0;
    left: 0;
    height: 40px;
    z-index: 35;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    background-color: var(--og-header-bg);
  }

  .og-layer-header-right {
    grid-area: 1 / 1 / 2 / 2;
    position: sticky;
    top: 0;
    right: 0;
    justify-self: end;
    height: 40px;
    z-index: 35;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    background-color: var(--og-header-bg);
  }

  .og-layer-overlay {
    position: absolute;
    top: 40px;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    pointer-events: none;
    overflow: hidden;
  }

  .og-row {
    position: absolute;
    left: 0;
    width: 100%;
    contain: layout style;
    border-bottom: 1px solid var(--og-border-color);
    background-color: var(--og-bg-color);
    box-sizing: border-box;
    transition: background-color 0.15s ease;
  }

  .og-row:hover,
  .og-row-hovered {
    background-color: var(--og-row-hover-bg);
  }

  .og-row-selected {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-focused {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-pinned-top {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-bottom: 2px solid var(--og-border-color) !important;
  }

  .og-row-pinned-bottom {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-top: 2px solid var(--og-border-color) !important;
  }

  .og-cell {
    position: absolute;
    top: 0;
    height: 100%;
    contain: layout style;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--og-cell-border);
  }

  .og-cell-portal-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .og-cell-focused {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: -2px;
    background-color: var(--og-selection-bg);
    z-index: 20;
  }

  .og-cell-selected {
    background-color: var(--og-selection-bg);
  }

  .og-cell-editor {
    position: absolute;
    inset: 0;
    z-index: 30;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 0 12px;
    border: 2px solid var(--og-focus-ring);
    outline: none;
    background: var(--og-bg);
    color: var(--og-text);
    font: inherit;
  }

  .og-header-cell {
    position: absolute;
    top: 0;
    height: 100%;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--og-header-text);
    border-right: 1px solid var(--og-border-color);
    box-sizing: border-box;
    user-select: none;
  }

  .og-header-cell-movable {
    cursor: grab;
  }

  .og-header-cell-dragging {
    cursor: grabbing;
    opacity: 0.62;
    background-color: color-mix(in srgb, var(--og-focus-ring) 12%, var(--og-header-bg));
  }

  .og-column-drop-indicator {
    position: absolute;
    top: 0;
    width: 3px;
    background-color: var(--og-focus-ring);
    border-radius: 999px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25), 0 0 12px var(--og-focus-ring);
    pointer-events: none;
    z-index: 60;
  }

  .og-column-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    max-width: min(260px, calc(100vw - 24px));
    padding: 7px 11px;
    border: 1px solid color-mix(in srgb, var(--og-focus-ring) 52%, rgba(255, 255, 255, 0.24));
    border-radius: 8px;
    background: color-mix(in srgb, var(--og-header-bg) 88%, var(--og-focus-ring));
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
    color: var(--og-header-text);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    line-height: 1.1;
    overflow: hidden;
    pointer-events: none;
    text-overflow: ellipsis;
    text-transform: uppercase;
    user-select: none;
    white-space: nowrap;
    z-index: 2147483647;
  }

  .og-selection-border {
    position: absolute;
    border: 2px dashed var(--og-selection-border);
    background-color: var(--og-selection-bg);
    box-sizing: border-box;
    pointer-events: none;
  }

  /* Selection Fill Handle Style */
  .og-selection-fill-handle {
    position: absolute;
    bottom: -4.5px;
    right: -4.5px;
    width: 9px;
    height: 9px;
    background-color: var(--og-focus-ring, #3b82f6);
    border: 1px solid #ffffff;
    border-radius: 1.5px;
    cursor: crosshair;
    pointer-events: auto;
    z-index: 50;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.1s ease, background-color 0.1s ease;
  }

  .og-selection-fill-handle:hover {
    transform: scale(1.35);
    background-color: #2563eb;
  }

  /* Fill Preview Border Style */
  .og-fill-preview-border {
    position: absolute;
    border: 2px dashed rgba(168, 85, 247, 0.75); /* Glowing Purple drag fill preview */
    background-color: rgba(168, 85, 247, 0.06);
    box-sizing: border-box;
    pointer-events: none;
    z-index: 45;
  }

  .og-header-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    transition: background-color 0.15s ease;
  }

  .og-header-resize-handle:hover {
    background-color: var(--og-focus-ring);
  }

  /* Premium Glassmorphic Context Menu styles */
  .og-context-menu {
    position: fixed;
    z-index: 1000;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    padding: 6px 0;
    min-width: 190px;
    font-family: var(--og-font-family), inherit;
    color: #f1f5f9;
    opacity: 0;
    transform: scale(0.95);
    transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
  }
  .og-context-menu.og-visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
  }
  .og-context-menu-item {
    display: flex;
    align-items: center;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .og-context-menu-item:hover {
    background-color: var(--og-focus-ring, #3b82f6);
    color: #ffffff;
  }
  .og-context-menu-divider {
    height: 1px;
    background-color: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }

  /* Group and Detail Rows */
  .og-group-row-content {
    display: flex;
    align-items: center;
    height: 100%;
    width: 100%;
    user-select: none;
    cursor: pointer;
    background-color: var(--og-group-row-bg);
    color: var(--og-group-row-text);
    font-size: var(--og-group-row-font-size);
    font-weight: var(--og-group-row-font-weight);
    transition: background-color 0.15s ease;
  }

  .og-group-row-content:hover {
    background-color: var(--og-group-row-hover-bg);
  }

  .og-group-row-toggle {
    margin-right: 8px;
    transition: transform 0.15s ease;
    display: inline-block;
  }

  .og-group-row-toggle-expanded {
    transform: rotate(90deg);
  }

  .og-group-row-label-prefix {
    opacity: 0.6;
    margin-right: 6px;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
  }

  .og-group-count {
    margin-left: 10px;
    background: var(--og-group-badge-bg);
    border: 1px solid var(--og-group-badge-border);
    color: var(--og-group-badge-text);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
  }

  .og-detail-row-content {
    display: flex;
    align-items: center;
    padding-left: 24px;
    height: 100%;
    width: 100%;
    background-color: var(--og-detail-row-bg);
    border-bottom: 1px dashed var(--og-detail-row-border);
    color: var(--og-detail-row-text);
    font-size: var(--og-detail-row-font-size);
    font-style: italic;
  }
`;
