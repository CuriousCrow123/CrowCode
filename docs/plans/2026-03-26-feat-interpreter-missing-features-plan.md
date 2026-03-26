---
title: Interpreter Missing Features — Batch Implementation
type: feat
status: completed
date: 2026-03-26
---

# Interpreter Missing Features — Batch Implementation

## Enhancement Summary

**Deepened on:** 2026-03-26
**Sections enhanced:** 10 steps + design + edge cases
**Research agents used:** C-semantics reviewer, test-adequacy reviewer, snapshot-contract reviewer, 5 codebase exploration agents

### Critical Issues Found
1. **Switch/break collision** — `breakFlag` is shared between loops and switch; `break` inside switch-in-loop exits the loop (wrong). Need separate mechanism.
2. **String literal mutability** — Plan allocates strings on heap as mutable; C says modifying string literals is UB. Must mark read-only or emit error on write.
3. **String literal dual allocation** — Evaluator and interpreter must not both allocate; use declaration interception only.
4. **Switch anchor rule** — The initial "evaluate switch expression" step must be a regular step (not sub-step) to satisfy validateProgram's anchor rule.
5. **Function pointer data type** — `CValue.data` is `number | null`; storing a string name won't work. Use integer function-table index instead.

### Key Design Corrections
- **Array-to-pointer decay**: Decay in `evalIdentifier` unconditionally (except `sizeof` and `&` contexts) rather than checking at specific call sites. Simpler and covers `arr + 1`, `if(arr)`, etc.
- **Float type propagation**: `evalBinary` must return the promoted `CType`, not just skip `toInt32()`. Without this, `formatValue` treats the result as int.
- **Multi-dim subscript**: When `arr[i]` returns an inner array, set `data = null` and `address = row base address`. Otherwise the second subscript computes from the wrong base.
- **Cross-function free cleanup**: Must also clean up `ptrTargetMap` entries when function scope exits, or stale entries cause wrong block resolution.
- **Uninit display value**: Use `'(uninit)'` matching the parenthetical pattern of `'(dangling)'`.

---

## Context

The C interpreter has 560 passing tests and covers the core language well, but several features that users will encounter are missing or broken. This plan implements all remaining high/medium-priority features in dependency order.

**Features to implement (ordered by dependency):**

| # | Feature | Difficulty | Depends on |
|---|---------|-----------|------------|
| 1 | Chained assignment `a = b = c = 0` | Low | — |
| 2 | Array-to-pointer decay `int *p = arr` | Low | — |
| 3 | String literals `char *s = "hello"` | Medium | — |
| 4 | `switch`/`case`/`default` | Medium | — |
| 5 | Uninitialized variable warnings | Medium | — |
| 6 | Float/double arithmetic | Medium | — |
| 7 | Multi-dimensional arrays `int arr[3][4]` | Medium | — |
| 8 | Function pointers | Hard | — |
| 9 | Cross-function free (display fix) | Medium | — |
| 10 | Empty loop/if bodies (cleanup) | Low | — |

## Design

Each feature is self-contained and can be implemented independently. The plan groups them into steps that can be tested incrementally. All features follow existing patterns — no new architectural concepts needed.

**Key design decisions:**

- **Chained assignment**: In `interpreter.ts executeAssignment`, recursively call `executeAssignment` for inner assignment nodes with `sharesStep=true`. This ensures ops are emitted for all variables in the chain. The evaluator's `evalAssignment` already updates env values for inner assignments — the fix adds op emission.

- **Array-to-pointer decay**: Decay in `evalIdentifier` unconditionally when the result type is `array`. The three C exceptions (`sizeof(arr)`, `&arr`, string literal initializer for `char[]`) are already handled: `evalSizeofExpr` captures array type before decay would happen, `evalUnary` for `&` reads address before decay, and `char[]` init is a declaration path. This covers all expression contexts: `arr + 1`, `if(arr)`, `arr == p`, function args, assignment — without context-tracking.

- **String literals**: Intercept in `executeDeclaration` only (like malloc interception). Do NOT allocate in evaluator — keep `string_literal` returning 0 for non-declaration contexts (sprintf args etc. already work). Allocate as `char[]` on heap with null terminator. Mark heap block as read-only; emit error on write attempt (C says modifying string literals is UB). Use `allocHeapWithAddress` with `ChildSpec[]` including `addressOffset` for each character — required by validateProgram's address rule.

