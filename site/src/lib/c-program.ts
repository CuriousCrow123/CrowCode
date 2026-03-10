/**
 * C program data model and byte utilities for CMemoryView.
 *
 * Pure TypeScript — no Svelte, no DOM. Defines the instruction model,
 * runtime variable state, and byte encoding/generation functions.
 */

// --- Type system ---

export type CTypeName = 'char' | 'int' | 'float' | 'double';

export const C_TYPE_SIZES: Record<CTypeName, number> = {
  char: 1,
  int: 4,
  float: 4,
  double: 8,
};

/** Color palette for variable annotations (cycled by variable index). */
export const VAR_COLORS: string[] = [
  'rgba(99, 102, 241, 0.35)', // indigo
  'rgba(34, 197, 94, 0.35)', // green
  'rgba(249, 115, 22, 0.35)', // orange
  'rgba(236, 72, 153, 0.35)', // pink
  'rgba(234, 179, 8, 0.35)', // yellow
];

// --- Instruction model ---

export type CInstruction =
  | { kind: 'declare'; code: string; varName: string; type: CTypeName }
  | { kind: 'assign'; code: string; varName: string; value: number }
  | { kind: 'declare-assign'; code: string; varName: string; type: CTypeName; value: number }
  | {
      kind: 'eval-assign';
      code: string;
      target: { name: string; type?: CTypeName };
      sources: string[];
      value: number;
    };

// --- Runtime state ---

export interface CVariable {
  name: string;
  type: CTypeName;
  address: number; // byte offset in memory region
  size: number; // C_TYPE_SIZES[type]
  color: string; // annotation overlay color
  value: number | null; // null = uninitialized (garbage displayed)
}

// --- Byte encoding ---

/** Convert a value to big-endian byte array for a given type. */
export function valueToBytes(value: number, type: CTypeName): number[] {
  if (type === 'char') {
    return [value & 0xff];
  }

  if (type === 'int') {
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  }

  // float and double: use DataView for IEEE 754 encoding
  const buf = new ArrayBuffer(type === 'float' ? 4 : 8);
  const view = new DataView(buf);
  if (type === 'float') {
    view.setFloat32(0, value, false); // big-endian
  } else {
    view.setFloat64(0, value, false); // big-endian
  }
  return Array.from(new Uint8Array(buf));
}

/**
 * Generate deterministic "garbage" bytes for uninitialized memory.
 * Same seed + address always produces the same bytes across replays.
 */
export function garbageBytes(address: number, count: number, seed: number): number[] {
  let state = (seed * 2654435761 + address * 2246822519) >>> 0;
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) {
    // Simple xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0; // keep as uint32
    bytes.push(state & 0xff);
  }
  return bytes;
}
