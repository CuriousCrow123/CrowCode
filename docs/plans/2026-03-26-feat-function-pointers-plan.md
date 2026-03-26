---
title: Function Pointers + Multi-Dimensional Array Writes
type: feat
status: completed
date: 2026-03-26
---

# Function Pointers + Multi-Dimensional Array Writes

## Context

Two remaining features from the interpreter batch plan:

1. **Function pointers** — Declare, assign, call through pointer. The `call_expression` AST stores `callee` as a plain string, but `fp(3,4)` needs variable lookup first.
2. **Multi-dimensional array writes** — `int m[2][3]; m[1][2] = 6;` currently fails because `buildAccessPath` discards array indices and the emitter can't construct the correct child ID for nested subscripts.

---

## Part A: Multi-Dimensional Array Writes

### Root Cause Analysis

The failure for `m[1][2] = 6` has three linked causes:

**1. `buildAccessPath` discards array indices** (evaluator.ts:516-517)
```typescript
if (node.type === 'subscript_expression') {
  return [...Evaluator.buildAccessPath(node.object)]; // Discards index!
}
```
For `m[1][2]`, this returns `['m']` — both indices lost.

**2. `executeAssignment` uses incomplete path** (interpreter.ts:677-726)
```typescript
const objPath = Evaluator.buildAccessPath(node.target.object); // ['m'] not ['m', '1']
// Then: directSetValue('m-2', displayVal) — should be 'm-1-2'
```
The single-level subscript code appends only the outer index `2`, missing the inner index `1`.

**3. Value storage works, display doesn't**
The evaluator's `eval(node.target)` correctly computes the nested address, and `memoryValues.set(address, val)` succeeds. The problem is only in the emitter op emission — the snapshot visualization shows the wrong child or no update.

### Design: Multi-Dim Array Write Fix

**Strategy:** Don't try to make `buildAccessPath` understand array indices. Instead, handle nested subscript assignment by computing the flat element address, finding the corresponding emitter child ID by walking the nested children.

**Approach:**
1. In `executeAssignment` subscript path, detect nested subscripts
2. Evaluate the full LHS expression to get the target address (already works)
3. Store in `memoryValues` (already works)
4. For the emitter: compute the flat index from the nested indices, then build the correct child ID string

**For a 2D array `int m[2][3]`:**
- Children in emitter: `m-0`, `m-1` (rows), with sub-children `m-0-0`, `m-0-1`, `m-0-2`, `m-1-0`, `m-1-1`, `m-1-2`
- But wait — current `buildArrayChildSpecs` builds flat children: `m-0` through `m-5` for a `[2][3]` array (6 ints)
- **This is the deeper issue:** The emitter doesn't build nested children for multi-dim arrays. The children are flat.

**Revised approach:** Since children are flat, `m[1][2]` maps to flat index `1*3 + 2 = 5`, so the child ID is `m-5`. The fix:
1. Detect nested subscript in assignment path
2. Evaluate all index expressions
3. Compute flat index: `outerIndex * innerSize + innerIndex`
4. Use the flat index with the array's root entry ID

**Why flat works:** The parser already resolves `int m[2][3]` as `arrayType(arrayType(int, 3), 2)`. `sizeOf` computes 24 bytes. But `buildArrayChildSpecs` currently builds children based on the outer element type — if the element type is itself an array, it needs to flatten recursively.

Actually, let me reconsider. The `buildArrayChildSpecs` for `arrayType(arrayType(int, 3), 2)` is called with `elementType = arrayType(int, 3)` and `size = 2`. Each child would be of array type — but the function builds flat specs with `addressOffset: i * elemSize`. For display this creates `m-0` (size 12) and `m-1` (size 12), but no sub-children for `m-0-0`, etc.

**The real fix needs two things:**
1. **stdlib.ts `buildArrayChildSpecs`:** When the element type is itself an array, recursively build nested children
2. **interpreter.ts assignment path:** For nested subscripts, walk the nested children to find the correct leaf child ID

