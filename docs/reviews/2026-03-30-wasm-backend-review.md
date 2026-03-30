# WASM Backend Review — 55 commits since a935f52

**Date:** 2026-03-30
**Branch:** `feat/wasm-compilation-backend`
**Scope:** 28,602 lines added across 121 files (55 commits)
**Tests:** 950 pass, 0 failures, 1 skipped

## Summary

Complete WASM compilation backend: C source → tree-sitter parse → `__crow_*` instrumentation → xcc in-browser compiler → WASM execution with op collection → Program/snapshots. Plus 47-program diagnostic audit, 11+ systemic bug fixes, interactive stdin, step descriptions, and UI integration with backend toggle.

Architecture is clean and well-separated. The pipeline is correct for the common case. This review identifies issues at the edges — memory growth, complex lvalues, loop exit visibility, and contract compliance.

---

## Critical Issues

### C1. Detached buffer after memory.grow

**Files:** `op-collector.ts:444`, `runtime.ts:97`
**Impact:** Data corruption / crash

`onRealloc` calls `onMalloc` (which calls the real WASM `malloc`), then does `memoryBuffer.copyWithin()` without calling `refreshMemory()` first. If `malloc` triggered `memory.grow`, the `DataView` and `Uint8Array` are detached and the copy reads garbage or throws.

Similarly, the `puts` handler in `runtime.ts:97` calls `collector.readCString(strPtr)` without refresh. If a prior call triggered memory growth, the read uses a stale buffer.

**Fix:** Call `refreshMemory()` in `onRealloc` between `onMalloc` and `copyWithin`. Either make `readCString` call `refreshMemory()` internally, or refresh in the `puts` handler before calling it.

### C2. Complex lvalue updates silently dropped

**File:** `transformer.ts:461-476`
**Impact:** Silent incorrect visualization

`arr[i]++` or `p->x++` as statements generate `__crow_set("arr[i]", &arr[i], line)`. The op-collector's `varRegistry` is keyed by simple variable names, so `varRegistry.get("arr[i]")` returns `undefined` and the mutation is silently invisible in the visualization.

**Fix:** For non-identifier lvalue updates, emit a different instrumentation pattern that identifies the parent variable and index/field separately, or track compound lvalues in the registry.

### C3. For-loop final condition uses substep

**File:** `transformer.ts:557-603`
**Impact:** Broken line-mode stepping

The for-loop condition check is always emitted as `__crow_substep_col`. The failing final check that exits the loop is also a substep. In line mode, substeps are hidden — the loop scope is removed without a visible anchor step, making the loop "just vanish."

The op-generation requirements specify: "Final failing check is the anchor for exiting the loop."

**Fix:** Emit the for-loop condition as `__crow_step_col` (anchor) rather than `__crow_substep_col`, or add a dedicated anchor step after the loop exits.

### C4. free() doesn't set pointer to '(dangling)'

**File:** `op-collector.ts:455-471`
**Impact:** Misleading visualization

After `free(p)`, the pointer variable `p` still shows the old heap address. The contract requires a `setValue` op setting the pointer to `'(dangling)'`.

**Fix:** In `onFree`, look up the variable whose value points to the freed address and emit `setValue(varEntryId, '(dangling)')`.

### C5. Null pointer shows 'UNSET' instead of 'NULL'

**File:** `op-collector.ts:739`
**Impact:** Confusing display

`readValue` returns `'UNSET'` when a pointer value is zero. Users writing `int *p = NULL` see `UNSET`. The contract specifies `'NULL'`.

**Fix:** Change `'UNSET'` to `'NULL'` on line 739.

### C6. Entry ID format violations

**File:** `op-collector.ts:309, 761, 787`
**Impact:** Contract violation

IDs use `::` separator (`main::x`), `.` for struct fields (`main::player.x`), and `[]` for array elements (`main::arr[0]`). The contract specifies dash-separated IDs with no dots or brackets.

**Fix:** Use `-` as the separator throughout: `main-x`, `main-player-x`, `main-arr-0`.

### C7. %ld scanf specifier silently dropped

**File:** `transformer.ts:977-988`
**Impact:** Silent incorrect behavior

`parseFormatSpecifiers` parses `%ld` as length `'l'` + spec `'d'`, producing `"ld"`. `scanfVariant` has no case for `"ld"`, so it returns `null`. `scanf("%ld", &x)` silently does nothing; the variable stays uninitialized.

**Fix:** Add `case 'ld': case 'li': return '__crow_scanf_int'` (or a dedicated `__crow_scanf_long` if long needs different handling).

---

## Warnings

### W1. No timeout on main-thread WASM execution

**File:** `runtime.ts:132`

`_start()` is synchronous on the main thread. The step limit only catches instrumented loops. Uninstrumented tight loops (inside library functions or between instrumentation points) freeze the browser tab with no escape. No Web Worker means no `terminate()`.

**Mitigation:** Move `executeWasm` to a `?worker` module with a `setTimeout`-based watchdog, or document this as a known limitation and ensure transformer coverage of all loops is treated as a hard safety requirement.

### W2. Variable shadowing broken

**File:** `op-collector.ts:290-301`

`varRegistry` is a flat `Map<string, VarInfo>` keyed by name only. When an inner scope declares `int i` shadowing an outer `int i`, the inner overwrites the registry entry. When the inner scope pops, the outer's `i` entry is gone — subsequent `onSet("i", ...)` calls fail silently.

**Fix:** Key `varRegistry` by `scopeId + name` or use a scope-chained lookup.

### W3. Duplicate getParser() functions

**File:** `wasm-backend/service.ts:15-30`, `interpreter/service.ts`

Both services independently initialize tree-sitter with separate module-level caches. Switching backends in the same session calls `Parser.init()` twice, which is a no-op in current tree-sitter versions but fragile.

