---
title: Line Mode Sub-step Description Aggregation
type: feat
status: active
date: 2026-03-26
---

# Line Mode Sub-step Description Aggregation

## Context

In sub-step mode, each step shows its own description — e.g., `for: init i = 0`, `for: check i(0) < 4 → true`, `sum += arr[0] → sum = 10`. In line mode, the user only sees the anchor step's description, and all sub-step descriptions are lost.

This means line mode hides the narrative of *how* a line executed. For a for-loop, the user sees `sum += arr[0] → sum = 10` but misses the condition check and increment that preceded it. The memory *state* is correct (sub-step ops are always applied), but the *story* is invisible.

## Design

**Approach:** Add a derived value that collects descriptions from all steps between the previous visible index and the current one (inclusive). Display them as a compact list in the description area.

**Why not just show the anchor description?** The anchor description covers only what happened on the final sub-step. For a for-loop iteration, that's just the body statement — the init, check, and increment descriptions are lost.

**Why not concatenate into one string?** Multiple descriptions are structurally distinct (some have evaluations, some don't). A list preserves the individual description/evaluation pairs.

**Alternatives considered:**
- **Tooltip/expandable** — more complex UI, deferred to later iteration
- **Only show count** ("3 sub-steps") — loses the actual narrative
- **Change the data model** — adding aggregated descriptions to ProgramStep would complicate the interpreter and hand-authored programs; keeping this in the UI layer is simpler

## Files

### Modify

| File | What changes | Why |
|---|---|---|
| `src/routes/+page.svelte` | Add `stepDescriptions` derived that collects descriptions from skipped sub-steps + anchor | This is where stepping state lives for the Custom tab |
| `src/routes/+page.svelte` | Update template to render description list instead of single description | Display the collected descriptions |
| `src/lib/components/ProgramStepper.svelte` | Same `stepDescriptions` derived + template update | Same feature for the pre-authored programs tab |

### Create

None. This is a pure UI change — no new files, no engine/interpreter changes.

## Steps

### Step 1: Add `stepDescriptions` derived to +page.svelte
- **What:** Compute a list of `{ description?: string; evaluation?: string }` from all steps between the previous visible index (exclusive) and the current visible index (inclusive). In sub-step mode, this is just the single current step (no change in behavior). In line mode, it collects from all intermediate sub-steps plus the anchor.
- **Files:** `src/routes/+page.svelte`
- **Depends on:** nothing
- **Verification:** `npm run check` — type-check passes

The derived logic:
```ts
const stepDescriptions = $derived.by(() => {
    if (mode.state !== 'viewing') return [];
    // In sub-step mode, just show current step's description
    if (subStepMode) {
        const step = steps[internalIndex];
        if (!step?.description && !step?.evaluation) return [];
        return [{ description: step.description, evaluation: step.evaluation }];
    }
    // In line mode, collect from all steps since previous visible position
    const pos = visiblePosition;
    const startIdx = pos > 0 ? visibleIndices[pos - 1] + 1 : 0;
    const endIdx = internalIndex;
    const descs: Array<{ description?: string; evaluation?: string }> = [];
    for (let i = startIdx; i <= endIdx; i++) {
        const step = steps[i];
        if (step?.description || step?.evaluation) {
            descs.push({ description: step.description, evaluation: step.evaluation });
        }
    }
    return descs;
});
```

### Step 2: Update +page.svelte template
- **What:** Replace the single description/evaluation display with a loop over `stepDescriptions`. Keep the same styling — `text-zinc-400` for description, `text-emerald-500` for evaluation. Each entry renders on its own line.
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Step 1
- **Verification:** `npm run check`, manual visual check

Replace the current block (lines 314-323):
```svelte
{#if currentStep?.description || currentStep?.evaluation}
    <div class="mt-2 text-sm font-mono flex items-center gap-2">
        ...
    </div>
{/if}
```

With:
```svelte
{#if stepDescriptions.length > 0}
    <div class="mt-2 text-sm font-mono space-y-0.5">
        {#each stepDescriptions as desc}
            <div class="flex items-center gap-2">
                {#if desc.description}
                    <span class="text-zinc-400">{desc.description}</span>
                {/if}
                {#if desc.evaluation}
                    <span class="text-emerald-500">{desc.evaluation}</span>
                {/if}
            </div>
        {/each}
    </div>
{/if}
```

### Step 3: Apply same changes to ProgramStepper.svelte
- **What:** Add the same `stepDescriptions` derived and update the template. Note: ProgramStepper currently passes `description` and `evaluation` as props to StepControls, but StepControls doesn't accept those props — so ProgramStepper's descriptions were already broken. This step fixes that by rendering descriptions directly in ProgramStepper (same pattern as +page.svelte).
- **Files:** `src/lib/components/ProgramStepper.svelte`
- **Depends on:** Step 2 (pattern established)
- **Verification:** `npm run check`, manual visual check with pre-authored programs

### Step 4: Verify
- **What:** Run full test suite and build. Manual check with the loops program — in line mode, stepping through a for-loop iteration should show the sub-step descriptions (init, check, increment) alongside the body description.
- **Files:** none
- **Depends on:** Steps 1-3
- **Verification:** `npm test && npm run check && npm run build`

## Edge Cases

| Case | Expected behavior | How handled |
|---|---|---|
| No sub-steps between visible positions | `stepDescriptions` has 0 or 1 entries (just the anchor) | The loop starts at `prevVisible + 1`; if that equals `currentIndex`, only the anchor is included |
| First visible step (no previous) | Collect from index 0 to current | `startIdx = pos > 0 ? visibleIndices[pos - 1] + 1 : 0` |
| Steps with no description | Skipped — only entries with description or evaluation are included | Filter in the collection loop |
| Sub-step mode ON | Behaves exactly as today — single description | Short-circuit returns `[currentStep]` |
| Many sub-steps (long list) | Could get visually long | Acceptable for v1; could add max-height + scroll later |

## Verification

- [ ] `npm test` passes
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] Line mode on loops program shows sub-step descriptions for for-loop iterations
- [ ] Sub-step mode behavior unchanged
- [ ] First step shows its description correctly
- [ ] Steps with no descriptions show nothing (no empty rows)

## References

- [docs/architecture.md](../architecture.md) — navigation and sub-step design
- [src/lib/programs/loops.ts](../../src/lib/programs/loops.ts) — reference program with sub-step descriptions
