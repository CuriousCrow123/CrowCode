---
title: Read Pulse Visual Feedback
topic: fix-read-pulse-visual
date: 2026-03-09
status: completed
---

# Read Pulse Visual Feedback

## What We're Building

Fix the "read" visual feedback in CMemoryView's sub-step system. When stepping through `int y = x + 32;` and reaching the "Read x" sub-step, the variable's memory rows should show a clear, sustained visual highlight indicating the CPU is reading those bytes.

## Problem

The current implementation uses a timer-based CSS animation (`animateReadPulse`) that:

1. **Fires on the wrong step** — timing/reactivity bugs cause the outline to appear during a different sub-step than intended
2. **Sometimes doesn't appear at all** — likely a Svelte 5 reactivity issue with `$state(new Set())` updates not reliably triggering DOM updates inside `{#each}` blocks
3. **Is too brief and subtle** — a 400ms fading outline is hard to notice, especially when the user's attention is split between the code panel and memory view

Root cause: the pulse is driven by an imperative timer (`setTimeout` + `highlightedVars.add/delete`) rather than being tied to the current step's state. This creates race conditions and reactivity gaps.

## Why This Approach

**Sustained highlight driven by step state** instead of a timed animation.

The key insight: the read highlight should persist for as long as the "Read x" step is the current step. The user controls the pace — they read the status label, observe the highlighted rows, and click Next when ready. This eliminates:

- Timer-based race conditions
- CSS animation restart issues
- Svelte reactivity gaps (the highlight is derived from step state, not a mutable Set)
- The "too brief" problem entirely

## Key Decisions

1. **Sustained highlight, not pulse**: The read visual stays on for the entire duration of the read step, turning off when the user advances to the next step
2. **Outline + tint style**: Solid indigo outline around the variable's rows plus a subtle indigo background tint (distinct from red uninitialized tint and green assignment glow)
3. **No artificial delay**: The read step completes immediately (no `await` timer). The highlight is the visual feedback — the user proceeds at their own pace
4. **Clear-on-step-change pattern**: Each new step clears previous read highlights before executing its action. This is simpler than deriving from step kind

## Scope

- CMemoryView: replace `animateReadPulse` timer with sustained `highlightVar`/`clearHighlights` methods
- CMemoryView: replace CSS `@keyframes read-pulse` animation with static `.read-highlight` styles
- CMemoryViewDemo: call `clearHighlights()` at the start of each `executeSubStep`, keeping highlight visible until next step starts
- CodePanel: no changes needed (sub-expression highlighting already works correctly)
