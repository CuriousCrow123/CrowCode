---
title: Documentation Cleanup — Focus Feature Inventory on C Features
type: refactor
status: completed
date: 2026-03-28
---

# Documentation Cleanup — Focus Feature Inventory on C Features

## Context

The feature inventory (`docs/feature-inventory.md`) mixes C language feature tracking with tool/UI/engine documentation. The C feature sections are valuable as a "what does CrowCode support?" reference, but the Visualization, UI Features, Engine, Infrastructure, Test Programs, Test Coverage, and Summary sections duplicate information already in `docs/architecture.md` and `README.md`. Trimming the inventory to C-only makes it a focused reference for "what C features are supported?"

Additionally, `architecture.md` and `README.md` need minor updates to stay current, and `CONTRIBUTING.md` has a stale test count (~600 → ~837).

## Design

**Feature inventory:** Remove non-C sections. Keep everything about C language support: Data Types, Operators, Control Flow, Functions, Memory Management, Standard Library, Partially Working, Not Implemented, Prioritized Remaining Work, Architecture Constraints.

**Architecture.md:** Multiple sections stale:
- **Directory tree** missing: `format.ts` (interpreter), `FeatureSearch.svelte`, `StdinInput.svelte`, `TerminalPanel.svelte` (components), `data/features.ts` (new directory)
- **Module table** (line 53-58): Components row only lists 4 files, missing StepControls/FeatureSearch/StdinInput/TerminalPanel. Interpreter row missing `format.ts`, `escapes.ts`, `stdlib.ts`.
- **Interpreter Components section**: No description for Format module (printf/scanf format string parser)
- **UI Components section** (line 305+): Missing FeatureSearch, StdinInput, TerminalPanel descriptions. ConsolePanel description says it has stdin input but that's now a separate StdinInput component.
- **Test count**: 832 → 837

**README.md:** Features list undersells the project. Missing: example program browser (46 programs), sub-step mode, drilldown modal, multi-tab editor, memory safety checks (null deref, double free, use-after-free, bounds checking, leak detection), step scrubber, resizable panels. Also update test count (~830 → ~837).

**CONTRIBUTING.md:** Fix stale test count (~600 → ~837).

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `docs/feature-inventory.md` | Remove sections: Visualization, UI Features, Engine, Infrastructure, Test Programs, Test Coverage, Summary | These belong in architecture.md, not the C feature inventory |
| `docs/architecture.md` | Update test count 832 → 837, verify directory tree | Keep accurate |
| `README.md` | Update test count ~830 → ~837 | Keep accurate |
| `CONTRIBUTING.md` | Update test count ~600 → ~837 | Stale since test suite grew |

## Steps

### Step 1: Trim feature-inventory.md
- **What:** Remove these sections: Visualization (lines 185-210), UI Features (lines 214-228), Engine (lines 232-242), Infrastructure (lines 246-254), Test Programs (lines 438-459), Test Coverage (lines 463-501), Summary (lines 505-519). Update header/intro to clarify this is a C language feature reference. Keep Architecture Constraints (useful C-model info).
- **Files:** `docs/feature-inventory.md`
- **Depends on:** nothing
- **Verification:** File reads cleanly, no broken references

### Step 2: Update architecture.md
- **What:** Multiple updates:
  1. **Directory tree:** Add `format.ts` to interpreter, add `FeatureSearch.svelte`, `StdinInput.svelte`, `TerminalPanel.svelte` to components, add `data/features.ts` directory
  2. **Module table (line 53-58):** Update Components row to include all key files. Update Interpreter row to include `format.ts`, `escapes.ts`, `stdlib.ts`.
  3. **Interpreter Components section:** Add `Format` paragraph (printf/scanf format string tokenizer — parses specifiers, width, precision, flags for both printf and scanf)
  4. **UI Components section (line 305+):** Add `FeatureSearch` (searchable example program dropdown, 46 programs across 14 categories), `StdinInput` (pre-supplied stdin textarea with consumed/remaining display during stepping), `TerminalPanel` (combined console output + stdin input container). Update `ConsolePanel` description — stdin input is now separate.
  5. **Test count:** 832 → 837
- **Files:** `docs/architecture.md`
- **Depends on:** nothing
- **Verification:** Directory tree matches `find src/lib/`, test counts match `npm test`

### Step 3: Update README.md
- **What:** Expand the Features section to reflect what the project actually does:
  - Memory safety detection: null pointer deref, double free, use-after-free, bounds checking, leak detection
  - 26 stdlib functions: full scanf support (%d, %c, %f, %x, %*), getchar, fgets, sprintf/snprintf, string functions, math functions
  - I/O mode toggle: pre-supplied stdin vs interactive (debugger-style, pause at scanf/getchar)
  - EOF support via Ctrl+D
  - Escape sequence processing (\n, \t, \0, etc.)
  - 46 example programs across 14 categories with search
  - Sub-step mode for loop/condition internals
  - Drilldown modal for nested structs/arrays
  - Multi-tab editor with localStorage persistence
  - Step scrubber for quick navigation
  - Resizable panels and fullscreen mode
  - Update test count (~830 → ~837)
- **Files:** `README.md`
- **Depends on:** nothing
- **Verification:** Features list matches actual capabilities

### Step 4: Update CONTRIBUTING.md
- **What:** Update test count from "~600" to "~837"
- **Files:** `CONTRIBUTING.md`
- **Depends on:** nothing
- **Verification:** Accurate count

## Edge Cases
| Case | Expected behavior | How handled |
|------|------------------|-------------|
| Feature inventory references from other docs | Links to feature-inventory.md still work | File path unchanged, just content trimmed |
| Architecture.md directory tree drift | May have files not listed | Verify against actual `src/lib/` structure |

## Verification
- [ ] `feature-inventory.md` contains only C language feature sections
- [ ] Test counts accurate across all docs
- [ ] No broken cross-references between docs
- [ ] `npm run build` succeeds (docs aren't in build, but sanity check)
