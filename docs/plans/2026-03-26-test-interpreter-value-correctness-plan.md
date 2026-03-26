---
title: Comprehensive Interpreter Value-Correctness Test Suite
type: feat
status: completed
date: 2026-03-26
deepened: 2026-03-26
---

# Comprehensive Interpreter Value-Correctness Test Suite

## Enhancement Summary

**Deepened on:** 2026-03-26
**Research agents used:** 8 (test adequacy, snapshot contract, C semantics, pattern recognition, Vitest best practices, spec flow analysis, simplicity review, repo research)

### Key Improvements
1. **Simplified from 10 steps to 4** — eliminated redundancy, merged related categories
2. **Minimal helper API** — 2 functions instead of 5; no premature abstractions
3. **12 additional known bugs identified** — including `*p = 42` unhandled, cast truncation missing, compound ops on struct fields broken, `toInt32` gap in compound assignment
4. **Precise `findEntry` algorithm specified** — recursive name-based tree walk, not ID-based
5. **Guard assertions added** — every test validates program AND checks `buildSnapshots` warnings
6. **C semantics gaps filled** — cast tests, pointer arithmetic scaling, sizeof, address-of operator, struct-by-value params

### Scope Decision
This suite intentionally focuses on **value correctness** (what users see in snapshots). Structural concerns (IDs, step metadata, column ranges, subStep flags) are covered by existing tests and are out of scope. The spec flow analysis found 62% of spec requirements are "missing" from this plan — that gap is intentional and documented.

---

## Context

The interpreter has known bugs where **snapshot values don't match expected C semantics**. The reported example:
- `p->scores = calloc(count, sizeof(int))` shows `1436549136` (raw address as decimal) instead of a hex pointer
- `p->scores[0] = 100` etc. don't update — values stay at their initial state

**Root causes identified during planning:**

1. **`executeMallocAssign` only handles `identifier` targets** (interpreter.ts:374: `if (node.target.type !== 'identifier') return;`). When target is `member_expression` like `p->scores`, it silently returns — no heap block is created, no pointer value is set.

2. **Subscript-through-pointer chains fail** — `p->scores[i]` requires resolving `p` -> heap struct -> `.scores` field -> second heap block -> `[i]` element. The emitter's `resolvePointerPath` only handles one level of pointer indirection.

3. **Value display inconsistency** — pointer values sometimes display as decimal integers instead of hex addresses.

Current tests (373 passing) verify **structural correctness** (valid IDs, addresses, validation rules) but have exactly **one** value assertion across the entire suite (`x &= 0xFF` producing `'52'`).

### Research Insights

**Silent failures are the primary risk.** The snapshot contract review found that `setValue` ops targeting non-existent IDs silently do nothing — `applyOps()` logs a warning but `buildSnapshots()` discards it. A test could pass validation, pass `expectNoWarnings`, and still assert on a default `''` value because the `setValue` went to a garbage ID. Every test must guard against this.

**The evaluator is correct but the pipeline loses values.** The evaluator has extensive unit tests proving expression evaluation is right. The bugs are in how the interpreter translates `CValue.data` into `MemoryEntry.value` strings via the emitter. Testing the evaluator alone gives false confidence.

## Design

### Approach: Two-part strategy

1. **Add value assertions to existing `interpreter.test.ts` tests** — the existing tests already run the right C programs. Adding `expect(findEntry(snapshot, 'x')?.value).toBe('42')` after `expectValid(program)` is the cheapest way to get value coverage without duplicating test scenarios.

2. **New `value-correctness.test.ts` for scenarios not already covered** — known-bug regressions (`test.fails`), compound pointer chains, C semantics edge cases, and the full integration test.

### Helper API (minimal)

Only two helpers needed. No wrappers around one-line assertions.

```typescript
// Runs C source through full pipeline with built-in guards
function interpretAndBuild(source: string): { program: Program; snapshots: MemoryEntry[][] } {
    const { program, errors } = run(source);
    expect(errors).toHaveLength(0);
    expectValid(program);
    expectNoWarnings(program);
    return { program, snapshots: buildSnapshots(program) };
}

// Recursive name-based tree walk — returns full MemoryEntry for flexible assertions
function findEntry(entries: MemoryEntry[], name: string): MemoryEntry | undefined {
    for (const e of entries) {
        if (e.name === name) return e;
        if (e.children) {
            const found = findEntry(e.children, name);
            if (found) return found;
        }
    }
    return undefined;
}
```

