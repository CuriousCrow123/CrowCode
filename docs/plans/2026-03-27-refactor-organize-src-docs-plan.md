---
title: Organize src/ and docs/ Directories
type: refactor
status: completed
date: 2026-03-27
---

# Organize src/ and docs/ Directories

## Context

After rapid development, both `src/` and `docs/` have accumulated dead code, orphaned files, and completed plans still marked as active. Specific problems:

**src/ issues:**
- `src/lib/programs/` (basics.ts, loops.ts) — pre-authored programs not imported by the app. Only used by their own test file. The app runs entirely on the interpreter + test-programs.ts dropdown.
- `src/lib/components/ProgramStepper.svelte` — dead component. Not imported by any page or component. The orchestration logic was moved into `+page.svelte` during the UI overhaul.
- `src/lib/engine/builders.ts` — only imported by the programs layer and its own tests. Not used by the interpreter or components.
- `src/lib/index.ts` — empty SvelteKit scaffold placeholder (just a comment).
- `src/lib/types.ts` — re-export layer (`./api/types`). Used by `summary.ts` and components. Keep as-is — it's a legitimate convenience re-export.

**docs/ issues:**
- 15 plan files, 4 still marked `active` but actually implemented:
  - `feat-line-mode-substep-descriptions-plan.md` — implemented in commit `604c047`
  - `refactor-ui-overhaul-plan.md` — implemented (EditorTabs.svelte exists, tabs working)
  - `test-manual-program-suite-plan.md` — implemented (60 tests in manual-programs.test.ts)
  - `refactor-whole-codebase-plan.md` — NOT implemented (still active, describes deleting programs layer)
- `docs/plans/c-interpreter/` subdirectory with intermediate planning files (phase1_codebase.md, phase2_research.md) — should live under the c-interpreter plan, not as loose files
- `docs/research/claude-code-skill-design-refactoring-workflows/` — orphaned intermediate files with no final report
- 5 research reports with intermediate `phase1_facets.md` and `phase2_findings.md` subdirectories that were only useful during research

## Design

### Approach: Delete dead code, archive completed plans, clean intermediates

**Guiding principles:**
1. If it's not imported, it's dead — delete it
2. Completed plans are historical records — mark as completed, don't delete
3. Research intermediates (phase1/phase2 files) served their purpose during research — delete the intermediates, keep the final reports
4. Don't move files that would break existing imports — prefer deletion over reorganization

### What changes

**src/ — Delete dead code:**
- Delete `src/lib/programs/` directory (basics.ts, loops.ts, index.ts, programs.test.ts) — not imported by the app
- Delete `src/lib/components/ProgramStepper.svelte` — not imported anywhere
- Delete `src/lib/engine/builders.ts` and `builders.test.ts` — only used by deleted programs layer
- Delete `src/lib/index.ts` — empty scaffold file
- Keep `src/lib/types.ts` — it's a legitimate re-export used by summary.ts and components

**docs/ — Clean up plans and research:**
- Mark 3 implemented plans as `status: completed`
- Delete `docs/plans/c-interpreter/` intermediates — the main plan is already completed and 60KB; appending more adds no value
- Delete orphaned `docs/research/claude-code-skill-design-refactoring-workflows/` (no final report)
- Delete all `phase1_facets.md` and `phase2_findings.md` intermediate files from research subdirectories (keep only the final `.md` reports)
- Delete empty research subdirectories after intermediate cleanup

**Documentation updates:**
- `docs/architecture.md` — remove programs layer, ProgramStepper, builders from directory listing and component descriptions. Update engine barrel exports.
- `CLAUDE.md` — remove programs/basics.ts, programs/loops.ts, builders.ts from Key Files table
- `CONTRIBUTING.md` — remove "Adding a Pre-authored Program" section. Update "Adding an Engine Feature" to note builders were removed.
- `docs/interpreter-status.md` — remove `programs.test.ts` and `builders.test.ts` from coverage table, update total test count

## Files

