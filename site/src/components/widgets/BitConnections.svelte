<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams, saveParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import Bit from './Bit.svelte';

  const WIDGET_ID = 'bit-connections';

  const paramDefs: Param[] = [
    { name: 'portSize',     value: 12,  unit: 'px',  category: 'style', min: 6,    max: 24,  step: 1,    description: 'Port dot diameter' },
    { name: 'wireWidth',    value: 2,   unit: 'px',  category: 'style', min: 1,    max: 6,   step: 0.5,  description: 'Wire stroke width' },
    { name: 'wireTension',  value: 0.4, unit: '',    category: 'style', min: 0.1,  max: 1.0, step: 0.05, description: 'Bezier curve tension' },
    { name: 'targetSize',   value: 4,   unit: 'rem', category: 'style', min: 2,    max: 8,   step: 0.25, description: 'Target card width and height' },
    { name: 'columnGap',    value: 6,   unit: 'rem', category: 'style', min: 2,    max: 12,  step: 0.5,  description: 'Gap between bit and targets' },
    { name: 'targetGap',    value: 1,   unit: 'rem', category: 'style', min: 0.25, max: 3,   step: 0.25, description: 'Vertical gap between targets' },
    { name: 'inertOpacity', value: 0.3, unit: '',    category: 'style', min: 0.1,  max: 0.6, step: 0.05, description: 'Opacity of disconnected targets' },
    { name: 'snapRadius',    value: 24,  unit: 'px', category: 'behavior',  min: 8,   max: 64,   step: 2,   description: 'Distance threshold for wire snap-to-port' },
    { name: 'pulseDuration', value: 400, unit: 'ms', category: 'animation', min: 100, max: 2000, step: 50,  description: 'Time for pulse to travel along wire' },
    { name: 'pulseSize',     value: 6,   unit: 'px', category: 'style',     min: 3,   max: 16,   step: 1,   description: 'Pulse dot radius' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // --- State ---
  let connections = $state(new Set<string>());
  let bitValue = $state<0 | 1>(0);
  let dragging = $state<{ from: 'bit' | string; cursorX: number; cursorY: number; snappedTo?: string | null } | null>(null);

  // --- Per-target state (decoupled from bitValue for pulse animation) ---
  let targetStates = $state<Record<string, 0 | 1>>({});
  let activePulses = new Map<string, number>(); // targetId → rAF id (not reactive, just bookkeeping)
  let pulsePositions = $state<Map<string, { x: number; y: number }>>(new Map());

  // --- Element refs ---
  let rootEl: HTMLDivElement | undefined = $state();
  let bitPortEl: HTMLDivElement | undefined = $state();
  let targetPortEls: Record<string, HTMLDivElement> = {};

  // --- Targets ---
  const targets = [
    { id: 'bulb',      label: 'Light bulb',   states: ['Off', 'On'] },
    { id: 'trueFalse', label: 'TRUE / FALSE',  states: ['FALSE', 'TRUE'] },
    { id: 'bwCard',    label: 'Black & White', states: ['White', 'Black'] },
    { id: 'coin',      label: 'Coin',          states: ['Tails', 'Heads'] },
  ];

  // --- Resize tracking ---
  let resizeTick = $state(0);

  $effect(() => {
    if (!rootEl) return;
    const ro = new ResizeObserver(() => { resizeTick++; });
    ro.observe(rootEl);
    return () => ro.disconnect();
  });

  // --- Cleanup in-flight animations on unmount ---
  $effect(() => {
    return () => {
      for (const [, id] of activePulses) cancelAnimationFrame(id);
    };
  });

  // --- Port position helpers ---
  function portCenter(el: HTMLElement | undefined): { x: number; y: number } | null {
    if (!el || !rootEl) return null;
    const rootRect = rootEl.getBoundingClientRect();
    const portRect = el.getBoundingClientRect();
    return {
      x: portRect.left + portRect.width / 2 - rootRect.left,
      y: portRect.top + portRect.height / 2 - rootRect.top,
    };
  }

  function wirePath(x1: number, y1: number, x2: number, y2: number): string {
    const dx = (x2 - x1) * params.wireTension;
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // --- Computed wire paths ---
  let wires = $derived.by(() => {
    void resizeTick;
    const paths: { id: string; d: string }[] = [];
    const bitPos = portCenter(bitPortEl);
    if (!bitPos) return paths;

    for (const id of connections) {
      const targetPos = portCenter(targetPortEls[id]);
      if (!targetPos) continue;
      paths.push({ id, d: wirePath(bitPos.x, bitPos.y, targetPos.x, targetPos.y) });
    }
    return paths;
  });

  // --- Drag wire path ---
  let dragWire = $derived.by(() => {
    void resizeTick;
    if (!dragging) return null;
    const rootRect = rootEl?.getBoundingClientRect();
    if (!rootRect) return null;

    const cursorLocal = {
      x: dragging.cursorX - rootRect.left,
      y: dragging.cursorY - rootRect.top,
    };

    if (dragging.from === 'bit') {
      const bitPos = portCenter(bitPortEl);
      if (!bitPos) return null;
      // Snap: use target port center if snapped
      const endPos = dragging.snappedTo
        ? portCenter(targetPortEls[dragging.snappedTo])
        : null;
      const end = endPos ?? cursorLocal;
      return wirePath(bitPos.x, bitPos.y, end.x, end.y);
    } else {
      const targetPos = portCenter(targetPortEls[dragging.from]);
      if (!targetPos) return null;
      // Snap: use bit port center if snapped to bit
      const endPos = dragging.snappedTo === 'bit'
        ? portCenter(bitPortEl)
        : null;
      const end = endPos ?? cursorLocal;
      return wirePath(targetPos.x, targetPos.y, end.x, end.y);
    }
  });

  // --- Bit flip handler ---
  function handleBitFlip(value: 0 | 1) {
    bitValue = value;

    // Cancel any in-flight pulses
    for (const [, id] of activePulses) cancelAnimationFrame(id);
    activePulses.clear();
    pulsePositions = new Map();

    if (reducedMotion?.matches || connections.size === 0) {
      // Instant update
      for (const id of connections) targetStates[id] = value;
      targetStates = { ...targetStates };
      return;
    }

    // Start pulse for each connected wire
    for (const targetId of connections) {
      startPulse(targetId, value);
    }
  }

  function startPulse(targetId: string, value: 0 | 1) {
    const pathEl = rootEl?.querySelector(`path[data-wire="${targetId}"]`) as SVGPathElement | null;
    if (!pathEl) {
      targetStates[targetId] = value;
      targetStates = { ...targetStates };
      return;
    }

    const totalLength = pathEl.getTotalLength();
    const startTime = performance.now();

    function step(now: number) {
      const progress = Math.min((now - startTime) / params.pulseDuration, 1);
      const point = pathEl!.getPointAtLength(progress * totalLength);

      pulsePositions.set(targetId, { x: point.x, y: point.y });
      pulsePositions = new Map(pulsePositions);

      if (progress < 1) {
        activePulses.set(targetId, requestAnimationFrame(step));
      } else {
        // Pulse arrived — update target state
        targetStates[targetId] = value;
        targetStates = { ...targetStates };
        activePulses.delete(targetId);
        pulsePositions.delete(targetId);
        pulsePositions = new Map(pulsePositions);
      }
    }

    activePulses.set(targetId, requestAnimationFrame(step));
  }

  // --- Drag handlers ---
  function startDragFromBit(e: PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging = { from: 'bit', cursorX: e.clientX, cursorY: e.clientY };
  }

  function startDragFromTarget(e: PointerEvent, targetId: string) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Cancel any pulse for this target
    const pulseId = activePulses.get(targetId);
    if (pulseId != null) { cancelAnimationFrame(pulseId); activePulses.delete(targetId); }
    pulsePositions.delete(targetId);
    pulsePositions = new Map(pulsePositions);
    // Disconnect immediately
    connections.delete(targetId);
    connections = new Set(connections);
    dragging = { from: targetId, cursorX: e.clientX, cursorY: e.clientY };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;

    const rootRect = rootEl?.getBoundingClientRect();
    if (!rootRect) { dragging = { ...dragging, cursorX: e.clientX, cursorY: e.clientY }; return; }

    const cursorLocal = {
      x: e.clientX - rootRect.left,
      y: e.clientY - rootRect.top,
    };

    let snappedTo: string | null = null;
    let bestDist = params.snapRadius;

    if (dragging.from === 'bit') {
      // Check unconnected target ports
      for (const t of targets) {
        if (connections.has(t.id)) continue;
        const pos = portCenter(targetPortEls[t.id]);
        if (!pos) continue;
        const dist = Math.hypot(cursorLocal.x - pos.x, cursorLocal.y - pos.y);
        if (dist < bestDist) { bestDist = dist; snappedTo = t.id; }
      }
    } else {
      // Check bit port
      const bitPos = portCenter(bitPortEl);
      if (bitPos) {
        const dist = Math.hypot(cursorLocal.x - bitPos.x, cursorLocal.y - bitPos.y);
        if (dist < bestDist) snappedTo = 'bit';
      }
    }

    dragging = { ...dragging, cursorX: e.clientX, cursorY: e.clientY, snappedTo };
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging) return;

    if (dragging.from === 'bit') {
      // Use snap target if available, fall back to elementFromPoint
      const targetId = dragging.snappedTo
        ?? document.elementFromPoint(e.clientX, e.clientY)?.getAttribute('data-target-port');
      if (targetId && !connections.has(targetId)) {
        addConnection(targetId);
      }
    } else {
      // Dragging from a target — check snap or elementFromPoint
      const isBitPort = dragging.snappedTo === 'bit'
        || document.elementFromPoint(e.clientX, e.clientY)?.hasAttribute('data-bit-port');
      if (isBitPort) {
        addConnection(dragging.from);
      }
      // Otherwise stays disconnected
    }

    dragging = null;
  }

  function addConnection(targetId: string) {
    connections.add(targetId);
    connections = new Set(connections);
    // Set target state immediately on connect (no pulse)
    targetStates[targetId] = bitValue;
    targetStates = { ...targetStates };
  }

  // --- Imperative API ---
  export function connectAll() {
    for (const t of targets) {
      connections.add(t.id);
      targetStates[t.id] = bitValue;
    }
    connections = new Set(connections);
    targetStates = { ...targetStates };
  }

  export function disconnectAll() {
    // Cancel all pulses
    for (const [, id] of activePulses) cancelAnimationFrame(id);
    activePulses.clear();
    pulsePositions = new Map();
    connections = new Set();
    targetStates = {};
  }
</script>

<div
  bind:this={rootEl}
  class="bit-connections"
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  style="
    --bc-port-size: {params.portSize}px;
    --bc-wire-width: {params.wireWidth}px;
    --bc-target-size: {params.targetSize}rem;
    --bc-column-gap: {params.columnGap}rem;
    --bc-target-gap: {params.targetGap}rem;
    --bc-inert-opacity: {params.inertOpacity};
  "
>
  <!-- SVG wire overlay -->
  <svg class="wire-overlay">
    {#each wires as wire (wire.id)}
      <path
        data-wire={wire.id}
        d={wire.d}
        fill="none"
        stroke="var(--color-accent)"
        stroke-width={params.wireWidth}
        stroke-linecap="round"
      />
    {/each}
    {#if dragWire}
      <path
        d={dragWire}
        fill="none"
        stroke="var(--color-accent)"
        stroke-width={params.wireWidth}
        stroke-linecap="round"
        stroke-dasharray={dragging?.snappedTo ? 'none' : '6 4'}
        opacity={dragging?.snappedTo ? 1 : 0.6}
      />
    {/if}
    {#each [...pulsePositions] as [id, pos] (id)}
      <circle
        cx={pos.x}
        cy={pos.y}
        r={params.pulseSize}
        fill="var(--color-accent)"
        opacity="0.9"
      />
    {/each}
  </svg>

  <!-- Bit column -->
  <div class="bit-column">
    <Bit onflip={handleBitFlip} />
    <div
      bind:this={bitPortEl}
      class="port bit-port"
      class:snapping={dragging?.snappedTo === 'bit'}
      data-bit-port
      role="button"
      tabindex="0"
      aria-label="Drag to connect bit to a target"
      onpointerdown={startDragFromBit}
    ></div>
  </div>

  <!-- Targets column -->
  <div class="targets-column">
    {#each targets as target (target.id)}
      {@const isConnected = connections.has(target.id)}
      {@const stateIndex = isConnected ? (targetStates[target.id] ?? 0) : 0}
      <div class="target-row">
        <div
          bind:this={targetPortEls[target.id]}
          class="port target-port"
          class:connected={isConnected}
          class:snapping={dragging?.snappedTo === target.id}
          data-target-port={target.id}
          role="button"
          tabindex="0"
          aria-label="{isConnected ? 'Disconnect' : 'Connect'} {target.label}"
          onpointerdown={(e) => isConnected ? startDragFromTarget(e, target.id) : undefined}
        ></div>
        <div
          class="target-card target-{target.id}"
          class:connected={isConnected}
          class:active={isConnected && (targetStates[target.id] ?? 0) === 1}
          aria-label="{target.label}: {isConnected ? target.states[stateIndex] : 'disconnected'}"
        >
          {#if target.id === 'bulb'}
            <div class="bulb" class:on={isConnected && stateIndex === 1}>
              {isConnected && stateIndex === 1 ? '●' : '○'}
            </div>
          {:else if target.id === 'trueFalse'}
            <span class="tf-text">{isConnected ? target.states[stateIndex] : '?'}</span>
          {:else if target.id === 'bwCard'}
            <div class="bw-inner"></div>
          {:else if target.id === 'coin'}
            <div class="coin-face" class:heads={isConnected && stateIndex === 1}>
              <span class="coin-letter">{isConnected ? (stateIndex === 1 ? 'H' : 'T') : '?'}</span>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-connections {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--bc-column-gap);
    padding: 2rem;
  }

  .wire-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  /* --- Bit column --- */
  .bit-column {
    position: relative;
    display: flex;
    align-items: center;
  }

  /* --- Port dots --- */
  .port {
    width: var(--bc-port-size);
    height: var(--bc-port-size);
    border-radius: 50%;
    background: var(--color-accent);
    border: 2px solid var(--color-accent);
    cursor: grab;
    touch-action: none;
    z-index: 1;
    flex-shrink: 0;
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
  }

  .port:hover,
  .port.snapping {
    transform: scale(1.5);
    box-shadow: 0 0 12px var(--color-accent);
  }

  .bit-port {
    position: absolute;
    right: calc(var(--bc-port-size) / -2);
    top: 50%;
    translate: 0 -50%;
  }

  /* --- Targets column --- */
  .targets-column {
    display: flex;
    flex-direction: column;
    gap: var(--bc-target-gap);
  }

  .target-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .target-port {
    background: var(--color-border);
    border-color: var(--color-border);
  }

  .target-port.connected {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  /* --- Target cards --- */
  .target-card {
    width: var(--bc-target-size);
    height: var(--bc-target-size);
    display: grid;
    place-items: center;
    border-radius: 8px;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.875rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-muted);
    opacity: var(--bc-inert-opacity);
    transition: opacity var(--transition-normal), background var(--transition-normal), color var(--transition-normal), box-shadow var(--transition-normal);
    user-select: none;
  }

  .target-card.connected {
    opacity: 1;
    color: var(--color-text);
  }

  /* Light bulb */
  .bulb {
    font-size: 1.5rem;
    color: var(--color-text-muted);
    transition: color var(--transition-normal), text-shadow var(--transition-normal);
  }

  .bulb.on {
    color: #fbbf24;
    text-shadow: 0 0 12px #fbbf24, 0 0 24px #fbbf2488;
  }

  /* TRUE/FALSE */
  .tf-text {
    font-size: 0.8rem;
    letter-spacing: 0.05em;
  }

  .target-card.connected.active .tf-text {
    color: var(--color-accent);
  }

  /* Black/White */
  .bw-inner {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: 7px;
    transition: background var(--transition-normal), color var(--transition-normal);
  }

  .target-card.connected .bw-inner {
    background: white;
    color: black;
  }

  .target-card.connected.active .bw-inner {
    background: black;
    color: white;
  }

  /* Coin */
  .coin-face {
    width: 80%;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 3px solid var(--color-border);
    display: grid;
    place-items: center;
    background: var(--color-bg-raised);
    transition: border-color var(--transition-normal), background var(--transition-normal);
  }

  .target-card.connected .coin-face {
    border-color: #909090;
    background: linear-gradient(145deg, #c0c0c0, #888888);
  }

  .coin-letter {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-text-muted);
    transition: color var(--transition-normal);
  }

  .target-card.connected .coin-letter {
    color: #3a3a3a;
  }
</style>