**Simplest correct approach:** Since the emitter uses flat indices for array children, map `m[i][j]` to flat index `i * innerDim + j` and emit `directSetValue('root-flatIndex', val)`. This avoids needing nested ChildSpec and keeps the emitter simple.

### Steps for Multi-Dim Array Writes

#### Step A1: Fix `buildArrayChildSpecs` for nested arrays
- **What:** In `stdlib.ts`, when `elementType` is itself an array, flatten into a single level of children. For `arrayType(arrayType(int, 3), 2)`, produce 6 children: `[0][0]`, `[0][1]`, `[0][2]`, `[1][0]`, `[1][1]`, `[1][2]` with correct `addressOffset` and `displayName`.
- **Files:** `stdlib.ts`
- **Key logic:**
  ```typescript
  if (isArrayType(elementType)) {
    // Flatten: outer * inner children
    const innerSize = elementType.size;
    const innerElemType = elementType.elementType;
    const innerElemSize = sizeOf(innerElemType);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < innerSize; j++) {
        specs.push({
          name: `${i * innerSize + j}`,
          displayName: `[${i}][${j}]`,
          type: innerElemType,
          value: initValues?.[i * innerSize + j] ?? '0',
          addressOffset: (i * innerSize + j) * innerElemSize,
        });
      }
    }
  }
  ```
- **Cap:** Still cap total children at 20 for display
- **Verification:** `npm test` — existing 1D arrays unchanged; new test for 2D array declaration shows all children

#### Step A2: Fix `buildAccessPath` to include array indices
- **What:** Modify `buildAccessPath` in evaluator.ts to include array index information for nested subscripts. Change return type or approach:
  - **Option A:** Include indices in path as strings: `['m', '[1]', '[2]']` — but this mixes field names and indices
  - **Option B (preferred):** Don't use `buildAccessPath` for nested subscripts at all. Instead, in `executeAssignment`, detect nested subscripts and compute the flat index directly.
- **Files:** `evaluator.ts` (minimal), `interpreter.ts` (main fix)

#### Step A3: Fix `executeAssignment` for nested subscript targets
- **What:** In the subscript branch of `executeAssignment` (interpreter.ts ~line 677), detect when `node.target` is a nested subscript (i.e., `node.target.object.type === 'subscript_expression'`). When detected:
  1. Evaluate all indices from outermost to innermost
  2. Walk the AST to find the root array variable name
  3. Determine the inner dimension size from the type
  4. Compute flat index: `outerIdx * innerDim + innerIdx`
  5. Resolve the root array's entry ID via emitter
  6. Emit `directSetValue(rootId + '-' + flatIndex, displayVal)`
  7. The address computation and memoryValues storage already work via `eval(node.target)`
- **Files:** `interpreter.ts`
- **Key code sketch:**
  ```typescript
  // Detect nested subscript: m[i][j]
  if (node.target.type === 'subscript_expression' &&
      node.target.object.type === 'subscript_expression') {
    const innerSub = node.target;        // [j] part
    const outerSub = innerSub.object;    // m[i] part

    const outerIdx = this.evaluator.eval(outerSub.index).value.data ?? 0;
    const innerIdx = this.evaluator.eval(innerSub.index).value.data ?? 0;

    // Get root array name
    const rootName = outerSub.object.type === 'identifier' ? outerSub.object.name : '';

    // Get inner dimension from type
    const rootVar = this.env.lookupVariable(rootName);
    let innerDim = 1;
    if (rootVar && isArrayType(rootVar.type) && isArrayType(rootVar.type.elementType)) {
      innerDim = rootVar.type.elementType.size;
    }

    const flatIdx = outerIdx * innerDim + innerIdx;

    // Store value
    const targetEval = this.evaluator.eval(node.target);
    if (targetEval.value.address) {
      this.memoryValues.set(targetEval.value.address, newVal);
    }

    // Emit visualization update
    const rootId = this.emitter.resolvePathId([rootName]);
    if (rootId) {
      this.emitter.directSetValue(`${rootId}-${flatIdx}`, displayVal);
    }
    return; // Skip the single-subscript path
  }
  ```