### Delete
| File | Why |
|------|-----|
| `src/lib/programs/basics.ts` | Not imported by app — only by own test |
| `src/lib/programs/loops.ts` | Not imported by app — only by own test |
| `src/lib/programs/index.ts` | Barrel for deleted module |
| `src/lib/programs/programs.test.ts` | Tests for deleted module |
| `src/lib/components/ProgramStepper.svelte` | Dead component — not imported anywhere |
| `src/lib/engine/builders.ts` | Only imported by deleted programs layer |
| `src/lib/engine/builders.test.ts` | Tests for deleted builders |
| `src/lib/index.ts` | Empty SvelteKit scaffold placeholder |
| `docs/plans/c-interpreter/phase1_codebase.md` | Intermediate planning file — content is in the main plan |
| `docs/plans/c-interpreter/phase2_research.md` | Intermediate planning file — content is in the main plan |
| `docs/research/claude-code-skill-design-refactoring-workflows/` | Orphaned intermediates with no final report |
| `docs/research/adr-best-practices-small-open-source-projects/` | Intermediates — final report exists at parent level |
| `docs/research/c-wasm-browser-execution/` | Intermediates — final report exists at parent level |
| `docs/research/codebase-documentation-best-practices/` | Intermediates — final report exists at parent level |
| `docs/research/readme-best-practices-educational-ts-projects/` | Intermediates — final report exists at parent level |

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `docs/architecture.md` | Remove programs layer, ProgramStepper, builders from directory listing and descriptions. Update engine barrel. | Dead code removed from codebase |
| `docs/plans/2026-03-26-feat-line-mode-substep-descriptions-plan.md` | `status: active` → `status: completed` | Implemented in commit `604c047` |
| `docs/plans/2026-03-26-refactor-ui-overhaul-plan.md` | `status: active` → `status: completed` | Implemented — EditorTabs.svelte, tabs, persistent code all working |
| `docs/plans/2026-03-26-test-manual-program-suite-plan.md` | `status: active` → `status: completed` | Implemented — 60 tests in manual-programs.test.ts |
| `CLAUDE.md` | Remove `programs/basics.ts`, `programs/loops.ts`, `builders.ts` from Key Files | Files deleted |
| `CONTRIBUTING.md` | Remove "Adding a Pre-authored Program" section. Adjust "Adding an Engine Feature" | Programs layer deleted |
| `src/lib/engine/index.ts` | Remove builders re-export | builders.ts deleted |
| `src/lib/engine/integration.test.ts` | Rewrite 10 tests that import `basics`/`loops` with inline `Program` literals | Dependencies deleted |
| `docs/interpreter-status.md` | Remove deleted test files from coverage table, update total | Test files deleted |
| `docs/plans/2026-03-26-refactor-whole-codebase-plan.md` | Add note that Part C was completed by this plan | Overlap resolved |

## Steps

### Step 1: Delete dead src/ files and fix integration.test.ts
- **What:** Remove the programs layer, ProgramStepper, builders, and empty index.ts. Rewrite `integration.test.ts` to remove its dependency on `basics`/`loops` — replace with interpreter-generated programs or inline test data. Remove builders re-export from `src/lib/engine/index.ts`.
- **Files:** 8 files deleted, `engine/index.ts` modified, `engine/integration.test.ts` rewritten
- **Depends on:** None
- **Details on integration.test.ts:** Currently imports `basics` and `loops` for 10 of 11 tests. Keep the 1 inline snapshot-isolation test. For the other 10, either:
  - (a) Inline small `Program` literals that test the same properties (scope lifecycle, sub-steps, diffing), or
  - (b) Use `interpretSync()` to generate programs from short C strings
  - Option (a) is simpler — these tests are about the engine, not the interpreter
- **Verification:** `npm test` — expect count to drop by ~45 (programs.test.ts: 28, builders.test.ts: 17). Remaining tests pass. `npm run build` succeeds.

