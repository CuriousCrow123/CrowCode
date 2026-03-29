---
title: WASM Backend Snapshot Bug Fixes
type: fix
status: active
date: 2026-03-29
---

# WASM Backend Snapshot Bug Fixes

## Context

Running the Entity System program (p15.1) through the WASM backend with full step/snapshot dumps revealed 5 categories of bugs. The snapshots don't match what the program actually does — struct fields are invisible, pointer values get corrupted, steps are skipped, and parameter types are wrong.

These bugs affect all programs that use structs, pointers, or arrow operators — not just the entity program.

## Methodology

For each example program, run through the full pipeline and dump:
1. The instrumented source (what the transformer produces)
2. Every step with all ops (addEntry, setValue, removeEntry, setHeapStatus)
3. Every snapshot showing the full entry tree with IDs, names, types, values, addresses, children

Compare against what the C code actually does line by line. This is the approach that found these bugs — the previous integration tests were only checking final values and missing structural problems.

## Bugs Found (from Entity System p15.1)

### Bug 1: Arrow field assignment corrupts pointer display

**Symptom:** `player->id = 1` causes `player` to show value `0x00000001` instead of the heap address `0x000030e8`.

**Root cause (transformer):** For `player->id = 1`, the transformer emits:
```c
__crow_set("player", player, 21);
```
This passes `player` (the pointer value) as the address to read. But the op collector calls `readValue(addr, size, type)` using the pointer type `struct Entity*` — it reads 4 bytes at the `player` stack slot, which now contains... the `player` pointer itself. But `player` is at address `0x00001fe0` and `readValue` reads `mem[0x00001fe0]` as a uint32, which should give `0x000030e8`.

Wait — actually the issue is different. The transformer emits `__crow_set("player", player, ...)` where the second arg is `player` (the pointer VALUE, e.g., `0x000030e8`), not `&player` (the ADDRESS of the pointer variable). So `onSet` reads memory at address `0x000030e8`, which is the struct in heap memory. The first 4 bytes of the Entity struct are `id`, which is `1`. So it reads `1` and displays it as the pointer value.

**Fix needed:** The transformer should emit `__crow_set("player", &player, ...)` for `player->field = ...`, same as for regular assignments. The `&` ensures we read the pointer variable's slot, not what it points to.

**Affected constructs:** Any `ptr->field = value` assignment.

### Bug 2: Nested field assignment uses unregistered name

**Symptom:** `player->pos.x = 3` produces `__crow_set("player->pos", &player->pos, ...)`. The var registry has `"player"` but not `"player->pos"`, so the set is silently dropped. No op is emitted. The step has 0 ops and gets swallowed.

**Root cause (transformer):** The `extractSetTarget` function returns `name: "player->pos"` for field expressions like `player->pos.x`. The op collector can't find this in its registry.

**Fix needed:** For any `ptr->field.subfield = ...` or `var.field = ...`, the transformer should emit `__crow_set` with the root variable name (`"player"` or `"p"`), and pass its address (`&player` or `&p`). The op collector reads the full struct from the root address.

### Bug 3: Structs have no children in snapshots

**Symptom:** `struct Vec2 dir = {1, 0}` shows `val=""` with no children. The user sees an empty struct with no `x` or `y` fields.

**Root cause (op-collector):** `buildChildren()` returns `[]` for struct types because it doesn't know the struct layout. It only handles arrays (where the type string contains `[N]`). For structs, it would need to know field names, types, and offsets — information that exists in the tree-sitter parse but isn't passed to the op collector.

**Fix options:**
1. **Pass struct layout info** from the transformer to the op collector (complex — needs a type registry)
2. **Parse struct definitions** in the op collector from the original source (duplicates work)
3. **Build a type registry** during transformation and pass it alongside the instrumented source

This is the biggest structural issue. The interpreter solves this because it has full type information during execution.

### Bug 4: Steps are skipped for untracked field assignments

**Symptom:** Steps for lines 21-22 (`player->id = 1`, `player->pos.x = 3`) are missing from the output. The step jumps from line 20 to line 23.