- **switch/case**: New AST nodes + interpreter execution. Fall-through by default, `break` exits. **Critical: need separate break mechanism.** The existing `breakFlag` is shared — a `break` inside a switch nested in a loop would exit the loop. Solution: save/restore `breakFlag` around switch execution, or use a `switchBreakFlag`. The initial "evaluate switch expression" step must be a regular step (not sub-step) to satisfy the anchor rule.

- **Uninitialized warnings**: Add `initialized?: boolean` to CValue. Display as `'(uninit)'` (matching `'(dangling)'` pattern). Warn on read — don't error. Separate `warnings: string[]` collection in interpreter alongside `errors: string[]`.

- **Float/double**: Skip `toInt32()` when either operand is float/double. **Must propagate promoted CType** from `evalBinary` — pass as second arg to `this.ok()`. Type promotion: `int + float → float`, `float + double → double`. Bitwise ops on floats should error. Display with `parseFloat(data.toFixed(6)).toString()`.

- **Multi-dimensional arrays**: Nested `CType.array` in parser (type system already supports recursion). Flatten to 1D in memory. **Critical for subscript**: when `evalSubscript` on a 2D array returns the inner array for `arr[i]`, set `data = null` and `address = computed row base`. The second subscript uses `obj.value.address` as base — if `data` contains the first element's value instead, the address computation is wrong. Build nested `ChildSpec[]` with correct `addressOffset` values for visualization.

- **Function pointers**: Add `{ kind: 'function'; returnType: CType; paramTypes: CType[] }` to CType. Store function-table integer index as `CValue.data` (not a string — `data` is `number | null`). Assign each function an index at registration. On call, `evalCall` checks if callee identifier resolves to function-pointer type, looks up index → function name → AST node, then calls. Display as `"→ funcName"`.

- **Cross-function free**: Register parameter names in `ptrTargetMap` when passing pointer arguments. **Must also clean up `ptrTargetMap` entries on scope exit** via `cleanupScopeVars` — otherwise stale entries from previous calls cause wrong block resolution.

