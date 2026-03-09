# Brainstorm: Bit Connections Widget

**Date:** 2026-03-09
**Status:** Complete

## What We're Building

A **BitConnections widget** — the Bit card on the left with a draggable port, and an array of two-state items on the right (light bulb, TRUE/FALSE card, black/white card, coin). The user drags wires from the bit's port to any item(s) to connect them. Flipping the bit flips all connected items.

This is the second section on the index page, below "The Bit" intro. The prose explains that a single bit can represent various two-state things.

## Layout

```
[Bit card] ---o  ·····>  💡 Light bulb (on/off)
              |  ·····>  T/F card (TRUE/FALSE)
              |          ◻◼ Black/white card
              |          🪙 Coin (heads/tails)
```

- Bit card on the left (reuses the existing Bit widget with flip animation)
- Port dot on the right edge of the Bit card — drag origin
- Four target items arranged vertically on the right
- Each target has a port dot on its left edge — drop target
- SVG wires drawn between connected ports

## Interaction

1. **Drag to connect**: User drags from the bit's port dot → wire follows cursor → drop on a target's port dot to connect
2. **Multiple connections**: The bit can connect to multiple items simultaneously
3. **Flip propagation**: Clicking the bit flips it AND all connected items
4. **Disconnect**: Drag from a connected target's port and release into empty space to disconnect (mirrors the connect gesture)
5. **Click vs drag**: Click on the Bit card = flip. Drag from the port dot = start a wire. These are separate interaction zones.

## Target Items (two-state representations)

1. **Light bulb** — off (dim) / on (bright glow)
2. **TRUE/FALSE card** — text flips between "TRUE" and "FALSE"
3. **Black/white card** — background color toggles
4. **Coin** — shows heads / tails (text or simple icon)

## Key Decisions

1. **Reuse Bit widget**: The left side embeds the existing Bit component with its flip animation
2. **Port dot for drag**: Small circle on right edge of Bit, left edge of targets — clear drag affordance
3. **SVG bezier wires**: Drawn as SVG cubic bezier paths in an overlay, connecting port positions
4. **Multiple connections**: Bit can drive any/all items at once
5. **New section below BitIntro**: Progressive essay layout — builds on the concept introduced above
6. **Disconnected = inert**: Targets are greyed/dimmed until connected. Only show their active state when wired to the bit.

## Resolved Questions

1. **Disconnect**: Drag from connected port, release into empty space (mirrors the connect gesture)
2. **Wire style**: Bezier curves (smooth S-curve between ports)
3. **Disconnected state**: Greyed/inert until connected
