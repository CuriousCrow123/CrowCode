---
title: "Refactor: BitSequence Widget Deduplication & Codebase Cleanup"
type: refactor
status: completed
date: 2026-03-09
deepened: 2026-03-09
origin: docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md
---

# Refactor: BitSequence Widget Deduplication & Codebase Cleanup

## Enhancement Summary

**Deepened on:** 2026-03-09
**Agents used:** architecture-strategist, pattern-recognition-specialist, code-simplicity-reviewer, performance-oracle, kieran-typescript-reviewer, julik-frontend-races-reviewer, spec-flow-analyzer

### Key Changes from Deepening
1. **Dropped EditableValue extraction** — only ~23 lines truly shared, high variant divergence (simplicity reviewer)
2. **Dropped paramPresets extraction** — only 3 params truly identical across all 4 variants, adds indirection for 12 lines saved (simplicity reviewer)
3. **Dropped SandboxStageButtons extraction** — only 2 consumers, premature abstraction (simplicity reviewer)
4. **Added critical bug fixes** — timer cleanup on unmount, document-level pointerup safety (race condition reviewer)
5. **Refined ScrubSlider API** — renamed `onchange` to `onvaluechange`, added `ondelta` callback (TypeScript reviewer, SpecFlow analyzer)
6. **Added keyboard accessibility** — arrow key support on role="slider" (SpecFlow analyzer)

### Revised Scope
| Original Extraction | Status | Reason |
|---|---|---|
| ScrubSlider.svelte | **Keep** | ~170 lines JS+CSS x4, clear boundary, simple interface |
| EditableValue.svelte | **Drop** | ~23 lines shared, commit logic diverges per variant |
| paramPresets.ts | **Drop** | 12 lines saved, Float can't use 3d presets at all |
| SandboxLayout.astro | **Keep** | ~10 lines x11 pages, textbook layout extraction |
| SandboxStageButtons.svelte | **Drop** | Only 2 consumers, premature abstraction |

**Net reduction: ~480 lines** (vs original estimate of 600-800)

---

## Overview

Refactor of the CrowCode widget codebase to eliminate duplicated scrub slider code across 4 BitSequence variants and consolidate sandbox page boilerplate. Preserves all architectural constraints (widget-local paramDefs, no shared animation layer, scoped CSS custom properties). Also fixes two pre-existing bugs (timer leak on unmount, orphaned repeat on touch devices).

## Problem Statement

The BitSequence widget family (Uint, Ascii, Signed, Float) was built rapidly with copy-paste patterns. The highest-value duplication:

- **Scrub slider + buttons**: `handleScrubDown/Move/Up`, `updateScrubValue`, `handleBtnDown/Up`, `stopBtnRepeat`, scrub track/rail/fill/knob markup + all CSS (~170 lines x4 = ~680 lines)
- **Sandbox page layout**: Identical Astro boilerplate across 11 sandbox pages (~10 lines x11 = ~110 lines)

Lower-value duplication (not worth extracting):
- **Edit mode**: ~23 shared lines but commit logic diverges fundamentally per variant (parseInt vs charCodeAt vs parseFloat+special strings vs dual-target editing)
- **Param definitions**: Only 3 params (repeatDelay/Interval/AccelMs) are truly identical across all 4; the "shared" visual params differ in Float (cellSize: 28 vs 48, cellGap: 4 vs 8, etc.)

## Proposed Solution

### Phase 1: Extract `ScrubSlider.svelte` shared component

Extract the scrub slider (track + knob + +/- buttons) into a self-contained Svelte component.

**File**: `site/src/components/widgets/shared/ScrubSlider.svelte`

**Props interface** (refined per TypeScript + SpecFlow review):
```typescript
interface ScrubSliderProps {
  value: number;           // Current value for fill/knob position
  max: number;             // Maximum value (min is always 0)
  onvaluechange: (v: number) => void;  // Scrub track drag callback
  ondelta: (delta: number, direction: 1 | -1) => void;  // +/- button callback
  repeatDelay?: number;    // Default: 400
  repeatInterval?: number; // Default: 80
  repeatAccelMs?: number;  // Default: 800
  ariaLabel?: string;      // Default: "Drag to scrub value"
  railWidth?: number;      // Default: 120 (Float uses 140)
}

let {
  value,
  max,
  onvaluechange,
  ondelta,
  repeatDelay = 400,
  repeatInterval = 80,
  repeatAccelMs = 800,
  ariaLabel = 'Drag to scrub value',
  railWidth = 120,
}: ScrubSliderProps = $props();

// Derived (maxLabel can't use another prop as default in destructuring)
let maxLabel = $derived(String(max));
let percent = $derived(max > 0 ? (value / max) * 100 : 0);
```