**Root cause:** The `__crow_set` for these lines targets unregistered names (Bug 2). The `onSet` method returns early without emitting any op. When `__crow_step` fires next, `currentOps` is empty, so no step is pushed.

**Fix:** Fixing Bug 2 (using root variable name) will fix this automatically — the sets will produce ops and the steps will be emitted.

### Bug 5: Pointer parameter types lose the `*`

**Symptom:** `int sumScores(int *arr, int n)` — parameter `arr` is declared with type `"int"` instead of `"int*"`.

**Root cause (transformer):** `extractParamType` returns only the base type node text (`"int"`). For pointer parameters like `int *arr`, the `*` is part of the declarator, not the type specifier.

**Fix needed:** `extractParamType` needs to check if the parameter's declarator is a `pointer_declarator` and append `*` accordingly.

## Steps

### Step 1: Diagnostic test for every example program

- **What:** Write a test that runs each of the ~40 example programs through the WASM pipeline and dumps: instrumented source, every step with ops, every snapshot with full entry tree. Save output to a structured format for review.
- **Files:** `src/lib/wasm-backend/diagnostic.test.ts`
- **Purpose:** Catalog ALL bugs across ALL programs, not just the entity system. Each program may reveal unique issues (2D arrays, function pointers, string literals, etc.)
- **Approach:** For each program, an opus agent reviews the dump against the C source and marks each discrepancy.

### Step 2: Fix transformer arrow/dot field assignments (Bugs 1, 2, 4)

- **What:** Fix `extractSetTarget` to always return the root variable name and use `&rootVar` as the address expression.
- **Files:** `transformer.ts`, `transformer.test.ts`
- **Before:** `player->id = 1` → `__crow_set("player", player, LINE)`
- **After:** `player->id = 1` → `__crow_set("player", &player, LINE)`
- **Before:** `player->pos.x = 3` → `__crow_set("player->pos", &player->pos, LINE)`
- **After:** `player->pos.x = 3` → `__crow_set("player", &player, LINE)`

### Step 3: Fix pointer parameter types (Bug 5)

- **What:** Update `extractParamType` and the declaration type extraction to include `*` from pointer declarators.
- **Files:** `transformer.ts`
- **Before:** `int *arr` → type `"int"`
- **After:** `int *arr` → type `"int*"`

### Step 4: Add struct children to op collector (Bug 3)

- **What:** Build a type registry from tree-sitter struct definitions. Pass it to the op collector. Use it in `buildChildren` to decompose structs into named fields with correct types, sizes, and offsets.
- **Files:** `transformer.ts` (extract struct layouts), `op-collector.ts` (use them)
- **Design:**
  ```typescript
  type StructLayout = {
      fields: { name: string; type: string; offset: number; size: number }[];
      totalSize: number;
  };
  type TypeRegistry = Map<string, StructLayout>;
  ```
  The transformer walks struct definitions and computes field offsets using C alignment rules (matching xcc's ILP32 model). This registry is passed to the op collector alongside the instrumented source.

### Step 5: Re-run all diagnostics to verify fixes

- **What:** Re-run the diagnostic dump for all example programs. Verify that steps match source lines, struct fields are visible, pointer values aren't corrupted, and parameter types are correct.
- **Verification:** Every program's dump is reviewed against the C source.

## Verification

- [ ] `npm test` passes
- [ ] Entity system (p15.1): player shows correct pointer value throughout
- [ ] Entity system: `player->id`, `player->pos.x`, `player->pos.y` each produce a visible step
- [ ] Struct programs (p2.1, p2.2): struct children show field names and values
- [ ] Function with pointer param: `arr` shows type `"int*"` not `"int"`
- [ ] No steps are silently dropped (every C statement produces a step)
- [ ] All 25 existing integration tests still pass

## References

- [Entity system diagnostic output](#bugs-found-from-entity-system-p151) (above)
- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
- [Op collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Integration tests](../../src/lib/wasm-backend/integration.test.ts)
