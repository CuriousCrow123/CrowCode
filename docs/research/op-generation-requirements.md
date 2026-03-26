# Op Generation Requirements

> Requirements for generating `SnapshotOp[]` and `ProgramStep[]` from arbitrary C source code. Derived from the existing engine, programs, architecture doc, and sub-step analysis.

## Primitive Ops

The engine has 4 primitive op types. All memory changes are expressed through these:

| Op | Fields | Purpose |
|---|---|---|
| `addEntry` | `parentId: string \| null`, `entry: MemoryEntry` | Insert a scope, variable, struct field, array element, or heap block |
| `removeEntry` | `id: string` | Remove an entry and all its children |
| `setValue` | `id: string`, `value: string` | Change an entry's display value |
| `setHeapStatus` | `id: string`, `status: 'allocated' \| 'freed' \| 'leaked'` | Change a heap block's lifecycle status |

8 builder functions provide semantic aliases: `addScope`, `addVar`, `addChild`, `alloc`, `set`, `free`, `leak`, `remove`.

## Entry Types

Every `MemoryEntry` has: `id`, `name`, `type`, `value`, `address`, optional `children`, optional `kind` (`'scope'` | `'heap'`), optional `scope` (`ScopeInfo`), optional `heap` (`HeapInfo`).

### Scope Entries (`kind: 'scope'`)

Represent stack frames, block scopes, and loop scopes. Created via `scope(id, name, opts?)`.

