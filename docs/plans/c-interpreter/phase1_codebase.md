# Phase 1: Codebase Exploration

## Architecture & Data Flow

Program (source + steps with ops) → buildSnapshots() → MemoryEntry[][] → ProgramStepper → CodeEditor + MemoryView

- `+page.svelte` imports programs, passes selected Program to ProgramStepper
- ProgramStepper calls `buildSnapshots(program)` via `$derived()` — rebuilds reactively
- Snapshots are MemoryEntry[][] (one per step), accessed by index
- diffSnapshots() compares consecutive snapshots for UI highlighting
- Navigation filters steps by mode (line vs sub-step)

## Key Contract

The interpreter must produce a valid `Program` object:
```typescript
{ name: string, source: string, steps: ProgramStep[] }
```

Where each ProgramStep has `location`, `ops: SnapshotOp[]`, optional `description`, `evaluation`, `subStep`.

This feeds directly into `buildSnapshots()` → existing UI pipeline. No component changes needed.

**Alternative**: The interpreter could produce `MemoryEntry[][]` directly, bypassing ops entirely. But this would require a new code path in ProgramStepper. Using ops preserves compatibility with existing validation, diffing, and navigation.

## Conventions

- TypeScript strict mode, tabs, single quotes, semicolons
- `$lib/` path alias for all internal imports
- Barrel exports via index.ts files
- Error tuple pattern: `{ result: T, errors: string[] }`
- structuredClone() for immutability
- Vitest 4.1.1, tests collocated as *.test.ts
- JSDoc one-liners on exported functions

## Validation Rules (must satisfy)

1. At least one step
2. No duplicate IDs within any snapshot
3. Non-scope entries must have non-empty address
4. SubStep anchor rule: each line needs at least one non-subStep step
5. Line numbers within source range
6. Column ranges within line length

## Test Infrastructure

- testProgram() runs 13+ checks on any Program
- Integration tests verify real programs end-to-end
- Edge case tests cover deep nesting, heap lifecycle, op ordering
- Console.warn spy pattern for error detection
- Inline helper factories for test data