### Step 2: Clean up docs/ (plans + research)
- **What:** Mark 3 implemented plans as completed. Delete `docs/plans/c-interpreter/` intermediates. Delete all research intermediate subdirectories. Delete orphaned `claude-code-skill-design-refactoring-workflows/`.
- **Files:** 3 plan files modified, `docs/plans/c-interpreter/` deleted, 5 research subdirectories deleted
- **Depends on:** None (can run parallel with Step 1)
- **Verification:** No research subdirectories remain. `grep "status: active" docs/plans/*.md` returns only this plan and the whole-codebase refactor plan.

### Step 3: Update all documentation
- **What:** Update architecture.md, CLAUDE.md, CONTRIBUTING.md, and interpreter-status.md to reflect deletions.
- **Files:** `docs/architecture.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/interpreter-status.md`
- **Depends on:** Step 1 (need final test count and confirmed file list)
- **Changes:**
  - architecture.md: remove programs layer, ProgramStepper, builders from directory listing and descriptions. Update engine barrel description. Update test counts.
  - CLAUDE.md: remove `programs/basics.ts`, `programs/loops.ts`, `builders.ts` from Key Files.
  - CONTRIBUTING.md: remove "Adding a Pre-authored Program" section.
  - interpreter-status.md: update total and per-file test counts. Remove `programs.test.ts` and `builders.test.ts` from coverage table.
- **Verification:** `grep -r "programs/basics\|programs/loops\|ProgramStepper\|builders\.ts" docs/ CLAUDE.md CONTRIBUTING.md` returns nothing. Test counts match `npm test` output.

### Step 4: Update whole-codebase refactor plan
- **What:** After Steps 1-3 execute, Part C of the whole-codebase refactor plan (Steps 8-11: delete programs layer) will be done. Add a note to that plan indicating Part C was completed by this plan.
- **Files:** `docs/plans/2026-03-26-refactor-whole-codebase-plan.md`
- **Depends on:** Steps 1-3 (must be executed first)
- **Verification:** Plan accurately reflects Part C completion

### Step 5: Final verification
- **What:** Run full test suite, build, type check. Grep for references to deleted files.
- **Files:** None
- **Depends on:** All previous steps
- **Verification:**
  - `npm test` passes (expect ~590-600 tests, down from 645)
  - `npm run check` passes
  - `npm run build` succeeds
  - `grep -r "programs/basics\|programs/loops\|ProgramStepper\|builders\.ts" docs/ CLAUDE.md CONTRIBUTING.md` returns nothing

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| `integration.test.ts` imports `basics`/`loops` | **Will break** — 10 of 11 tests depend on them | Rewrite in Step 1: replace with inline `Program` literals |
| `snapshot-regression.test.ts` imports programs | **Verified safe** — uses `interpretSync`, not programs layer | No action needed |
| `engine/index.ts` re-exports builders | **Will break** if not updated | Remove re-export in Step 1 alongside file deletion |
| Whole-codebase refactor plan overlaps on Part C | This plan completes Part C | Add note to refactor plan in Step 4 |
| Research final reports reference phase files | **Verified safe** — no final reports contain links to intermediates | No action needed |

## Verification

- [ ] `npm test` passes (~600 tests, down from 645)
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] No references to deleted files in any documentation
- [ ] `src/lib/programs/` directory does not exist
- [ ] `src/lib/components/ProgramStepper.svelte` does not exist
- [ ] `src/lib/engine/builders.ts` does not exist
- [ ] No research subdirectories remain (only `.md` files in `docs/research/`)
- [ ] 3 previously-active plans marked completed
- [ ] Whole-codebase refactor plan updated with Part C completion note
- [ ] `integration.test.ts` still passes without importing from `$lib/programs`

## References

- [Architecture doc](../architecture.md) — directory listing and component descriptions to update
- [Whole-codebase refactor plan](2026-03-26-refactor-whole-codebase-plan.md) — Part C overlaps with this plan
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — "Adding a Pre-authored Program" section to remove
