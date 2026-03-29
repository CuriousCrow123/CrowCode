---
title: WASM Backend Snapshot Bug Fixes
type: fix
status: active
date: 2026-03-29
---

# WASM Backend Snapshot Bug Fixes

## Context

Running the Entity System program (p15.1) through the WASM backend with full step/snapshot dumps revealed 7 bugs. The snapshots don't match what the program actually does — struct fields are invisible, pointer values get corrupted, steps are skipped, ops are attributed to wrong lines, and parameter types are wrong.

These bugs affect all programs that use structs, pointers, or arrow operators — not just the entity program.

## Diagnostic Protocol

**This protocol MUST be followed exactly for every example program. Do not skip steps or summarize. Write all outputs to files.**

### Per-program audit procedure

For each program `pX.Y`:

#### 1. Run pipeline, write dump to file

Run the program through the WASM pipeline. Write the full dump to `docs/diagnostics/pX.Y.md`:

```markdown
# pX.Y — [Program Name]

## Source (with line numbers)
[Number every line of the C source starting at 1]

## Instrumented Source
[Full output of transformSource()]

## Steps
[For each step, one block:]
### Step N | Line L | M ops
- op: [full op description with all fields]
- op: ...
[If ioEvents, list them]

## Snapshots
[For each snapshot, one block:]
### Snapshot N (after step N)
[For each entry in tree format:]
- ID | name | type | value | address | kind | heap | children
```

#### 2. Line-by-line audit

Create a table in the same file:

```markdown
## Audit

| Source Line | C Statement | Expected Step? | Actual Step | Expected Ops | Actual Ops | Expected Values | Actual Values | Status |
|-------------|-------------|----------------|-------------|--------------|------------|-----------------|---------------|--------|
| 1 | int main() { | scope push | Step 0, line 0 | addEntry(main) | addEntry(main) | — | — | BUG: line 0, should be 1 |
| 2 | int x = 5; | decl x=5 | Step 1, line 1 | addEntry(x, val=5) | addEntry(x, val=5) | x=5 | x=5 | BUG: line 1, should be 2 |
```

