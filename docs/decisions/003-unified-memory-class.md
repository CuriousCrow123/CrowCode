# ADR-003: Unified Memory class replaces Environment + Emitter

**Status:** Accepted
**Date:** 2026-03-26
**Commits:** `cb4c3964`, `60cb707e`

## Context

The C interpreter needs to do two things on every mutation (variable declaration, assignment, malloc, free, etc.):
1. Update the runtime state (scope chain, heap, symbol tables)
2. Record the corresponding `SnapshotOp` for visualization

The original architecture split these responsibilities across three objects:
- `Environment` — managed runtime state (scope chain, heap allocations, symbol tables)
- `DefaultEmitter` — translated interpreter events into `SnapshotOp` sequences
- `memoryValues` — a separate mutable map tracking display values by address

Every mutation in the interpreter required calling all three in sync. This three-way coordination caused bugs: ops were emitted for state that hadn't been updated yet, or state was updated without recording the op.

## Decision

Merge all three into a single `Memory` class where every mutation method (`pushScope`, `declareVariable`, `malloc`, `free`, etc.) atomically updates runtime state AND records the corresponding `SnapshotOp`.

The interpreter calls `memory.declareVariable(...)` once. The Memory class handles both the runtime state change and the op recording internally.

## Considered Alternatives

**Keep separation with stricter interfaces.** Enforce the calling order (update state → record op) via a protocol or wrapper. Pros: preserves separation of concerns. Cons: still requires three-way coordination discipline from every callsite in interpreter.ts — the same class of bug would recur.

**Event-driven architecture.** Environment emits state-change events, Emitter subscribes. Pros: loose coupling. Cons: adds indirection without solving the atomicity problem — events can still arrive out of order or be missed.

## Consequences

- Eliminated an entire class of synchronization bugs between runtime state and op recording
- Reduced interpreter.ts complexity — one object to interact with instead of three
- `Memory` class is the single source of truth for both "what is the current runtime state" and "what ops describe the changes"
- Migration was safe: snapshot regression tests (`snapshot-regression.test.ts`) captured output from 7 representative programs *before* the change, and 696 tests passed after migration
- Legacy files `environment.ts` and `emitter.ts` were deleted after migration, removing 1,566 lines