- **Empty bodies**: Already works for loops. Just verify and add test coverage.

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/types.ts` | Add `switch_statement`, `case_clause` AST nodes; add `initialized` to CValue; add `function` CType kind | New language constructs |
| `src/lib/interpreter/parser.ts` | Parse switch/case/default; parse multi-dim arrays; parse function pointer parameters | AST conversion |
| `src/lib/interpreter/evaluator.ts` | Fix chained assignment; add float arithmetic paths; add array-to-pointer decay in evalIdentifier; handle function pointer calls | Expression evaluation |
| `src/lib/interpreter/interpreter.ts` | Add `executeSwitch` with separate break; string literal heap allocation (read-only); uninit tracking; cross-function free display; empty body handling | Statement execution |
| `src/lib/interpreter/emitter.ts` | Track pointer reassignment across functions; clean up ptrTargetMap on scope exit | Display fixes |
| `src/lib/interpreter/types-c.ts` | Float arithmetic helpers; function type size/comparison; `isFunctionType` helper | Type system |
| `src/lib/interpreter/environment.ts` | Add `initialized` flag to declareVariable/setVariable | Uninit tracking |
| `src/lib/interpreter/stdlib.ts` | Recursive `buildArrayChildSpecs` for nested arrays | Multi-dim visualization |
| `src/lib/interpreter/value-correctness.test.ts` | Tests for all features | Verification |
| `src/lib/interpreter/manual-programs.test.ts` | Test programs for switch, strings, floats, multi-dim arrays | Integration tests |
| `src/lib/interpreter/evaluator.test.ts` | Unit tests for float arithmetic, array decay helper, function pointer dispatch | Unit verification |
| `src/lib/interpreter/parser.test.ts` | Parse tests for switch, multi-dim arrays, function pointers | Parser verification |
| `src/lib/test-programs.ts` | Add dropdown programs for new features | UI testing |

## Steps

### Step 1: Chained assignment fix
- **What:** Fix evaluator to execute side effects for inner assignments in `a = b = c = 0`. When `evalAssignment` processes `b = (c = 0)`, the inner `c = 0` must update `c` in the environment before returning the value to the outer assignment.
- **Root cause:** `evalAssignment` calls `this.eval(node.value)` which recursively evaluates, but the interpreter's `executeAssignment` (which emits steps/ops) only runs for the outermost assignment. Inner assignments go through evaluator only, which does call `env.setVariable` — but the interpreter never emits ops for them.
- **Fix approach:** In `interpreter.ts executeAssignment`, before evaluating RHS, check if `node.value.type === 'assignment'`. If so, recursively call `executeAssignment` for the inner assignment (with `sharesStep=true` so it doesn't create a new step), then use the result. This ensures ops are emitted for all assignments in the chain.
- **Files:** `interpreter.ts`, `evaluator.ts`
- **Verification:** Remove `test.fails` from chained assignment test, expect it to pass.

#### Research Insights

**Pedagogical concern:** With `sharesStep=true`, all inner assignments fold into a single step. The UI cannot animate `c=0` → `b=0` → `a=0` individually. Consider whether inner assignments should be distinct sub-steps (`subStep: true` on the same line) rather than folded ops — this gives step-by-step animation while keeping them grouped under the line.

**`a = b = malloc(4)` edge case:** If the fix reorders evaluation, `malloc` could be called twice. The inner assignment must be processed before the outer one sees its result. Since `executeAssignment` evaluates RHS first, and malloc interception already happens at the RHS call level, this should work — but needs explicit test coverage.

#### Minimum Tests (4)
1. `a = b = c = 0` sets all three (promote existing `test.fails`)
2. `a = b = 3 + 4` — both are 7 (non-trivial inner RHS)
3. Verify setValue ops emitted for `b` and `c`, not just `a`
4. Step structure: chained assignment produces one step (sharesStep works)

---

### Step 2: Array-to-pointer decay
- **What:** When an array variable is used in expression context, automatically convert it to a pointer whose value is the array's base address. Exceptions: `sizeof(arr)` and `&arr`.
- **Fix approach:** Add `decayArrayToPointer(value: CValue): CValue` helper to evaluator. Apply decay in `evalIdentifier` unconditionally when result type is `array`. The three C exceptions are naturally handled:
  1. `sizeof(arr)` — `evalSizeofExpr` captures the type before identifier decay
  2. `&arr` — `evalUnary` for `&` reads `address` field (unaffected by decay)
  3. `char s[] = "hello"` — declaration path, not expression evaluation
- **Why decay in evalIdentifier (not at call sites):** Covers all contexts: `arr + 1`, `if(arr)`, `arr == p`, function args, assignment — without tracking context at 5+ separate call sites.
- **Files:** `evaluator.ts`
- **Verification:** Test `int arr[5]; int *p = arr; *p = 99;` — p should point to arr[0]'s address.

#### Research Insights

**C standard contexts where decay occurs:** Nearly every expression context except `sizeof`, `&`, and string literal initializer for `char[]`. Decaying in `evalIdentifier` unconditionally is the simplest correct approach since all exceptions are handled upstream.

**`sizeof(arr)` must NOT be broken:** Current code evaluates `sizeof` on the expression's type. If decay happens before sizeof sees the type, it would return pointer size (4) instead of array size (20 for `int[5]`). Verify `evalSizeofExpr` captures the pre-decay type.

#### Minimum Tests (4)
1. `int arr[5]; int *p = arr;` — p's value = arr's base address
2. `*p = 99` after decay updates arr[0]
3. Array passed to function expecting `int*` — parameter holds array's address
4. `int x = arr[1];` still subscripts normally (decay doesn't break existing paths)

---

### Step 3: String literals
- **What:** `char *s = "hello"` allocates a char array on the heap containing the string bytes + null terminator, and returns a pointer to it.
- **Fix approach:** Intercept in `executeDeclaration` only (like malloc pattern):
  1. Check if initializer is `string_literal` and target type is pointer-to-char
  2. Allocate heap block: `env.malloc(strlen + 1, 'string_literal', line)`
  3. Set heap block type: `arrayType(primitiveType('char'), len + 1)`
  4. Store char codes in `memoryValues` at sequential addresses, plus null terminator (0)
  5. Declare pointer variable with heap address as value
  6. Build `ChildSpec[]` with `addressOffset` for each character (required by validateProgram)
  7. Use `allocHeapWithAddress` to emit heap block with children
  8. Keep evaluator `string_literal → 0` for non-declaration contexts (sprintf args already work)
- **Read-only enforcement:** Mark string literal heap blocks. On write via subscript/dereference to a string literal block, emit error: "UB: write to string literal". Add a `readOnly?: boolean` field to `HeapBlock`.
- **Files:** `interpreter.ts`, `types.ts` (HeapBlock), `evaluator.ts` (no allocation here)

#### Research Insights

**Snapshot contract concern:** String literal char children must have addresses. Use `buildArrayChildSpecs(primitiveType('char'), size, charValues)` which produces `ChildSpec[]` with `addressOffset` fields. Pass these to `allocHeapWithAddress`. Without address offsets, validateProgram will error on every character child.

**Dual allocation risk:** If both evaluator and interpreter allocate, the same string gets two heap blocks. The evaluator's `string_literal` case must remain `return this.ok(0)` — only the declaration interception path allocates. For `printf("hello")`, the string is consumed as a format string by the stdlib handler, not as a pointer.

**Display:** Show char values as `'h'`, `'e'`, `'l'`, `'l'`, `'o'`, `'\0'` in heap children. For printable ASCII (32-126), use `'c'` format; otherwise use numeric code.

#### Minimum Tests (5)
1. Heap block created with `status: 'allocated'`, `size: 6` (5 + null)
2. Individual char values correct in children
3. Pointer variable value = heap block address (not `'0'`)
4. Two identical strings get separate allocations (no interning)
5. Parser produces `string_literal` node in declaration initializer

---

### Step 4: switch/case/default
- **What:** Full switch statement support with fall-through semantics and break.
- **AST nodes:**
  ```typescript
  // Add to ASTNode union in types.ts:
  | { type: 'switch_statement'; expression: ASTNode; cases: ASTCaseClause[]; line: number }

  // New type:
  export type ASTCaseClause = {
    kind: 'case' | 'default';
    value?: ASTNode;        // undefined for default
    statements: ASTNode[];
    line: number;
  };
  ```
- **Parser:** Convert tree-sitter `switch_statement`:
  - `node.childForFieldName('condition')` → parenthesized expression
  - `node.childForFieldName('body')` → compound_statement containing `case_statement` children
  - Each `case_statement` has optional `childForFieldName('value')` (null for default)
  - Statements after `:` are the body — iterate children, skip keywords and punctuation
- **Interpreter:** `executeSwitch`:
  1. Evaluate switch expression → emit regular step (anchor): `"switch: <expr> = <value>"`
  2. Find matching case (compare values)
  3. Execute from matching case forward (fall-through), stop at `break` or end
  4. If no match and no default, skip entirely

- **Break handling (CRITICAL):** The existing `breakFlag` is shared between loops and switch. A `break` inside a switch nested in a for-loop would incorrectly exit the loop. **Fix:** Save `breakFlag` before switch, execute cases, consume `breakFlag` if set (it was a switch-break), restore saved flag after switch.
  ```typescript
  private executeSwitch(node: ...): void {
    // ... evaluate expression, emit step ...
    const savedBreak = this.breakFlag;
    this.breakFlag = false;
    for (const clause of matchedCases) {
      this.executeStatements(clause.statements);
      if (this.breakFlag) { this.breakFlag = false; break; } // switch-break consumed
      if (this.returnFlag || this.continueFlag) break; // propagate to enclosing
    }
    this.breakFlag = savedBreak; // restore — loop break not swallowed
  }
  ```
- **Files:** `types.ts`, `parser.ts`, `interpreter.ts`
- **Verification:** Test basic switch, fall-through, default, switch inside loop with break.

#### Research Insights

**Tree-sitter structure:** `switch_statement` has fields `condition` and `body`. The body is a `compound_statement` containing `case_statement` nodes. Each `case_statement` has optional `value` field (null for default) and child statements after the colon.

**Anchor rule compliance:** The initial "evaluate switch expression" step at the `switch(x)` line must be a regular step (`subStep` omitted). Individual case comparisons can be sub-steps. Without the anchor step, validateProgram will error for the switch line.

**`continue` inside switch:** In C, `continue` inside a switch nested in a loop skips to the next loop iteration. The current `continueFlag` mechanism handles this correctly — switch doesn't consume `continueFlag`, it propagates to the enclosing loop.

#### Minimum Tests (8)
1. Basic match: `switch(2) { case 1: r=10; break; case 2: r=20; break; }` → r=20
2. Default taken when no case matches
3. No default + no match → body skipped, variable unchanged
4. Fall-through: `case 1: r+=10; case 2: r+=20; break;` with x=1 → r=30
5. **Break exits switch, not enclosing loop**: `for(i=0;i<3;i++) { switch(i){case 1: break;} count++; }` → count=3
6. `continue` inside switch-in-loop: `for(i=0;i<3;i++){switch(i){case 1: continue;} sum+=i;}` → sum=2
7. Parser: `switch_statement` node with `case_clause` children
8. Step description contains `"switch:"` prefix

---

### Step 5: Uninitialized variable warnings
- **What:** Track which variables have been explicitly initialized. Warn (don't error) when reading an uninitialized variable.
- **Fix approach:**
  1. Add `initialized?: boolean` to `CValue` in types.ts
  2. In `environment.ts declareVariable`, set `initialized: false` when `data === null` (no initial value)
  3. In `environment.ts setVariable`, set `initialized: true`
  4. In `evaluator.ts evalIdentifier`, check `initialized` flag. If false, call a warning callback (don't error — C allows UB reads, computation proceeds with default 0)
  5. In interpreter, collect warnings in separate `warnings: string[]` array. Return alongside errors.
  6. Display uninitialized variables with value `'(uninit)'` until first assignment
- **Files:** `types.ts`, `environment.ts`, `evaluator.ts`, `interpreter.ts`
- **Verification:** Test `int x; int y = x;` — warning emitted, x shows as `'(uninit)'`.

#### Research Insights

**Display value contract:** Use `'(uninit)'` matching the parenthetical pattern of `'(dangling)'`. This is not currently listed in the op-generation-requirements value contract — document as an extension.

**Function parameters are always initialized:** `executeUserFunctionCall` passes argument values to `declareVariable` — these should have `initialized: true`. Only declarations without initializers get `initialized: false`.

**Existing test conflict:** `value-correctness.test.ts` line 137 has a test `'uninitialized variable shows 0'` that expects `'0'`. This must be updated to expect `'(uninit)'` when the feature lands.

#### Minimum Tests (5)
1. `int x;` shows `'(uninit)'` in snapshot
2. Warning emitted on read: `int x; int y = x;` — spy catches warning
3. No warning after assignment: `int x; x = 5; int y = x;`
4. Function parameter is always initialized (no warning)
5. Struct declaration without initializer warns on field access

---

### Step 6: Float/double arithmetic
- **What:** When operands are float/double, preserve decimal precision instead of truncating to int32.
- **Fix approach:**
  1. Add `isFloatingPoint(type: CType): boolean` helper to evaluator
  2. In `evalBinary`, check operand types. If either is float/double:
     - Skip `toInt32()` and `Math.imul()` — use raw JS arithmetic
     - **Return promoted CType** via `this.ok(result, promotedType)` — critical for correct display
     - Type promotion: `int + float → float`, `float + double → double`
     - Bitwise ops (`&`, `|`, `^`, `~`, `<<`, `>>`) on floats → error
     - Modulo (`%`) on floats → error (not allowed in C)
  3. In `evalUnary`, skip `toInt32()` for float negation
  4. In `evalAssignment`, skip `toInt32()` for compound ops on float variables
  5. In `interpreter.ts formatValue`, format floats: `parseFloat(data.toFixed(6)).toString()`
  6. Cast: `(int)3.14` → `Math.trunc()`, `(float)3` → preserve as 3.0
- **Files:** `evaluator.ts`, `interpreter.ts`, `types-c.ts`
- **Verification:** Test `float x = 3.14; float y = x * 2.0;` — y should be 6.28.

#### Research Insights

**Parser already handles floats:** `parseNumber()` (parser.ts:715-721) detects decimals via `includes('.')` and calls `parseFloat()`. Tree-sitter-c correctly parses `3.14` and `3.14f`.

**Type propagation is critical:** Without propagating the promoted CType from `evalBinary`, `formatValue` sees `type.name === 'int'` and formats as integer, truncating the display. The `this.ok()` helper must accept an optional type parameter.

**`int / int` must still truncate:** `7 / 2 = 3`, not `3.5`. Only promote when at least one operand is float/double. `float x = 1/3` produces `0.0` (integer division then implicit widening) — this is a common C gotcha and must be tested.

**Array/struct parents with float elements:** `formatValue` must still return `''` for array/struct parent entries. Only leaf values get float formatting.

#### Minimum Tests (9)
1. `float + float` preserves decimal (evaluator unit)
2. `int + float` promotes to float (evaluator unit)
3. `float / float` not truncated: `7.0 / 2.0 = 3.5` (evaluator unit)
4. `int / int` still truncates: `7 / 2 = 3` (regression guard)
5. `float x = 3.14;` displays decimal string in snapshot
6. `float y = x * 2.0;` → y = 6.28 (integration)
7. `int z = (int)3.7;` → z = 3 (cast truncation)
8. `float x = 1/3;` → x = 0.0 (integer division gotcha)
9. Display format: no excessive trailing zeros

---

### Step 7: Multi-dimensional arrays
- **What:** Support `int arr[3][4]` with nested indexing `arr[i][j]`.
- **Fix approach:**
  1. **Parser:** In `parseDeclarator`, handle nested `array_declarator` nodes. Tree-sitter nests them inner-first: `int arr[3][4]` has outer=3, inner=4. Collect dimensions with `unshift()` to reverse. Store as `arrays?: number[]` in CTypeSpec (alongside existing `array?: number` for backward compat, or migrate).
  2. **Type resolution:** In `TypeRegistry.resolve()`, build nested array types from innermost to outermost: `arrayType(arrayType(int, 4), 3)`. The existing CType already supports recursive nesting.
  3. **Memory layout:** 48 bytes contiguous. `sizeOf` already handles nesting: `3 * sizeOf(arrayType(int, 4)) = 3 * 16 = 48`.
  4. **Subscript evaluation:** Current `evalSubscript` already works for nesting! `arr[i]` returns `{ type: arrayType(int, 4), address: baseAddr + i * 16 }`. The second subscript `[j]` resolves from there. **Critical:** set `data = null` (not memReader value) so the second subscript uses `address` as base.
  5. **Init lists:** Recursive flattening of `{{1,2,3},{4,5,6}}` — nested `init_list` nodes.
  6. **Visualization:** Build nested `ChildSpec[]` via recursive `buildArrayChildSpecs`. Inner children must have correct `addressOffset` values.
- **Files:** `parser.ts`, `types.ts` (CTypeSpec), `types-c.ts`, `interpreter.ts`, `stdlib.ts`

#### Research Insights

**Type system already supports nesting:** `CType.array` is recursive — `arrayType(arrayType(int, 4), 3)` works today. `sizeOf` correctly computes nested sizes. No type system changes needed.

**Evaluator subscript already works for nesting:** `evalSubscript` returns `{ type: elementType, address: computed }` — for a 2D array, `elementType` is the inner array type, and the second subscript processes it correctly. The only fix needed: when returning an inner-array result, ensure `data = null` so the next subscript uses `address` (not `data`) as base.

**CTypeSpec extension:** Add `arrays?: number[]` to CTypeSpec. In `TypeRegistry.resolve()`, build nested types: `for (i = arrays.length - 1; i >= 0; i--) base = arrayType(base, arrays[i])`.

#### Minimum Tests (6)
1. Parser: `int arr[2][3]` produces nested array CType
2. `int m[2][3] = {{1,2,3},{4,5,6}}; int x = m[1][2];` → x = 6
3. Boundary test: `m[0][2] = 3`, `m[1][0] = 4` (off-by-one guard)
4. Write through double subscript: `m[0][1] = 99;`
5. Snapshot shows nested children: m[0] → [0][0], [0][1], [0][2]
6. `int arr[0][5]` — reject or empty (pick one, document)

---

### Step 8: Function pointers
- **What:** Support declaring function pointers and calling through them.
- **Fix approach:**
  1. **Types:** Add `{ kind: 'function'; returnType: CType; paramTypes: CType[] }` to CType union. Add `isFunctionType()` helper. `sizeOf(function) = POINTER_SIZE` (4 bytes).
  2. **Function table:** In `environment.ts`, assign each defined function an integer index at registration. Add `getFunctionByIndex(index: number)` alongside existing `getFunction(name)`.
  3. **Parser:** Recognize `int (*fp)(int, int)` declarations. Tree-sitter structure: `pointer_declarator` → `parenthesized_declarator` → `function_declarator` with `parameters` field. Extract return type from declaration base type, parameter types from parameter list.
  4. **Evaluator:** In `evalCall`, when callee resolves to a function-pointer-typed variable: read `data` (function table index), look up function name via `env.getFunctionByIndex(data)`, pass resolved name to `onCall`. Current AST has `callee: string` — this is the variable name, not the function name; the indirection must be explicit.
  5. **Interpreter:** In call handler, check if name resolves to a function pointer variable before checking function definitions. If so, resolve through the pointer.
  6. **Display:** Function pointer variable shows `"→ funcName"` as value.
- **Files:** `types.ts`, `types-c.ts`, `parser.ts`, `evaluator.ts`, `interpreter.ts`, `environment.ts`

#### Research Insights

**Simplified approach is correct for education:** Full function pointer support (signature checking, casting, variadic) is complex. The plan correctly limits scope to: declare, assign function name, call through pointer. No signature type checking at assignment time.

**`CValue.data` is `number | null`:** Cannot store a string function name. Use integer function-table index. Each function gets an index at `defineFunction` time. Store index as `data`. On call, resolve index → name → AST node.

**`call_expression.callee` is a string:** For `fp(3,4)`, `callee === "fp"`. The interpreter's call handler currently does `env.getFunction(name)`. Must add: `if (!func) { check if name is a function pointer variable; if so, resolve index → actual function name; retry getFunction }`.

#### Minimum Tests (6)
1. Parser: `int (*fp)(int, int)` produces function CType
2. Basic call: `int (*fp)(int,int) = add; fp(3,4);` → x = 7
3. Function pointer survives across steps (assign, do other work, then call)
4. `int (*fp)(int) = NULL; fp(1);` → null pointer error
5. Reassignment: `fp = add; fp = sub; fp(5,3);` → uses sub
6. Function pointer as parameter to another function

---

### Step 9: Cross-function free display fix
- **What:** When `free(ptr)` is called inside a helper function, the heap block should show as freed in the visualization.
- **Root cause:** The emitter's `ptrTargetMap` maps variable names to heap block IDs. When a pointer is passed as a function parameter, the parameter name is different from the original variable name, so `ptrTargetMap` lookup fails.
- **Fix approach:**
  1. In `interpreter.ts executeUserFunctionCall`, when passing a pointer argument: look up the argument's `ptrTargetMap` entry, register the parameter name → same heap block ID.
  2. **Critical companion fix:** In `emitter.cleanupScopeVars` (called on scope exit), also clean up `ptrTargetMap` entries for the exiting scope's variables. Without this, stale parameter names in `ptrTargetMap` from previous calls cause wrong block resolution for subsequent calls with the same parameter names.
- **Files:** `interpreter.ts`, `emitter.ts`
- **Verification:** Test function that receives pointer and frees it — heap block should show "freed" status.

#### Research Insights

**Heap free itself works correctly:** `environment.ts free()` uses global `heapBlocks` map keyed by address. The issue is only in the emitter's display — `ptrTargetMap` can't find the heap block ID by the parameter name to emit the status change op.

**Scope cleanup is essential:** If function `cleanup(int *q)` frees `q`, and later `other(int *q)` is called with a different pointer, the stale `q → old_block_id` mapping would cause wrong display.

#### Minimum Tests (4)
1. Heap block shows 'freed' after cross-function free
2. Original pointer in caller shows '(dangling)' after return
3. Multi-level free: `outer(p)` calls `inner(p)`, inner frees — works through two renames
4. Renamed parameter: `void cleanup(int *q)` — different name from caller's variable

---

### Step 10: Empty body cleanup + test programs
- **What:** Ensure empty bodies `for(;;){}`, `if(x){}`, `while(x){}` work without errors. Add test programs for all new features to the dropdown.
- **Fix approach:** Test current behavior through `interpretAndBuild()` (which calls `expectValid` and `expectNoWarnings`). If errors exist, add guards in execute methods. Add dropdown programs for switch, strings, floats, multi-dim arrays, function pointers.
- **Files:** `interpreter.ts`, `test-programs.ts`, `value-correctness.test.ts`
- **Verification:** All empty-body programs run without errors. Dropdown has new test programs.

#### Minimum Tests (4)
1. `for(i=0; i<5; i++) {}` passes `interpretAndBuild` (promote existing weak test)
2. `while(x > 0) {}` with x=0 — valid program
3. `if(x > 5) {}` — condition step emitted, no errors
4. `if(x) { r = 1; } else {}` — else branch does nothing, r correct

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| `a = b = malloc(4)` | Both point to same heap block | Chained assignment: inner malloc intercepted first, outer gets address |
| `a = b = 3 + 4` | Both set to 7 | Inner eval returns 7, outer assigns 7 |
| `switch` without `break` (fall-through) | Executes all subsequent cases | Execute from match point forward |
| `switch` with no matching case, no default | Skip entire switch body | No case matches → skip |
| `break` in switch inside loop | Exits switch only, loop continues | Save/restore breakFlag around switch |
| `continue` in switch inside loop | Skips to next loop iteration | continueFlag not consumed by switch |
| `"hello"` appears twice in code | Two separate heap allocations | Each string_literal gets own allocation |
| `char *s = "hello"; s[0] = 'H';` | Error: write to string literal | HeapBlock.readOnly check on write |
| `float x = 1/3` | x = 0.0 (integer division) | int/int stays int; widened to float on assign |
| `7.0 / 2.0` | 3.5 (not 3) | Float operand detected, skip toInt32 |
| `int arr[0][5]` | Reject or empty | Zero-size check in declaration |
| `arr[i]` on 2D array | Returns inner array pointer | data=null, address=row base |
| `int (*fp)(int) = NULL; fp(1)` | Null function pointer error | Check data == 0 before call dispatch |
| `int x; x = x + 1;` | Warn on read, then x = 1 | Warning emitted, proceed with default 0 |
| Nested multi-dim init `{{1,2},{3,4}}` | Flatten into memory | Recursive init_list processing |
| `free` inside recursive function | Each frame's pointer freed independently | ptrTargetMap tracks per-scope, cleaned up on exit |
| String literal in printf arg | Works as before (no allocation) | Evaluator returns 0, stdlib handler extracts text |

## Verification
- [ ] `npm test` passes (all existing 562 tests + ~60 new tests)
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] Chained assignment `test.fails` promoted to passing
- [ ] Struct-pointer-chain bounds `it.skip` remains (separate issue)
- [ ] New test programs visible in Custom tab dropdown
- [ ] Each feature has minimum tests as specified per step
- [ ] Switch break inside loop does NOT exit loop
- [ ] String literal write produces error
- [ ] Float display shows decimal values
- [ ] Multi-dim array shows nested children

## References
- [docs/interpreter-status.md](../interpreter-status.md) — Current feature matrix
- [docs/architecture.md](../architecture.md) — System architecture
- [docs/research/op-generation-requirements.md](../research/op-generation-requirements.md) — Op generation contract
- [src/lib/interpreter/types.ts](../../src/lib/interpreter/types.ts) — AST and type definitions
- [src/lib/interpreter/evaluator.ts](../../src/lib/interpreter/evaluator.ts) — Expression evaluation
- [src/lib/interpreter/interpreter.ts](../../src/lib/interpreter/interpreter.ts) — Statement execution
- [src/lib/engine/validate.ts](../../src/lib/engine/validate.ts) — validateProgram rules