**Encapsulates**: Scrub drag logic, pointer capture, isDragging state, button markup, scrub CSS. All internal — parent only sees `onvaluechange` and `ondelta`.

**Critical implementation details** (from race condition review):

1. **Timer cleanup on unmount** (fixes pre-existing bug):
```typescript
import { onDestroy } from 'svelte';

let stopBtnRepeat: (() => void) | null = null;

onDestroy(() => {
  stopBtnRepeat?.();
  stopBtnRepeat = null;
});
```

2. **Document-level pointerup safety** (fixes orphaned repeat on touch):
```typescript
function handleBtnDown(dir: 1 | -1) {
  stopBtnRepeat?.();
  stopBtnRepeat = startRepeat((delta) => {
    ondelta(delta, dir);
  }, repeatDelay, repeatInterval, repeatAccelMs);

  // Safety: stop on any pointer-up anywhere (catches touch leave)
  document.addEventListener('pointerup', handleBtnUp, { once: true });
}
```

3. **Keyboard accessibility** (fixes missing WCAG requirement):
```typescript
function handleKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? Math.ceil(max / 10) : 1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    e.preventDefault();
    onvaluechange(Math.min(max, value + step));
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    e.preventDefault();
    onvaluechange(Math.max(0, value - step));
  } else if (e.key === 'Home') {
    e.preventDefault();
    onvaluechange(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    onvaluechange(max);
  }
}
```

4. **Cancellation token in repeat.ts** (from race condition review):
```typescript
// Add `canceled` flag to startRepeat for safety
export function startRepeat(action, delay, interval, accelMs) {
  let elapsed = 0;
  let canceled = false;
  let timer;
  action(1);
  timer = setTimeout(function tick() {
    if (canceled) return;
    elapsed += interval;
    const delta = 2 ** Math.floor(elapsed / accelMs);
    action(delta);
    timer = setTimeout(tick, interval);
  }, delay);
  return () => { canceled = true; if (timer) clearTimeout(timer); };
}
```

**Why `ondelta` instead of baking value computation into the component**: The Float variant's +/- buttons operate on raw bit patterns (`bits16 + dir * delta`), while others use `decimalValue + dir * delta`. The parent owns the semantics.

### Phase 2: Consolidate sandbox page boilerplate

Extract shared Astro layout for sandbox pages.

**File**: `site/src/layouts/SandboxLayout.astro`

```astro
---
import BaseLayout from './BaseLayout.astro';

interface Props {
  title: string;
  description: string;
}

const { title, description } = Astro.props;
---

<BaseLayout title={`Sandbox: ${title}`}>
  <main style="padding: var(--space-2xl); max-width: var(--figure-width); margin-inline: auto;">
    <a href="/sandbox" style="color: var(--color-accent);">&larr; All widgets</a>
    <h1 style="margin-block: var(--space-lg); font-size: 1.75rem;">{title}</h1>
    <p style="color: var(--color-text-muted); margin-bottom: var(--space-xl);">{description}</p>
    <div style="background: var(--color-bg-raised); padding: var(--space-xl); border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
      <slot />
    </div>
  </main>
</BaseLayout>
```

**Note**: Layouts are not widgets, so using spatial tokens (`--space-*`, `--radius-*`) is compliant with the token separation rule.

### Phase 3: Apply ScrubSlider to all BitSequence variants

Rewrite each variant to use the shared ScrubSlider. **Keep edit mode inline** in each variant (variant-specific commit logic stays local).

Per-variant changes:
- **BitSequenceUint**: Remove ~170 lines scrub JS+CSS. Keep edit mode inline. `ondelta` calls `setValue(decimalValue + delta * dir)`.
- **BitSequenceAscii**: Same removal. `ondelta` calls `setValue(decimalValue + delta * dir)`.
- **BitSequenceSigned**: Same removal. Keep number line SVG. `ondelta` calls `setValue(unsignedValue + delta * dir)`. Add mutual exclusion guard between slider drag and number line drag.
- **BitSequenceFloat**: Same removal. `ondelta` writes raw bit pattern: `const newVal = Math.max(0, Math.min(65535, bits16 + dir * delta)); ...writeUint(newBits, 0, newVal, 16)`. Uses `railWidth={140}`.

### Phase 4: Consolidate sandbox pages

Rewrite all 11 sandbox `.astro` pages to use `SandboxLayout`. Sandbox wrappers (`BitSequenceAsciiSandbox`, `BitSequenceSignedSandbox`) remain as-is — they have only 2 consumers, and their stage-button CSS duplication (~25 lines) doesn't justify a new component.

### Phase 5: Documentation

- Update CLAUDE.md: document `widgets/shared/` directory pattern, ScrubSlider usage
- Update CLAUDE.md: clarify that `widgets/shared/` contains Svelte components used by multiple widgets (stateless, no WIDGET_ID or paramDefs), while `lib/` contains pure TypeScript utilities