**Design decisions:**

- **Name-based, not ID-based** — `findEntry(snapshot, 'x')` searches by `entry.name`, not `entry.id`. Names are stable display text (`'x'`, `'.x'`, `'[0]'`); IDs are implementation details (`'main-x'`, `'heap-p-x'`). Name-based lookup makes tests readable and decoupled from ID generation.

- **Returns `MemoryEntry`, not just value string** — callers can check `.value`, `.type`, `.address`, `.heap?.status`, `.children` as needed. More flexible than a `findValue()` that returns only the string.

- **No path resolution (yet)** — `findEntry` does a flat recursive search by name. For `p->x`, you search for `'.x'` not `'p.x'`. Complex paths like `p.scores[0]` need the pointer-through-struct bugs fixed first. Add path resolution when fixing those bugs.

- **Guards baked into `interpretAndBuild`** — every test automatically validates the program and checks for `buildSnapshots` warnings. This prevents the silent-failure scenario where `setValue` ops target wrong IDs.

### Research Insights

**`beforeAll` parser init is required** — must replicate the exact block from `interpreter.test.ts` (lines 9-18): `resetParserCache()`, WASM loading, `parser.setLanguage()`. This is file-scoped, not shareable.

**Use `it.each` for parameterized tests** — Vitest's `it.each` with object form is the idiomatic way to do matrix testing, preferred over raw `for` loops. Use `$prop` interpolation for readable test names.

**Use `test.fails()` for known bugs, `it.todo()` for planned features** — `test.fails` runs the test and passes when it fails (alerts you when the bug is fixed). `it.todo` is for tests that can't be written yet.

### Alternatives Considered

- **Snapshot testing (jest snapshots):** Rejected — brittle, doesn't communicate intent, hard to maintain when IDs or addresses change.
- **Per-component unit tests only:** Insufficient — the bugs are in the integration between evaluator -> interpreter -> emitter -> snapshot pipeline.
- **Property-based/fuzzing:** Overkill for current stage — we need targeted correctness first.
- **Separate fixture files:** Rejected for now — the test count is manageable in a single file. Extract fixtures later if the file exceeds ~500 lines.
- **Custom `expect.extend()` matchers:** Deferred — only worthwhile when the same assertion pattern appears 5+ times. Start with inline assertions; extract matchers in a follow-up if needed.

## Files

### Create
| File | Purpose |
|------|---------|
| `src/lib/interpreter/value-correctness.test.ts` | Value-correctness test suite (new scenarios, known bugs, integration) |

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/interpreter.test.ts` | Add value assertions to ~10 existing tests | Get value coverage without duplicating test scenarios |

## Steps

### Step 1: Helpers + scalar value assertions
- **What:** Add `interpretAndBuild()` and `findEntry()` helpers, then test scalar variable values: declarations, reassignment, compound operators, unary ops
- **Files:** `src/lib/interpreter/value-correctness.test.ts` (new), `src/lib/interpreter/interpreter.test.ts` (augment existing)
- **Depends on:** Nothing
- **Verification:** `npm test` passes

**1a. Setup in new file:**
```typescript
import { describe, it, expect, beforeAll, vi, test } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import type { Program, MemoryEntry } from '$lib/api/types';

let parser: Parser;

beforeAll(async () => {
    resetParserCache();
    await Parser.init({ locateFile: () => resolve('static/tree-sitter.wasm') });
    parser = new Parser();
    const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
    parser.setLanguage(lang);
});

function run(source: string) { return interpretSync(parser, source); }

function expectValid(program: Program) { /* same as interpreter.test.ts */ }
function expectNoWarnings(program: Program) { /* same as interpreter.test.ts */ }

