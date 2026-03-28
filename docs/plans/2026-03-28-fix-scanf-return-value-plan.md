---
title: "Fix scanf return value — make it usable as an expression"
type: fix
status: completed
date: 2026-03-28
---

# Fix scanf return value — make it usable as an expression

## Context

`scanf` in C returns an `int` — the number of items successfully matched, or -1 (EOF). Students commonly write:

```c
while (scanf("%d", &x) != -1) { ... }
```

CrowCode currently handles scanf as a **statement interceptor** in `executeCallStatement` / `executeScanfCall`. This means:
- `scanf("%d", &x);` as a bare statement — works (intercepted)
- `x = scanf("%d", &x);` — partially works (intercepted in assignment path)
- `while (scanf("%d", &x) != -1)` — **broken** (goes through evaluator → stdlib, which doesn't handle scanf → "Unknown stdlib function: scanf")

Additionally, when `readInt` fails on non-matching input (e.g., `"abc\n"` for `%d`), the interpreter re-pauses silently. In real C, scanf returns 0 and the program continues. The user currently has no feedback and no way to recover.

## Design

### Approach: Add scanf to stdlib alongside the statement interceptor

The statement-level interceptor (`executeScanfCall`) handles step creation, description enrichment, and interactive pausing for bare `scanf(...)` calls. This is valuable and should stay.

For expression contexts (`while(scanf(...) != -1)`, `result = scanf(...)`), add a **stdlib handler** that performs the same I/O operations and returns the item count as an `int` CValue.

Both paths share the same I/O logic (format parsing, readInt/readChar/readFloat, variable writes). Extract the core scanf logic into a shared function that returns `{ itemsAssigned: number; needsInput: boolean }`.

### Return value semantics (matching real C)

| Scenario | Real C returns | CrowCode should return |
|----------|---------------|----------------------|
| `scanf("%d", &x)` with `"42\n"` | 1 | 1 |
| `scanf("%d %d", &a, &b)` with `"10 20\n"` | 2 | 2 |
| `scanf("%d", &x)` with `"abc\n"` | 0 (no match, 'a' stays in buffer) | 0 (no match, 'a' stays in buffer) |
| `scanf("%d", &x)` with empty/EOF | -1 (EOF) | -1 (EOF) |
| `scanf("%d %d", &a, &b)` with `"10\n"` (partial) | 1 (first matched, second waits) | 1 (first matched, second blocks — existing limitation) |

### Non-matching input behavior fix

When `readInt` fails on non-matching input (buffer not exhausted), the current code sets `needsInput = true` and the program loops forever. The fix:

- **Statement path (executeScanfCall):** On read failure with non-empty buffer, stop processing format specifiers and proceed (don't set `needsInput`). The step description shows `→ 0 items matched`. The variable is unchanged. This matches real C where scanf returns 0 and the program continues.
- **Stdlib path:** Return 0 immediately on match failure.
- **Only set `needsInput`** when the buffer is truly exhausted (`isExhausted()` is true).

### Interactive mode behavior

In the **statement path**, the interactive pause mechanism (`needsInput`) stays the same — pause when buffer is exhausted. But on non-matching input (buffer has content that doesn't match), don't pause — let the program see the 0 return value and handle the error.

In the **stdlib/expression path**, the evaluator callback is synchronous. When the buffer is exhausted:
- `driveGenerator` already handles this — it drives generators to completion, and `needsInput` propagates up to `executeStatementsYielding` which does the actual yield.
- For stdlib calls (not user functions), we need to set `ctx.needsInput` directly. The evaluator callback has access to `this` (the interpreter), so it can set `this.needsInput = true` after the stdlib call.

## Files

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/handlers/statements.ts` | Extract core scanf logic into shared function; update `executeScanfCall` to use it; fix non-matching input behavior | Shared logic for both paths |
| `src/lib/interpreter/stdlib.ts` | Add `scanf` case that calls shared logic, returns item count | Makes scanf available as expression |
| `src/lib/interpreter/interpreter.ts` | After stdlib call in evaluator callback, check if `needsInput` was set | Propagate interactive pause from stdlib scanf |
| `src/lib/interpreter/interactive.test.ts` | Update type-mismatch test; add scanf-as-expression tests | Verify correct behavior |

### No new files needed

## Steps

### Step 1: Extract shared scanf core logic

- **What:** Extract the format-parsing and I/O reading loop from `executeScanfCall` into a standalone function `executeScanfReads(ctx, call)` that returns `{ itemsAssigned: number; needsInput: boolean; assignments: string[] }`. The existing `executeScanfCall` calls this function and handles step creation/description. The new function does NOT create steps or set `ctx.needsInput` — the caller decides.
- **Files:** `src/lib/interpreter/handlers/statements.ts`
- **Depends on:** Nothing
- **Verification:** `npm test` — existing tests still pass (pure refactor)

### Step 2: Fix non-matching input behavior

- **What:** In `executeScanfCall`, when `executeScanfReads` returns `needsInput: false` but `itemsAssigned: 0` (match failure with non-empty buffer), don't set `ctx.needsInput`. Let the function complete normally. Update step description to show `→ 0 items matched`.
- **Files:** `src/lib/interpreter/handlers/statements.ts`
- **Depends on:** Step 1
- **Verification:** Interactive test: `scanf("%d", &x)` with `"abc\n"` should complete (not re-pause), x unchanged

### Step 3: Add scanf to stdlib

- **What:** Add a `case 'scanf':` to the stdlib switch that calls `executeScanfReads`, writes to variables, and returns `{ value: { type: primitiveType('int'), data: itemsAssigned }, error?: string }`. Import the shared function and necessary types. Handle the `needsInput` case by setting it on the interpreter context.
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 1
- **Verification:** `while (scanf("%d", &x) != -1)` should work in sync mode with pre-supplied stdin

### Step 4: Handle interactive pause from stdlib scanf

- **What:** In the evaluator callback (interpreter.ts line 122), after calling `stdlib(name, args, line)`, check if `this.needsInput` was set by the scanf handler. If so, the statement-level `executeStatementsYielding` will pick it up on the next check.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 3
- **Verification:** `while (scanf("%d", &x) != -1)` should pause for input in interactive mode

### Step 5: Update tests

- **What:** Update the type-mismatch test (currently expects re-pause, should now expect completion with x unchanged). Add new tests: `scanf` return value in expression, `while(scanf(...) != -1)` loop with sync stdin, `while(scanf(...) != -1)` with interactive input + EOF. Update Grade Calculator to optionally use `while(scanf(...) != -1)` pattern.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Steps 2-4
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

### Step 6: Run full suite and verify

- **What:** Full test suite, type check.
- **Depends on:** All previous
- **Verification:** `npm test && npm run check`

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|------------|
| `scanf("%d", &x)` with `"abc\n"` | Returns 0, x unchanged, program continues | Match failure → don't set needsInput, return 0 |
| `scanf("%d %d", &a, &b)` with `"10 abc\n"` | Returns 1, a=10, b unchanged | First specifier succeeds, second fails, return 1 |
| `while(scanf("%d", &x) != -1)` with EOF | Loop exits (scanf returns -1) | isExhausted+isEofSignaled → return -1 |
| `while(scanf("%d", &x) != -1)` interactive | Pauses when buffer empty, resumes on input | needsInput set only when buffer exhausted |
| `scanf("%c", &c)` with any char | Returns 1 always (%c never fails on non-empty buffer) | readChar succeeds on any non-EOF |
| Bare `scanf(...)` statement | Still intercepted by executeCallStatement | Statement path unchanged, just uses shared core |
| `int n = scanf(...)` in declaration | evaluateCallForDecl → evaluator → stdlib | Works via the new stdlib handler |

## Verification

- [ ] `npm test` passes
- [ ] `npm run check` — no new type errors
- [ ] `while (scanf("%d", &x) != -1)` works in sync mode
- [ ] `while (scanf("%d", &x) != -1)` pauses and resumes in interactive mode
- [ ] `while (scanf("%d", &x) != -1)` exits on EOF (Ctrl+D)
- [ ] `scanf("%d", &x)` with `"abc\n"` returns 0, program continues
- [ ] Grade Calculator example can use `while(scanf(...) != -1)` pattern
- [ ] Existing scanf tests still pass (backward compatible)

## References

- `src/lib/interpreter/handlers/statements.ts` — current `executeScanfCall` (line 1011), INPUT_FUNCTIONS intercept
- `src/lib/interpreter/stdlib.ts` — stdlib handler (getchar pattern to follow)
- `src/lib/interpreter/interpreter.ts` — evaluator callback (line 93-123)
- `src/lib/interpreter/io-state.ts` — `readInt` reset behavior (line 134)
- `docs/research/c-stdio-terminal-behavior.md` — real C scanf semantics
- `docs/plans/2026-03-28-test-stdio-interactive-plan.md` — Known Limitations table
