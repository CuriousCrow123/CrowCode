---
title: Fix Function Call Stepping in WASM Backend
type: fix
status: completed
date: 2026-03-30
---

# Fix Function Call Stepping in WASM Backend

## Context

When stepping through `int x = add(10, 20) + add(10, 20) + add(10, 20);`, the WASM backend jumps straight into the first `add` function without ever showing the calling line. After returning from the first `add`, it jumps straight into the second `add` without returning to the calling line.

The **interpreter** creates this step sequence:
1. Step on calling line — `Declare int x` (user sees the statement)
2. Step on calling line — `Call add(10, 20)` (with column highlighting)
3. Steps inside `add()` body
4. Step on calling line — `Return from add()` → 30
5. Step on calling line — `Call add(10, 20)` (second call)
6. Steps inside `add()` body
7. Step on calling line — `Return from add()` → 30
8. Final step — `x = 90`

The **WASM backend** currently produces:
1. Steps inside first `add()` body (no pre-call step on calling line)
2. Steps inside second `add()` body (no inter-call step)
3. Steps inside third `add()` body
4. Single step on calling line — after everything

## Design

The fix has two parts:

### Part A: Pre-call step

Add `__crow_step(line)` **before** any statement containing a user function call. This makes the stepper land on the calling line before entering the function.

### Part B: Call decomposition into temporaries

For statements with **multiple** user function calls, extract each call into a temporary variable with a `__crow_step(line)` between them. This creates inter-call steps on the calling line.

**Before transformation:**
```c
int x = add(10, 20) + add(10, 20) + add(10, 20);
```

**After transformation (conceptually):**
```c
__crow_step(LINE);                     // pre-call: land on calling line
int __ct0 = add(10, 20);
__crow_step(LINE);                     // after first call: back on calling line
int __ct1 = add(10, 20);
__crow_step(LINE);                     // after second call: back on calling line
int __ct2 = add(10, 20);
int x = __ct0 + __ct1 + __ct2;        // final expression with temps
__crow_decl("x", &x, sizeof(x), "int", LINE, 0);
__crow_step(LINE);                     // final step with value
```

### Function registry

To create correctly-typed temporaries, we need a map of user-defined function names to return types. Build this in a first pass over `function_definition` nodes before instrumentation.

### What gets decomposed

| Statement type | Contains calls | Action |
|---------------|----------------|--------|
| Declaration: `int x = add(1,2);` | Single call | Pre-call step only |
| Declaration: `int x = add(1,2) + add(3,4);` | Multiple calls | Full decomposition |
| Assignment: `x = add(1,2) + add(3,4);` | Multiple calls | Full decomposition |
| Bare call: `add(1,2);` | Single call | Pre-call step only |
| Return: `return add(1,2);` | Calls | Already handled (temp var approach exists) |
| Nested: `add(sub(1,2), 3)` | Nested calls | Depth-first extraction |

### What does NOT get decomposed

- Library/special calls: `malloc`, `calloc`, `free`, `printf`, `scanf`, `sprintf`, `strcpy` — these are rewritten by existing logic, not user functions
- Void calls as statements: `doSomething();` — no temp needed, just pre-call step
- Calls in conditions: `if (check()) { ... }` — separate concern (substep plan)

### Identifying user functions vs library functions

Build the function registry from `function_definition` nodes in the translation unit. Any call whose name is in the registry is a user function and eligible for decomposition. All other calls are treated as library functions.

---

## Steps

### Step 1: Build function return type registry

- **What:** In `transformSource`, before `walkNode`, walk the root node to collect all `function_definition` nodes. Extract name and return type into a `Map<string, string>` (e.g., `'add' → 'int'`, `'createPlayer' → 'Player*'`).
- **Files:** `transformer.ts`
- **Verification:** Unit test: parse source with multiple functions, verify registry has correct entries

### Step 2: Add pre-call step for single-call statements

- **What:** In `instrumentDeclaration` and `instrumentExpressionStatement`, when the expression contains a user function call (checked via the function registry), add `__crow_step(line)` as a **pre-insertion** (before the statement, not after).
- **Files:** `transformer.ts`
- **Depends on:** Step 1
- **Verification:** Transform `int x = add(1,2);` and verify output has `__crow_step` before and after the statement