function interpretAndBuild(source: string) { /* as designed above */ }
function findEntry(entries: MemoryEntry[], name: string) { /* as designed above */ }
```

**1b. Augment existing `interpreter.test.ts` tests with value assertions:**

Add to the existing `'assigns variable'` test (line 63):
```typescript
const snapshots = buildSnapshots(program);
const last = snapshots[snapshots.length - 1];
// walk snapshot to find entry named 'x' and check value
```

Add similar value checks to: `'declares int variable'`, `'compound assignment +='`, `'declares struct variable'`, `'declares array variable'`, `'malloc allocates heap block'`, `'free marks heap block as freed'`.

**1c. Scalar value tests in new file — use `it.each` with object form:**

```typescript
it.each([
    { op: '+=', init: 10, rhs: 3, expected: '13' },
    { op: '-=', init: 10, rhs: 3, expected: '7' },
    { op: '*=', init: 10, rhs: 3, expected: '30' },
    { op: '/=', init: 10, rhs: 3, expected: '3' },
    { op: '%=', init: 10, rhs: 3, expected: '1' },
    { op: '&=', init: 0xFF, rhs: 0x0F, expected: '15' },
    { op: '|=', init: 0xF0, rhs: 0x0F, expected: '255' },
    { op: '^=', init: 0xFF, rhs: 0x0F, expected: '240' },
    { op: '<<=', init: 1, rhs: 4, expected: '16' },
    { op: '>>=', init: 256, rhs: 4, expected: '16' },
])('compound $op assigns $init $op $rhs to $expected', ({ op, init, rhs, expected }) => {
    // ...
});
```

**Additional scalar tests:**
- `int x = 0`, `int x = -1`, `int x = 5 + 3` (expression init)
- `x = 0; x = 42` — verify before and after
- `char c = 'A'` -> value `65`
- `x++`, `x--`, `++x`, `--x` — verify value after
- Uninitialized: `int x;` -> shows `0`
- Division by zero: doesn't crash

### Research Insights (Step 1)

**Compound ops lack `toInt32` truncation** (C semantics review, critical). `applyCompoundOp` in interpreter.ts uses raw JS arithmetic (`oldVal + newVal`), not `toInt32()`. The small values in the test matrix will always pass. Add one overflow test: `int x = 2147483647; x += 1;` should produce `-2147483648` but will produce `2147483648`. Mark as `test.fails`.

**Compound ops on struct fields are broken** (C semantics review, critical). `p->x += 5` falls through evaluator without applying old value. Add as `test.fails`: `struct S { int x; }; struct S *p = malloc(...); p->x = 10; p->x += 5;` — x should be `15`.

### Step 2: Compound types + pointers/heap value tests
- **What:** Test struct fields, arrays, pointers, malloc/calloc/free, heap block values
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` passes

**2a. Struct field values:**
| Scenario | Assert |
|----------|--------|
| `struct Point p = {3, 4}` | `.x` = `3`, `.y` = `4`, parent `value` = `''` |
| `p.x = 10` after init | `.x` changes to `10` |
| `p->x = 10` (heap struct) | `.x` shows `10` in heap block children |
| `p->pos.x = 10` (nested struct through pointer) | Nested field correct |

**2b. Array element values:**
| Scenario | Assert |
|----------|--------|
| `int arr[3] = {10, 20, 30}` | `[0]`=`10`, `[1]`=`20`, `[2]`=`30` |
| `arr[1] = 99` | `[1]` changes, others unchanged |

**2c. Pointer and heap values:**
| Scenario | Assert |
|----------|--------|
| `int *p = malloc(sizeof(int))` | `p` value matches `/^0x[0-9a-f]+$/i` (not decimal) |
| `int *a = calloc(3, sizeof(int))` | 3 children all show `'0'` |
| `a[0] = 100; a[1] = 200` | Children update to `'100'`, `'200'` |
| `free(p)` | Heap block `.heap?.status` = `'freed'`, pointer value = `'(dangling)'` |
| `struct S *p = malloc(...)` then `p->field = 5` | Heap struct child shows `'5'` |
| `NULL` pointer declaration | `int *p = NULL` shows `'NULL'` or `'0x00000000'` |

**2d. Address-of pointer (missing from original plan):**
| Scenario | Assert |
|----------|--------|
| `int x = 5; int *p = &x;` | `p` shows hex address, matches `x`'s address |

### Research Insights (Step 2)

**Struct/array parent `value` must be `''`** (snapshot contract review). Composite entries (structs, arrays) must have empty `value` — children hold the values. Assert `findEntry(snapshot, 'p')?.value === ''` for every struct.

**`freeHeap` does NOT emit `set(ptrVarId, '(dangling)')` in the emitter** (snapshot contract review, critical). The emitter's `freeHeap()` only emits `setHeapStatus`. The interpreter must emit the `setValue` for the pointer separately. Verify that both ops appear in the same `ProgramStep.ops` array, not just the final snapshot value.

