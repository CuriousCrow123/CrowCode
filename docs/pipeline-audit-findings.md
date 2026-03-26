# Pipeline Audit Findings

**Date:** 2026-03-26
**Method:** Ran all 38 dropdown programs through full pipeline (interpret → validate → buildSnapshots), then reviewed step-by-step output with 6 parallel review agents.

**Result:** 38/38 programs pass validation. 0 crashes. Several correctness and display issues found.

## Critical Bugs (FAIL)

### BUG-1: Float division `1.0 / 2.0` returns 0 instead of 0.5
- **Program:** p13.3 Float Arithmetic
- **Impact:** High — teaches students that float division works like integer division
- **Root cause:** Likely the evaluator treats number literals as integers when both operands happen to have integer-like values

### BUG-2: `strcpy` produces no step and doesn't update heap buffer
- **Program:** p14.2 String Functions
- **Impact:** High — `strcpy(dst, src)` is completely skipped as a step. The heap buffer stays all zeros, yet `strlen(dst)` returns 5. Visible contradiction.
- **Root cause:** `strcpy` as an expression statement (not in a declaration) may not emit a step. The stdlib handler writes to memoryValues but the heap display children aren't updated.

### BUG-3: Chained assignment ops bleed across step boundaries
- **Program:** p13.5 Chained Assignment
- **Impact:** Medium — values from line 8 (`a = b = c = 42`) appear at the step for line 6 (`int c = 0`), and values from line 11 appear prematurely at step for line 8.
- **Root cause:** The `sharesStep = true` mechanism for chained assignments leaks setValue ops into earlier steps.

### BUG-4: Nested struct initializer ignored
- **Program:** p2.2 Nested Structs
- **Impact:** Medium — `struct Player p = {1, {10, 20}}` initializes `p.pos.x` and `p.pos.y` to 0 instead of 10 and 20. Only the top-level field `id = 1` works.
- **Root cause:** `initStructFromList` doesn't recurse into nested brace-enclosed initializer lists for nested struct fields.

### BUG-5: Use-after-free read shows variable as `(uninit)` instead of indicating the error
- **Program:** p14.1 Use-After-Free
- **Impact:** Medium — `int x = *p` after `free(p)` shows `x = (uninit)` with no indication that a use-after-free occurred. The error is in the errors array but not reflected in the step description or memory.
- **Root cause:** When the memoryReader returns undefined (due to UAF check), the declaration path treats it as no initializer.

### BUG-6: Freed/leaked heap status not visible in memory display
- **Programs:** p4.1, p4.2, p4.4, p5.1, p5.3, p10.3, p14.1
- **Impact:** Medium — `setHeapStatus` ops fire but the heap block display doesn't change. Students can't tell a block is freed or leaked from the memory view. Particularly bad for p10.3 (Memory Leak Detection) whose entire purpose is demonstrating leaks.
- **Root cause:** The snapshot display doesn't surface the `status` field of heap entries.

### BUG-7: Intermediate function returns have wrong "assign to X" description
- **Programs:** p6.4, p12.2, p12.5
- **Impact:** Medium — When a function returns inside a nested call (e.g., `fib(n-1)` inside `fib()`), the description says "assign to result" or "assign to c" even though the return value feeds into an expression, not a named variable. The emitter propagates the outermost call-site's variable name into intermediate returns.

## Minor Issues (MINOR)

### MINOR-1: Prefix `++a`/`--a` described as postfix `a++`/`a--`
- **Programs:** p1.1, p1.4
- **Impact:** Confusing in p1.4 which specifically teaches prefix vs postfix distinction
- **Root cause:** The description formatter doesn't distinguish prefix from postfix unary ops

### MINOR-2: Missing "condition → false" sub-step at for-loop exit
- **Programs:** p7.3, p7.4, p11.2, p11.5, p12.1
- **Impact:** Low — during loop body, every iteration shows "check → true", but the final false check that causes exit is elided. Students can't see why the loop stopped.

### MINOR-3: `malloc` shows zero-initialized memory
- **Programs:** p4.4, p5.1, p5.3, p9.1, p14.2
- **Impact:** Low — `malloc` doesn't zero-initialize in real C (only `calloc` does). Showing 0 could teach wrong assumptions. Acceptable as simplification if documented.

### MINOR-4: Heap entry type shows `<char>` not `<char[N]>` for malloc'd buffers
- **Programs:** p5.3, p9.1
- **Impact:** Low — 64-byte or 128-byte malloc'd buffers shown as `<char>` type, losing size information

### MINOR-5: `free(p->scores)` described as generic `free(ptr)`
- **Program:** p5.3
- **Impact:** Low — loses context about which pointer is being freed

### MINOR-6: Function pointer type displays with extra trailing `*`
- **Program:** p13.6
- **Impact:** Low — `int (*)(int, int)*` instead of `int (*)(int, int)`

### MINOR-7: Float values display without decimal point
- **Programs:** p13.3, p14.3
- **Impact:** Low — `sqrt(25.0)` shows `5` not `5.0`, making it unclear the value is floating-point

### MINOR-8: No explicit `break`/`continue` step in switch and loops
- **Programs:** p7.4, p13.1
- **Impact:** Low — behavior is correct but not narrated; students must infer control flow

### MINOR-9: Comment lines produce "Unsupported statement" errors
- **Program:** p13.1
- **Impact:** Low — inline comments in switch cases produce non-fatal errors visible to user

### MINOR-10: First variable declaration merged into "Enter main()" step
- **Programs:** p1.1, p4.1, p11.2, p14.3 and others
- **Impact:** Low — systematic; the first declaration shares the scope-creation step

## Summary

| Severity | Count | Key themes |
|----------|-------|------------|
| FAIL (Critical) | 7 | Float division, strcpy missing, chained assignment, nested struct init, UAF display, heap status, return descriptions |
| MINOR | 10 | Prefix/postfix labels, loop exit steps, malloc zero-init, display formatting |

## Programs by Verdict

| Verdict | Programs |
|---------|----------|
| PASS | p1.3, p2.1, p3.1, p3.3, p4.2, p6.1, p7.2, p8.2, p13.4, p13.7, p13.8 (11) |
| MINOR | p1.1, p1.2, p1.4, p4.1, p5.1, p6.4, p7.1, p7.3, p7.4, p9.1, p11.2, p11.5, p12.1, p12.5, p13.1, p13.2, p13.6, p14.3 (18) |
| FAIL | p2.2, p4.4, p5.3, p10.3, p12.2, p13.3, p13.5, p14.1, p14.2 (9) |

## Recommended Fix Priority

1. **BUG-1** (float division) — Likely one line in evaluator
2. **BUG-2** (strcpy no step) — Need to emit step for stdlib calls as expression statements
3. **BUG-4** (nested struct init) — Recurse into nested init_list in initStructFromList
4. **BUG-5** (UAF display) — Show error indication in step description when UAF detected
5. **BUG-3** (chained assignment step bleed) — Investigate sharesStep timing
6. **BUG-6** (heap status display) — Surface freed/leaked status in snapshot rendering
7. **BUG-7** (return "assign to X") — Only label "assign to X" for direct assignment, not nested calls