### Step 3: Implement call decomposition for multi-call expressions

- **What:** Add a function `decomposeUserCalls(expr, line, funcRegistry)` that:
  1. Walks the expression tree depth-first to find all `call_expression` nodes whose function name is in the registry
  2. For each (innermost first), creates a temp variable declaration and replaces the call with the temp name
  3. Returns: array of temp declarations (each followed by `__crow_step(line)`) and the modified expression text
- **Files:** `transformer.ts`
- **Depends on:** Step 1
- **Verification:** Unit test: decompose `add(1,2) + add(sub(3,4), 5)` → correct temp ordering

### Step 4: Integrate decomposition into instrumentDeclaration

- **What:** When a declaration's initializer has 2+ user function calls, use `decomposeUserCalls` to rewrite the statement. Use a `Replacement` to replace the entire declaration with: `{ temps... finalDecl __crow_decl(...) __crow_step(...) }`
- **Files:** `transformer.ts`
- **Depends on:** Steps 2, 3
- **Verification:** Transform `int x = add(1,2) + add(3,4);` → verify decomposed output

### Step 5: Integrate decomposition into instrumentExpressionStatement

- **What:** For assignment expressions with 2+ user calls in the RHS, decompose the RHS calls into temps. For bare multi-call expressions, same treatment.
- **Files:** `transformer.ts`
- **Depends on:** Steps 2, 3
- **Verification:** Transform `x = add(1,2) + add(3,4);` → verify decomposed output

### Step 6: Handle nested calls

- **What:** Ensure `decomposeUserCalls` processes calls depth-first (innermost first). `add(sub(1,2), 3)` extracts `sub(1,2)` first, then `add(__ct0, 3)`.
- **Files:** `transformer.ts` (within `decomposeUserCalls`)
- **Depends on:** Step 3
- **Verification:** Unit test with nested calls

### Step 7: Verification

- **What:** Run full test suite, check browser behavior
- **Depends on:** All steps
- **Verification:**
  1. `npm test` passes
  2. In browser: stepping through multi-call expression lands on calling line first
  3. In browser: returning from each call shows calling line before entering next call
  4. Existing diagnostic programs still work correctly

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Single call: `int x = add(1,2);` | Pre-call step, then enter function, then result step | Pre-call step added; no decomposition needed |
| Multiple calls: `add(1,2) + add(3,4)` | Step between calls | Full decomposition into temps |
| Nested: `add(sub(1,2), 3)` | Inner call extracted first | Depth-first traversal |
| Library call in mix: `add(1,2) + strlen(s)` | Only `add` decomposed | Only calls in funcRegistry get temps |
| Void statement: `doSomething();` | Pre-call step only | No temp needed for void or single-call statements |
| Chained assignment: `a = b = add(1,2);` | Pre-call step, single call | Pre-call step; one call doesn't need decomposition |
| Call as argument to library: `printf("%d", add(1,2))` | `add` extracted to temp | `add` is user function, `printf` is not |
| Side-effect-free expression: `add(1,2);` (discard result) | Pre-call step, call, done | Pre-call step added |
| No user calls: `int x = strlen(s) + 1;` | No change | No user function calls detected |

---

## Verification Checklist

- [x] `npm test` passes (950 tests)
- [x] `npm run build` succeeds
- [ ] Single-call statement: stepper lands on calling line before entering function
- [ ] Multi-call expression: stepper returns to calling line between function calls
- [x] Nested calls: inner call extracted before outer (test passes)
- [x] Library calls not decomposed (test passes)
- [ ] Existing diagnostic programs produce correct snapshots
- [ ] `validateProgram()` passes for all programs

## References

- [Interpreter callFunction](../../src/lib/interpreter/handlers/statements.ts) — lines 1508-1618, creates Call/Return steps
- [Transformer instrumentDeclaration](../../src/lib/wasm-backend/transformer.ts) — line 237
- [Transformer instrumentExpressionStatement](../../src/lib/wasm-backend/transformer.ts) — line 276
- [Substep plan](./2026-03-30-feat-wasm-substeps-plan.md) — related but separate concern
- [Op-collector onStep](../../src/lib/wasm-backend/op-collector.ts) — line 129, step dedup logic