- **Verification:** Test `int m[2][3]; m[1][2] = 6; int x = m[1][2];` → x = 6

#### Step A4: Handle nested init_list for 2D declaration
- **What:** When declaring `int m[2][3] = {{1,2,3},{4,5,6}}`, the parser produces nested `init_list` nodes. The interpreter's array declaration path currently handles only flat init_list. Add recursive flattening.
- **Files:** `interpreter.ts` (in `executeDeclaration` array branch)
- **Key logic:** When `node.initializer.type === 'init_list'` and elements are also `init_list`, flatten them: iterate outer list, for each inner list iterate values, store at sequential addresses.
- **Verification:** Test `int m[2][3] = {{1,2,3},{4,5,6}}; int x = m[1][2];` → x = 6

#### Step A5: Tests for multi-dim arrays
- **What:** Comprehensive tests:
  1. `m[1][2] = 6; int x = m[1][2];` → x = 6 (write + read)
  2. Declaration with nested init_list
  3. Flat index correctness: `m[0][2]` = flat 2, `m[1][0]` = flat 3
  4. Bounds: `m[2][0]` on a `[2][3]` array → out of bounds (outer index >= 2)
  5. Snapshot shows children with `[i][j]` display names
  6. Add dropdown test program
- **Files:** `value-correctness.test.ts`, `test-programs.ts`

### What Can Go Wrong (Multi-Dim Arrays)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **`buildArrayChildSpecs` flattening breaks 1D arrays** | All existing array tests fail | Guard: only flatten when `isArrayType(elementType)` |
| **Flat child IDs don't match emitter's generated IDs** | `directSetValue` silently fails | Test: verify setValue op targets match actual child IDs |
| **3D arrays (`int a[2][3][4]`)** | Untested, may produce wrong flat index | Scope: only support 2D for now, document limitation |
| **Nested init_list with wrong count** | `{{1,2},{3,4,5}}` — inner lists of different sizes | Use actual element count, fill remaining with 0 |
| **Array decay + 2D array** | `int *p = m[1]` — pointer to row | Currently works since `m[1]` evaluates to inner array → decays to pointer |
| **`sizeof(m)` returns wrong value** | Was already fixed in evalSizeofExpr | Verify: `sizeof(int[2][3])` = 24 |
| **Empty inner dimension `int m[0][3]`** | Zero-size outer → no children | Guard in buildArrayChildSpecs |
| **Cap at 20 children hides elements** | `int m[5][5]` = 25 elements, capped at 20 | Show first 20, document limitation |
| **Compound assignment `m[i][j] += 1`** | Needs to read old value via nested eval | Use `eval(node.target)` to get old value (already works for addresses) |

---

## Part B: Function Pointers

### Design

**Approach: Function name as integer index, resolve at call time**

1. Store a small integer "function index" as the pointer's `data` value
2. `Environment.defineFunction` assigns sequential indices (1, 2, 3...)
3. When calling through a function pointer, look up the index → function name → AST node
4. Display as `"→ funcName"`

**Call resolution strategy:**
- Current: `executeCallStatement` checks `call.callee` against function names and stdlib names
- New: After those checks fail, check if `call.callee` resolves to a function-pointer-typed variable. If so, read its `data` (function index), resolve to function name, then call.
- For `(*fp)(args)`: parser unwraps the dereference to extract the identifier name.

**CTypeSpec extension:**
```typescript
functionParams?: CTypeSpec[];  // if present, this is a function pointer
```

When `functionParams` is set, `TypeRegistry.resolve()` wraps the base type as `pointerType(functionType(returnType, paramTypes))`.

