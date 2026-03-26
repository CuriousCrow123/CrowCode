---
title: Extend Test Suite — Fill Coverage Gaps
type: test
status: completed
date: 2026-03-26
---

# Extend Test Suite — Fill Coverage Gaps

## Context

Current state: 510 passing, 1 skipped, 8 todo across 20 test files. The existing suite covers happy paths well but has gaps in:

1. **Unimplemented todos** — 8 planned tests never written
2. **Combinatorial edge cases** — operators at boundaries, mixed types
3. **Complex control flow** — nested break/continue, early return, multiple returns
4. **Pointer arithmetic** — scaling, multi-level indirection beyond basics
5. **Error paths** — what happens with bad programs (undefined vars, type mismatches)
6. **Step description quality** — descriptions user sees while stepping through

## Design

Add tests to `value-correctness.test.ts` and `manual-programs.test.ts` in focused batches. Each batch targets a specific gap category. No new test files needed.

**Approach:** Promote the 8 todos, then add new test groups for uncovered scenarios. Focus on features the interpreter *already supports* — don't test unsupported features (switch, enums, unions, function pointers).

## Steps

### Step 1: Promote todos to real tests
- **What:** Convert the 8 `it.todo` items into working tests (or mark as `it.skip` with reason if the feature genuinely doesn't work yet)
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Todos:**
  - Chained assignment `a = b = c = 0`
  - Short-circuit evaluation `ptr && ptr->valid`
  - While-loop sub-steps with evaluation strings
  - Do-while loop value progression
  - If/else condition evaluation as sub-step
  - Function returning malloc pointer used by caller
  - Array decay `int *p = arr` equals `&arr[0]`
  - `sizeof(long)` documents 32-bit model behavior
- **Verification:** `npm test` — todo count drops

### Step 2: Integer edge cases
- **What:** Test arithmetic at boundaries and with tricky operand combinations
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Tests:**
  - `INT_MAX + 1` wraps to `INT_MIN` (already partially tested, verify)
  - `INT_MIN / -1` behavior (implementation-defined in C)
  - `-1 % 3` sign of result (C99: result has sign of dividend)
  - `0 / 0` and `0 % 0` error paths
  - Shift edge cases: `1 << 31`, `x >> 32`, negative shift
  - `~0` = -1, `~(-1)` = 0
  - Chained comparison: `a < b < c` (parsed as `(a < b) < c`)
- **Verification:** `npm test`

### Step 3: Pointer arithmetic depth
- **What:** Test pointer +/- with various element sizes, multi-level pointers
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Tests:**
  - `p + 1` scales by `sizeof(*p)` for int*, char*, struct*
  - `p - q` pointer difference (if supported)
  - `p[i]` equivalence with `*(p + i)`
  - Pointer to struct, then `(p+1)->field`
  - `int **pp` double pointer (declare, assign, dereference)
  - `&arr[0]` == arr (array-to-pointer decay)
- **Verification:** `npm test`

### Step 4: Control flow edge cases
- **What:** Test tricky control flow the interpreter handles
- **Files:** `src/lib/interpreter/value-correctness.test.ts`, `manual-programs.test.ts`
- **Tests:**
  - Nested loop with break in inner only
  - Nested loop with continue in inner only
  - Early return from inside a loop
  - Multiple return statements in one function (first one wins)
  - Empty loop body `for (int i = 0; i < 5; i++) {}`
  - Empty if body `if (1) {} else { x = 2; }`
  - Deeply nested if/else (3+ levels)
  - While loop that never enters (condition false initially)
  - Do-while that runs exactly once
- **Verification:** `npm test`

### Step 5: Struct and memory patterns
- **What:** Test struct patterns not yet covered
- **Files:** `src/lib/interpreter/value-correctness.test.ts`, `manual-programs.test.ts`
- **Tests:**
  - Struct with all field types (int, char, pointer, nested struct)
  - sizeof(struct) with padding verification
  - Struct passed to function then modified locally (caller unchanged)
  - Two functions each allocating/freeing their own heap
  - malloc→use→free→re-malloc same pointer name
  - calloc then partial fill (some elements stay 0)
  - Free inside a function called from main
- **Verification:** `npm test`

### Step 6: Step description and metadata quality
- **What:** Verify step descriptions are clear and correct for the UI
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Tests:**
  - Declaration step shows computed value: `"int x = 35"` not `"int x = a + b"`
  - Assignment step shows operator: `"x += 10"`, `"x = x >> 1"`
  - For-loop init shows: `"for: int i = 0"`
  - For-loop check shows: `"for: check i < 5 → true/false"`
  - For-loop update shows correct new value: `"for: i++ → i = 1"`
  - Function call shows: `"Call add(a, b) — push stack frame"`
  - Return step shows value: `"return 120"`
  - Free step shows: `"free(p) — deallocate memory"`
  - malloc step shows: `"malloc(sizeof(int)) — allocate 4 bytes"`
- **Verification:** `npm test`

### Step 7: Error handling coverage
- **What:** Test error paths the interpreter should handle gracefully
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Tests:**
  - Undefined variable reference → error
  - Call to undefined function → error
  - Stack overflow from deep recursion → error (existing but verify message)
  - Double free → error or graceful handling
  - Null pointer dereference `int *p = 0; *p = 5;` → error
  - Use after free (read from freed pointer)
  - Multiple syntax errors in one program
  - Empty program `int main() { return 0; }` → valid, no steps
- **Verification:** `npm test`

### Step 8: New manual test programs
- **What:** Add complex programs to `docs/test-programs.md` and `manual-programs.test.ts`
- **Files:** `docs/test-programs.md`, `src/lib/interpreter/manual-programs.test.ts`
- **Programs:**
  - P12.1 — Bubble sort (nested loops, array swaps, function)
  - P12.2 — Stack calculator (push/pop with array)
  - P12.3 — String builder (calloc + sprintf chain)
  - P12.4 — Multi-function program (3+ functions calling each other)
  - P12.5 — Memory pool pattern (allocate N blocks, use, free all)
- **Verification:** `npm test` + manual Custom tab review

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Todo that needs interpreter fix | Mark `it.skip` with reason | Don't block on interpreter changes |
| Test exposes new bug | Write test as `test.fails` | Track bug, fix separately |
| Feature not supported | Don't test it | Skip switch/enum/union/etc. |

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Todo count drops from 8 to 0
- [ ] Skip count documented with reasons
- [ ] No new warnings from buildSnapshots
