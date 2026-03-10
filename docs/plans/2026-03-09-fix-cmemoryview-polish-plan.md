---
title: "fix: CMemoryView polish — highlight overflow, view state, toggle, table animations"
type: fix
status: completed
date: 2026-03-09
---

# CMemoryView Polish

Five focused fixes for the CMemoryView widget after the sub-step decomposition feature landed.

## Files

- `site/src/components/widgets/CMemoryView.svelte`
- `site/src/components/sandbox/CMemoryViewDemo.svelte`
- `CLAUDE.md`
- `docs/brainstorms/2026-03-09-read-pulse-visual-feedback-brainstorm.md` (status update)

## 1. Read-highlight extends beyond hex column

**Problem**: The `.read-highlight` outline wraps the entire `.byte-row` flex container, which includes the address, annotation, bits, AND hex columns. It should only highlight the bit cells + hex area (the "data" portion).

**Fix**: Wrap the `.bits` + `.hex` spans in a `.byte-data` container. Move the `read-highlight` class onto that container instead of `.byte-row`.

```svelte
<!-- Before -->
<div class="byte-row" class:read-highlight={...}>
  <span class="address">...</span>
  <span class="annotation">...</span>
  <span class="bits">...</span>
  <span class="hex">...</span>
</div>

<!-- After -->
<div class="byte-row">
  <span class="address">...</span>
  <span class="annotation">...</span>
  <span class="byte-data" class:read-highlight={...}>
    <span class="bits">...</span>
    <span class="hex">...</span>
  </span>
</div>
```

CSS: `.byte-data { display: flex; align-items: center; gap: 0.5rem; }` — inherits the same gap as byte-row had between bits and hex. Move `read-highlight` styles onto `.byte-data.read-highlight`.

- [x] Add `.byte-data` wrapper around `.bits` + `.hex` in the template
- [x] Move `class:read-highlight` from `.byte-row` to `.byte-data`
- [x] Add `.byte-data` CSS (flex, align-items, gap)
- [x] Update `.read-highlight` selector to `.byte-data.read-highlight`

## 2. Stepping backwards reverts to bits view

**Problem**: `executePrev()` calls `memoryView.reset()` which sets `viewMode = 'bits'`. The user's view preference should survive backward navigation.

**Fix**: `reset()` should NOT touch `viewMode` or `tableUnlocked`. These are user preferences, not program state. Remove the `viewMode = 'bits'` line from `reset()`.

- [x] Remove `viewMode = 'bits';` from `reset()` in CMemoryView.svelte
- [x] Keep `tableUnlocked` unchanged (already persists)
- [x] Add a separate `fullReset()` or have `handleReset()` in the demo explicitly call `setViewMode('bits')` after `reset()` if a full reset is desired

## 3. Redundant table/bits view buttons

**Problem**: The demo has two buttons ("Table view", "Bits view") AND the CMemoryView has its own internal toggle button ("Show table"/"Show bits"). Three controls for one toggle is redundant.

**Fix**: Remove the "Table view" and "Bits view" buttons from the demo's `.demo-controls`. The widget's own toggle (gated behind `tableUnlocked`) is sufficient. The toggle should be unlocked from the start (since the demo is about exploring both views), or unlocked after the first variable is declared.

- [x] Remove "Table view" and "Bits view" buttons from CMemoryViewDemo.svelte
- [x] Set `tableUnlocked = true` by default (or unlock after first `declareVar`)
- [x] Optionally: make the toggle more prominent or always visible in the widget

## 4. Table view animations parallel to bits view

**Problem**: The table view has no visual feedback during sub-steps. Variables appear instantly with no animation.

**Fix**: Add minimal animations to the table view that mirror the bits view:

| Sub-step | Bits view | Table view |
|----------|-----------|------------|
| declare | Red tint (uninitialized) | New row fades in, value shows "???" with red tint |
| read | Outline + indigo tint on rows | Row background flashes indigo (sustained, same as bits) |
| assign | Bit glow animation | Value cell glows/pulses (green accent), value updates |
| compute | (no memory change) | (no change — code panel only) |

**Implementation**: Track `highlightedVars` and `glowingVars` (new) in the table view template:

- `highlightedVars` already exists — reuse for table read highlights
- Add `glowingVarNames: Set<string>` (derived from `variables` value changes) for the assign glow
- Uninitialized rows: value cell gets red tint when `v.value === null`
- New row appearance: CSS `@keyframes fade-in` on table rows

```css
/* Table row fade-in */
.cmv-table tr { animation: table-row-in 300ms ease-out; }
@keyframes table-row-in { from { opacity: 0; transform: translateY(-4px); } }

/* Table read highlight */
.cmv-table tr.read-highlight { background: rgba(99, 102, 241, 0.10); }

/* Table assign glow */
.cmv-table td.value-glow { animation: value-glow 400ms ease-out; }
@keyframes value-glow {
  0% { color: var(--color-accent); text-shadow: 0 0 6px var(--color-accent); }
  100% { color: var(--color-text); text-shadow: none; }
}

/* Table uninitialized */
.cmv-table td.uninitialized { color: rgba(239, 68, 68, 0.7); }
```

- [x] Add `read-highlight` class to table rows when variable is in `highlightedVars`
- [x] Add `.uninitialized` class to value cell when `v.value === null`
- [x] Add row fade-in animation CSS
- [x] Add value glow animation for assign steps (track via a `glowingVarNames` Set, clear after animation ends)
- [x] Verify table animations work during sub-step navigation

## 5. Documentation updates

- [x] Update `CLAUDE.md` with the new `clearHighlights()` / sustained highlight pattern
- [x] Update brainstorm `2026-03-09-read-pulse-visual-feedback-brainstorm.md` status to completed
- [x] Update plan `2026-03-09-feat-instruction-sub-step-decomposition-plan.md` if any acceptance criteria changed

## Acceptance Criteria

- [x] Read-highlight outline only covers bits + hex area, not address/annotation
- [x] Switching to table view, then stepping backward, stays in table view
- [x] Only one toggle control exists (the widget's own button)
- [x] Table view shows visual feedback for declare (fade-in + red "???"), read (indigo tint), and assign (value glow)
- [x] `npm run build` passes
- [x] All documentation updated
