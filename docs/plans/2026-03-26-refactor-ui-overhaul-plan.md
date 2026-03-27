---
title: UI Overhaul — Unified Editor with Tabs and Persistent Code
type: refactor
status: active
date: 2026-03-26
deepened: 2026-03-26
---

# UI Overhaul — Unified Editor with Tabs and Persistent Code

## Enhancement Summary

**Deepened on:** 2026-03-26
**Research agents used:** CodeMirror 6 docs, localStorage/Svelte 5 patterns, Svelte 5 races reviewer, architecture strategist, accessibility reviewer, code simplicity reviewer, UX spec flow analyzer, TypeScript reviewer

### Key Improvements from Research
1. **Compartment-based readonly toggle** — use CodeMirror `Compartment` instead of recreating EditorState
2. **Simplified store** — cut tab renaming, schema versioning; auto-name tabs; ~50 lines total
3. **Architecture fix** — keep page thin; extract `InterpreterService`; keep ProgramStepper as stepping orchestrator
4. **Svelte 5 reactivity safety** — single state machine to avoid effect ordering races; `editorReady` signal pattern; debounced localStorage writes
5. **Accessibility** — ARIA tab pattern, live regions for step announcements, keyboard shortcut conflict fix, error alerts
6. **UX gaps filled** — clear stale visualization on Run, confirm before tab delete, abort guard for stale runs, step limit warning

### Simplifications Applied (YAGNI)
- Cut double-click-to-rename tabs (auto-name instead)
- Cut schema versioning (v1 has no users to migrate)
- Cut dedicated quota/corruption handling (try/catch is sufficient)
- Deferred: mobile optimization, step scrubber/slider, tab reordering

---

## Context

The current UI has 3 hardcoded tabs (Memory Basics, For Loops, Custom) with different experiences — preset programs use a read-only CodeMirror viewer, while Custom uses a plain `<textarea>`. This is confusing for students. The goal is a single, unified experience: a beautiful code editor where students write C, a Run button to visualize, and a memory view. Code should persist across refreshes so students don't lose work.

### Current state
- `+page.svelte`: Tab bar switching between preset programs and CustomEditor
- `CustomEditor.svelte`: `<textarea>` + Run button + test program dropdown → calls `interpretSync()`
- `ProgramStepper.svelte`: StepControls (play/pause/speed) + CodeEditor (read-only CodeMirror) + MemoryView
- `StepControls.svelte`: Prev/Next, Play/Pause, Speed slider, Sub-step toggle, step counter, description
- `CodeEditor.svelte`: Read-only CodeMirror with line/range highlighting

### Problems
1. Three separate modes with inconsistent UX
2. Custom mode uses plain textarea — no syntax highlighting while editing
3. Play/Pause/Speed adds complexity students don't need yet
4. Stepper panel is visually heavy
5. Code is lost on refresh

## Design

### Layout (single screen, no mode switching)

```
┌─────────────────────────────────────────────────────┐
│  CrowCode                                          │
├─────────────────────────────────────────────────────┤
│  [ Tab 1 ] [ Tab 2 ] [ + ]  [Examples ▾] [Edit|Run]│
├────────────────────────┬────────────────────────────┤
│                        │                            │
│   CodeMirror Editor    │     Memory View            │
│   (editable or         │     (ScopeCard, HeapCard)  │
│    read-only with      │                            │
│    highlighting)       │                            │
│                        │                            │
├────────────────────────┴────────────────────────────┤
│  ◀ Prev   Step 3 / 42   Next ▶   Sub-steps   desc  │
└─────────────────────────────────────────────────────┘
```

### Key decisions

