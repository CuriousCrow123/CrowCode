<script lang="ts">
  import { tick } from 'svelte';
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { toHex, readUint, writeUint } from '../../lib/binary';
  import {
    type CTypeName,
    type CVariable,
    C_TYPE_SIZES,
    VAR_COLORS,
    valueToBytes,
    garbageBytes,
  } from '../../lib/c-program';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitCell from './shared/BitCell.svelte';

  const WIDGET_ID = 'c-memory-view';

  // --- Param definitions ---

  const paramDefs: Param[] = [
    { name: 'cellSize',     value: 16,  unit: 'px',   category: 'grid',      min: 10, max: 28,   step: 1,  description: 'Bit cell width/height' },
    { name: 'cellGap',      value: 2,   unit: 'px',   category: 'grid',      min: 0,  max: 6,    step: 1,  description: 'Gap between bit cells' },
    { name: 'fontSize',     value: 11,  unit: 'px',   category: 'grid',      min: 0,  max: 16,   step: 1,  description: 'Bit digit font size' },
    { name: 'glowDuration', value: 400, unit: 'ms',   category: 'animation', min: 50, max: 1500, step: 50, description: 'Bit change glow duration' },
    { name: 'rowGap',       value: 4,   unit: 'px',   category: 'style',     min: 0,  max: 12,   step: 2,  description: 'Vertical gap between byte rows' },
    { name: 'visibleRows',  value: 14,  unit: 'rows', category: 'style',     min: 6,  max: 32,   step: 1,  description: 'Visible rows in scroll area' },
    { name: 'contextRows',  value: 2,   unit: '',     category: 'behavior',  min: 0,  max: 5,    step: 1,  description: 'Unallocated rows shown around variables' },
  ];

  let values = $state(loadParams(WIDGET_ID, paramDefs));

  // --- Constants ---

  const TOTAL_BYTES = 64;
  const BASE_ADDRESS = 0x0100;
  const SEED = 42;

  // --- Stack frame tracking ---

  interface StackFrame {
    name: string;
    baseAddress: number;      // stackPointer when frame was pushed
    varCountAtPush: number;   // variables.length when frame was pushed
  }

  // --- State ---

  // Bits array: 64 bytes × 8 bits = 512 elements. Use $state (not $state.raw)
  // because BitCell reads individual bits reactively.
  let bits: number[] = $state([]);
  let variables: CVariable[] = $state([]);
  let stackPointer = $state(BASE_ADDRESS + TOTAL_BYTES); // starts at top, grows down
  let viewMode: 'bits' | 'table' = $state('bits');
  let frameStack: StackFrame[] = $state([]);

  // Glow tracking (same pattern as MemoryTable)
  let glowingCells: Set<number> = $state(new Set());
  let prevBits = new Uint8Array(0);

  // Read highlight tracking (sustained, cleared by clearHighlights)
  // Maps variable name → highlight color override (or variable's own color as fallback)
  let highlightedVars: Map<string, string> = $state(new Map());

  // Table view: track which variables just had their value assigned (for glow animation)
  let glowingVarNames: Set<string> = $state(new Set());

  // Array element highlight (sustained, cleared by clearHighlights)
  let highlightedElement: { arrayName: string; index: number; color: string } | null = $state(null);

  // Out-of-bounds highlight (red tint for OOB access past array end)
  let oobHighlight: { arrayName: string; index: number } | null = $state(null);

  // Generation counter for async chain cancellation.
  // Every reset() increments this; async methods capture it at start and bail
  // if it has changed by the time they resume after an await.
  let generation = 0;

  // Red tint for uninitialized (declared but not assigned) variable bytes
  const UNINITIALIZED_TINT = 'rgba(239, 68, 68, 0.20)';

  // Scroll container and row element refs
  let scrollAreaEl: HTMLDivElement | undefined = $state(undefined);
  let rowElMap = new Map<number, HTMLElement>();

  function registerRow(node: HTMLElement, address: number) {
    rowElMap.set(address, node);
    return { destroy() { rowElMap.delete(address); } };
  }

  function scrollToAddress(address: number) {
    const el = rowElMap.get(address);
    if (!el || !scrollAreaEl) return;
    const targetTop = el.offsetTop - scrollAreaEl.offsetTop - (scrollAreaEl.clientHeight / 2) + (el.offsetHeight / 2);
    scrollAreaEl.scrollTo({ top: targetTop, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  // --- Scope-aware variable lookup (reverse search = innermost scope first) ---

  function findVar(name: string): CVariable | undefined {
    for (let i = variables.length - 1; i >= 0; i--) {
      if (variables[i].name === name) return variables[i];
    }
    return undefined;
  }

  function findVarIndex(name: string): number {
    for (let i = variables.length - 1; i >= 0; i--) {
      if (variables[i].name === name) return i;
    }
    return -1;
  }

  // --- Reduced motion ---

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Initialize bits with garbage ---

  function initBits(): number[] {
    const result: number[] = [];
    for (let byteIdx = 0; byteIdx < TOTAL_BYTES; byteIdx++) {
      const address = BASE_ADDRESS + byteIdx;
      const garbage = garbageBytes(address, 1, SEED);
      for (let bit = 7; bit >= 0; bit--) {
        result.push((garbage[0] >> bit) & 1);
      }
    }
    return result;
  }

  $effect(() => {
    if (bits.length === 0) {
      bits = initBits();
    }
  });

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
      glowingCells = new Set([...glowingCells, ...changed]);
    }

    prevBits = new Uint8Array(currentBits);
  });

  function handleGlowEnd(index: number) {
    glowingCells = new Set([...glowingCells].filter((i) => i !== index));
  }

  function handleTableGlowEnd(varName: string) {
    glowingVarNames = new Set([...glowingVarNames].filter((n) => n !== varName));
  }

  // --- Derived values ---

  /** Rows to display: lowest address at top, highest at bottom. */
  let displayRows = $derived.by(() => {
    const rows: Array<{
      address: number;
      byteIndex: number;
      bitOffset: number;
      variable: CVariable | null;
      isFirstByte: boolean;
      isAllocated: boolean;
    }> = [];

    // Lowest address at top — big-endian reads naturally top-to-bottom
    for (let byteIdx = 0; byteIdx < TOTAL_BYTES; byteIdx++) {
      const address = BASE_ADDRESS + byteIdx;
      const bitOffset = byteIdx * 8;

      // Find which variable (if any) owns this byte
      let ownerVar: CVariable | null = null;
      let isFirst = false;
      for (const v of variables) {
        if (address >= v.address && address < v.address + v.size) {
          ownerVar = v;
          // First byte = lowest address (MSB in big-endian, top of variable)
          isFirst = address === v.address;
          break;
        }
      }

      rows.push({
        address,
        byteIndex: byteIdx,
        bitOffset,
        variable: ownerVar,
        isFirstByte: isFirst,
        isAllocated: ownerVar !== null,
      });
    }

    return rows;
  });

  // --- Collapsed display (ellipsis for unallocated regions) ---

  type DisplayItem =
    | { kind: 'row'; row: (typeof displayRows)[number] }
    | { kind: 'ellipsis'; startAddress: number; endAddress: number; count: number }
    | { kind: 'frame-divider'; name: string; address: number };

  let collapsedDisplayRows: DisplayItem[] = $derived.by(() => {
    // No variables → show all rows (all dimmed, establishes "memory exists")
    if (variables.length === 0) {
      return displayRows.map((row) => ({ kind: 'row' as const, row }));
    }

    // Mark which byte indices to keep (allocated + context)
    const keepSet = new Set<number>();
    for (const row of displayRows) {
      if (row.isAllocated) {
        keepSet.add(row.byteIndex);
        for (let d = 1; d <= values.contextRows; d++) {
          if (row.byteIndex - d >= 0) keepSet.add(row.byteIndex - d);
          if (row.byteIndex + d < TOTAL_BYTES) keepSet.add(row.byteIndex + d);
        }
      }
    }

    // Ensure rows around frame boundaries are visible
    for (const frame of frameStack) {
      const byteIdx = frame.baseAddress - BASE_ADDRESS;
      if (byteIdx >= 0 && byteIdx < TOTAL_BYTES) keepSet.add(byteIdx);
      if (byteIdx - 1 >= 0 && byteIdx - 1 < TOTAL_BYTES) keepSet.add(byteIdx - 1);
    }

    // Build collapsed rows
    const result: DisplayItem[] = [];
    let collapseStart: number | null = null;
    let collapseCount = 0;

    // Collect frame boundary addresses within grid range
    const frameBoundaries = new Map<number, string>();
    for (const frame of frameStack) {
      if (frame.baseAddress >= BASE_ADDRESS && frame.baseAddress < BASE_ADDRESS + TOTAL_BYTES) {
        frameBoundaries.set(frame.baseAddress, frame.name);
      }
    }

    for (const row of displayRows) {
      if (keepSet.has(row.byteIndex)) {
        if (collapseStart !== null) {
          result.push({
            kind: 'ellipsis',
            startAddress: BASE_ADDRESS + collapseStart,
            endAddress: BASE_ADDRESS + collapseStart + collapseCount - 1,
            count: collapseCount,
          });
          collapseStart = null;
          collapseCount = 0;
        }

        // Insert frame divider before the row at a frame boundary
        const frameName = frameBoundaries.get(row.address);
        if (frameName) {
          result.push({ kind: 'frame-divider', name: frameName, address: row.address });
        }

        result.push({ kind: 'row', row });
      } else {
        if (collapseStart === null) collapseStart = row.byteIndex;
        collapseCount++;
      }
    }

    if (collapseStart !== null) {
      result.push({
        kind: 'ellipsis',
        startAddress: BASE_ADDRESS + collapseStart,
        endAddress: BASE_ADDRESS + collapseStart + collapseCount - 1,
        count: collapseCount,
      });
    }

    return result;
  });

  // --- Byte writing ---

  function writeBytesToMemory(address: number, bytes: number[]) {
    const newBits = [...bits];
    for (let i = 0; i < bytes.length; i++) {
      const byteIdx = (address + i) - BASE_ADDRESS;
      writeUint(newBits, byteIdx * 8, bytes[i], 8);
    }
    bits = newBits;
  }

  // --- Animation helpers ---

  /** Wait for glow to finish on a set of bit indices. */
  function waitForGlow(gen: number): Promise<void> {
    if (reducedMotion || generation !== gen) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(done, values.glowDuration * 2);
      const check = () => {
        if (resolved) return;
        if (generation !== gen || glowingCells.size === 0) {
          done();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
    });
  }

  /** Clear all read highlights. Call before each new step. */
  export function clearHighlights() {
    if (highlightedVars.size > 0) {
      highlightedVars = new Map();
    }
    highlightedElement = null;
    oobHighlight = null;
  }

  // --- Imperative API (Promise-based for animation sequencing) ---

  /**
   * Declare a variable: allocate bytes on the stack, show garbage.
   * Promise resolves after the annotation fade-in animation.
   */
  export async function declareVar(type: CTypeName, name: string, targetType?: CTypeName): Promise<void> {
    const gen = generation;
    const size = C_TYPE_SIZES[type];
    stackPointer -= size;
    const color = VAR_COLORS[variables.length % VAR_COLORS.length];

    variables = [
      ...variables,
      { name, type, address: stackPointer, size, color, value: null, ...(targetType ? { targetType } : {}) },
    ];

    await tick();
    if (generation !== gen) return;
    scrollToAddress(stackPointer);

    if (reducedMotion || generation !== gen) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, values.glowDuration);
    });
  }

  /**
   * Assign a value to an existing variable: write bytes, trigger glow.
   * Promise resolves after the glow animation completes.
   */
  export async function assignVar(name: string, value: number): Promise<void> {
    const gen = generation;
    const vIdx = findVarIndex(name);
    if (vIdx === -1) return;
    const v = variables[vIdx];

    const bytes = valueToBytes(value, v.type);
    writeBytesToMemory(v.address, bytes);

    variables = variables.map((vr, i) =>
      i === vIdx ? { ...vr, value } : vr,
    );

    // Track for table view value-glow animation
    glowingVarNames = new Set([...glowingVarNames, name]);

    await tick();
    if (generation !== gen) return;
    scrollToAddress(v.address);
    await waitForGlow(gen);
  }

  /**
   * Declare and assign in one step: allocate then write.
   * Promise resolves after all animations complete.
   */
  export async function declareAssignVar(
    type: CTypeName,
    name: string,
    value: number,
  ): Promise<void> {
    const gen = generation;
    await declareVar(type, name);
    if (generation !== gen) return;
    await assignVar(name, value);
  }

  /**
   * Highlight a variable's bytes with a sustained read-highlight.
   * Stays visible until clearHighlights() is called (typically at the next step).
   */
  export function highlightVar(name: string, color?: string) {
    const v = findVar(name);
    if (v) scrollToAddress(v.address);
    const hlColor = color ?? v?.color ?? 'rgba(99, 102, 241, 0.35)';
    highlightedVars = new Map([...highlightedVars, [name, hlColor]]);
  }

  /** Switch between bits view and simplified table view. */
  export function setViewMode(mode: 'bits' | 'table') {
    viewMode = mode;
  }

  /** Get a declared variable by name (innermost scope first). */
  export function getVariable(name: string): CVariable | undefined {
    return findVar(name);
  }

  /** Get the hex address string for a variable (e.g., "0x011C"). */
  export function getAddress(name: string): string | null {
    const v = findVar(name);
    if (!v) return null;
    return toHex(v.address, 4);
  }

  /** Get the raw numeric address for a variable. */
  export function getAddressRaw(name: string): number | null {
    const v = findVar(name);
    if (!v) return null;
    return v.address;
  }

  // --- Array imperative API ---

  /**
   * Allocate an array block (count * elementSize bytes) on the stack.
   * Promise resolves after the glow animation.
   */
  export async function declareArray(
    elementType: CTypeName, name: string, count: number
  ): Promise<void> {
    const gen = generation;
    const elementSize = C_TYPE_SIZES[elementType];
    const totalSize = count * elementSize;
    stackPointer -= totalSize;
    const address = stackPointer;

    const v: CVariable = {
      name,
      type: elementType,
      address,
      size: totalSize,
      color: VAR_COLORS[variables.length % VAR_COLORS.length],
      value: null,
      arrayElements: count,
      elementValues: new Array(count).fill(null),
    };
    variables = [...variables, v];

    // Glow effect for new bytes
    const changed: number[] = [];
    for (let i = 0; i < totalSize; i++) {
      changed.push(address - BASE_ADDRESS + i);
    }
    glowingCells = new Set([...glowingCells, ...changed]);

    await tick();
    if (generation !== gen) return;
    scrollToAddress(address);

    await new Promise<void>((r) => setTimeout(r, 400));
    if (gen !== generation) return;
  }

  /**
   * Assign one array element (writes bytes at base + index * elementSize).
   * Promise resolves after the glow animation.
   */
  export async function assignArrayElement(
    name: string, index: number, value: number
  ): Promise<void> {
    const gen = generation;
    const v = findVar(name);
    if (!v || !v.arrayElements) return;

    const elementSize = C_TYPE_SIZES[v.type];
    const byteOffset = v.address - BASE_ADDRESS + index * elementSize;
    const newBytes = valueToBytes(value, v.type);

    // Update bits
    const newBits = [...bits];
    for (let i = 0; i < elementSize; i++) {
      writeUint(newBits, (byteOffset + i) * 8, newBytes[i], 8);
    }
    bits = newBits;

    // Update elementValues
    const updatedVars = variables.map((variable) => {
      if (variable.name === name && variable.elementValues) {
        const newEV = [...variable.elementValues];
        newEV[index] = value;
        return { ...variable, elementValues: newEV };
      }
      return variable;
    });
    variables = updatedVars;

    // Glow effect
    const changed: number[] = [];
    for (let i = 0; i < elementSize; i++) {
      changed.push(byteOffset + i);
    }
    glowingCells = new Set([...glowingCells, ...changed]);

    // Track for table view glow
    glowingVarNames = new Set([...glowingVarNames, `${name}[${index}]`]);

    await tick();
    if (generation !== gen) return;
    scrollToAddress(v.address + index * elementSize);
    await waitForGlow(gen);
  }

  /** Highlight a specific array element's bytes (sustained until clearHighlights). */
  export function highlightArrayElement(
    name: string, index: number, color?: string
  ): void {
    const v = findVar(name);
    if (!v) return;
    highlightedElement = {
      arrayName: name,
      index,
      color: color || v.color,
    };
    // Scroll to the element's first byte
    const elementSize = C_TYPE_SIZES[v.type];
    scrollToAddress(v.address + index * elementSize);
  }

  /** Highlight an out-of-bounds access (past array end — red/danger styling). */
  export function highlightOob(name: string, index: number): void {
    oobHighlight = { arrayName: name, index };
  }

  // --- Frame management API ---

  /**
   * Push a new stack frame. Records the current stack pointer as the frame boundary.
   * All subsequent declareVar calls allocate within this frame.
   */
  export async function pushFrame(name: string): Promise<void> {
    const gen = generation;
    frameStack = [...frameStack, {
      name,
      baseAddress: stackPointer,
      varCountAtPush: variables.length,
    }];

    await tick();
    if (generation !== gen) return;

    if (!reducedMotion) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  /**
   * Pop the top stack frame. Removes its variables, restores stack pointer,
   * and fills freed bytes with garbage.
   * @param skipAnimation — true during replay (fire-and-forget)
   */
  export async function popFrame(skipAnimation = false): Promise<void> {
    const gen = generation;
    const frame = frameStack[frameStack.length - 1];
    if (!frame) return;

    // Capture freed range BEFORE restoring stack pointer
    const freedStart = stackPointer;
    const freedEnd = frame.baseAddress;

    // Synchronous mutations (safe for replay)
    variables = variables.slice(0, frame.varCountAtPush);
    stackPointer = frame.baseAddress;
    frameStack = frameStack.slice(0, -1);

    // Restore garbage bytes for freed range
    const newBits = [...bits];
    for (let i = freedStart; i < freedEnd; i++) {
      const byteIdx = i - BASE_ADDRESS;
      const garbageByte = garbageBytes(i, 1, SEED)[0];
      for (let bit = 0; bit < 8; bit++) {
        newBits[byteIdx * 8 + bit] = (garbageByte >> (7 - bit)) & 1;
      }
    }
    bits = newBits;
    prevBits = new Uint8Array(bits); // prevent glow on garbage restore

    await tick();
    if (generation !== gen) return;

    if (!skipAnimation && !reducedMotion) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  /** Reset program state: cancel animations, clear variables, reinitialize garbage.
   *  Preserves viewMode and tableUnlocked (user preferences, not program state). */
  export function reset() {
    generation++; // invalidate all outstanding async chains
    variables = [];
    frameStack = [];
    stackPointer = BASE_ADDRESS + TOTAL_BYTES;
    glowingCells = new Set();
    highlightedVars = new Map();
    glowingVarNames = new Set();
    highlightedElement = null;
    oobHighlight = null;
    bits = initBits();
    prevBits = new Uint8Array(bits);
    rowElMap.clear();
    if (scrollAreaEl) scrollAreaEl.scrollTop = 0;
  }

  // Cleanup on destroy — invalidate all outstanding async chains
  $effect(() => {
    return () => {
      generation++;
    };
  });

  // --- Helpers for rendering ---

  function getByteHex(bitOffset: number): string {
    return toHex(readUint(bits, bitOffset, 8), 2);
  }

  function formatTableValue(v: CVariable): string {
    if (v.value === null) return '???';
    if (v.type === 'char') {
      const ch = String.fromCharCode(v.value);
      return `'${ch}' (${v.value})`;
    }
    if (v.type === 'pointer') {
      return toHex(v.value, 4);
    }
    return String(v.value);
  }

  /** For pointer variables, find the target variable whose address matches the stored value. */
  function getPointerTargetColor(ptrVar: CVariable): string | null {
    if (ptrVar.type !== 'pointer' || ptrVar.value === null) return null;
    const target = variables.find((v) => v.address === ptrVar.value);
    return target?.color ?? null;
  }

  /** Format the type name for display (e.g., "int *" for pointer-to-int). */
  function formatTypeName(v: CVariable): string {
    if (v.type === 'pointer' && v.targetType) {
      return `${v.targetType} *`;
    }
    if (v.arrayElements != null) {
      return `${v.type}[${v.arrayElements}]`;
    }
    return v.type;
  }

  /**
   * For an array variable, compute the element label for a byte address.
   * Returns e.g. "arr[0]" if this address is the first byte of element 0,
   * or null if it's not the first byte of any element.
   */
  function getArrayElementLabel(v: CVariable, address: number): string | null {
    if (!v.arrayElements) return null;
    const elementSize = C_TYPE_SIZES[v.type];
    const offset = address - v.address;
    if (offset % elementSize !== 0) return null;
    const idx = offset / elementSize;
    if (idx < 0 || idx >= v.arrayElements) return null;
    return `${v.name}[${idx}]`;
  }

  /**
   * Check if a byte address falls within the highlighted array element's range.
   * Returns the highlight color or null.
   */
  function getElementHighlightColor(address: number): string | null {
    if (!highlightedElement) return null;
    const v = variables.find((v) => v.name === highlightedElement!.arrayName);
    if (!v || !v.arrayElements) return null;
    const elementSize = C_TYPE_SIZES[v.type];
    const elemStart = v.address + highlightedElement.index * elementSize;
    const elemEnd = elemStart + elementSize;
    if (address >= elemStart && address < elemEnd) {
      return highlightedElement.color;
    }
    return null;
  }

  /**
   * Check if a byte address falls within the OOB highlighted range.
   * Returns true if it does.
   */
  function isOobAddress(address: number): boolean {
    if (!oobHighlight) return false;
    const v = variables.find((v) => v.name === oobHighlight!.arrayName);
    if (!v || !v.arrayElements) return false;
    const elementSize = C_TYPE_SIZES[v.type];
    const oobStart = v.address + oobHighlight.index * elementSize;
    const oobEnd = oobStart + elementSize;
    return address >= oobStart && address < oobEnd;
  }

  /** Format a single array element value for display. */
  function formatElementValue(value: number | null, type: CTypeName): string {
    if (value === null) return '???';
    if (type === 'char') {
      const ch = String.fromCharCode(value);
      return `'${ch}' (${value})`;
    }
    return String(value);
  }
</script>

{#if viewMode === 'bits'}
  <div
    class="cmv-container"
    style="
      --bit-cell-size: {values.cellSize}px;
      --bit-cell-font-size: {values.fontSize}px;
      --bit-cell-glow-duration: {values.glowDuration}ms;
      --cmv-cell-gap: {values.cellGap}px;
      --cmv-row-gap: {values.rowGap}px;
    "
  >
    <!-- Column labels -->
    <div class="cmv-header">
      <span class="header-label addr-label">Addr</span>
      <span class="header-label var-label">Var</span>
      <span class="header-label bits-label">Bits</span>
      <span class="header-label hex-label">Hex</span>
    </div>

    <!-- Scrollable byte rows -->
    <div
      class="cmv-scroll-area"
      bind:this={scrollAreaEl}
      style="max-height: {values.visibleRows * (values.cellSize + values.rowGap)}px;"
    >
      {#each collapsedDisplayRows as item (item.kind === 'row' ? item.row.address : item.kind === 'frame-divider' ? `divider-${item.address}` : `ellipsis-${item.startAddress}`)}
        {#if item.kind === 'frame-divider'}
          <div class="frame-divider">
            <span class="frame-label">{item.name}()</span>
          </div>
        {:else if item.kind === 'row'}
          {@const row = item.row}
          {@const elemLabel = row.variable ? getArrayElementLabel(row.variable, row.address) : null}
          {@const elemHlColor = getElementHighlightColor(row.address)}
          {@const isOob = isOobAddress(row.address)}
          <div
            class="byte-row"
            class:allocated={row.isAllocated}
            class:oob-row={isOob}
            use:registerRow={row.address}
          >
            <span class="address">{toHex(row.address, 4)}</span>

            <span
              class="annotation"
              style={row.variable ? `border-left-color: ${row.variable.color}; background: ${row.variable.color};` : ''}
            >
              {#if row.variable?.arrayElements && elemLabel}
                <span class="var-name">{elemLabel}</span>
              {:else if row.isFirstByte && row.variable}
                <span class="var-name">{row.variable.name}</span>
              {/if}
            </span>

            <span
              class="byte-data"
              class:read-highlight={row.variable !== null && highlightedVars.has(row.variable.name)}
              class:element-highlight={elemHlColor !== null}
              style:--rh-color={elemHlColor ?? (row.variable ? highlightedVars.get(row.variable.name) : undefined)}
            >
              <span class="bits">
                {#each Array(8) as _, bitIdx (bitIdx)}
                  {@const globalIdx = row.bitOffset + bitIdx}
                  {@const ptrColor = row.variable ? getPointerTargetColor(row.variable) : null}
                  <BitCell
                    bit={bits[globalIdx] ?? 0}
                    glowing={glowingCells.has(globalIdx)}
                    highlightColor={isOob
                      ? 'rgba(239, 68, 68, 0.35)'
                      : row.variable
                        ? (row.variable.value === null && !row.variable.arrayElements ? UNINITIALIZED_TINT : (ptrColor ?? row.variable.color))
                        : undefined}
                    dimmed={!row.isAllocated}
                    onglowend={() => handleGlowEnd(globalIdx)}
                  />
                {/each}
              </span>

              <span class="hex" class:dimmed={!row.isAllocated}>{getByteHex(row.bitOffset)}</span>
            </span>
          </div>
        {:else}
          <div class="ellipsis-row">
            <span class="ellipsis-text">··· {item.count} byte{item.count !== 1 ? 's' : ''} ···</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
{:else}
  <div class="cmv-table" style="--bit-cell-glow-duration: {values.glowDuration}ms;">
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Name</th>
          <th>Value</th>
          <th>Address</th>
        </tr>
      </thead>
      <tbody>
        {#each variables as v, vIdx (`${v.name}-${v.address}`)}
          {#if frameStack.some(f => f.varCountAtPush === vIdx && f.baseAddress < BASE_ADDRESS + TOTAL_BYTES)}
            {@const frame = frameStack.find(f => f.varCountAtPush === vIdx)}
            <tr class="frame-header">
              <td colspan="4">{frame?.name}()</td>
            </tr>
          {/if}
          {#if v.arrayElements && v.elementValues}
            <!-- Array variable: render one row per element -->
            {#each { length: v.arrayElements } as _, elIdx (elIdx)}
              {@const elementSize = C_TYPE_SIZES[v.type]}
              {@const elAddr = v.address + elIdx * elementSize}
              {@const elKey = `${v.name}[${elIdx}]`}
              {@const isElHighlighted = highlightedElement?.arrayName === v.name && highlightedElement.index === elIdx}
              {@const isElOob = oobHighlight?.arrayName === v.name && oobHighlight.index === elIdx}
              {@const trRhColor = isElHighlighted ? highlightedElement!.color : highlightedVars.get(v.name)}
              <tr
                class:read-highlight={!!trRhColor}
                class:element-highlight={isElHighlighted}
                class:oob-row={isElOob}
                style:--rh-color={trRhColor}
              >
                <td class="type">{elIdx === 0 ? formatTypeName(v) : ''}</td>
                <td class="name" style="color: {v.color.replace('0.35', '1')}">{elKey}</td>
                <td
                  class="value"
                  class:uninitialized={v.elementValues[elIdx] === null}
                  class:value-glow={glowingVarNames.has(elKey)}
                  onanimationend={() => handleTableGlowEnd(elKey)}
                >
                  {formatElementValue(v.elementValues[elIdx], v.type)}
                </td>
                <td class="addr">{toHex(elAddr, 4)}</td>
              </tr>
            {/each}
            <!-- OOB row if highlighting past the array end -->
            {#if oobHighlight?.arrayName === v.name && oobHighlight.index >= v.arrayElements}
              {@const elementSize = C_TYPE_SIZES[v.type]}
              {@const oobAddr = v.address + oobHighlight.index * elementSize}
              <tr class="oob-row">
                <td class="type"></td>
                <td class="name oob-name">{v.name}[{oobHighlight.index}]</td>
                <td class="value oob-value">OUT OF BOUNDS</td>
                <td class="addr">{toHex(oobAddr, 4)}</td>
              </tr>
            {/if}
          {:else}
            <!-- Regular (non-array) variable -->
            {@const trRhColor = highlightedVars.get(v.name)}
            <tr class:read-highlight={!!trRhColor} style:--rh-color={trRhColor}>
              <td class="type">{formatTypeName(v)}</td>
              <td class="name" style="color: {v.color.replace('0.35', '1')}">{v.name}</td>
              <td
                class="value"
                class:uninitialized={v.value === null}
                class:value-glow={glowingVarNames.has(v.name)}
                onanimationend={() => handleTableGlowEnd(v.name)}
              >
                {v.value !== null ? formatTableValue(v) : '???'}
              </td>
              <td class="addr">{toHex(v.address, 4)}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if variables.length > 0}
  <button class="view-toggle" onclick={() => setViewMode(viewMode === 'bits' ? 'table' : 'bits')}>
    {viewMode === 'bits' ? 'Show table' : 'Show bits'}
  </button>
{/if}

<WidgetDebugPanel widgetId={WIDGET_ID} defs={paramDefs} bind:values />

<style>
  .cmv-container {
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1;
  }

  /* Column labels */
  .cmv-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.35rem;
    margin-bottom: 0.25rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .header-label {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    opacity: 0.4;
    user-select: none;
  }

  .addr-label {
    width: 3.5em;
    text-align: right;
    flex-shrink: 0;
    font-size: 0.65rem;
  }

  .var-label {
    width: 3.5rem;
    text-align: center;
    flex-shrink: 0;
    font-size: 0.65rem;
  }

  .bits-label {
    flex: 0 0 calc(8 * var(--bit-cell-size, 16px) + 7 * var(--cmv-cell-gap, 2px));
    text-align: center;
    font-size: 0.65rem;
  }

  .hex-label {
    width: 2.5em;
    flex-shrink: 0;
    font-size: 0.65rem;
  }

  /* Scrollable area */
  .cmv-scroll-area {
    display: flex;
    flex-direction: column;
    gap: var(--cmv-row-gap, 4px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  .byte-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .address {
    color: var(--color-text-muted);
    font-size: 0.65rem;
    width: 3.5em;
    text-align: right;
    flex-shrink: 0;
  }

  .annotation {
    width: 3.5rem;
    min-height: var(--bit-cell-size, 16px);
    display: flex;
    align-items: center;
    justify-content: center;
    border-left: 3px solid transparent;
    font-size: 0.6rem;
    flex-shrink: 0;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .var-name {
    color: var(--color-text);
    font-weight: 600;
  }

  .byte-data {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .bits {
    display: flex;
    gap: var(--cmv-cell-gap, 2px);
  }

  .hex {
    color: var(--color-text-muted);
    font-size: 0.65rem;
    width: 2.5em;
    flex-shrink: 0;
  }

  .hex.dimmed {
    opacity: 0.35;
  }

  /* Ellipsis row for collapsed regions */
  .ellipsis-row {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 0;
  }

  .ellipsis-text {
    font-size: 0.5rem;
    color: var(--color-text-muted);
    opacity: 0.3;
    font-style: italic;
    user-select: none;
  }

  /* Frame divider bar between stack frames */
  .frame-divider {
    display: flex;
    align-items: center;
    padding: 2px 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.04);
    animation: divider-slide-in 200ms ease-out;
  }

  .frame-label {
    font-size: 0.55rem;
    color: var(--color-text-muted);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    user-select: none;
  }

  @keyframes divider-slide-in {
    from { opacity: 0; transform: translateY(-4px); }
  }

  /* Table view frame section header */
  .cmv-table tr.frame-header td {
    font-size: 0.6rem;
    color: var(--color-text-muted);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.5rem 0.75rem 0.2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    font-weight: 500;
  }

  /* Sustained read-highlight: visible while the "read" step is active.
     Scoped to .byte-data (bits + hex) so it doesn't extend to address/annotation. */
  .byte-data.read-highlight {
    outline: 1.5px solid var(--rh-color, rgba(99, 102, 241, 0.5));
    outline-offset: -1px;
    border-radius: 3px;
    background: var(--rh-color, rgba(99, 102, 241, 0.10));
  }

  /* Simplified table view */
  .cmv-table {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .cmv-table table {
    border-collapse: collapse;
    width: 100%;
  }

  .cmv-table th,
  .cmv-table td {
    padding: 0.35rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--color-border, rgba(255,255,255,0.1));
  }

  .cmv-table th {
    color: var(--color-text-muted);
    font-weight: 500;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .cmv-table .type {
    color: var(--color-text-muted);
  }

  .cmv-table .name {
    font-weight: 600;
  }

  .cmv-table .value {
    color: var(--color-text);
  }

  /* Table row fade-in when new variable is declared */
  .cmv-table tbody tr {
    animation: table-row-in 300ms ease-out;
  }

  @keyframes table-row-in {
    from { opacity: 0; transform: translateY(-4px); }
  }

  /* Table read highlight — uses variable-specific color */
  .cmv-table tr.read-highlight {
    background: var(--rh-color, rgba(99, 102, 241, 0.10));
  }

  /* Table uninitialized value — red tint matching bits view */
  .cmv-table .value.uninitialized {
    color: rgba(239, 68, 68, 0.7);
  }

  /* Table assign glow — value cell pulses on assignment */
  .cmv-table .value.value-glow {
    animation: table-value-glow var(--bit-cell-glow-duration, 400ms) ease-out;
  }

  @keyframes table-value-glow {
    0% { color: var(--color-accent, #6366f1); text-shadow: 0 0 6px var(--color-accent, #6366f1); }
    100% { color: var(--color-text); text-shadow: none; }
  }

  .cmv-table .addr {
    color: var(--color-text-muted);
    font-size: 0.7rem;
  }

  /* Toggle button */
  .view-toggle {
    margin-top: 0.75rem;
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border, rgba(255,255,255,0.15));
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .view-toggle:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  /* Array element highlight in bits view */
  .byte-data.element-highlight {
    outline: 1.5px solid var(--rh-color, rgba(99, 102, 241, 0.5));
    outline-offset: -1px;
    border-radius: 3px;
    background: var(--rh-color, rgba(99, 102, 241, 0.10));
  }

  /* Array element highlight in table view */
  .cmv-table tr.element-highlight {
    background: var(--rh-color, rgba(99, 102, 241, 0.10));
  }

  /* OOB (out-of-bounds) row styling — bits and table views */
  .byte-row.oob-row {
    background: rgba(239, 68, 68, 0.08);
  }

  .cmv-table tr.oob-row {
    background: rgba(239, 68, 68, 0.12);
  }

  .cmv-table .oob-name {
    color: rgba(239, 68, 68, 0.9);
  }

  .cmv-table .oob-value {
    color: rgba(239, 68, 68, 0.8);
    font-weight: 600;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }

</style>