**Fix:** Extract a shared `src/lib/parser.ts` singleton.

### W4. Compiler artifact loading race

**File:** `compiler.ts:38-86`

Concurrent `compile()` calls both see `cachedHeaders === null` and start parallel fetches. Results are correct (last write wins with identical data) but wasteful.

**Fix:** Use a singleton `loadArtifactsPromise` that both calls await.

### W5. requestAnimationFrame in non-browser contexts

**File:** `service.ts:60-61, 72-73`

`requestAnimationFrame` yields won't work in SSR or Web Workers. Currently safe because the code path only runs from user interaction, but fragile.

**Fix:** Replace with `setTimeout(resolve, 0)`.

### W6. Struct double field alignment

**File:** `op-collector.ts:782`

Struct field alignment uses `Math.min(fieldSize, 4)` — a 4-byte cap. If xcc aligns `double` fields to 8 bytes (natural alignment), the JS-side layout reads from wrong addresses. Must match xcc's actual ABI.

**Verify:** Check xcc's struct layout for `struct { char c; double d; }` and confirm the 4-byte cap is correct.

### W7. onCalloc patches last op in currentOps

**File:** `op-collector.ts:419-425`

`onCalloc` calls `onMalloc` then mutates the last entry in `currentOps` to change `name` and `allocator`. Fragile if `onMalloc` ever pushes additional ops before it.

### W8. typeHeapBlock sets value to type string

**File:** `op-collector.ts:916`

For single structs, `setValue(block.entryId, 'struct Player')` is emitted. The contract says parent values should be `''` (children hold the values). The HeapCard UI then uses this value string to display the type — a coupling between op-collector output format and UI rendering logic.

### W9. printf env import is a silent no-op

**File:** `runtime.ts:92-95`

If xcc emits a direct `call $printf` import (bypassing fd_write), output silently disappears. Consider logging a warning when this import is invoked.

### W10. wasm! non-null assertion in closure

**File:** `service.ts:139, 165`

`wasm!` is asserted non-null inside `runWithStdin`. The null check on line 124 returns early, so it's safe in practice, but TypeScript can't prove this across the closure boundary.

**Fix:** Capture `const wasmBytes = wasm` before the closure.

---

## Test Gaps

### Missing test coverage

| Area | Status | Risk |
|------|--------|------|
| Struct field mutation values | Not verified (only checks entry exists) | High — field-level bugs invisible |
| Pointer-to-heap writes (`*p = 42`) | Untested at any level | High — core feature |
| `use-after-free` status | In type system, never exercised | Medium |
| `realloc` | Zero tests (unit, transformer, integration) | Medium |
| `do-while` loops | Completely absent | Medium |
| `description` / `evaluation` strings | Never asserted | Medium — primary learning text |
| `colStart` / `colEnd` column ranges | Never verified | Medium — sub-step highlighting |
| `scanf` IoEvent round-trip | Untested end-to-end | Medium |
| Variable shadowing | Untested (and broken, see W2) | Medium |
| Dangling pointer display | Untested (and missing, see C4) | High |
| Null pointer display | Untested (shows UNSET, see C5) | Medium |
| Snapshot isolation (mutation safety) | Never tested | Low — relies on structuredClone |
| Step limit through integration pipeline | Only unit-tested | Low |
| Diagnostic tests | Zero `expect()` assertions — manual audit only | Low |

### Weak assertions in existing tests

- `p2.1 — Simple Struct`: checks `findEntry(snap, 'p')` exists but never checks `p.x = 30`, `p.y = 35`
- `p4.1 — malloc/free`: checks `setHeapStatus: 'freed'` but not heap block value or dangling pointer
- `p6.1 — Function Call`: checks scope `add` exists twice but not that `removeEntry` ops match
- `p13.3 — Float Arithmetic`: `toBeCloseTo(78.54, 0)` — precision 0 means only integer part checked
- Transformer for-loop test: doesn't verify `__crow_substep` vs `__crow_step` distinction
- Op-collector heap test: never populates struct children on heap blocks

---

## What's Done Well

- **Pipeline architecture** — clean separation of concerns across 6 modules
- **47-program diagnostic audit** — systematic, thorough, documented
- **Interactive stdin** — progressive re-execution model works correctly
- **WASI shim** — handles both compiler and user program contexts cleanly
- **Memory safety features** — leak detection, use-after-free detection, step merging
- **UI integration** — backend toggle, progress bar, cache invalidation on switch
- **Correct edge cases** — `free(NULL)` no-op, `realloc(NULL, n)` → `malloc`, `realloc(p, 0)` → `free`
- **Scope ID generation** — stable across function re-invocations via counter
- **`onDecl` dedup** — loop variable re-declarations emit `setValue` instead of duplicate `addEntry`
- **Commit discipline** — atomic commits, `type(scope): description` format throughout
- **`structuredClone` isolation** in `applyOps` ensures snapshot immutability
- **`runGeneration` counter** correctly aborts stale runs on rapid re-execution

---

## Recommended Fix Order

1. **C1** — Detached buffer (data corruption risk, straightforward fix)
2. **C4 + C5** — Dangling pointer + NULL display (core visualization correctness)
3. **C7** — `%ld` scanf (silent data loss, one-line fix)
4. **C3** — For-loop anchor rule (broken line-mode UX)
5. **W2** — Variable shadowing (incorrect state after inner scope pops)
6. **Tests** — struct fields, heap writes, use-after-free, realloc, do-while, scanf IoEvents
7. **C6** — ID format (if any downstream code depends on the convention)
8. **C2** — Complex lvalue updates (design decision needed)
9. **W1** — Web Worker for timeout protection (architectural change)