### Steps for Function Pointers

#### Step B1: Type system — add function type
- **What:** Add `{ kind: 'function'; returnType: CType; paramTypes: CType[] }` to CType union. Add `functionType()`, `isFunctionType()` helpers to types-c.ts. `sizeOf` returns `POINTER_SIZE` for function types. Add `functionParams?: CTypeSpec[]` to CTypeSpec. Update `TypeRegistry.resolve()`: when `functionParams` is set, build `pointerType(functionType(returnType, paramTypes))`.
- **Files:** `types.ts`, `types-c.ts`
- **Verification:** `npm test` — existing tests pass

#### Step B2: Environment — function index table
- **What:** In `defineFunction`, assign a sequential index (starting at 1, since 0 = NULL). Add `getFunctionIndex(name: string): number` and `getFunctionByIndex(index: number): { name: string; node: ASTNode } | undefined`.
- **Files:** `environment.ts`
- **Verification:** `npm test`

#### Step B3: Parser — extract function pointer signatures
- **What:** In `parseDeclarator`, when hitting `function_declarator`, check if the inner declarator is a `parenthesized_declarator` containing a `pointer_declarator` (the `(*fp)` pattern). If so, extract the variable name and parameter types. Set `functionParams` on the CTypeSpec.
- **Also:** Handle `(*fp)(args)` call syntax — unwrap dereference in `convertCall`.
- **Files:** `parser.ts`
- **Verification:** `npm test` + parser test

#### Step B4: Interpreter — function pointer assignment and call
- **What:**
  1. **Declaration:** When initializer is an identifier matching a function name, store the function's index as data
  2. **Call resolution:** In `executeCallStatement` and evaluator callback, if callee isn't a function or stdlib, check if it's a function pointer variable → resolve index → call
  3. **Display:** Function pointer value shows `→ funcName`
- **Files:** `interpreter.ts`
- **Verification:** `int (*fp)(int,int) = add; int x = fp(3,4);` → x = 7

#### Step B5: Tests and dropdown program
- **What:** Tests for basic call, NULL pointer error, reassignment, display format. Dropdown program.
- **Files:** `value-correctness.test.ts`, `test-programs.ts`
- **Verification:** `npm test`

### What Can Go Wrong (Function Pointers)

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Tree-sitter `(*fp)(args)` structure unknown** | Parser can't extract callee | Test with actual tree-sitter to see real node structure; fall back to treating `fp(args)` identically |
| **`fp = add` vs `fp = &add`** | Both should work | In evaluator, when identifier matches a function name, return its index |
| **Callee collision: variable named same as stdlib** | `int (*printf)(int) = func; printf(1);` hits stdlib check first | Check user functions before stdlib (already the case); then check function pointers |
| **Function index 0 = NULL vs function index 0** | Off-by-one | Start indices at 1; 0 always means NULL |
| **`defineFunction` called in wrong order** | Index doesn't exist when pointer assigned | Functions are defined in first pass before main() runs — indices available |
| **Recursive function through pointer** | `int (*fp)(int) = fib; fp(5)` | Works — index resolution finds the same function |
| **`CTypeSpec.functionParams` breaks existing parsing** | Parser errors for non-function-pointer declarations | Field is optional, only set when function_declarator pattern detected |

