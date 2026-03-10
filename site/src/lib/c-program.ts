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

// --- Sub-step decomposition ---

export type CSubStepKind = 'declare' | 'read' | 'compute' | 'assign';

export interface CSubStep {
  kind: CSubStepKind;
  /** Substring of the instruction's `code` to highlight (found via indexOf) */
  highlight: string;
  /** Human-readable status label */
  label: string;
  /** Action to perform on the memory view, or null for compute (no memory change) */
  action:
    | { kind: 'declareVar'; typeName: CTypeName; varName: string }
    | { kind: 'assignVar'; varName: string; value: number }
    | { kind: 'highlightVar'; varName: string }
    | null;
}

/**
 * Decompose a C instruction into ordered sub-steps for visual stepping.
 *
 * Each sub-step maps to one visual beat: a code highlight, a status label,
 * and optionally a CMemoryView imperative call.
 *
 * @param getVarValue Optional callback to read current variable values for
 *   labels (e.g., "Read x → 10"). When omitted, labels show without values.
 *   The highlight substring must appear exactly once in instr.code.
 */
export function decomposeInstruction(
  instr: CInstruction,
  getVarValue?: (name: string) => number | null,
): CSubStep[] {
  switch (instr.kind) {
    case 'declare':
      return [{
        kind: 'declare',
        highlight: `${instr.type} ${instr.varName}`,
        label: `Declare ${instr.varName} (${C_TYPE_SIZES[instr.type]} byte${C_TYPE_SIZES[instr.type] !== 1 ? 's' : ''}, uninitialized)`,
        action: { kind: 'declareVar', typeName: instr.type, varName: instr.varName },
      }];

    case 'assign': {
      const assignExpr = instr.code.replace(';', '').trim();
      return [{
        kind: 'assign',
        highlight: assignExpr,
        label: `Assign ${assignExpr}`,
        action: { kind: 'assignVar', varName: instr.varName, value: instr.value },
      }];
    }

    case 'declare-assign': {
      // Extract the RHS of the assignment for the highlight (e.g., "'A'" from "char c = 'A';")
      const rhs = instr.code.slice(instr.code.indexOf('=') + 1).replace(';', '').trim();
      return [
        {
          kind: 'declare',
          highlight: `${instr.type} ${instr.varName}`,
          label: `Declare ${instr.varName} (${C_TYPE_SIZES[instr.type]} byte${C_TYPE_SIZES[instr.type] !== 1 ? 's' : ''}, uninitialized)`,
          action: { kind: 'declareVar', typeName: instr.type, varName: instr.varName },
        },
        {
          kind: 'assign',
          highlight: `${instr.varName} = ${rhs}`,
          label: `Assign ${instr.varName} = ${instr.value}`,
          action: { kind: 'assignVar', varName: instr.varName, value: instr.value },
        },
      ];
    }

    case 'eval-assign': {
      const steps: CSubStep[] = [];

      // Declare target if it has a type (new variable)
      if (instr.target.type) {
        steps.push({
          kind: 'declare',
          highlight: `${instr.target.type} ${instr.target.name}`,
          label: `Declare ${instr.target.name} (${C_TYPE_SIZES[instr.target.type]} byte${C_TYPE_SIZES[instr.target.type] !== 1 ? 's' : ''}, uninitialized)`,
          action: { kind: 'declareVar', typeName: instr.target.type, varName: instr.target.name },
        });
      }

      // Read each source variable
      for (const src of instr.sources) {
        const val = getVarValue?.(src);
        steps.push({
          kind: 'read',
          highlight: src,
          label: val != null ? `Read ${src} → ${val}` : `Read ${src}`,
          action: { kind: 'highlightVar', varName: src },
        });
      }

      // Compute expression
      const exprParts = instr.code.slice(instr.code.indexOf('=') + 1).replace(';', '').trim();
      // Build a substituted expression like "10 + 32 = 42"
      let substituted = exprParts;
      let allKnown = true;
      for (const src of instr.sources) {
        const val = getVarValue?.(src);
        if (val != null) {
          substituted = substituted.replace(src, String(val));
        } else {
          allKnown = false;
        }
      }
      steps.push({
        kind: 'compute',
        highlight: exprParts,
        label: allKnown ? `${substituted} = ${instr.value}` : `Compute ${exprParts}`,
        action: null,
      });

      // Assign result
      steps.push({
        kind: 'assign',
        highlight: `${instr.target.name} = ${exprParts}`,
        label: `Assign ${instr.target.name} = ${instr.value}`,
        action: { kind: 'assignVar', varName: instr.target.name, value: instr.value },
      });

      return steps;
    }
  }
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
