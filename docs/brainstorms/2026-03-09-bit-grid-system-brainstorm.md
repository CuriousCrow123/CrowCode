# Brainstorm: BitGrid Widget System

**Date:** 2026-03-09
**Status:** Complete

## What We're Building

A composable bit-grid widget system that visualizes how computers represent and manipulate data as binary. The system consists of:

1. **BitGridCore** — A shared base component that renders a grid of tiny bits with glow-pulse flip animations. Prop-driven pure renderer; accepts a reactive `bits` array from the variant and detects changes to trigger glow.

2. **BitGridRandom** — Large grid of bits that continuously flip randomly with a matrix/CRT-style glow effect. Simulates how bits in RAM are constantly changing. No CPU visualization.

3. **BitGridBytes** — Same grid, but bits flip 8-at-a-time to foreshadow bytes and byte-addressable RAM. Includes a side-by-side CPU block with animated bus wires (traveling dot/pulse signals). Transforms from random mode via prose trigger.

4. **BitGridData** — Grid where specific byte groups represent integers (x, y) that drive a sine-wave ball animation. Includes CPU block, bus wires, sidebar decode panel showing `x: 01111111 = 127`, and the animation canvas. Demonstrates that bits encode meaningful values.

## Why This Approach

**Architecture: Separate widgets, shared base (thin base, fat variants)**

- Aligns with existing widget patterns — each widget is self-contained with its own `paramDefs`
- The base component (BitGridCore) is a pure renderer with no behavior logic
- Each variant owns its timing, layout, overlays, and imperative API
- Avoids a god component that tries to handle all modes
- Each variant gets its own sandbox page for isolated development

**Why not one widget with modes?** Modes add conditional complexity and make each variant harder to tune independently. Separate widgets mean separate `paramDefs`, separate debug panels, and cleaner code.

**Why not base with overlays?** Risks coupling the base to layout concerns (CPU position, wire routing, decode panel). The thin base stays focused on one job: rendering bits with animations.

## Key Decisions

### Grid rendering
- **Flexible dimensions**: `cols` and `rows` are params, each variant sets its own defaults
- **Bit cells**: Tiny monospace `0`/`1` characters in a CSS grid
- **Color scheme**: Dark background, dim text for idle bits, bright glow on flip

### Flip animation: Glow pulse
- Bits briefly glow (bright cyan/green) when their value changes
- Implemented via CSS animation class toggled on flip — performant at scale
- Glow fades over ~200-300ms (tunable via params)
- Respects `prefers-reduced-motion` (skip glow, instant value change)

### CPU + wires (byte and data variants)
- **Layout**: Side-by-side — CPU block on left, grid (labeled "RAM") on right
- **Togglable**: CPU visibility controlled via imperative API (`showCpu()` / `hideCpu()`) or prop
- **Bus wires**: SVG paths connecting CPU to grid, with traveling dot/pulse animation
- **Signal direction**: Dots travel CPU→RAM for writes, RAM→CPU for reads
- Wire animation triggered when bits actually change (not continuously)

### Byte-addressable variant
- Flips happen in groups of 8 consecutive bits
- Visual: byte groups have subtle separators (slightly wider gap every 8 columns or alternating row tinting)
- CPU sends a "write" signal (dot travels along wire), then the target byte glows and flips

### Data-bound variant (sine wave ball)
- **Bit mapping**: Specific byte groups in the grid represent x and y integers
- **Decode panel**: Sidebar showing real-time `x: [binary] = [decimal]` and `y: [binary] = [decimal]`
- **Bits per value**: Parameterized — default 8 bits (0-255), switchable to 16 bits (0-65535) via debug panel
- **Highlighted bytes**: Subtle highlight on the bits that map to x and y (distinct from flip glow)
- **Animation**: Canvas element rendering a ball on a sine wave
  - Infinite loop with left/right edges connected (seamless wrapping)
  - Ball rolls along the sine curve as a track (marble-on-wavy-surface physics)
  - Gravity affects speed on slopes — accelerates downhill, decelerates uphill, no friction
  - x = horizontal position along curve, y = sine(x) as track height
  - Ball position updates drive bit changes in the grid
  - CPU wire animation throttled — animates on significant value changes, not every frame (e.g., when byte value changes by more than a threshold, or at a capped rate like ~10hz)
- **Layout**: Animation renders below the grid by default (natural "these bits produce this motion" vertical flow)

### Shared base (BitGridCore) API
- **Data model**: Prop-driven pure renderer. Variant owns a `$state` bits array and passes it down. BitGridCore has no internal bit state.
- **Props**: `bits: number[]` (reactive), `cols: number`, `cellSize`, `cellGap`, `fontSize`, `glowDuration` (all numbers), `glowColor?: string`, `highlights?: Record<string, { indices: number[]; color: string }>` (named highlight groups with per-group color). No `rows` prop — grid auto-wraps based on `bits.length / cols`.
- **Glow detection**: Base tracks previous bit values internally (plain `Uint8Array`, not `$state`) to detect which bits just changed, triggering glow animation on the diff
- **No exported methods**: All mutation happens in the variant. Base just renders.
- **Not a widget**: Has no `paramDefs` or `WidgetDebugPanel`. All numeric styling flows as props from the variant's own params.

### Widget CSS prefixes
| Component | Prefix |
|-----------|--------|
| BitGridCore | `--bg-` |
| BitGridRandom | `--bgr-` |
| BitGridBytes | `--bgb-` |
| BitGridData | `--bgd-` |

## Component Hierarchy

```
BitGridRandom (variant widget)
└── BitGridCore (shared base)

BitGridBytes (variant widget)
├── CpuBlock (inline, not a separate component — just markup in the variant)
├── WireSvg (inline SVG overlay for bus animation)
└── BitGridCore (shared base)

BitGridData (variant widget)
├── CpuBlock (inline)
├── WireSvg (inline SVG overlay)
├── BitGridCore (shared base)
├── DecodePanel (inline sidebar)
└── SineWaveAnimation (inline canvas/SVG)
```

Note: "Inline" means the markup lives directly in the variant, not extracted to separate components. If CPU/wire patterns repeat significantly between BitGridBytes and BitGridData, we can extract shared markup later (YAGNI for now).

## Resolved Questions

1. **Bit count for data values** — Parameterized: default to 8 bits (0-255), with a param to switch to 16-bit (0-65535) via debug panel. Start with 8-bit for simplicity.

2. **Sine wave physics** — Ball rolls along the sine curve as a track, like a marble on a wavy surface. Gravity affects speed on slopes (accelerates downhill, decelerates uphill). Seamless infinite loop with connected edges.

3. **Grid renderer** — DOM-based rendering first (CSS grid of span elements). Optimize to canvas only if performance becomes an issue with larger grids. CSS animations are simpler to implement and debug.

## Open Questions

None — all resolved.

## Future Considerations (not for v1)

- Prose trigger transitions between variants (random → bytes → data)
- Integration into the main essay narrative
- Additional data visualizations beyond sine wave (e.g., color values, text encoding)
- Address bus visualization (showing which memory address is being written)
