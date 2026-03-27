# ADR-002: Four primitive op types for all memory changes

**Status:** Accepted
**Date:** 2026-03-25
**Commit:** `fc56113f`

## Context

The engine needs a way to describe memory state changes between steps. Each `ProgramStep` carries a list of `SnapshotOp` values that transform the previous snapshot into the current one.

The design question: how many op types should exist? A minimal set is easier to validate and implement but may lack expressiveness. A domain-specific set is more readable but harder to keep consistent.

Memory changes in CrowCode fall into four categories:
1. Adding something to the tree (scope, variable, struct field, heap block)
2. Removing something from the tree (and all its children)
3. Changing an entry's display value
4. Changing a heap block's lifecycle status (allocated → freed → leaked)

## Decision

Four primitive op types cover all memory changes:

| Op | Purpose |
|---|---|
| `addEntry` | Insert a new entry (scope, variable, struct field, heap block) |
| `removeEntry` | Remove an entry and all its children |
| `setValue` | Change an entry's display value |
| `setHeapStatus` | Change a heap block's lifecycle status |

All ops target entries by their stable `id` field.

Builder functions (`addScope`, `addVar`, `set`, `free`, `remove`, etc.) provide the ergonomic layer for program authors without expanding the op set.

## Considered Alternatives

**Domain-specific ops.** Separate op types for `addScope`, `addVariable`, `addHeapBlock`, `addField`, etc. Pros: more self-documenting, easier for program authors to understand. Cons: the `applyOps` implementation would need a case for each, `validateProgram` would need exhaustive rules per op type, and new visualization features would require new op types.

**Single "patch" op with JSON patch semantics.** One op type carrying path + operation + value. Pros: maximally minimal. Cons: loses semantic meaning — the engine couldn't distinguish "value changed" from "entry added" for diffing and validation purposes.

## Consequences

- `applyOps` is a 4-case switch statement — easy to reason about and test exhaustively
- `validateProgram` can check a small, closed set of invariants
- New features (e.g., highlighting freed blocks, marking leaked memory) only need new builder functions, not new op types
- `setHeapStatus` being separate from `setValue` is important: heap lifecycle (`allocated | freed | leaked`) is structurally distinct from display values and requires different validation (the entry must have a `heap` field)
- The builder layer keeps program authoring ergonomic despite the minimal primitive set
