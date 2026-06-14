# Plan 046: Modern (shadcn-style) header menu + context menu

## Status

- **Priority**: P2 (UI polish)
- **Effort**: S–M (mostly CSS + small positioning hooks)
- **Risk**: LOW (presentation only; no behavior change)
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14, branch rendering-architecture-v2-wip-3)**. core 582/582, react 85/85, demo build clean. **Keyboard navigation follow-up landed 2026-06-14 — see end.**

## Goal

Make the column header popover and the row context menu look modern (shadcn/ui aesthetic) with fluid, origin-aware open animations.

## What landed (`styles.ts`, `headerMenuController.ts`, `contextMenu.ts`)

- **Surface**: near-solid popover bg (`rgba(17,20,28,0.97)`) with light blur, 1px subtle border, 8px radius, soft layered shadow + a 1px inner ring (shadcn `shadow-md` + ring). Themeable via `--og-popover-bg/border/text/divider`.
- **Items**: rounded (6px) inset rows with a **muted accent hover** (`rgba(255,255,255,0.07)`) instead of the old saturated full-bleed blue; 13px, tighter padding, icon opacity 0.7, plus a `.og-context-menu-item-shortcut` slot (right-aligned, muted) for future shortcuts.
- **Separators**: hairline `--og-popover-divider` with horizontal inset.
- **Fluid, origin-aware entrance**: fade + `scale(0.96)` + a 4px slide. The controllers tag the menu with a placement class so it grows from the edge nearest the trigger:
    - Header popover: `og-placement-bottom` (default) / `og-placement-top` (flipped above) → `transform-origin` top/bottom.
    - Context menu: `og-placement-top`/`-bottom` (+ `og-placement-left` when flipped horizontally) → origin at the corner nearest the pointer.
    - Easing `cubic-bezier(0.16,1,0.3,1)`, ~150ms.

## Notes

- Header popover sort/filter controls kept; only surface + item + animation styling changed.
- No DOM-structure or behavior changes → existing `headerPopover.test.ts` (6) stays green.
- Verify visually in the dev server (menus only appear on interaction; not asserted pixel-wise).

## Keyboard navigation follow-up (DONE 2026-06-14)

- **Shared helper** `menuKeyboardNav.ts` → `attachRovingMenuKeyboard({container, items, activeClass, onActivate, onClose})`: ARIA vertical-menu pattern via roving focus — ArrowUp/Down (wrap), Home/End, Enter/Space activate, Escape/Tab close. Returns a cleanup fn. Pure DOM, framework-free. 9 unit tests in `menuKeyboardNav.test.ts`.
- **Context menu** (`contextMenu.ts`, a pure list): collects enabled item els, attaches the roving helper (`activeClass: 'og-menu-active'`, `onActivate: el => el.click()`, `onClose: hide`); cleanup stored + run in `hide()`. Added `role=menu`/`menuitem`/`separator` + `aria-disabled`.
- **Header popover** (`headerMenuController.ts`, a form): NOT roving (would break Tab into the filter). Instead: document `keydown` Escape → close (covers custom menus too, returns focus to the header cell); built-in sort rows made keyboard-activatable (`_makeActivatable`: `tabindex=0` + `role=menuitem` + Enter/Space → click) so they sit in the natural Tab order before the native select/input/buttons; first sort row autofocused on open; `role=menu` on the popover.
- **CSS** (`styles.ts`): `.og-context-menu-item.og-menu-active` mirrors hover + suppresses the focused-item outline; `.og-popover-item:focus-visible` gets a focus ring.
- Green: core 601/601 (9 new), react 70/70, builds clean. NOT browser-verified (hidden preview tab); behavior is DOM-level and unit-tested.
