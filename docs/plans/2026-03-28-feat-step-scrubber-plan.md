---
title: Step Scrubber
type: feat
status: completed
date: 2026-03-28
---

# Step Scrubber

## Context

Currently, navigation through program steps is limited to discrete Prev/Next buttons and arrow keys. For programs with many steps, this makes it tedious to jump to a specific point in execution. A scrubber (range slider) lets users drag to any step instantly, giving a sense of the program's timeline and enabling quick navigation.

## Design

Add an `<input type="range">` scrubber to `StepControls.svelte`. The scrubber operates on **visible positions** (not internal indices), matching the existing Prev/Next logic. The page component maps visible positions to internal indices, keeping StepControls stateless.

**Approach:** Extend StepControls with a new `onseek(position: number)` callback prop and render a styled range input. The page handles the position→internalIndex mapping.

**Alternatives considered:**
- Custom canvas/SVG scrubber — overkill for this use case, native range input is sufficient and accessible
- Separate Scrubber component — unnecessary indirection since it's tightly coupled to StepControls

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/components/StepControls.svelte` | Add range input and `onseek` callback prop | Core UI change |
| `src/routes/+page.svelte` | Add `seek()` function, pass `onseek` to StepControls | Wire scrubber to navigation state |

### Create
None.

## Steps

### Step 1: Add scrubber to StepControls
- **What:** Add `onseek: (position: number) => void` prop. Render `<input type="range" min={0} max={total - 1} value={current}>` below the button row. Style to match dark theme. Wire `oninput` to call `onseek` with the parsed value.
- **Files:** `src/lib/components/StepControls.svelte`
- **Depends on:** Nothing
- **Verification:** Component renders without errors, slider appears

### Step 2: Wire seek to page navigation
- **What:** Add `seek(position: number)` function in `+page.svelte` that sets `internalIndex = visibleIndices[position]`. Pass it as `onseek` to StepControls.
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Step 1
- **Verification:** Dragging the slider navigates to the correct step, code highlights and memory view update

### Step 3: Style the range input
- **What:** Style the range input track and thumb to match the zinc/dark theme using CSS. Keep it minimal — thin track, small thumb, consistent with existing button styles.
- **Files:** `src/lib/components/StepControls.svelte`
- **Depends on:** Step 1
- **Verification:** Visual inspection — slider matches the app's dark aesthetic

## Edge Cases

| Case | Expected behavior | How handled |
|------|------------------|-------------|
| Only 1 step | Scrubber disabled or hidden | Disable when `total <= 1` |
| Sub-step toggle changes total | Scrubber range updates, position remaps | Derived `total` and `current` props already handle this via existing `nearestVisibleIndex` logic |
| Keyboard on focused scrubber | Native arrow keys move slider | Browser default behavior works correctly |
| Interactive mode waiting for input | Scrubber still works for existing steps | No special handling needed — `total` reflects available steps |

## Verification

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Scrubber appears below Prev/Next buttons
- [ ] Dragging updates step counter, code highlight, and memory view
- [ ] Works correctly in both line mode and sub-step mode
- [ ] Scrubber disabled/hidden when only 1 step
- [ ] Keyboard arrow keys still work for step navigation (no conflict)

## References

- [StepControls.svelte](src/lib/components/StepControls.svelte) — current component
- [navigation.ts](src/lib/engine/navigation.ts) — visible index logic
- [+page.svelte](src/routes/+page.svelte) — state management and navigation