**`*p = 42` (dereference assignment) is unhandled** (test adequacy review, critical). `executeAssignment` has no branch for `unary_expression` targets. Add as `test.fails`: `int *p = malloc(sizeof(int)); *p = 42;` then verify heap value shows `'42'`.

**`calloc` zero-initialization** (test adequacy review). `buildArrayChildSpecs` is called without init values for calloc — children may default to `'0'` but this should be explicitly asserted, not assumed.

**HeapInfo.allocator field** (snapshot contract review). Assert `entry.heap?.allocator === 'calloc'` for calloc allocations to verify metadata correctness.

### Step 3: Known-bug regressions + C semantics edge cases
- **What:** Document all known bugs as `test.fails()`, all planned-but-unimplemented features as `it.todo()`
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` passes (test.fails tests pass by failing)

**3a. Known bugs (`test.fails`):**

| Bug | Test | Root cause |
|-----|------|-----------|
| Member-expression malloc | `p->scores = calloc(n, sizeof(int))` -> heap block created | interpreter.ts:374 early return |
| Multi-level pointer chain | `p->scores[0] = 100` -> element shows `'100'` | emitter resolvePointerPath single-level |
| Pointer displayed as decimal | After calloc, `p->scores` shows hex not decimal | formatValue path |
| `*p = 42` unhandled | Dereference assignment produces setValue op | executeAssignment no unary branch |
| Compound op on struct field | `p->x += 5` when `p->x` was `10` -> shows `'15'` | evaluator evalAssignment doesn't apply old value |
| Post-increment on array element | `arr[0]++` increments element | evaluator only handles identifier operands |
| Cast truncation missing | `(char)300` should narrow to 8 bits | evalCast does type-only reinterpretation |
| Compound op overflow | `int x = 2147483647; x += 1` should wrap to `-2147483648` | applyCompoundOp lacks toInt32 |
| Double pointer indirection | `p->data->field = 5` through two pointers | resolvePointerPath single-level |
| `free(p->scores)` | Scores heap block marked freed | fragile resolution fallbacks |

**3b. Planned features (`it.todo`):**

```typescript
describe('planned: unimplemented spec constructs', () => {
    it.todo('chained assignment a = b = c = 0 sets all three');
    it.todo('short-circuit evaluation ptr && ptr->valid');
    it.todo('while-loop sub-steps with evaluation strings');
    it.todo('do-while loop value progression');
    it.todo('if/else condition evaluation as sub-step');
    it.todo('function returning malloc pointer used by caller');
    it.todo('leak detection marks unfreed blocks as leaked');
});
```

**3c. C semantics edge cases (explicit tests):**

| Test | What to verify |
|------|---------------|
| `sizeof(int) == 4`, `sizeof(int*) == 4`, `sizeof(struct {char c; int x;}) == 8` | Type system sizes correct |
| `int *p = arr; p + 1` advances by `sizeof(int)` | Pointer arithmetic scales correctly |
| `int x; x = 5` (uninit then assign) | Shows `'0'` then `'5'` |
| `struct Point p` passed by value to function | Callee's copy has correct field values |

### Research Insights (Step 3)

**`long` is 8 bytes in a "32-bit model"** (C semantics review, warning). `types-c.ts` says 32-bit model but uses LP64 `long = 8`. Test `sizeof(long)` to document the actual behavior.

**Array decay is untested** (C semantics review). `int arr[3]; int *p = arr;` — `p` should equal `&arr[0]`. Add as todo if the interpreter supports it.

**Struct-by-value parameters use default `'0'` for all fields** (test adequacy review). When `distance(origin, p->pos)` is called, the callee's struct params should copy the caller's field values, but `buildStructChildSpecs` defaults to `'0'`. Add as `test.fails`.

**`return` inside for-loop body** (test adequacy review). Early return from loop should clean up loop scope. Test that no dangling scope entry remains.

**Multiple mallocs to same variable** (test adequacy review). After `free(p); p = malloc(n)`, assignment to `p->field` should target the new heap block, not the old one.

### Step 4: Integration test — Memory Basics equivalent
- **What:** Interpret the exact `basics.ts` source and assert key values at final state
- **Files:** `src/lib/interpreter/value-correctness.test.ts`
- **Depends on:** Steps 1-3
- **Verification:** `npm test` passes

**Assert final-state values only** (not every intermediate step — too brittle). Check 8-10 key values at the last snapshot before each `free()`:

| Variable | Expected value | When |
|----------|---------------|------|
| `count` | `'3'` | Any step after declaration |
| `origin.x`, `origin.y` | `'0'`, `'0'` | After struct init |
| `p->id` | `'1'` | After `p->id = 1` |
| `p->pos.x`, `p->pos.y` | `'10'`, `'20'` | After assignments |
| `d` (distance result) | `'500'` | After function call returns |

Mark the `p->scores` assertions as `test.fails` since those depend on the member-expression malloc bug being fixed.

### Research Insights (Step 4)

**Don't compare interpreted output to hand-crafted program output** (repo research). Different IDs, addresses, and step counts. Assert on semantic values by name, not structural equality.

**Use "find last snapshot where condition" instead of hardcoded step indices** (repo research). Adding a debug step would shift all indices. Search for the last snapshot containing an entry named `'d'` and assert its value, rather than asserting at step 14.

**For-loop sub-step metadata** (spec flow analysis). As a bonus, verify the for-loop in the distance function produces correct `subStep` flags and evaluation strings. This is the one area where the spec is fully implemented but has zero metadata coverage. Could be a stretch goal.

## Edge Cases

Trimmed to high-value cases only. Others are either already tested or document known deviations:

| Case | Expected behavior | How handled | Step |
|------|-------------------|-------------|------|
| Uninitialized variable | Shows `'0'` | Explicit test | 1 |
| Division by zero | Doesn't crash | Explicit test | 1 |
| `int x = 2147483647; x += 1` | Should wrap, actually doesn't | `test.fails` | 3 |
| `(char)300` | Should truncate, actually doesn't | `test.fails` | 3 |
| `*p = 42` | Should set heap value, actually no-ops | `test.fails` | 3 |
| Struct passed by value | Should copy fields, actually defaults to 0 | `test.fails` | 3 |
| Early return from loop | Loop scope cleaned up | Explicit test | 3 |

## Verification

- [ ] `npm test` — all tests pass (existing + new, including `test.fails` known bugs)
- [ ] `npm run check` — TypeScript compiles cleanly
- [ ] Known bugs documented as `test.fails()` with descriptive names
- [ ] Planned features documented as `it.todo()` for visibility
- [ ] Test count: ~40-60 new assertions (mix of augmented existing tests and new tests)

## References

- [docs/research/op-generation-requirements.md](docs/research/op-generation-requirements.md) — op generation contract
- [src/lib/programs/basics.ts](src/lib/programs/basics.ts) — hand-crafted reference program (the "gold standard")
- [src/lib/interpreter/interpreter.test.ts](src/lib/interpreter/interpreter.test.ts) — existing structural tests (to augment)
- [src/lib/engine/validate.ts](src/lib/engine/validate.ts) — validation rules

## Known Bugs to Capture as Failing Tests

**Original (from planning phase):**
1. **`executeMallocAssign` ignores member_expression targets** — `p->field = malloc(n)` silently does nothing (interpreter.ts:374)
2. **Multi-level pointer chain resolution** — `p->scores[i]` can't resolve through struct pointer -> field pointer -> array element
3. **Pointer values displayed as decimal** — address values sometimes shown as `1436549136` instead of `0x55a0000c`
4. **Leak detection incomplete** — `detectLeaks()` is a stub (interpreter.ts:979-988)
5. **`free(p->scores)` fragile resolution** — complex fallback logic to find heap block ID (interpreter.ts:580-622)

**Discovered during deepening:**
6. **`*p = 42` dereference assignment unhandled** — `executeAssignment` has no branch for `unary_expression` targets; silently does nothing
7. **`evalCast` performs no numeric truncation** — `(char)300` changes type but not value; should narrow to 8 bits
8. **`applyCompoundOp` lacks `toInt32`** — compound assignments (`+=`, `*=`) don't wrap on 32-bit overflow; evaluator's `evalBinary` does but `applyCompoundOp` doesn't
9. **Compound ops on member_expression targets broken** — `p->x += 5` returns RHS `5` not `old + 5`; evaluator `evalAssignment` line 298 fallback
10. **Pre/post increment on non-identifier lvalues** — `arr[0]++`, `p->x++` fall through with no state change
11. **Struct-by-value params use default `'0'` for all fields** — caller's field values not copied into callee's parameter struct children
12. **`freeHeap` emitter doesn't emit `setValue` for pointer** — only emits `setHeapStatus`; the `(dangling)` setValue must come from interpreter separately
