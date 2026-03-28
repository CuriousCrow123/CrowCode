---
title: Feature Search Panel
type: feat
status: completed
date: 2026-03-28
---

# Feature Search Panel

## Context

CrowCode supports a large subset of C but not everything. Users trying to write C code need a quick way to check "does this interpreter support X?" without leaving the app. Currently the only reference is `docs/feature-inventory.md`, which users won't find while using the tool.

A discrete, searchable feature panel lets users type "enum" or "malloc" and instantly see whether it's supported, partially working, or not implemented — with a hover description explaining the details.

## Design

**Trigger:** A small "Features" button in the toolbar area (next to the Run/Edit buttons). Clicking opens a modal overlay.

**Modal:** Follows the existing DrilldownModal pattern — fixed backdrop, centered container, Escape/click-outside to close. Contains:
1. A search input with autofocus
2. A scrollable list of features grouped by status (Implemented / Partial / Not Implemented)
3. Each item shows: name, status badge, category tag
4. Hovering an item reveals a tooltip with the full description

**Fuzzy search:** Use `fuzzysort` (6.5 KB minified, ~2.5 KB gzipped). It provides subsequence matching with scoring and built-in highlight support — ideal for searching feature names like "stp scrb" -> "step scrubber". No typo tolerance, but for a curated list of known feature names, subsequence matching is more useful than typo correction.

**Data:** A static TypeScript array in `src/lib/data/features.ts` containing ~100 entries extracted from `docs/feature-inventory.md`. Each entry has: `name`, `category`, `status` (implemented | partial | not-implemented), and `description`.

**Keyboard shortcut:** `?` key (when not in an input/editor) opens the panel. This is discoverable and doesn't conflict with existing shortcuts (Arrow keys, S).

### Alternatives considered

- **fuse.js** — 18 KB minified, has typo tolerance but 3x larger. Overkill for ~100 items where users know approximate names.
- **No dependency** — Subsequence matching is easy but scoring/ranking is ~50-80 lines of non-trivial code. Not worth maintaining when fuzzysort is 2.5 KB gzipped.
- **Sidebar instead of modal** — Would compete with the two-column layout. Modal is more "discrete" per the requirement.
- **Tooltip library** — Not needed. CSS `position: absolute` + conditional rendering on hover/focus is simpler and matches existing patterns (no tooltip library in the project).

## Files

### Create
| File | Purpose |
|------|---------|
| `src/lib/data/features.ts` | Static feature data array (~100 entries with name, category, status, description) |
| `src/lib/components/FeatureSearch.svelte` | Modal component: search input, filtered list, hover tooltips |

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/routes/+page.svelte` | Add Features button to toolbar, render FeatureSearch modal, add `?` keyboard shortcut | Entry point for the feature |
| `package.json` | Add `fuzzysort` dependency | Fuzzy search library |

## Steps

### Step 1: Add fuzzysort dependency
- **What:** Install fuzzysort
- **Files:** `package.json`
- **Depends on:** Nothing
- **Verification:** `npm install` succeeds, `import fuzzysort from 'fuzzysort'` resolves

### Step 2: Create feature data file
- **What:** Create `src/lib/data/features.ts` with a typed array of all features from `docs/feature-inventory.md`. Each entry: `{ name: string; category: string; status: 'implemented' | 'partial' | 'not-implemented'; description: string }`. Group by: Data Types, Operators, Control Flow, Functions, Memory Management, Standard Library, Visualization, I/O, Language Features (not implemented), Format Strings, Runtime.
- **Files:** `src/lib/data/features.ts`
- **Depends on:** Nothing
- **Verification:** File compiles, `npm run check` passes

### Step 3: Build FeatureSearch component
- **What:** Create `src/lib/components/FeatureSearch.svelte` with:
  - Modal backdrop (fixed inset-0 z-50, bg-black/60 backdrop-blur-sm) — matches DrilldownModal
  - Search input with autofocus, zinc-800 background, placeholder "Search features..."
  - Filtered results list using fuzzysort, with highlighted match characters
  - Status badges: green "Implemented", amber "Partial", red "Not Implemented"
  - Category tags in zinc-600 text
  - Hover tooltip: absolute-positioned card below/above the item showing full description
  - Escape key and backdrop click to close
  - Props: `onclose: () => void`
- **Files:** `src/lib/components/FeatureSearch.svelte`
- **Depends on:** Steps 1, 2
- **Verification:** Component renders, search filters correctly, tooltips appear on hover

### Step 4: Integrate into main page
- **What:** Add a "Features" button to the toolbar row in `+page.svelte`. Wire up `?` keyboard shortcut (with existing guard clauses for input/textarea/editor). Conditionally render FeatureSearch modal.
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Step 3
- **Verification:** Button visible, `?` opens modal, Escape closes, search works end-to-end

### Step 5: Verify build
- **What:** Run `npm run build` and `npm run check` to ensure no type errors or build issues
- **Files:** None
- **Depends on:** Step 4
- **Verification:** `npm run build` succeeds, `npm run check` passes

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Empty search query | Show all features grouped by status | Default state shows full list |
| No matches | Show "No features match" message | Conditional rendering |
| Very long description | Tooltip doesn't overflow viewport | `max-w-sm` + `max-h-48 overflow-y-auto` on tooltip |
| Tooltip near bottom of list | Tooltip renders above item instead of below | Check position and flip direction |
| `?` pressed while typing in editor/input | Ignored (types `?` normally) | Guard clause checks `e.target` type |
| Mobile/touch (no hover) | Tap item to toggle tooltip | Use click/focus as fallback |
| Modal open + keyboard nav | Arrow keys shouldn't step through program | Modal captures keyboard events |

## Verification
- [ ] `npm run build` succeeds
- [ ] `npm run check` passes
- [ ] `?` key opens feature search from main view
- [ ] Search filters features with fuzzy matching ("mloc" finds "malloc")
- [ ] Status badges show correct colors (green/amber/red)
- [ ] Hover tooltip shows description
- [ ] Escape and backdrop click close the modal
- [ ] Keyboard shortcut doesn't fire in inputs/editor

## References
- [docs/feature-inventory.md](../feature-inventory.md) — source data for all features
- [DrilldownModal.svelte](../../src/lib/components/DrilldownModal.svelte) — modal pattern to follow
- [fuzzysort](https://github.com/farzher/fuzzysort) — fuzzy search library