1. **Single CodeMirror instance — dual-mode via Compartment.** Use a `Compartment` to toggle `EditorState.readOnly` dynamically without recreating the editor. Use `EditorView.updateListener.of()` to extract edits. Use `view.setState()` when switching between tabs (different documents).

   **Research insight — Compartment reconfiguration pattern:**
   ```typescript
   const readOnlyCompartment = new Compartment();
   // Toggle: view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(value)) })
   // Tab switch: view.setState(EditorState.create({ doc: newSource, extensions: [...] }))
   ```
   Compartment reconfigure is lightweight (one transaction). `setState` is fine for tab switches — documents in an educational tool are small.

2. **Editor tabs — auto-named, minimal store.** Stored in `localStorage` as `{ tabs: [{name, source}], active: number }`. Tabs are auto-named ("Program 1", "Program 2", ...). A "+" button adds a new tab. No rename UI (YAGNI). Confirm dialog before deleting a tab.

3. **Persistence via localStorage** — debounced 500ms writes using `$effect` cleanup pattern. `beforeunload` safety net for final save. SSR-safe via `browser` guard from `$app/environment`. No schema versioning needed for v1.

   **Research insight — debounce pattern:**
   ```typescript
   $effect(() => {
     const snapshot = $state.snapshot(tabStore);
     const t = setTimeout(() => save(snapshot), 500);
     return () => clearTimeout(t);  // $effect cleanup = natural debounce
   });
   ```

4. **Minimal stepper bar** — one compact row: `◀ Prev | Step X / Y | Next ▶ | Sub-steps | description`. No play/pause, no speed slider.

5. **Three-state mode machine** (not two):
   - **editing**: CodeMirror editable, no stepper, Run button active
   - **running**: brief transitional state while `interpretSync` executes, editor locked
   - **viewing**: CodeMirror read-only with highlighting, stepper visible, Edit button visible

   **Research insight — use discriminated union for impossible-state prevention:**
   ```typescript
   type AppMode =
     | { state: 'editing' }
     | { state: 'running' }
     | { state: 'viewing'; program: Program; errors: string[] };
   ```

6. **Remove preset programs as tabs** — the test program dropdown stays as "Load example..." in the toolbar. Loading an example sets the active tab's source.

7. **Keep page thin — extract interpreter logic.** Parser init and `interpretSync` call go into `src/lib/interpreter/service.ts` (a lazy-loaded module), not directly into `+page.svelte`. The page only orchestrates: tabs + mode + wiring components.

### Alternatives considered
- **Monaco editor**: Heavier, already have CodeMirror installed and themed
- **Keep preset tabs**: Adds complexity, students should write their own code with examples loadable on demand
- **Separate edit/view pages**: Single page is simpler, just toggle read-only
- **Tab renaming**: YAGNI for v1, auto-names suffice

### Design decisions from research

**Tab switch state model:** Destroy and recreate ProgramStepper on each Run (via `{#key}`). Visualization state (step index, sub-step mode) is not preserved per-tab. This matches the current pattern, is simpler, and students rarely switch tabs mid-visualization.

**Clear stale visualization on Run:** When Run is clicked, clear the previous program immediately (`program = null`) before interpretation starts. This prevents showing stale visualization alongside new errors.

**Stale run abort guard:** If the user switches tabs while `interpretSync` is running (via lazy load), discard the result using a generation counter:
```typescript
let runGeneration = 0;
async function run() {
  const thisRun = ++runGeneration;
  // ... await parser/interpret ...
  if (thisRun !== runGeneration) return; // stale
}
```