---

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/types.ts` | Add `function` CType kind; add `functionParams` to CTypeSpec | Function pointer types |
| `src/lib/interpreter/types-c.ts` | Add `functionType()`, `isFunctionType()`; `sizeOf(function)`; handle in `resolve()` | Type helpers |
| `src/lib/interpreter/parser.ts` | Extract function pointer signatures; handle `(*fp)(args)` | Parsing |
| `src/lib/interpreter/environment.ts` | Function index table | Function registry |
| `src/lib/interpreter/evaluator.ts` | Minimal: `buildAccessPath` cleanup for nested subscripts | Array fix |
| `src/lib/interpreter/interpreter.ts` | Nested subscript assignment; function pointer call resolution; display | Main logic |
| `src/lib/interpreter/stdlib.ts` | Flatten `buildArrayChildSpecs` for nested array types | 2D array display |
| `src/lib/interpreter/value-correctness.test.ts` | Tests for both features | Verification |
| `src/lib/test-programs.ts` | Dropdown programs for both features | UI testing |

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] `m[1][2] = 6; int x = m[1][2];` → x = 6
- [ ] `int m[2][3] = {{1,2,3},{4,5,6}};` initializes correctly
- [ ] `int (*fp)(int,int) = add; int x = fp(3,4);` → x = 7
- [ ] NULL function pointer produces error
- [ ] Function pointer display shows `→ funcName`
- [ ] Existing 1D array tests still pass
- [ ] Dropdown programs work in Custom tab

## Execution Order

Do multi-dim arrays first (Steps A1-A5) since they're a fix to existing partial work. Then function pointers (Steps B1-B5) as a new feature.

---

## Comprehensive Test Specification

### Test infrastructure reference

| File | Helpers | Use for |
|------|---------|---------|
| `value-correctness.test.ts` | `interpretAndBuild(src)` → `{ program, snapshots }`, `findEntry(entries, name)`, `walkEntries(entries)`, `lastSnapshotWith(snapshots, name)` | Integration: full pipeline value assertions |
| `evaluator.test.ts` | `setup(vars?)` → `{ env, typeReg, evaluator }`, `num()`, `id()`, `binop()`, `assign()` | Unit: evaluator expression logic |
| `parser.test.ts` | `parse(src)` → `{ result, errors }`, `firstChild(src)` | Unit: AST structure |
| `interpreter.test.ts` | `run(src)` → `{ program, errors }`, `expectValid(program)`, `expectNoWarnings(program)` | Statement-level: step/op generation |

**ID format for assertions:** Variable entries = `{scope}-{name}`. Array children = `{parentId}-{flatIndex}`. Child `name` field is `'0'`, `'1'`, etc. Child `displayName` = `'[0]'`, `'[1]'`, etc.

---

### Part A Tests: Multi-Dimensional Array Writes

#### A-T1: 2D array write and read (value-correctness.test.ts)

```typescript
it('2D array write and read via chained subscript', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][3];
    m[0][0] = 1;
    m[0][2] = 3;
    m[1][0] = 4;
    m[1][2] = 6;
    int a = m[0][2];
    int b = m[1][0];
    int c = m[1][2];
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'a')?.value).toBe('3');
  expect(findEntry(last, 'b')?.value).toBe('4');
  expect(findEntry(last, 'c')?.value).toBe('6');
});
```
**Why:** Core feature. Tests write at multiple positions and read-back. Exercises flat index computation: `m[0][2]` = flat 2, `m[1][0]` = flat 3, `m[1][2]` = flat 5.

#### A-T2: 2D array with nested init_list (value-correctness.test.ts)

```typescript
it('2D array initialized with nested init_list', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][3] = {{1, 2, 3}, {4, 5, 6}};
    int a = m[0][1];
    int b = m[1][2];
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'a')?.value).toBe('2');
  expect(findEntry(last, 'b')?.value).toBe('6');
});
```
**Why:** Tests the recursive init_list flattening path in executeDeclaration.

#### A-T3: 2D array children have correct display names (value-correctness.test.ts)

```typescript
it('2D array snapshot shows [i][j] display names', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][2] = {{10, 20}, {30, 40}};
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  const mEntry = findEntry(last, 'm');
  expect(mEntry).toBeDefined();
  expect(mEntry!.children?.length).toBe(4); // 2*2 flattened
  expect(mEntry!.children?.[0]?.name).toBe('[0][0]');
  expect(mEntry!.children?.[1]?.name).toBe('[0][1]');
  expect(mEntry!.children?.[2]?.name).toBe('[1][0]');
  expect(mEntry!.children?.[3]?.name).toBe('[1][1]');
  expect(mEntry!.children?.[0]?.value).toBe('10');
  expect(mEntry!.children?.[3]?.value).toBe('40');
});
```
**Why:** Verifies the flattened buildArrayChildSpecs produces correct display names and values. Tests that validateProgram passes (children have address offsets).

#### A-T4: 2D array write updates snapshot child value (value-correctness.test.ts)

```typescript
it('2D array write updates the correct snapshot child', () => {
  const { program, snapshots } = interpretAndBuild(`int main() {
    int m[2][2] = {{0, 0}, {0, 0}};
    m[1][1] = 99;
    return 0;
  }`);
  // Find the step that writes m[1][1]
  const writeStep = program.steps.find(s => s.description?.includes('m[1][1]'));
  expect(writeStep).toBeDefined();
  // The setValue op should target the correct child (flat index 3)
  const setOps = writeStep!.ops.filter(o => o.op === 'setValue');
  expect(setOps.length).toBeGreaterThan(0);
  // After write, snapshot should show 99
  const last = snapshots[snapshots.length - 1];
  const mEntry = findEntry(last, 'm');
  expect(mEntry!.children?.[3]?.value).toBe('99'); // [1][1] = flat 3
});
```
**Why:** Verifies the emitter receives the correct child ID and the snapshot actually reflects the write. This is the exact failure that was occurring before the fix.

#### A-T5: 2D array compound assignment (value-correctness.test.ts)

```typescript
it('2D array compound assignment m[i][j] += val', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][2] = {{10, 20}, {30, 40}};
    m[0][1] += 5;
    int x = m[0][1];
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('25');
});
```
**Why:** Compound assignment reads the old value then writes the new one. The old-value read must work through the nested subscript path correctly.

#### A-T6: 2D array in loop (value-correctness.test.ts)

```typescript
it('2D array fill in nested loop', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][3];
    for (int i = 0; i < 2; i++) {
      for (int j = 0; j < 3; j++) {
        m[i][j] = i * 10 + j;
      }
    }
    int x = m[1][2];
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('12');
});
```
**Why:** Most realistic usage pattern. Tests that the nested subscript path works correctly across multiple iterations with changing indices.

#### A-T7: 1D array regression guard (value-correctness.test.ts)

```typescript
it('1D array still works after buildArrayChildSpecs change', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int arr[3] = {10, 20, 30};
    arr[1] = 99;
    int x = arr[1];
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('99');
  // Children should have standard [i] display names
  const arrEntry = findEntry(last, 'arr');
  expect(arrEntry!.children?.[0]?.name).toBe('[0]');
});
```
**Why:** Guards against the buildArrayChildSpecs flattening breaking existing 1D arrays.

#### A-T8: Bounds check on outer dimension (value-correctness.test.ts)

```typescript
it('2D array outer index out of bounds produces error', () => {
  const { errors } = run(`int main() {
    int m[2][3];
    m[2][0] = 1;
    return 0;
  }`);
  expect(errors.some(e => e.includes('out of bounds'))).toBe(true);
});
```
**Why:** Verifies that the nested subscript path still checks bounds on the outer array dimension.

#### A-T9: sizeof 2D array (evaluator.test.ts or value-correctness.test.ts)

```typescript
it('sizeof 2D array returns total byte size', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int m[2][3];
    int s = sizeof(m);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 's')?.value).toBe('24'); // 2 * 3 * 4 bytes
});
```
**Why:** Regression: sizeof must return the full array size, not decay to pointer size.

#### A-T10: Parser produces nested array type (parser.test.ts)

```typescript
it('parses int m[2][3] as nested array type', () => {
  const { result } = parse(`int main() { int m[2][3]; }`);
  const fn = result.children[0];
  if (fn.type === 'function_definition') {
    const decl = fn.body.children[0];
    if (decl.type === 'declaration') {
      expect(decl.declType.arrays).toEqual([2, 3]);
    }
  }
});
```
**Why:** Verifies the parser produces the correct CTypeSpec with `arrays: [2, 3]`.

---

### Part B Tests: Function Pointers

#### B-T1: Basic call through function pointer (value-correctness.test.ts)

```typescript
it('function pointer call returns correct value', () => {
  const { snapshots } = interpretAndBuild(`
int add(int a, int b) { return a + b; }
int main() {
    int (*fp)(int, int) = add;
    int x = fp(3, 4);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('7');
});
```
**Why:** The primary acceptance test from the plan. If this passes, the core feature works.

#### B-T2: NULL function pointer produces error (value-correctness.test.ts)

```typescript
it('NULL function pointer call produces error', () => {
  const { errors } = run(`
int add(int a, int b) { return a + b; }
int main() {
    int (*fp)(int, int) = 0;
    int x = fp(3, 4);
    return 0;
  }`);
  expect(errors.some(e =>
    e.includes('null') || e.includes('NULL') || e.includes('function pointer')
  )).toBe(true);
});
```
**Why:** Calling through a null function pointer must not crash the interpreter; it should report an error.

#### B-T3: Function pointer reassignment (value-correctness.test.ts)

```typescript
it('function pointer reassignment calls the new target', () => {
  const { snapshots } = interpretAndBuild(`
int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
int main() {
    int (*fp)(int, int) = add;
    int a = fp(10, 3);
    fp = sub;
    int b = fp(10, 3);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'a')?.value).toBe('13');
  expect(findEntry(last, 'b')?.value).toBe('7');
});
```
**Why:** Verifies that re-assigning `fp` changes which function gets called. Catches bugs where the index isn't updated.

#### B-T4: Function pointer display value (value-correctness.test.ts)

```typescript
it('function pointer displays → funcName', () => {
  const { snapshots } = interpretAndBuild(`
int add(int a, int b) { return a + b; }
int main() {
    int (*fp)(int, int) = add;
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  const fpEntry = findEntry(last, 'fp');
  expect(fpEntry?.value).toBe('→ add');
});
```
**Why:** Verifies the display format. Without this, function pointers would show as opaque integers.

#### B-T5: Uninitialized function pointer shows (uninit) (value-correctness.test.ts)

```typescript
it('uninitialized function pointer shows (uninit)', () => {
  const { snapshots } = interpretAndBuild(`
int add(int a, int b) { return a + b; }
int main() {
    int (*fp)(int, int);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'fp')?.value).toBe('(uninit)');
});
```
**Why:** Verifies integration with the uninitialized variable tracking from Step 5 of the batch plan.

#### B-T6: Function pointer as parameter (value-correctness.test.ts)

```typescript
it('function pointer passed as argument and called inside', () => {
  const { snapshots } = interpretAndBuild(`
int add(int a, int b) { return a + b; }
int apply(int (*f)(int, int), int x, int y) {
    return f(x, y);
}
int main() {
    int result = apply(add, 5, 3);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'result')?.value).toBe('8');
});
```
**Why:** Tests function pointer decay when passed as argument, and call-through-pointer inside a called function. This exercises the function index being copied to a parameter variable.

#### B-T7: Function name without & works (value-correctness.test.ts)

```typescript
it('function name without & decays to function pointer', () => {
  const { snapshots } = interpretAndBuild(`
int square(int x) { return x * x; }
int main() {
    int (*fp)(int) = square;
    int x = fp(5);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('25');
});
```
**Why:** C allows `fp = funcName` without `&`. Verifies the interpreter resolves bare function names to indices.

#### B-T8: Existing function calls still work (interpreter.test.ts)

```typescript
it('direct function calls still work after function pointer changes', () => {
  const { program } = run(`
int add(int a, int b) { return a + b; }
int main() {
    int x = add(3, 4);
    return 0;
  }`);
  expectValid(program);
});
```
**Why:** Regression guard. The call resolution now has an additional check for function pointers; this must not break the normal direct-call path.

#### B-T9: Parser extracts function pointer type (parser.test.ts)

```typescript
it('parses int (*fp)(int, int) as function pointer declaration', () => {
  const { result, errors } = parse(`int main() { int (*fp)(int, int); }`);
  expect(errors.length).toBe(0);
  const fn = result.children[0];
  if (fn.type === 'function_definition') {
    const decl = fn.body.children[0];
    if (decl.type === 'declaration') {
      expect(decl.declType.functionParams).toBeDefined();
      expect(decl.declType.functionParams!.length).toBe(2);
      expect(decl.declType.base).toBe('int'); // return type
    }
  }
});
```
**Why:** Verifies the parser extracts function pointer parameter types into `CTypeSpec.functionParams`. Without this, the type system can't identify function pointers.

#### B-T10: Type resolution for function pointer (evaluator.test.ts or types-c.test.ts)

```typescript
it('resolves function pointer CTypeSpec to pointer(function(int, [int, int]))', () => {
  const typeReg = new TypeRegistry();
  const spec: CTypeSpec = { base: 'int', pointer: 0, functionParams: [
    { base: 'int', pointer: 0 },
    { base: 'int', pointer: 0 },
  ]};
  const resolved = typeReg.resolve(spec);
  // Should be pointer → function type
  expect(resolved.kind).toBe('pointer');
  if (resolved.kind === 'pointer') {
    expect(resolved.pointsTo.kind).toBe('function');
    if (resolved.pointsTo.kind === 'function') {
      expect(resolved.pointsTo.returnType).toEqual(primitiveType('int'));
      expect(resolved.pointsTo.paramTypes.length).toBe(2);
    }
  }
});
```
**Why:** Verifies `TypeRegistry.resolve()` correctly constructs the nested type. Without this, `isFunctionType` checks downstream won't work.

#### B-T11: sizeOf function pointer = POINTER_SIZE (types-c.test.ts)

```typescript
it('sizeof function pointer equals POINTER_SIZE', () => {
  const fpType = pointerType(functionType(primitiveType('int'), [primitiveType('int')]));
  expect(sizeOf(fpType)).toBe(4); // POINTER_SIZE
});
```
**Why:** Function pointers are 4-byte pointers. Verifies `sizeOf` handles the new `function` CType kind.

---

### Test Count Summary

| Part | File | Count | Purpose |
|------|------|-------|---------|
| A (multi-dim) | value-correctness.test.ts | 8 | Write, read, init, display, compound, loop, bounds, sizeof |
| A (multi-dim) | parser.test.ts | 1 | Nested array type parsing |
| A (multi-dim) | — (regression) | 1 | 1D array still works |
| B (fn ptrs) | value-correctness.test.ts | 7 | Call, null, reassign, display, uninit, param, bare name |
| B (fn ptrs) | parser.test.ts | 1 | Function pointer declaration parsing |
| B (fn ptrs) | types-c.test.ts | 1 | sizeof function pointer |
| B (fn ptrs) | evaluator/types test | 1 | Type resolution |
| B (fn ptrs) | interpreter.test.ts | 1 | Regression: direct calls |
| **Total** | | **21** | |

---

## References
- [docs/plans/2026-03-26-feat-interpreter-missing-features-plan.md](2026-03-26-feat-interpreter-missing-features-plan.md) — Parent plan
- [src/lib/interpreter/evaluator.ts:516](../../src/lib/interpreter/evaluator.ts) — buildAccessPath discards indices
- [src/lib/interpreter/interpreter.ts:677](../../src/lib/interpreter/interpreter.ts) — subscript assignment path
- [src/lib/interpreter/stdlib.ts:134](../../src/lib/interpreter/stdlib.ts) — buildArrayChildSpecs
