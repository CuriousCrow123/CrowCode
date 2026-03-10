<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { toHex } from '../../lib/binary';
  import { writeUint, readUint } from '../../lib/binary';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitCell from './shared/BitCell.svelte';

  const WIDGET_ID = 'memory-table';

  // --- Param definitions ---

  const paramDefs: Param[] = [
    { name: 'cellSize',     value: 14,  unit: 'px', category: 'grid',      min: 8,   max: 24,   step: 1,   description: 'Bit cell width/height' },
    { name: 'cellGap',      value: 2,   unit: 'px', category: 'grid',      min: 0,   max: 6,    step: 1,   description: 'Gap between bit cells' },
    { name: 'fontSize',     value: 10,  unit: 'px', category: 'grid',      min: 0,   max: 16,   step: 1,   description: 'Digit size (0 = color only)' },
    { name: 'glowDuration', value: 300, unit: 'ms', category: 'animation', min: 50,  max: 1000, step: 50,  description: 'Glow-pulse duration' },
    { name: 'addressMode',  value: 0,   unit: '',   category: 'behavior',  min: 0,   max: 1,    step: 1,   description: 'Address preset (0=simple, 1=realistic)' },
    { name: 'ambientRate',  value: 200, unit: 'ms', category: 'behavior',  min: 50,  max: 1000, step: 50,  description: 'Ambient random flip interval' },
    { name: 'sectionGap',   value: 8,   unit: 'px', category: 'style',     min: 0,   max: 20,   step: 2,   description: 'Vertical gap between sections' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // --- Section model ---

  interface MemorySection {
    type: 'section' | 'gap';
    label: string;
    color: string;
    visibleBytes: number;
    totalBytes: number;
    init: number[] | 'zero' | 'random';
    dimmed?: boolean;
  }

  interface SectionState {
    collapsed: boolean;
    byteOffset: number;
  }

  const SECTIONS: MemorySection[] = [
    { type: 'section', label: 'TEXT',  color: 'rgba(99, 102, 241, 0.6)',  visibleBytes: 3, totalBytes: 16, init: [0x48, 0x65, 0x6C] },
    { type: 'section', label: 'DATA',  color: 'rgba(34, 197, 94, 0.6)',   visibleBytes: 2, totalBytes: 16, init: [0xCC, 0x55] },
    { type: 'section', label: 'BSS',   color: 'rgba(234, 179, 8, 0.6)',   visibleBytes: 2, totalBytes: 16, init: 'zero' },
    { type: 'section', label: 'HEAP',  color: 'rgba(249, 115, 22, 0.6)',  visibleBytes: 2, totalBytes: 16, init: 'random' },
    { type: 'gap',     label: '',      color: 'transparent',               visibleBytes: 0, totalBytes: 0,  init: 'zero' },
    { type: 'section', label: 'STACK', color: 'rgba(236, 72, 153, 0.6)',  visibleBytes: 2, totalBytes: 16, init: 'random' },
    { type: 'section', label: 'KERN',  color: 'rgba(107, 114, 128, 0.4)', visibleBytes: 2, totalBytes: 16, init: 'random', dimmed: true },
  ];

  // Address presets: [simple 4-digit, realistic 8-digit]
  const ADDRESS_PRESETS: Record<string, [number, number]> = {
    TEXT:  [0x0000, 0x08048000],
    DATA:  [0x0010, 0x08049000],
    BSS:   [0x0020, 0x0804A000],
    HEAP:  [0x0030, 0x0804B000],
    STACK: [0x00E0, 0xBFFFF000],
    KERN:  [0x00F0, 0xC0000000],
  };

  // --- Compute total visible bytes and section offsets ---

  const totalVisibleBytes = SECTIONS.reduce((sum, s) => sum + s.visibleBytes, 0);

  function computeSectionStates(): SectionState[] {
    let offset = 0;
    return SECTIONS.map(s => {
      const state: SectionState = { collapsed: false, byteOffset: offset };
      offset += s.visibleBytes;
      return state;
    });
  }

  // --- State ---

  let bits: number[] = $state([]);
  let sectionStates: SectionState[] = $state(computeSectionStates());
  let running = $state(true);
  let ambient = $state(false);
  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let isVisible = $state(false);

  // Glow tracking
  let glowingCells: Set<number> = $state(new Set());
  let prevBits = new Uint8Array(0);

  // Highlight tracking
  let highlightedRows: Set<number> = $state(new Set());

  // Write protection: byteOffset → expiry timestamp
  let writeProtected = new Map<number, number>();

  // Pending writes/highlights for collapsed sections
  let pendingWrites: Array<{ byteOffset: number; value: number }> = [];
  let pendingHighlights: number[] = [];

  // --- Initialize bits ---

  function initBits(): number[] {
    const result: number[] = [];
    for (const section of SECTIONS) {
      for (let b = 0; b < section.visibleBytes; b++) {
        let byteVal: number;
        if (section.init === 'zero') {
          byteVal = 0;
        } else if (section.init === 'random') {
          byteVal = Math.floor(Math.random() * 256);
        } else {
          byteVal = b < section.init.length ? section.init[b] : 0;
        }
        for (let bit = 7; bit >= 0; bit--) {
          result.push((byteVal >> bit) & 1);
        }
      }
    }
    return result;
  }

  // Init on mount
  $effect(() => {
    if (bits.length === 0) {
      bits = initBits();
    }
  });

  // --- Derived values ---

  let addressDigits = $derived(params.addressMode === 0 ? 4 : 8);

  // Compute hex value for a byte at a given bit offset
  function getByteValue(bitOffset: number): number {
    return readUint(bits, bitOffset, 8);
  }

  // Get section start address
  function getSectionAddress(sectionIdx: number): number {
    const section = SECTIONS[sectionIdx];
    if (section.type === 'gap' || !ADDRESS_PRESETS[section.label]) return 0;
    return ADDRESS_PRESETS[section.label][params.addressMode];
  }

  // Format byte count for ellipsis text
  function formatByteCount(count: number): string {
    if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}G`;
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
  }

  // --- Change detection for glow-pulse ---

  $effect(() => {
    const currentBits = bits;
    if (prevBits.length !== currentBits.length) {
      prevBits = new Uint8Array(currentBits);
      return;
    }

    const changed: number[] = [];
    for (let i = 0; i < currentBits.length; i++) {
      if (currentBits[i] !== prevBits[i]) {
        changed.push(i);
      }
    }

    if (changed.length > 0) {
      for (const idx of changed) {
        glowingCells.add(idx);
      }
    }

    prevBits = new Uint8Array(currentBits);
  });

  function handleGlowEnd(index: number) {
    glowingCells.delete(index);
  }

  // --- Address / section resolution ---

  function resolveByteOffset(address: number): number | null {
    for (let si = 0; si < SECTIONS.length; si++) {
      const section = SECTIONS[si];
      if (section.type === 'gap') continue;

      const startAddr = getSectionAddress(si);
      const endAddr = startAddr + section.visibleBytes;

      if (address >= startAddr && address < endAddr) {
        const row = address - startAddr;
        return sectionStates[si].byteOffset + row;
      }
    }
    return null;
  }

  function resolveSectionForByteOffset(byteOffset: number): { sectionIdx: number; section: MemorySection; state: SectionState } | null {
    for (let si = 0; si < SECTIONS.length; si++) {
      const section = SECTIONS[si];
      const state = sectionStates[si];
      if (byteOffset >= state.byteOffset && byteOffset < state.byteOffset + section.visibleBytes) {
        return { sectionIdx: si, section, state };
      }
    }
    return null;
  }

  // --- Imperative API ---

  export function start() { running = true; }
  export function stop() { running = false; }

  export function setAmbient(on: boolean) {
    ambient = on;
    if (on) running = true;
  }

  export function writeByte(address: number, value: number) {
    const byteOffset = resolveByteOffset(address);
    if (byteOffset == null) return;

    const resolved = resolveSectionForByteOffset(byteOffset);
    if (!resolved || resolved.section.dimmed) return;

    if (resolved.state.collapsed) {
      expand(resolved.section.label);
      pendingWrites.push({ byteOffset, value });
      return;
    }
    doWriteByte(byteOffset, value);
  }

  function doWriteByte(byteOffset: number, value: number) {
    const newBits = [...bits];
    writeUint(newBits, byteOffset * 8, value, 8);
    bits = newBits;
    writeProtected.set(byteOffset, performance.now() + 2000);
  }

  export function highlightRow(address: number) {
    const byteOffset = resolveByteOffset(address);
    if (byteOffset == null) return;

    const resolved = resolveSectionForByteOffset(byteOffset);
    if (!resolved) return;

    if (resolved.state.collapsed) {
      expand(resolved.section.label);
      pendingHighlights.push(byteOffset);
      return;
    }
    doHighlightRow(byteOffset);
  }

  function doHighlightRow(byteOffset: number) {
    // Remove and re-add to restart animation via forced reflow
    if (highlightedRows.has(byteOffset)) {
      highlightedRows.delete(byteOffset);
      // Force reflow to restart animation
      requestAnimationFrame(() => {
        highlightedRows.add(byteOffset);
      });
    } else {
      highlightedRows.add(byteOffset);
    }
  }

  function handleHighlightEnd(byteOffset: number) {
    highlightedRows.delete(byteOffset);
  }

  export function collapse(label: string) {
    const idx = SECTIONS.findIndex(s => s.label === label && s.type === 'section');
    if (idx === -1) return;
    sectionStates[idx].collapsed = true;
  }

  export function expand(label: string) {
    const idx = SECTIONS.findIndex(s => s.label === label && s.type === 'section');
    if (idx === -1) return;
    sectionStates[idx].collapsed = false;
  }

  function handleTransitionEnd(sectionIdx: number) {
    const state = sectionStates[sectionIdx];
    if (state.collapsed) return; // Only flush on expand

    // Flush pending writes for this section
    const section = SECTIONS[sectionIdx];
    const sectionStart = state.byteOffset;
    const sectionEnd = sectionStart + section.visibleBytes;

    const toFlush = pendingWrites.filter(w => w.byteOffset >= sectionStart && w.byteOffset < sectionEnd);
    pendingWrites = pendingWrites.filter(w => w.byteOffset < sectionStart || w.byteOffset >= sectionEnd);
    for (const w of toFlush) {
      doWriteByte(w.byteOffset, w.value);
    }

    // Flush pending highlights for this section
    const highlightsToFlush = pendingHighlights.filter(h => h >= sectionStart && h < sectionEnd);
    pendingHighlights = pendingHighlights.filter(h => h < sectionStart || h >= sectionEnd);
    for (const h of highlightsToFlush) {
      doHighlightRow(h);
    }
  }

  export function reset() {
    bits = initBits();
    glowingCells.clear();
    highlightedRows.clear();
    writeProtected.clear();
    pendingWrites = [];
    pendingHighlights = [];
    sectionStates = computeSectionStates();
  }

  // --- Visibility observer ---

  $effect(() => {
    if (!containerEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0 }
    );
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // --- Ambient mode ---

  $effect(() => {
    if (!isVisible || !running || !ambient) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      // Pick a random visible byte
      const byteIdx = Math.floor(Math.random() * totalVisibleBytes);

      // Skip collapsed sections, KERNEL, and write-protected bytes
      const resolved = resolveSectionForByteOffset(byteIdx);
      if (!resolved || resolved.state.collapsed || resolved.section.dimmed) return;
      const protectedExpiry = writeProtected.get(byteIdx);
      if (protectedExpiry && now < protectedExpiry) return;

      // Flip the byte
      const newBits = [...bits];
      const bitStart = byteIdx * 8;
      for (let j = 0; j < 8; j++) {
        newBits[bitStart + j] = Math.round(Math.random());
      }
      bits = newBits;
    }, params.ambientRate);
    return () => clearInterval(id);
  });
</script>

<div
  class="memory-table"
  bind:this={containerEl}
  role="table"
  aria-label="Byte-addressable memory"
  style="
    --bit-cell-size: {params.cellSize}px;
    --bit-cell-font-size: {params.fontSize}px;
    --bit-cell-glow-duration: {params.glowDuration}ms;
    --mt-section-gap: {params.sectionGap}px;
    --mt-cell-gap: {params.cellGap}px;
  "
>
  {#each SECTIONS as section, si}
    {#if section.type === 'gap'}
      <!-- Gap row -->
      <div class="gap-row" role="row">
        <span class="gap-text">··· free space ···</span>
      </div>
    {:else}
      <!-- Section -->
      <div class="section" role="rowgroup" aria-label="{section.label} section">
        <div class="section-sidebar" style="--mt-section-color: {section.color}">
          <span class="section-label">{section.label}</span>
        </div>
        <div class="section-content">
          <!-- Collapsible rows wrapper -->
          <div
            class="section-rows-wrapper"
            class:collapsed={sectionStates[si].collapsed}
            ontransitionend={() => handleTransitionEnd(si)}
          >
            <div class="section-rows-inner">
              {#each { length: section.visibleBytes } as _, row}
                {@const byteOffset = sectionStates[si].byteOffset + row}
                {@const bitOffset = byteOffset * 8}
                {@const address = getSectionAddress(si) + row}
                {@const byteVal = getByteValue(bitOffset)}
                {@const isHighlighted = highlightedRows.has(byteOffset)}
                <div
                  class="row"
                  class:highlighted={isHighlighted}
                  role="row"
                  onanimationend={() => handleHighlightEnd(byteOffset)}
                >
                  <span class="address" role="cell">{toHex(address, addressDigits)}</span>
                  <div class="byte-cells" role="cell">
                    {#each { length: 8 } as _, bi}
                      <BitCell
                        bit={bits[bitOffset + bi]}
                        glowing={glowingCells.has(bitOffset + bi)}
                        dimmed={section.dimmed ?? false}
                        onglowend={() => handleGlowEnd(bitOffset + bi)}
                      />
                    {/each}
                  </div>
                  <span class="hex-value" role="cell">{toHex(byteVal, 2)}</span>
                </div>
              {/each}
            </div>
          </div>
          <!-- Ellipsis row (always visible) -->
          {#if section.totalBytes > section.visibleBytes}
            <div class="ellipsis-row" role="row">
              <span class="ellipsis-text">
                ··· {formatByteCount(section.totalBytes - section.visibleBytes)} more bytes ···
              </span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .memory-table {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--mt-section-gap, 4px);
    padding: 1rem;
    overflow-x: auto;
    font-family: var(--font-mono);
  }

  /* --- Section --- */

  .section {
    display: flex;
    gap: 0;
  }

  .section-sidebar {
    flex-shrink: 0;
    width: 44px;
    position: relative;
    padding-left: 8px;
    padding-top: 2px;
  }

  .section-sidebar::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--mt-section-color);
    border-radius: 1.5px;
  }

  .section-label {
    font-size: 0.5rem;
    font-weight: 700;
    color: var(--mt-section-color);
    letter-spacing: 0.08em;
    white-space: nowrap;
    line-height: 1;
  }

  .section-content {
    flex: 1;
    min-width: 0;
  }

  /* --- Collapse/expand animation --- */

  .section-rows-wrapper {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows var(--transition-normal, 0.25s ease);
  }

  .section-rows-wrapper.collapsed {
    grid-template-rows: 0fr;
  }

  .section-rows-inner {
    overflow: hidden;
  }

  /* --- Row --- */

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .row.highlighted {
    animation: highlight-fade 1.5s ease-out forwards;
  }

  @keyframes highlight-fade {
    0% { background-color: rgba(99, 102, 241, 0.2); }
    100% { background-color: transparent; }
  }

  .address {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    opacity: 0.7;
    flex-shrink: 0;
    text-align: right;
    min-width: 5ch;
  }

  .byte-cells {
    display: flex;
    gap: var(--mt-cell-gap, 2px);
    flex-shrink: 0;
  }

  .hex-value {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    opacity: 0.5;
    flex-shrink: 0;
    min-width: 4ch;
  }

  /* --- Ellipsis / gap rows --- */

  .ellipsis-row {
    padding: 2px 0;
  }

  .ellipsis-text {
    font-size: 0.5rem;
    color: var(--color-text-muted);
    opacity: 0.4;
    font-style: italic;
  }

  .gap-row {
    display: flex;
    justify-content: center;
    padding: 4px 0;
  }

  .gap-text {
    font-size: 0.5rem;
    color: var(--color-text-muted);
    opacity: 0.3;
    font-style: italic;
  }

  /* --- Responsive --- */

  @media (max-width: 600px) {
    .memory-table {
      padding: 0.5rem;
    }
  }
</style>