**Step limit UX:** When code produces exactly 500 steps (the `maxSteps` limit), show a distinct warning: "Program truncated at 500 steps." This is separate from errors.

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/routes/+page.svelte` | Rewrite — unified layout with EditorTabs, Run/Edit, mode state machine, wires components | New layout |
| `src/lib/components/CodeEditor.svelte` | Add Compartment-based readonly toggle, `onchange` via updateListener, `view.setState()` for tab switch | Dual-mode editor |
| `src/lib/components/StepControls.svelte` | Remove play/pause, speed slider. Single compact row. Add `aria-live` on step counter, `aria-pressed` on sub-step toggle | Simplify + a11y |
| `src/lib/components/ProgramStepper.svelte` | Remove auto-play logic. Fix keyboard shortcut to skip `.cm-editor` targets | Remove play/pause + a11y |

### Create
| File | Purpose |
|------|---------|
| `src/lib/components/EditorTabs.svelte` | Tab bar — auto-named tabs, add/close, ARIA tablist pattern |
| `src/lib/stores/editor-tabs.svelte.ts` | localStorage-backed `$state` store for tabs (`.svelte.ts` for runes) |
| `src/lib/interpreter/service.ts` | Lazy-loaded interpreter service: `runProgram(source) → { program, errors }` |

### Delete
| File | Why |
|------|-----|
| `src/lib/components/CustomEditor.svelte` | Functionality split between page layout and interpreter service |

## Steps

### Step 1: Create editor tabs store
- **What:** Create `src/lib/stores/editor-tabs.svelte.ts` — factory function returning a reactive store.
  - Type: `{ name: string; source: string }[]` + `active: number`
  - Functions: `addTab()`, `removeTab(index)`, `updateSource(index, source)`, `setActiveTab(index)`
  - Auto-naming: "Program 1", "Program 2", etc.
  - Load from localStorage on init, fallback to default tab on parse failure (single try/catch)
  - `initPersistence()` function for debounced saves (call from page component)
  - SSR-safe: guard all `localStorage` access with `browser` from `$app/environment`
  - Use `$state.snapshot()` before `JSON.stringify` to strip reactive proxies
- **Files:** `src/lib/stores/editor-tabs.svelte.ts`
- **Depends on:** nothing
- **Verification:** Unit test — create store, add/remove tabs, verify localStorage round-trip

**Implementation details from research:**
- Use `.svelte.ts` extension (not `.ts`) to enable `$state` runes at module level
- Factory function pattern (`createEditorTabStore()`) for testability — no module singletons
- Debounce via `$effect` cleanup: `setTimeout` + `return () => clearTimeout`
- Add `beforeunload` listener as safety net for final save
- Runtime validation on load: check `Array.isArray(data.tabs)`, filter valid entries, fallback to defaults

### Step 2: Create EditorTabs component
- **What:** Svelte component rendering tab bar with ARIA tablist semantics.
  - Each tab: name label + close button (hidden if only 1 tab)
  - "+" button at end to add new tab
  - Confirm dialog (`window.confirm`) before deleting a tab
  - `role="tablist"`, `role="tab"`, `aria-selected` on each tab
  - Click to switch, keyboard arrow navigation between tabs (roving tabindex)
- **Files:** `src/lib/components/EditorTabs.svelte`
- **Depends on:** Step 1
- **Verification:** Manual — tabs render, add/close work, ARIA attributes present

### Step 3: Make CodeEditor dual-mode
- **What:** Refactor to support edit and readonly modes via CodeMirror Compartment.
  - Add `readOnly` prop (camelCase, default true for backwards compat)
  - Wrap `EditorState.readOnly` in a `Compartment`, reconfigure on prop change
  - Add `onchange` callback prop via `EditorView.updateListener.of()` (fires only when `docChanged`)
  - Add document swap support: call `view.setState(EditorState.create({...}))` when source prop changes to a different document (tab switch)
  - Keep `view` as plain variable (NOT `$state`) to avoid reactive cycles
  - Separate `$effect` blocks: (1) creation on `container`, (2) readonly toggle, (3) document sync with no-op guard, (4) highlight update on `location`
  - Add `editorReady` `$state` signal so highlight effect re-runs after creation
  - Keep all existing highlighting logic for readonly mode
- **Files:** `src/lib/components/CodeEditor.svelte`
- **Depends on:** nothing
- **Verification:** Manual — can type when readOnly=false, highlighting works when readOnly=true, tab switch swaps content

**Critical Svelte 5 reactivity notes:**
- Document sync effect must include a no-op guard (`if (currentDoc === source) return`) to prevent infinite loops when editing
- Do NOT merge creation and sync effects — separate concerns prevent ordering issues
- The `editorReady` signal solves the problem of highlight effect running before `view` is assigned

### Step 4: Simplify StepControls
- **What:** Remove `playing`, `speed`, `ontoggleplay`, `onspeedchange` props. Single compact row.
  - Keep: Prev/Next buttons, step counter, sub-step toggle, description/evaluation
  - Add `role="status"` + `aria-live="polite"` on step counter for screen reader announcements
  - Add `aria-pressed={subStepMode}` on sub-step toggle button
  - Extract named `StepControlsProps` type for clarity
- **Files:** `src/lib/components/StepControls.svelte`
- **Depends on:** nothing
- **Verification:** `npm run check` passes

### Step 5: Simplify ProgramStepper
- **What:** Remove `playing`, `speed` state and auto-play `$effect`. Remove Space keyboard shortcut.
  - Fix keyboard handler to skip events from `.cm-editor` (CodeMirror uses contenteditable, not textarea):
    ```typescript
    if (e.target instanceof HTMLElement && e.target.closest('.cm-editor')) return;
    ```
  - Keep: step navigation, sub-step toggle, arrow key shortcuts (only active when not in editor)
  - Keep ProgramStepper as the full stepping orchestrator (snapshots, navigation, diff, keyboard)
- **Files:** `src/lib/components/ProgramStepper.svelte`
- **Depends on:** Step 4
- **Verification:** `npm run check` passes

### Step 6: Extract interpreter service
- **What:** Create `src/lib/interpreter/service.ts` encapsulating parser init and interpretation.
  - Exports: `async function runProgram(source: string): Promise<{ program: Program; errors: string[] }>`
  - Internally: lazy `import('web-tree-sitter')` + `import('$lib/interpreter/index')` (keeps WASM out of initial bundle)
  - Caches parser instance across calls
  - `maxSteps: 500` hardcoded
  - Returns a distinct warning when step limit is hit
- **Files:** `src/lib/interpreter/service.ts`
- **Depends on:** nothing
- **Verification:** Existing interpreter tests still pass

### Step 7: Rewrite page layout
- **What:** Rewrite `+page.svelte` as the unified layout:
  - Top: compact header
  - Below header: EditorTabs + "Load example..." dropdown + Edit/Run buttons
  - Main area: 2-column grid — CodeEditor (left) + MemoryView (right)
  - Below: StepControls (only visible in `viewing` state)
  - Mode state machine (single `$state<AppMode>`):
    - `{ state: 'editing' }` → CodeMirror editable, Run button green, stepper hidden
    - `{ state: 'running' }` → editor locked, "Running..." indicator
    - `{ state: 'viewing', program, errors }` → CodeMirror readonly with highlighting, stepper visible
  - Run button: clears stale program, calls `runProgram()` from service, transitions to `viewing`
  - Edit button: transitions to `editing`
  - Abort guard: generation counter to discard stale runs on tab switch
  - Wire up editor tabs store: call `initPersistence()` here
  - Error display with `role="alert"` for screen reader announcements
  - Use `<main>` landmark for the content area
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Steps 1–6
- **Verification:** Manual — full flow: edit → run → step through → edit again

**Architecture principle:** Page stays thin (~100 lines). It only orchestrates: tab selection, mode transitions, and component wiring. No parser logic, no snapshot computation.

### Step 8: Delete CustomEditor
- **What:** Remove `src/lib/components/CustomEditor.svelte`. Its logic is now split between `interpreter/service.ts` (parsing) and `+page.svelte` (UI wiring).
- **Files:** delete `src/lib/components/CustomEditor.svelte`
- **Depends on:** Step 7
- **Verification:** `npm run build` succeeds, no import errors

### Step 9: Polish and test
- **What:** Final pass:
  - Verify localStorage persistence (refresh keeps code and active tab)
  - Verify tab operations (add, close with confirm, switch)
  - Verify stepper works with keyboard shortcuts
  - Verify arrow keys work in CodeMirror edit mode (not intercepted by stepper)
  - Verify error display with `role="alert"`
  - Run full test suite
  - Adjust styling/spacing for responsive stacking below 768px
- **Files:** various
- **Depends on:** Step 8
- **Verification:** `npm test`, `npm run build`, `npm run check` all pass. Manual: full cycle works.

## Edge Cases
| Case | Expected behavior | How handled |
|------|------------------|-------------|
| Refresh with no localStorage | Create default tab with starter program | Store init try/catch with fallback |
| Delete last tab | Prevent — hide close button when only 1 tab | EditorTabs conditional |
| Run with syntax errors | Show errors below editor, stay in edit mode | `role="alert"` error display, mode stays `editing` |
| Run hits 500-step limit | Show distinct warning (not error): "Program truncated at 500 steps" | Separate warning from errors |
| Switch tabs while viewing | Reset to edit mode for new tab | Tab switch sets mode to `editing` |
| Switch tabs while running | Abort stale run via generation counter | `runGeneration` pattern |
| localStorage corrupted | Reset to defaults | try/catch around JSON.parse |
| localStorage write fails | Code works in session, console warning | try/catch around setItem |
| Arrow keys in CodeMirror edit mode | Normal cursor movement (not stepping) | Keyboard handler checks `.cm-editor` target |
| CodeMirror edit → source sync loop | No-op guard prevents infinite dispatch | `if (currentDoc === source) return` |
| Many tabs (20+) | Horizontal scroll in tab bar | CSS `overflow-x: auto` on tablist |
| Page load during SSR/prerender | No localStorage access, default state | `browser` guard from `$app/environment` |

## Accessibility Checklist
- [ ] Tab bar: `role="tablist"` / `role="tab"` / `aria-selected` / roving tabindex
- [ ] Step counter: `role="status"` + `aria-live="polite"` for screen reader announcements
- [ ] Sub-step toggle: `aria-pressed` attribute
- [ ] Error display: `role="alert"` for immediate announcement
- [ ] Keyboard shortcuts: skip events from `.cm-editor` contenteditable elements
- [ ] Page: `<main>` landmark
- [ ] Tab close buttons: only shown when >1 tab, accessible label

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] `npm run check` passes
- [ ] Code persists across page refresh
- [ ] Tab add/close/switch works
- [ ] Edit → Run → Step through → Edit cycle works
- [ ] Load example dropdown works
- [ ] Keyboard shortcuts (arrows, S) work in view mode only
- [ ] Arrow keys work normally in CodeMirror edit mode
- [ ] Screen reader: step changes announced, errors announced
- [ ] Responsive: stacks vertically below 768px

## Out of Scope (v2)
- Tab renaming (auto-names for now)
- Tab reordering / drag-and-drop
- Mobile-optimized layout
- Step scrubber/slider for large programs
- Web Worker interpretation (non-blocking)
- Undo for tab deletion (confirm dialog for now)
- Onboarding banner / first-time hints
- Schema versioning / localStorage migrations

## References
- Current components: `src/lib/components/` (CodeEditor, StepControls, ProgramStepper, CustomEditor)
- CodeMirror 6 Compartment docs: https://codemirror.net/docs/ref/#state.Compartment
- CodeMirror 6 updateListener: https://codemirror.net/docs/ref/#view.EditorView%5EupdateListener
- Existing interpreter API: `src/lib/interpreter/index.ts` — `interpretSync(parser, source, options)`
- Test programs: `src/lib/test-programs/` — reuse for "Load example" dropdown
- Svelte 5 `$app/environment`: `browser` guard for SSR safety
