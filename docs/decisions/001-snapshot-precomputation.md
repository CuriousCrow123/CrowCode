# ADR-001: Pre-compute all snapshots upfront

**Status:** Accepted
**Date:** 2026-03-25
**Commit:** `45b6f249`

## Context

CrowCode lets users step forward and backward through program execution. Each step shows a complete memory snapshot — the full state of stack frames, variables, and heap allocations at that point.

The core question: when should these snapshots be computed?

Backward stepping is the critical constraint. If snapshots are computed lazily (only when needed), stepping backward requires either caching all previously visited snapshots or replaying operations from the beginning. Both add complexity, and replay makes backward stepping O(N) in the worst case.

Programs are small (typically 25-50 steps), so the total data volume is negligible.

## Decision

Pre-compute all snapshots upfront when a program loads. `buildSnapshots()` iterates through every step, applying ops sequentially, and produces a `MemoryEntry[][]` — one complete snapshot per step. Each snapshot is a deep clone via `structuredClone()`, guaranteeing immutability.

Access to any step is a simple array index: `snapshots[i]`.

## Considered Alternatives

**Lazy computation with LRU cache.** Compute snapshots on demand and cache recent ones. Pros: lower upfront cost. Cons: still O(N) worst case for backward stepping, added complexity for cache eviction, no immutability guarantee without cloning anyway.

**Checkpoint-based replay.** Store full snapshots every N steps, replay from the nearest checkpoint. Pros: bounded memory growth. Cons: backward stepping takes up to N op replays, more complex implementation. This is noted as the migration path if programs grow beyond ~1000 steps.

**Diff-based storage.** Store only deltas between steps. Pros: minimal memory. Cons: random access requires replaying diffs from a known state, losing the O(1) property that makes the UI responsive.

## Consequences

- Stepping forward or backward is O(1) — just index into the array
- Memory grows linearly with step count, but this is negligible at current scale (~50 steps)
- Snapshot immutability is guaranteed by `structuredClone()` — mutating one snapshot cannot corrupt another
- The entire downstream system (components, diffing, navigation) only needs to handle `MemoryEntry[]`, never ops
- If programs grow to 1000+ steps, checkpoint-based replay is a ~20 line change to `buildSnapshots()` with zero component changes, since everything downstream sees `MemoryEntry[]` via props