## Implementation Phases (Git Commits)

Each phase is an atomic commit. Reduced from 11 to 8:

1. `fix(lib): add cancellation token to startRepeat for safety`
2. `refactor(widgets): extract ScrubSlider shared component with bug fixes`
3. `refactor(widgets): apply ScrubSlider to BitSequenceUint`
4. `refactor(widgets): apply ScrubSlider to BitSequenceAscii`
5. `refactor(widgets): apply ScrubSlider to BitSequenceSigned`
6. `refactor(widgets): apply ScrubSlider to BitSequenceFloat`
7. `refactor(sandbox): extract SandboxLayout and consolidate all sandbox pages`
8. `docs: update CLAUDE.md with shared component patterns`

**Phase ordering rationale** (from architecture review): Commit 3 validates ScrubSlider's interface on the simplest variant (Uint) before applying to others. If the interface needs adjustment, only 1 variant needs updating.

## Acceptance Criteria

- [ ] All 4 BitSequence variants use shared `ScrubSlider`
- [ ] All sandbox pages use `SandboxLayout.astro`
- [ ] No duplicated scrub CSS across variants
- [ ] ScrubSlider has `onDestroy` cleanup for repeat timer
- [ ] ScrubSlider has document-level pointerup safety for touch
- [ ] ScrubSlider has keyboard accessibility (arrow keys, Home/End)
- [ ] `repeat.ts` has cancellation token
- [ ] All widgets function identically (same props, same imperative API)
- [ ] Dev server runs without errors (`npm run dev`)
- [ ] Production build succeeds (`npm run build`)
- [ ] Widget debug panels still work
- [ ] ~480 lines of code eliminated
- [ ] Each commit is atomic and builds cleanly
- [ ] CLAUDE.md updated

## Performance Assessment

(from performance-oracle review)

- **Reactivity**: No measurable impact. Svelte 5 signal propagation is flat — component boundaries don't add overhead.
- **Pointer events**: `setPointerCapture` works correctly across component boundaries — Svelte doesn't insert wrapper elements.
- **Animation**: Bit flip animations (in BitSequenceCore) are untouched. Scrub drag updates follow the same signal chain.
- **Bundle size**: Net reduction of ~0.5-1.5 KB. Deduplication savings (~3 KB) exceed component overhead (~2.4 KB).

## Bug Fixes Included

1. **Timer leak on unmount** (all 4 variants): If ScrubSlider unmounts mid-repeat (e.g., stage change), the setTimeout chain was never cancelled. Fixed with `onDestroy` cleanup.
2. **Orphaned repeat on touch** (all 4 variants): On touch devices, `pointerup` can miss the button element, leaving the repeat timer running indefinitely. Fixed with document-level pointerup listener.
3. **Cancellation token in repeat.ts**: Added `canceled` flag to prevent executing after cleanup.

## Constraints (from ADRs — must preserve)

- **ADR 002**: Each widget keeps its own `paramDefs` array inline — no presets, no central registry
- **ADR 003**: No shared animation layer — each widget picks its own animation approach
- **Token separation**: Shared components use only non-spatial globals (`--color-*`, `--font-*`, `--transition-*`)
- **Widget independence**: ScrubSlider is dumb/stateless UI — variants own all domain logic and value semantics

## Sources & References

### Origin

- **Brainstorm document**: [docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md](docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md) — established Core+Variant architecture
- Key decisions: widget independence, per-widget paramDefs, scoped CSS custom properties

### Internal References

- ADR 002: [docs/decisions/002-per-widget-params.md](docs/decisions/002-per-widget-params.md) — param system constraints
- ADR 003: [docs/decisions/003-widget-animation-strategy.md](docs/decisions/003-widget-animation-strategy.md) — animation independence
- BitSequenceCore: [site/src/components/widgets/BitSequenceCore.svelte](site/src/components/widgets/BitSequenceCore.svelte) — existing shared renderer pattern
- Params system: [site/src/lib/params.ts](site/src/lib/params.ts) — Param interface and loadParams
- Repeat utility: [site/src/lib/repeat.ts](site/src/lib/repeat.ts) — existing shared utility pattern

### Deepening Review Findings

- Architecture: ScrubSlider extraction is clean, widget independence preserved
- Simplicity: Dropped 3 of 5 proposed extractions as premature/unnecessary
- Performance: No measurable impact; net bundle size reduction
- TypeScript: Renamed onchange to onvaluechange (avoids DOM event naming collision)
- Race conditions: 3 pre-existing bugs fixed during extraction (timer leak, touch orphan, cancellation)
- SpecFlow: Identified keyboard accessibility gap (WCAG violation on role="slider")