For EVERY line of C source:
- **Expected Step?** — Should this line produce a step? (Yes for statements, No for struct definitions, includes, blank lines)
- **Actual Step** — Which step number and line? Or "MISSING" if no step exists for this line.
- **Expected Ops** — What ops should this line produce? (e.g., addEntry with name/type/value, setValue with new value)
- **Actual Ops** — What ops did it actually produce?
- **Expected Values** — After this step, what should each variable's value be?
- **Actual Values** — What does the snapshot actually show?
- **Status** — `OK`, `BUG: [description]`, or `SKIP` (for lines that don't produce steps)

#### 3. Write bug summary

At the bottom of the file:

```markdown
## Bugs Found
- [ ] BUG-pX.Y-1: [description] (line N)
- [ ] BUG-pX.Y-2: [description] (line N)
[Or: "No bugs found."]
```

#### 4. Mark program as audited

Update the master checklist (below) with the result: pass count, fail count, bug IDs.

### Master checklist

Maintain a file `docs/diagnostics/CHECKLIST.md`:

```markdown
# WASM Diagnostic Checklist

| Program | Status | Bugs | Notes |
|---------|--------|------|-------|
| p1.1 Integer Lifecycle | NOT STARTED | | |
| p1.2 Char and Casting | NOT STARTED | | |
...
```

Update each row as you complete the audit. Mark `PASS`, `FAIL (N bugs)`, or `SKIP (reason)`.

### Program order

Audit in this exact order (simple → complex, so fixes cascade):

**Round 1 — Minimal programs (no includes, no functions):**
1. Custom: `int main() { int x = 5; x = 10; x = x + 1; return 0; }`
2. p1.1 Integer Lifecycle
3. p1.3 All Compound Operators
4. p1.4 Increment / Decrement

**Round 2 — Control flow:**
5. p7.1 If / Else Branching
6. p7.2 While Loop
7. p7.3 Nested Loops
8. p7.4 Break and Continue

**Round 3 — Functions:**
9. p6.1 Simple Function Call
10. p6.4 Recursive Factorial
11. p12.2 Multi-Function Clamp
12. p12.5 Recursive Fibonacci

**Round 4 — Types:**
13. p1.2 Char and Casting
14. p13.3 Float Arithmetic
15. p13.4 Uninitialized Variable
16. p13.5 Chained Assignment

**Round 5 — Arrays:**
17. p3.1 Array Init and Loop
18. p3.3 Array Squared in Loop
19. p12.1 Bubble Sort
20. p13.7 2D Array

**Round 6 — Structs:**
21. p2.1 Simple Struct
22. p2.2 Nested Structs

**Round 7 — Heap:**
23. p4.1 malloc / free Lifecycle
24. p4.2 calloc Zero-Init
25. p4.4 Heap Array with Loop
26. p10.3 Memory Leak Detection

**Round 8 — Struct + Pointer:**
27. p5.1 Heap Struct via Pointer
28. p5.3 Full Memory Basics

**Round 9 — Scope:**
29. p8.2 Variable Shadowing
30. p13.1 Switch / Case

**Round 10 — Integration:**
31. p11.2 Matrix Identity
32. p11.5 Fibonacci Array
33. p15.1 Entity System

**Round 11 — stdio (may need special handling):**
34. p16.1 Basic printf
35. p16.2 puts and putchar
36. p16.3 getchar Loop
37. p16.4 scanf + printf
38. p16.6 printf Format Specifiers

**Round 12 — Edge cases:**
39. p13.2 String Literal
40. p13.6 Function Pointer
41. p13.8 Array-to-Pointer Decay
42. p14.1 Use-After-Free
43. p14.2 String Functions
44. p14.3 Math Functions
45. p9.1 sprintf Formats
46. p16.5 scanf \n Residue
47. p16.7 Grade Calculator

### After each round

1. Stop and review all bugs found in that round.
2. Group bugs by root cause (transformer? op-collector? wasi-shim?).
3. Fix bugs if they affect subsequent rounds (e.g., fix line attribution before auditing function calls).
4. Re-run affected programs to verify fix.
5. Commit fixes + updated diagnostics.

## Bugs Found So Far (from Entity System p15.1)

### Bug 1: Arrow field assignment corrupts pointer display

**Symptom:** `player->id = 1` causes `player` to show value `0x00000001` instead of the heap address `0x000030e8`.

**Root cause (transformer):** For `player->id = 1`, the transformer emits `__crow_set("player", player, 21)` where the second arg is `player` (the pointer VALUE `0x000030e8`), not `&player` (the ADDRESS of the pointer variable `0x00001fe0`). So `onSet` reads memory at `0x000030e8` — the struct in heap memory. The first 4 bytes are `id=1`. It displays `1` as the pointer value.

**Fix:** Emit `__crow_set("player", &player, ...)` — the `&` ensures we read the pointer variable's slot.

### Bug 2: Nested field assignment uses unregistered name

**Symptom:** `player->pos.x = 3` emits `__crow_set("player->pos", &player->pos, ...)`. The var registry has `"player"` but not `"player->pos"`, so `onSet` returns early. No op emitted.

**Fix:** `extractSetTarget` should walk up to the root variable: `player->pos.x` → root is `"player"`, addr is `&player`.

### Bug 3: Structs have no children in snapshots

**Symptom:** `struct Vec2 dir = {1, 0}` shows `val=""` with no children. No `x` or `y` visible.

**Fix:** Build a type registry from struct definitions, pass to op collector, use in `buildChildren()`.

### Bug 4: Steps skipped for untracked field assignments

**Symptom:** Lines 21-22 produce no step. Consequence of Bug 2.

**Fix:** Fixing Bug 2 fixes this.

### Bug 5: Pointer parameter types lose `*`

**Symptom:** `int *arr` declared as type `"int"`.

**Fix:** Check if declarator is `pointer_declarator` in `extractParamType`.

### Bug 6: Ops attributed to wrong source lines

**Symptom (4 instances from Entity System):**
1. `malloc` (line 20) shown at line 19 (`int main() {`)
2. `dir` decl (line 29) shown at line 27 (last loop body line)
3. `total` decl (line 31) shown at line 14 (inside sumScores)
4. `if (total > 50)` (line 32) has no step — jumps from line 14 to line 33

**Root cause:** `onStep(line)` flushes ops at `this.currentLine` (previous step's line), then sets `this.currentLine = line`. Ops between `__crow_step(19)` and `__crow_step(20)` get attributed to line 19.

**Fix:** Set `this.currentLine = line` FIRST, then flush.

### Bug 7: Steps silently swallowed

**Symptom:** Lines with `__crow_set` targeting unregistered names produce 0 ops. `onStep` doesn't push empty steps.

**Fix:** Bug 2 fix + consider emitting empty steps.

## Implementation Steps

### Step 1: Create diagnostic infrastructure

- Create `docs/diagnostics/` directory
- Create `CHECKLIST.md` with all programs listed as NOT STARTED
- Create the diagnostic test runner that writes dump files

### Step 2: Run Round 1 (minimal programs), write audit files

- Follow the per-program audit procedure exactly
- Write dump + audit to `docs/diagnostics/pX.Y.md`
- Update CHECKLIST.md

### Step 3: Fix bugs found in Round 1, re-verify

### Step 4: Run Round 2 (control flow), audit, fix

### Step 5: Run Round 3 (functions), audit, fix

### Step 6: Continue through all rounds...

### Final: Re-run all programs to verify

## Verification

- [ ] `npm test` passes
- [ ] Every program in CHECKLIST.md is marked PASS or SKIP (with reason)
- [ ] All diagnostic files written to `docs/diagnostics/`
- [ ] Entity system (p15.1): player shows correct pointer value throughout
- [ ] Entity system: `player->id`, `player->pos.x`, `player->pos.y` each produce a visible step
- [ ] Struct programs (p2.1, p2.2): struct children show field names and values
- [ ] Function with pointer param: `arr` shows type `"int*"` not `"int"`
- [ ] No steps are silently dropped (every C statement produces a step)
- [ ] Ops attributed to correct source lines (malloc on line 20, not line 19)
- [ ] `struct Vec2 dir` declaration shows up at line 29, not line 27
- [ ] `int total = sumScores(...)` has its own step at line 31
- [ ] `if (total > 50)` has a step at line 32
- [ ] All existing integration tests still pass

## References

- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
- [Op collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Integration tests](../../src/lib/wasm-backend/integration.test.ts)
