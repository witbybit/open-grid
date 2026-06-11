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
    --og-leaf-header-height: 40px;
    --og-group-panel-height: 42px;
    --og-overlay-top: var(--og-leaf-header-height);

    /* Pin column boundary — border and shadow on the dividing edge.
       Override these vars to customise or disable the pin boundary visual. */
    --og-pin-left-border-color: rgba(255, 255, 255, 0.07);
    --og-pin-right-border-color: rgba(255, 255, 255, 0.07);
    --og-pin-left-shadow: 4px 0 14px rgba(0, 0, 0, 0.45);
    --og-pin-right-shadow: -4px 0 14px rgba(0, 0, 0, 0.45);

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

  @keyframes og-cell-flash {
    0%   { background-color: var(--og-copy-flash-color, rgba(99, 179, 237, 0.45)); }
    100% { background-color: transparent; }
  }

  .og-cell-flash {
    animation: og-cell-flash var(--og-copy-flash-duration, 380ms) ease-out;
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

  /*
   * Scroll viewport — single overflow container for both axes.
   * No CSS Grid: rows live in og-rows-container (block flow after the sticky header).
   */
  .og-scroll-viewport {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: auto;
    z-index: 10;
  }

  /* ── Group panel ─────────────────────────────────────────────────────── */

  .og-group-panel {
    position: sticky;
    top: 0;
    z-index: 31;
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 7px;
    padding: 7px 10px;
    min-height: var(--og-group-panel-height);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0)),
      var(--og-header-bg);
    border-bottom: 1px solid var(--og-border-color);
    overflow: hidden;
    box-sizing: border-box;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.035) inset;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }

  .og-group-panel-drop-active {
    background:
      linear-gradient(90deg, rgba(59, 130, 246, 0.16), rgba(167, 139, 250, 0.09)),
      var(--og-header-bg);
    border-bottom-color: rgba(59, 130, 246, 0.4);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.22) inset, 0 10px 28px rgba(0, 0, 0, 0.26);
  }

  .og-group-panel-empty {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 26px;
    padding: 0 8px;
    border: 1px dashed rgba(148, 163, 184, 0.22);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.26);
    font-size: 12px;
    color: var(--og-header-text);
    opacity: 0.82;
    pointer-events: none;
    user-select: none;
  }

  .og-group-panel-empty-icon {
    display: inline-flex;
    width: 18px;
    height: 18px;
    color: #93c5fd;
    opacity: 0.85;
  }

  .og-group-panel-label {
    flex: 0 0 auto;
    padding: 0 2px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    color: #64748b;
  }

  /* Drop position indicator within the panel */
  .og-group-panel-drop-indicator {
    position: absolute;
    top: 5px;
    bottom: 5px;
    width: 3px;
    background: #60a5fa;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 18px rgba(96, 165, 250, 0.9);
    pointer-events: none;
    display: none;
    z-index: 4;
  }

  /* Group-by chip */
  .og-group-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 190px;
    height: 26px;
    padding: 0 7px 0 6px;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.18), rgba(59, 130, 246, 0.1));
    border: 1px solid rgba(96, 165, 250, 0.38);
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #93c5fd;
    cursor: grab;
    user-select: none;
    white-space: nowrap;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset;
    transition: background 0.12s, border-color 0.12s, box-shadow 0.12s, opacity 0.12s, transform 0.12s;
  }

  .og-group-chip:hover {
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.28), rgba(59, 130, 246, 0.14));
    border-color: rgba(147, 197, 253, 0.62);
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.08) inset, 0 8px 18px rgba(0, 0, 0, 0.18);
  }

  .og-group-chip:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-group-chip:active,
  .og-group-panel-chip-dragging .og-group-chip {
    cursor: grabbing;
  }

  .og-group-chip-handle {
    display: inline-flex;
    align-items: center;
    opacity: 0.62;
    flex-shrink: 0;
    color: #93c5fd;
  }

  .og-group-chip-handle svg {
    width: 8px;
    height: 13px;
  }

  .og-group-chip-label {
    font-size: 12px;
    line-height: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .og-group-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: #93c5fd;
    opacity: 0.55;
    border-radius: 3px;
    flex-shrink: 0;
    transition: opacity 0.1s, background 0.1s;
  }

  .og-group-chip-remove:hover {
    opacity: 1;
    background: rgba(59, 130, 246, 0.25);
  }

  .og-group-chip-remove svg {
    width: 10px;
    height: 10px;
    pointer-events: none;
  }

  /* Drop-position highlights when reordering chips */
  .og-group-chip-drop-before {
    transform: translateX(3px);
    box-shadow: -4px 0 0 #60a5fa, 0 0 18px rgba(96, 165, 250, 0.3);
  }

  .og-group-chip-drop-after {
    transform: translateX(-3px);
    box-shadow: 4px 0 0 #60a5fa, 0 0 18px rgba(96, 165, 250, 0.3);
  }

  .og-group-chip-drag-source {
    opacity: 0.45;
  }

  .og-group-chip-separator {
    color: #475569;
    font-size: 16px;
    line-height: 1;
    flex: 0 0 auto;
  }

  /*
   * Header wrapper — sticky at the top of the scroll viewport.
   * Three absolutely-positioned child layers overlap inside it (center, left-pin, right-pin).
   */
  .og-layer-header-wrapper {
    position: sticky;
    top: 0;
    height: 40px;
    z-index: 30;
    overflow: hidden;
    flex-shrink: 0;
  }

  .og-layer-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    background-color: var(--og-header-bg);
  }

  .og-layer-header-left {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 5;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    border-right: 1px solid var(--og-pin-left-border-color);
    box-shadow: var(--og-pin-left-shadow);
    background-color: var(--og-header-bg);
  }

  .og-layer-header-right {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 5;
    pointer-events: auto;
    border-bottom: 2px solid var(--og-border-color);
    border-left: 1px solid var(--og-pin-right-border-color);
    box-shadow: var(--og-pin-right-shadow);
    background-color: var(--og-header-bg);
  }

  /*
   * Rows container — one compositor layer for all rows.
   * Rows are absolutely positioned inside; will-change here (not per-row) means
   * all rows share a single GPU texture instead of N individual layers.
   */
  .og-rows-container {
    position: relative;
    will-change: transform;
    pointer-events: auto;
  }

  .og-layer-sticky-groups {
    position: sticky;
    top: 0;
    left: 0;
    height: 0;
    z-index: 29;
    pointer-events: none;
  }

  .og-sticky-group-row-host {
    pointer-events: auto;
  }

  /*
   * Overlay — absolute, outside the scroll container so selection/focus rings
   * render over content without being clipped by overflow:auto.
   */
  .og-layer-overlay {
    position: absolute;
    top: var(--og-overlay-top);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    pointer-events: none;
    overflow: hidden;
  }

  /*
   * Row — absolutely positioned at top:0 inside og-rows-container and offset via
   * transform: translateY() (paint/composite-only; writing style.top invalidates
   * layout, and pinned/sticky rows reposition every scroll frame).
   * A 2D transform on .og-row does NOT break descendant position:sticky — sticky
   * resolves against the nearest scrollport, not the transformed ancestor (the FLIP
   * sort animation has always relied on this).
   * display:flex so the sticky pin containers (og-row-pin-left / og-row-pin-right)
   * can use margin-left:auto and position:sticky for zero-lag compositor pinning.
   * contain:style only (NOT layout) so that position:sticky propagates correctly
   * to the scroll viewport as the containing scroll ancestor.
   * No will-change — the compositor layer is on og-rows-container, not each row.
   */
  .og-row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: stretch;
    contain: style;
    border-bottom: 1px solid var(--og-border-color);
    background-color: var(--og-bg-color);
    box-sizing: border-box;
    transition: background-color 0.15s ease;
  }

  /*
   * Hover only matches while NOT scrolling (og-is-scrolling on the container during
   * scroll): the cursor sweeps dozens of rows per second during scroll, and each
   * :hover match + 150ms background transition is style-recalc and paint work stolen
   * from the frame budget. Transitions are likewise suspended during scroll.
   */
  .og-grid-container:not(.og-is-scrolling) .og-row:hover,
  .og-row-hovered {
    background-color: var(--og-row-hover-bg);
  }

  .og-is-scrolling .og-row {
    transition: none;
  }

  .og-row-portal-host {
    width: 100%;
    height: 100%;
  }

  .og-row-portal-host > * {
    width: 100%;
    height: 100%;
  }

  .og-row-selected {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-node-selected {
    background-color: var(--og-row-selected-bg, rgba(59, 130, 246, 0.08));
  }
  .og-row-node-selected .og-cell {
    background-color: inherit;
  }

  .og-row-focused {
    background-color: var(--og-selection-bg) !important;
  }

  .og-row-pinned-top {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-bottom: 2px solid var(--og-border-color) !important;
  }

  .og-row-group-sticky {
    background-color: color-mix(in srgb, var(--og-header-bg) 82%, #3b82f6);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.34), 0 1px 0 rgba(147, 197, 253, 0.22);
    border-bottom: 1px solid rgba(147, 197, 253, 0.28) !important;
  }

  .og-row-group-sticky .og-group-row-content {
    background:
      linear-gradient(90deg, rgba(59, 130, 246, 0.2), rgba(167, 139, 250, 0.1) 44%, rgba(15, 23, 42, 0.02)),
      var(--og-header-bg);
  }

  .og-row-group-sticky-depth-1 .og-group-row-content { padding-left: 20px; }
  .og-row-group-sticky-depth-2 .og-group-row-content { padding-left: 40px; }
  .og-row-group-sticky-depth-3 .og-group-row-content { padding-left: 60px; }
  .og-row-group-sticky-depth-4 .og-group-row-content { padding-left: 80px; }

  .og-row-group-sticky-pushed {
    opacity: 0.96;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3), 0 -1px 0 rgba(248, 250, 252, 0.08) inset;
  }

  .og-row-pinned-bottom {
    background-color: var(--og-header-bg);
    z-index: 25;
    border-top: 2px solid var(--og-border-color) !important;
  }

  /*
   * Cells are absolutely positioned (left/width set by JS).
   * Pinned cells live inside sticky lane containers and stay absolute within
   * those lanes, avoiding per-scroll cell coordinate writes.
   */
  .og-cell {
    position: absolute;
    top: 0;
    height: 100%;
    contain: style;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--og-cell-border);
  }

  .og-cell-row-selector,
  .og-header-cell-row-selector {
    justify-content: center;
    padding: 0;
  }

  .og-cell-row-selector .og-cell-content {
    justify-content: center;
  }

  .og-row-checkbox,
  .og-header-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1.5px solid rgba(100, 116, 139, 0.9);
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.72);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
    cursor: pointer;
    pointer-events: auto;
    transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease;
  }

  .og-row-checkbox:hover,
  .og-header-checkbox:hover {
    border-color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
  }

  .og-row-checkbox:focus-visible,
  .og-header-checkbox:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-row-checkbox:checked,
  .og-header-checkbox:checked,
  .og-header-checkbox:indeterminate {
    border-color: #60a5fa;
    background: linear-gradient(180deg, #60a5fa, #2563eb);
  }

  .og-row-checkbox:checked::after,
  .og-header-checkbox:checked::after {
    content: '';
    width: 8px;
    height: 5px;
    border-left: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    transform: rotate(-45deg) translateY(-1px);
  }

  .og-header-checkbox:indeterminate::after {
    content: '';
    width: 8px;
    height: 2px;
    border-radius: 2px;
    background: #ffffff;
  }

  .og-row-node-selected .og-row-checkbox {
    border-color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  .og-cell-pinned-left {
    z-index: 3;
    background-color: inherit;
  }

  .og-cell-pinned-right {
    z-index: 3;
    background-color: inherit;
  }

  /*
   * Pin containers use position:sticky so the browser compositor handles
   * their fixed-edge behaviour natively — no RAF-based JS transforms needed.
   * This eliminates the one-frame lag that caused flicker on horizontal scroll.
   *
   * Left pin: sticks to left:0 of the scroll viewport.
   * Right pin: margin-left:auto pushes it to the natural right side of the
   *   full-width flex row; sticky right:0 then anchors it to the viewport's
   *   right edge when horizontal scrolling would otherwise move it off-screen.
   */
  .og-row-pin-left,
  .og-row-pin-right {
    position: sticky;
    top: 0;
    height: 100%;
    flex-shrink: 0;
    z-index: 3;
    background-color: inherit;
    overflow: hidden;
  }

  .og-row-pin-left {
    left: 0;
    border-right: 1px solid var(--og-pin-left-border-color);
    box-shadow: var(--og-pin-left-shadow);
  }

  .og-row-pin-right {
    right: 0;
    margin-left: auto;
    border-left: 1px solid var(--og-pin-right-border-color);
    box-shadow: var(--og-pin-right-shadow);
  }

  .og-cell-content {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .og-cell-portal-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  .og-custom-renderer-container {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  .og-cell[data-content-mode="portal"] > .og-cell-content,
  .og-cell[data-content-mode="text"] > .og-cell-portal-host,
  .og-cell[data-content-mode="empty"] > .og-cell-portal-host,
  .og-cell[data-content-mode="fallback"] > .og-cell-portal-host,
  .og-cell[data-content-mode="pending"] > .og-cell-portal-host,
  .og-cell[data-content-mode="loading"] > .og-cell-portal-host {
    display: none;
  }

  .og-cell[data-content-mode="pending"] > .og-cell-content::before {
    content: '';
    width: min(72%, 120px);
    height: 16px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(148, 163, 184, 0.12), rgba(148, 163, 184, 0.22), rgba(148, 163, 184, 0.12));
  }

  .og-cell[data-content-mode="loading"] > .og-cell-content::before {
    content: '';
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
    /* Transitions apply to pickup (class added) and drop (class removed).
       transform is on the inline style so it animates here too. */
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease, opacity 0.15s ease;
  }

  .og-header-cell-dragging {
    cursor: grabbing;
    opacity: 0.95;
    background-color: color-mix(in srgb, var(--og-focus-ring) 20%, var(--og-header-bg));
    /* transform is composited inline by headerRenderer — scale(1.035) translateY(-2px) */
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55),
                0 0 0 1.5px var(--og-focus-ring),
                0 0 20px rgba(59, 130, 246, 0.2);
    z-index: 10;
  }

  /* Dim all non-dragging header cells so the lifted column pops out visually */
  .og-col-reordering .og-header-cell:not(.og-header-cell-dragging) {
    opacity: 0.38;
    transition: opacity 0.15s ease;
  }

  .og-column-drop-indicator {
    position: absolute;
    top: 0;
    width: 2px;
    /* Fade in/out at the ends so it doesn't look clipped */
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--og-focus-ring) 6%,
      var(--og-focus-ring) 94%,
      transparent 100%
    );
    box-shadow: 0 0 8px var(--og-focus-ring), 0 0 2px rgba(255, 255, 255, 0.25);
    pointer-events: none;
    z-index: 60;
  }

  /* White-fill circle caps with blue ring — crisp insertion-point markers */
  .og-column-drop-indicator::before,
  .og-column-drop-indicator::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffffff;
    border: 2px solid var(--og-focus-ring);
    box-shadow: 0 0 8px var(--og-focus-ring);
  }

  .og-column-drop-indicator::before { top: -5px; }
  .og-column-drop-indicator::after  { bottom: -5px; }

  .og-column-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    max-width: min(240px, calc(100vw - 24px));
    padding: 7px 12px 7px 9px;
    border: 1px solid color-mix(in srgb, var(--og-focus-ring) 60%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--og-header-bg) 80%, var(--og-focus-ring));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55),
                0 4px 12px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(255, 255, 255, 0.08) inset;
    color: var(--og-header-text);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1;
    overflow: hidden;
    pointer-events: none;
    text-overflow: ellipsis;
    text-transform: uppercase;
    user-select: none;
    white-space: nowrap;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  /* SVG drag-handle icon injected by JS */
  .og-drag-ghost-icon {
    width: 10px;
    height: 16px;
    opacity: 0.45;
    flex-shrink: 0;
    color: var(--og-header-text);
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
    background: rgba(15, 23, 42, 0.93);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.6), 0 8px 16px -8px rgba(0, 0, 0, 0.6);
    padding: 6px 0;
    min-width: 200px;
    font-family: var(--og-font-family), inherit;
    color: #f1f5f9;
    opacity: 0;
    transform: scale(0.96);
    transition: opacity 0.12s cubic-bezier(0.16, 1, 0.3, 1), transform 0.12s cubic-bezier(0.16, 1, 0.3, 1);
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
    user-select: none;
  }
  .og-context-menu-item:hover {
    background-color: var(--og-focus-ring, #3b82f6);
    color: #ffffff;
  }
  .og-context-menu-item.og-disabled {
    opacity: 0.35;
    cursor: not-allowed;
    color: #94a3b8;
  }
  .og-context-menu-item.og-disabled:hover {
    background-color: transparent;
    color: #94a3b8;
  }
  .og-context-menu-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-right: 10px;
    font-size: 14px;
    flex-shrink: 0;
    color: inherit;
    opacity: 0.85;
  }
  .og-context-menu-item-label {
    flex-grow: 1;
    font-weight: 500;
  }
  .og-context-menu-divider {
    height: 1px;
    background-color: rgba(255, 255, 255, 0.08);
    margin: 5px 0;
  }

  /* Column Header Popover Styles & Developer Themeable CSS Variables */
  .og-header-sort-indicator {
    display: none;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--og-focus-ring, #3b82f6);
    margin-left: 4px;
    margin-right: 4px;
    flex-shrink: 0;
  }
  
  .og-header-menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    color: #94a3b8;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
    margin-right: 4px;
    z-index: 5;
  }
  .og-header-cell:hover .og-header-menu-button {
    opacity: 1;
  }
  .og-header-menu-button:hover {
    color: #ffffff;
    background-color: rgba(255, 255, 255, 0.08);
  }
  
  .og-header-popover {
    position: fixed;
    z-index: 1100;
    background: var(--og-popover-bg, rgba(15, 23, 42, 0.95));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--og-popover-border, rgba(255, 255, 255, 0.1));
    border-radius: 10px;
    box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.6), 0 8px 16px -8px rgba(0, 0, 0, 0.6);
    padding: 8px;
    width: 220px;
    font-family: var(--og-font-family), inherit;
    color: var(--og-popover-text, #f1f5f9);
    opacity: 0;
    transform: scale(0.96);
    transition: opacity 0.12s cubic-bezier(0.16, 1, 0.3, 1), transform 0.12s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .og-header-popover.og-visible {
    opacity: 1;
    transform: scale(1);
    pointer-events: auto;
  }
  .og-popover-sort-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .og-popover-item {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 6px;
    transition: background-color 0.12s ease, color 0.12s ease;
    color: inherit;
    opacity: 0.85;
    gap: 8px;
  }
  .og-popover-item svg {
    color: #94a3b8;
    flex-shrink: 0;
  }
  .og-popover-item:hover {
    background-color: var(--og-popover-item-hover-bg, rgba(255, 255, 255, 0.06));
    color: #ffffff;
    opacity: 1;
  }
  .og-popover-item.og-active {
    background-color: var(--og-popover-item-active-bg, var(--og-focus-ring, #3b82f6));
    color: #ffffff;
    opacity: 1;
  }
  .og-popover-item.og-active svg {
    color: #ffffff;
  }
  .og-popover-item.og-danger {
    color: #f87171;
  }
  .og-popover-item.og-danger:hover {
    background-color: rgba(248, 113, 113, 0.08);
    color: #f87171;
  }
  .og-popover-divider {
    height: 1px;
    background-color: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }
  .og-popover-filter-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 4px;
  }
  .og-popover-section-title {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #94a3b8;
    margin-bottom: 2px;
  }
  .og-popover-select {
    background: var(--og-popover-input-bg, rgba(30, 41, 59, 0.7));
    border: 1px solid var(--og-popover-input-border, rgba(255, 255, 255, 0.08));
    color: inherit;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 11px;
    outline: none;
    cursor: pointer;
    font-family: inherit;
  }
  .og-popover-select option {
    background: #0f172a;
    color: #f1f5f9;
  }
  .og-popover-input {
    background: var(--og-popover-input-bg, rgba(30, 41, 59, 0.7));
    border: 1px solid var(--og-popover-input-border, rgba(255, 255, 255, 0.08));
    color: inherit;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 11px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.12s ease;
  }
  .og-popover-input:focus {
    border-color: var(--og-focus-ring, #3b82f6);
  }
  .og-popover-btn-group {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .og-popover-btn {
    flex: 1;
    font-size: 11px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.12s ease, background-color 0.12s ease;
  }
  .og-btn-primary {
    background-color: var(--og-popover-item-active-bg, var(--og-focus-ring, #3b82f6));
    color: #ffffff;
  }
  .og-btn-primary:hover {
    opacity: 0.9;
  }
  .og-btn-secondary {
    background-color: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }
  .og-btn-secondary:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }

  /* Group and Detail Rows */
  .og-group-row-content {
    display: flex;
    align-items: center;
    height: 100%;
    width: 100%;
    user-select: none;
    cursor: pointer;
    background:
      linear-gradient(90deg, rgba(167, 139, 250, 0.13), rgba(59, 130, 246, 0.08) 44%, rgba(15, 23, 42, 0.02)),
      var(--og-group-row-bg);
    color: var(--og-group-row-text);
    font-size: var(--og-group-row-font-size);
    font-weight: var(--og-group-row-font-weight);
    gap: 10px;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    transition: background-color 0.15s ease;
  }

  .og-group-row-content:hover {
    background:
      linear-gradient(90deg, rgba(167, 139, 250, 0.18), rgba(59, 130, 246, 0.11) 44%, rgba(15, 23, 42, 0.04)),
      var(--og-group-row-hover-bg);
  }

  .og-group-row-toggle {
    width: 18px;
    height: 18px;
    margin-right: 0;
    transition: transform 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border-radius: 4px;
    border: 1px solid rgba(167, 139, 250, 0.34);
    background: rgba(167, 139, 250, 0.14);
    color: #c4b5fd;
    line-height: 1;
  }

  .og-group-row-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    display: inline-grid;
    place-content: center;
    border: 1.5px solid rgba(147, 197, 253, 0.5);
    border-radius: 4px;
    background: rgba(15, 23, 42, 0.62);
    cursor: pointer;
    flex: 0 0 auto;
    pointer-events: auto;
  }

  .og-group-row-checkbox:hover {
    border-color: #bfdbfe;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.13);
  }

  .og-group-row-checkbox:focus-visible {
    outline: 2px solid var(--og-focus-ring);
    outline-offset: 2px;
  }

  .og-group-row-checkbox:checked,
  .og-group-row-checkbox:indeterminate {
    border-color: #93c5fd;
    background: linear-gradient(180deg, #60a5fa, #2563eb);
  }

  .og-group-row-checkbox:checked::after {
    content: '';
    width: 8px;
    height: 5px;
    border-left: 2px solid #ffffff;
    border-bottom: 2px solid #ffffff;
    transform: rotate(-45deg) translateY(-1px);
  }

  .og-group-row-checkbox:indeterminate::after {
    content: '';
    width: 8px;
    height: 2px;
    border-radius: 2px;
    background: #ffffff;
  }

  .og-group-row-toggle-expanded {
    transform: rotate(90deg);
  }

  .og-group-row-label-prefix {
    opacity: 0.72;
    margin-right: 6px;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0;
    color: #94a3b8;
    white-space: nowrap;
  }

  .og-group-count {
    margin-left: 4px;
    background: var(--og-group-badge-bg);
    border: 1px solid var(--og-group-badge-border);
    color: var(--og-group-badge-text);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .og-group-row-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .og-group-aggregate {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 160px;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(15, 23, 42, 0.32);
    color: #94a3b8;
    font-size: 11px;
    white-space: nowrap;
  }

  .og-group-aggregate span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .og-group-aggregate strong {
    color: #dbeafe;
    font-weight: 800;
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