- `ScopeInfo`: `{ caller?, returnAddr?, file?, line? }`
- `name` is the display label: `'main()'`, `'distance(a, b)'`, `'for'`, `'{ }'`
- `address` is empty string (scopes don't have addresses)

### Heap Container (`kind: 'heap'`)

A single root entry that parents all heap blocks. Created once via `heapContainer()` on program start. Default id: `'heap'`.

### Variable Entries

Scalars, struct fields, array elements, pointers. Created via `variable(id, name, type, value, address, children?)`.

- Struct fields use `.fieldName` as display name
- Array elements use `[index]` as display name
- Pointers store a hex address string or `'NULL'` as value
- Nested structs/arrays are expressed as `children`

### Heap Block Entries

Allocated memory regions. Created via `heapBlock(id, type, address, heap, children?)`.

- `HeapInfo`: `{ size, status, allocator?, allocSite?: { file, line }, refCount? }`
- `status`: `'allocated'` → `'freed'` or `'leaked'`
- Children represent typed fields within the allocation (struct members, array elements)

## Step Metadata

Every `ProgramStep` requires:

```typescript
{
    location: { line: number, colStart?: number, colEnd?: number },
    description?: string,    // Human-readable: "int dx = 0 - 10 = -10"
    evaluation?: string,     // Expression result: "dx*dx + dy*dy → 500"
    ops: SnapshotOp[],
    subStep?: boolean,       // true = hidden in line mode
}
```

- `location.line` is 1-based within the source string
- `colStart`/`colEnd` highlight a character range within the line (sub-step mode only; stripped in line mode)
- Steps with empty `ops` are valid (advance line highlight only, e.g., `printf`, `return 0`)
- `evaluation` is for showing expression results without memory side effects

## ID and Address Conventions

### IDs
- Hierarchical, dash-separated: `main`, `main-count`, `heap-player-pos-x`, `for1-i`
- Must be unique within any single snapshot (enforced by `validateProgram`)
- Stable across steps (same entry keeps the same id)

### Addresses
- Stack addresses: `0x7ffc00XX` range, sequential
- Heap addresses: `0x55a000XXXX` range
- Scopes and heap container use empty string `''` for address
- Struct fields share the parent's base address (first field) or offset from it

## Scope Lifecycle

### Function Entry

```
addScope(null, scope('main', 'main()', { caller, returnAddr, file, line }))
addVar('main', variable(...))   // for each local
addScope(null, heapContainer()) // first step only
```

- Function scopes are root-level (`parentId: null`)
- Parameters are added as `addVar` ops in the same step as `addScope`
- Struct params are expanded with children (pass-by-value copies the entire struct)

### Block Scope Entry

```
addScope(parentScopeId, scope('main-block', '{ }', { file, line }))
```

- Block scopes are nested under their parent scope
- Variables declared inside are parented to the block scope id

### Loop Scope Entry

```
addScope(parentScopeId, scope('for1', 'for', { file, line }))
addVar('for1', variable('for1-i', 'i', 'int', '0', addr))
```

- Loop variable lives inside the loop scope
- Scope is removed on loop exit, taking the loop variable with it

### Scope Exit

```
remove(scopeId)
```

- Removes the scope and all its children (loop vars, block-scoped vars)
- For function return: also pair with `addVar` or `set` in the caller for the return value

## Variable Lifecycle

| C construct | Op pattern |
|---|---|
| `int x = 5;` | `addVar(scopeId, variable(id, 'x', 'int', '5', addr))` |
| `struct Point p = {0, 0};` | `addVar(scopeId, variable(id, 'p', 'struct Point', '', addr, [field, field]))` |
| `int arr[4] = {10,20,30,40};` | `addVar(scopeId, variable(id, 'arr', 'int[4]', '', addr, [elem, elem, elem, elem]))` |
| `int *p = &x;` | `addVar(scopeId, variable(id, 'p', 'int*', '0x7ffc0060', addr))` |
| `x = 10;` | `set(varId, '10')` |
| `p->field = val;` | `set(fieldId, 'val')` — targets the heap entry directly |
| `arr[i] = val;` | `set(elemId, 'val')` — targets the array element entry directly |

- Compound initialization (structs, arrays) is a single step with children, not sub-steps
- All values are strings (display format): `'42'`, `'"hello"'`, `'0x55a0001000'`, `'NULL'`, `'(dangling)'`

## Heap Lifecycle

| C construct | Op pattern |
|---|---|
| `malloc(size)` | `alloc('heap', heapBlock(id, type, addr, heapInfo, children?))` + `addVar` or `set` for the pointer |
| `calloc(n, size)` | Same as malloc, children initialized to `'0'` |
| `p->field = val` | `set(heapFieldId, 'val')` |
| `free(ptr)` | `free(heapBlockId)` + `set(ptrVarId, '(dangling)')` |
| Memory leak | `leak(heapBlockId)` (supported, not yet used in existing programs) |
| Block exit with freed block | `remove(heapBlockId)` to clean up visually |

- Heap blocks are always parented to the heap container (`'heap'`)
- `alloc` creates the block with `status: 'allocated'`
- `free` changes status to `'freed'` but does NOT remove the entry (it remains visible as freed)
- `remove` is separate — used when the block should disappear from the visualization

## Function Calls

### Current implementation (basics.ts — no sub-steps)

Two anchor steps:
1. `addScope` + `addVar` for each param (push frame)
2. `remove(scopeId)` + `addVar` for return value (pop frame + assign)

### Full sub-step pattern (documented, not yet implemented)

All sub-steps share the same `location.line` (the call site line):

| Step | subStep | Ops | colStart/colEnd |
|---|---|---|---|
| Evaluate arg 1 | `true` | none (or `set` if side effects) | Highlight arg expression |
| Evaluate arg 2 | `true` | none (or `set` if side effects) | Highlight arg expression |
| Push frame | `true` | `addScope` + `addVar` for params | Full call expression |
| *(function body steps on different lines)* | — | — | — |
| Return expression | `true` | none | `return expr` |
| Pop frame + assign | `false` (anchor) | `remove(scopeId)` + `addVar`/`set` | Full line |

## For-Loop Sub-Steps

Fully implemented pattern in loops.ts. Each iteration produces 3 steps:

| Step | subStep | Ops | colStart/colEnd |
|---|---|---|---|
| **Init** `int i = 0` | `false` (anchor) | `addScope` + `addVar` | Full line |
| **Check** `i < 4` → true | `true` | none | Condition chars |
| **Body** `sum += arr[i]` | `false` (anchor) | `set(...)` | Full line (different line number) |
| **Increment** `i++` | `true` | `set(loopVarId, ...)` | Increment chars |
| *(repeat check → body → increment)* | | | |
| **Final check** `i < 4` → false | `false` (anchor) | `remove(loopScopeId)` | Full line |

- Init is only once, as the anchor for "entering the loop"
- Final failing check is the anchor for "exiting the loop"
- `evaluation` string on check steps: `'0 < 4 → true'`, `'4 < 4 → false'`

## Chained Expressions (not yet implemented)

`a = b = c = 0` — right-to-left evaluation:

| Step | subStep | Ops | colStart/colEnd |
|---|---|---|---|
| `c = 0` | `true` | `set('c', '0')` | `c = 0` |
| `b = c` | `true` | `set('b', '0')` | `b = c` |
| `a = b` | `false` (anchor) | `set('a', '0')` | Full line |

All steps share the same `location.line`.

## Short-Circuit Evaluation (not yet implemented)

### `ptr && ptr->valid` when `ptr` is NULL:

| Step | subStep | Ops | Evaluation | colStart/colEnd |
|---|---|---|---|---|
| Evaluate LHS | `true` | none | `ptr → NULL` | `ptr` |
| Short-circuit | `false` (anchor) | none | `NULL && ... → false (short-circuit)` | Full expression |

### `ptr && ptr->valid` when `ptr` is non-NULL:

| Step | subStep | Ops | Evaluation | colStart/colEnd |
|---|---|---|---|---|
| Evaluate LHS | `true` | none | `ptr → 0x55a0001000` | `ptr` |
| Evaluate RHS | `true` | none | `ptr->valid → 1` | `ptr->valid` |
| Result | `false` (anchor) | none (or `set` if assigned) | `0x55a0001000 && 1 → true` | Full expression |

## While-Loop Sub-Steps (not yet implemented, derived from for-loop pattern)

| Step | subStep | Ops |
|---|---|---|
| **Check** `cond` → true | `true` | none |
| **Body** | `false` (anchor) | mutations |
| *(repeat)* | | |
| **Final check** `cond` → false | `false` (anchor) | none |

No init or increment steps. Loop scope is optional (only if the body declares variables that should be scoped to the loop).

## Do-While Sub-Steps (not yet implemented)

| Step | subStep | Ops |
|---|---|---|
| **Body** (first iteration) | `false` (anchor) | mutations |
| **Check** `cond` → true | `true` | none |
| **Body** | `false` (anchor) | mutations |
| *(repeat)* | | |
| **Check** `cond` → false | `false` (anchor) | none |

Body executes before the first check.

## If/Else (not yet implemented as sub-steps)

| Step | subStep | Ops |
|---|---|---|
| Evaluate condition | `true` | none |
| Enter taken branch | `false` (anchor) | `addScope` if block has declarations |
| *(body steps)* | | |
| Exit branch | `false` (anchor) | `remove(scopeId)` if scoped |

The skipped branch produces no steps.

## Validation Rules

These are enforced by `validateProgram()` and must be satisfied by any generator:

1. **No duplicate IDs** within any single snapshot
2. **All non-scope entries must have an address** (non-empty string)
3. **Anchor rule**: if any steps exist for a given line, at least one must NOT be `subStep: true` — otherwise that line is invisible in line mode
4. **Line numbers** must be within the source string's line count
5. **Column ranges** (`colStart`/`colEnd`) must be within the line's character length

## Interpreter State Requirements

A generator producing ops from C source needs to maintain:

| State | Purpose |
|---|---|
| **Scope stack** | Track current `parentId` for `addVar`/`addScope` |
| **Symbol table** | Map variable names → entry IDs for `set()` targeting |
| **Address allocator** | Assign realistic stack addresses (growing down) and heap addresses (growing up) |
| **ID generator** | Produce unique hierarchical IDs (e.g., `main-count`, `heap-player-pos-x`) |
| **Type system** | Know struct layouts, array sizes, pointer targets for `children` expansion and `sizeof` |
| **Expression evaluator** | Compute values for arithmetic, comparisons, pointer derefs |
| **Sub-step controller** | Decide when to emit sub-steps vs. anchor steps based on construct type |
| **Source mapper** | Track `line`, `colStart`, `colEnd` for every emitted step |
| **Description generator** | Produce human-readable `description` and `evaluation` strings |
