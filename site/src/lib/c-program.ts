/**
 * C program data model and byte utilities for CMemoryView.
 *
 * Pure TypeScript — no Svelte, no DOM. Defines the instruction model,
 * runtime variable state, and byte encoding/generation functions.
 */

// --- Type system ---

export type CTypeName = 'char' | 'int' | 'float' | 'double' | 'pointer';

export const C_TYPE_SIZES: Record<CTypeName, number> = {
  char: 1,
  int: 4,
  float: 4,
  double: 8,
  pointer: 4, // 32-bit model; parameterizable via CMemoryView
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
  | { kind: 'declare'; code: string; varName: string; type: CTypeName; targetType?: CTypeName }
  | { kind: 'assign'; code: string; varName: string; value: number }
  | { kind: 'declare-assign'; code: string; varName: string; type: CTypeName; value: number }
  | {
      kind: 'eval-assign';
      code: string;
      target: { name: string; type?: CTypeName };
      sources: string[];
      value: number;
    }
  | { kind: 'printf'; code: string; format: string; sources: string[] }
  | { kind: 'scanf'; code: string; format: string; targets: string[]; inputValues: number[]; inputBuffer: string; userInput?: string }
  | { kind: 'declare-pointer-assign'; code: string; varName: string; targetType: CTypeName; targetName: string }
  | { kind: 'pointer-assign'; code: string; ptrName: string; targetName: string }
  | { kind: 'deref-write'; code: string; ptrName: string; targetName: string; value: number }
  | { kind: 'deref-read-assign'; code: string; varName: string; type: CTypeName; ptrName: string; targetName: string }
  | { kind: 'address-of'; code: string; varName: string }
  | { kind: 'comment'; code: string; label: string }
  | {
      kind: 'declare-array';
      code: string;
      varName: string;
      elementType: CTypeName;
      values: number[];
    }
  | {
      kind: 'array-index-read';
      code: string;
      varName: string;
      type: CTypeName;
      arrayName: string;
      index: number;
    }
  | {
      kind: 'pointer-arith-deref';
      code: string;
      varName: string;
      type: CTypeName;
      ptrName: string;
      offset: number;
      arrayName: string;
      elementType: CTypeName;
    }
  | {
      kind: 'call';
      code: string;
      functionName: string;
      args: CallArg[];
      returnTarget?: { name: string; type: CTypeName };
      sourceLine: number;
    }
  | {
      kind: 'return';
      code: string;
      valueSource?: string;       // variable to read return value from (callee scope)
      returnValue?: number;       // pre-computed return value
      returnToVar?: string;       // caller's variable to assign to
      returnToType?: CTypeName;   // type of caller's variable
      returnSourceLine?: number;  // caller's source line for assign-return highlight
      sourceLine: number;
    };

// --- Runtime state ---

export interface CVariable {
  name: string;
  type: CTypeName;
  targetType?: CTypeName; // for pointer variables: what they point to
  address: number; // byte offset in memory region
  size: number; // C_TYPE_SIZES[type]
  color: string; // annotation overlay color
  value: number | null; // null = uninitialized (garbage displayed)
  arrayElements?: number; // number of elements (only set for arrays)
  elementValues?: (number | null)[]; // per-element values for table view
}

// --- Function call support ---

export interface CallArg {
  paramName: string;
  paramType: CTypeName;
  argSource?: string;   // variable to read from caller scope (null for literals)
  argValue?: number;    // pre-computed value (required when argSource is null)
}

// --- Sub-step decomposition ---

export type CSubStepKind = 'declare' | 'read' | 'compute' | 'assign'
  | 'printf-literal' | 'printf-placeholder'
  | 'scanf-address' | 'scanf-consume' | 'scanf-skip'
  | 'deref-read' | 'deref-write' | 'pointer-assign'
  | 'push-frame' | 'copy-arg' | 'pop-frame' | 'assign-return';

export interface CSubStep {
  kind: CSubStepKind;
  /** Substring of the instruction's `code` to highlight (found via indexOf) */
  highlight: string;
  /** Human-readable status label */
  label: string;
  /** Pre-computed character offset for highlight positioning (skips indexOf if set) */
  highlightOffset?: number;
  /** Override source line for CodePanel highlight (used by assign-return to jump to caller's line) */
  sourceLine?: number;
  /** Action to perform on the memory view, or null for compute (no memory change) */
  action:
    | { kind: 'declareVar'; typeName: CTypeName; varName: string; targetType?: CTypeName }
    | { kind: 'assignVar'; varName: string; value: number }
    | { kind: 'highlightVar'; varName: string }
    | { kind: 'appendStdout'; text: string; raw?: string }
    | { kind: 'scanfRead'; varName: string; value: number; specifier: '%d' | '%c'; chars: number }
    | { kind: 'scanfSkip'; chars: number }
    | { kind: 'declareArray'; elementType: CTypeName; varName: string; count: number }
    | { kind: 'assignArrayElement'; arrayName: string; index: number; value: number }
    | { kind: 'highlightArrayElement'; arrayName: string; index: number }
    | { kind: 'pushFrame'; name: string }
    | { kind: 'popFrame' }
    | null;
}

// --- Format string parser ---

export type FormatSegment =
  | { kind: 'literal'; text: string }
  | { kind: 'specifier'; spec: '%d' | '%c' | '%f' | '%s' | '%%'; argIndex: number }
  | { kind: 'escape'; raw: string; rendered: string };

/**
 * Parse a C format string into typed segments for per-placeholder stepping.
 *
 * Scans left-to-right, splitting into literal text, format specifiers (%d, %c, %f),
 * and escape sequences (\n, \t). Unknown specifiers and trailing special chars
 * are emitted as literals (defense-in-depth).
 */
export function parseFormatString(format: string): FormatSegment[] {
  const segments: FormatSegment[] = [];
  let i = 0;
  let literalBuf = '';
  let argIndex = 0;

  const flushLiteral = () => {
    if (literalBuf.length > 0) {
      segments.push({ kind: 'literal', text: literalBuf });
      literalBuf = '';
    }
  };

  while (i < format.length) {
    const ch = format[i];

    if (ch === '%' && i + 1 < format.length) {
      const next = format[i + 1];
      if (next === 'd' || next === 'c' || next === 'f') {
        flushLiteral();
        segments.push({ kind: 'specifier', spec: `%${next}` as '%d' | '%c' | '%f', argIndex });
        argIndex++;
        i += 2;
        continue;
      }
      if (next === '%') {
        // %% → literal %
        literalBuf += '%';
        i += 2;
        continue;
      }
      // Unknown specifier: emit as literal
      literalBuf += ch;
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < format.length) {
      const next = format[i + 1];
      const escapeMap: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '0': '\0' };
      if (next in escapeMap) {
        flushLiteral();
        segments.push({ kind: 'escape', raw: `\\${next}`, rendered: escapeMap[next] });
        i += 2;
        continue;
      }
      // Unknown escape: emit backslash as literal
      literalBuf += ch;
      i++;
      continue;
    }

    literalBuf += ch;
    i++;
  }

  flushLiteral();
  return segments;
}

/** Format a numeric value according to a printf specifier. */
export function formatValue(value: number, spec: '%d' | '%c' | '%f' | '%s' | '%%'): string {
  switch (spec) {
    case '%d': return String(Math.trunc(value));
    case '%c': return String.fromCharCode(value);
    case '%f': return value.toFixed(6);
    default: return String(value);
  }
}

/** Count the total sub-steps an instruction produces (without needing runtime state). */
export function countSubSteps(instr: CInstruction): number {
  switch (instr.kind) {
    case 'declare': return 1;
    case 'assign': return 1;
    case 'declare-assign': return 2;
    case 'eval-assign': {
      const expr = instr.code.slice(instr.code.indexOf('=') + 1).replace(';', '').trim();
      const isSimpleCopy = instr.sources.length === 1 && expr === instr.sources[0];
      return (instr.target.type ? 1 : 0) + instr.sources.length + (isSimpleCopy ? 0 : 1) + 1;
    }
    case 'printf': return parseFormatString(instr.format).length;
    case 'scanf': {
      const segments = parseFormatString(instr.format);
      let count = 0;
      for (const seg of segments) {
        if (seg.kind === 'literal' && /^\s+$/.test(seg.text)) {
          count += 1; // scanf-skip
        } else if (seg.kind === 'specifier') {
          count += 2; // scanf-address + scanf-consume
        }
        // other literals (non-whitespace) are skipped silently
      }
      return count;
    }
    case 'declare-pointer-assign': return 3; // declare + read(&) + pointer-assign
    case 'pointer-assign': return 2;          // read(&) + pointer-assign
    case 'deref-write': return 2;             // deref-read + deref-write
    case 'deref-read-assign': return 3;       // declare + deref-read + assign
    case 'address-of': return 1;                // standalone &x expression
    case 'comment': return 1;                  // single pause step
    case 'declare-array': return 1 + instr.values.length; // 1 declare + N element assignments
    case 'array-index-read': return 3;         // declare + read/highlight + assign
    case 'pointer-arith-deref': return 4;      // declare + compute + read/highlight + assign
    case 'call': {
      const reads = instr.args.filter(a => a.argSource).length;
      return reads + 1 + 2 * instr.args.length; // reads + push-frame + (declare + assign) per arg
    }
    case 'return':
      return (instr.valueSource ? 1 : 0) + 1 + (instr.returnToVar ? 1 : 0); // read? + pop-frame + assign-return?
  }
}

export interface DecomposeOptions {
  getVarValue?: (name: string) => number | null;
  getVarColor?: (name: string) => string | null;
  getVarAddress?: (name: string) => string | null;
}

/**
 * Decompose a C instruction into ordered sub-steps for visual stepping.
 *
 * Each sub-step maps to one visual beat: a code highlight, a status label,
 * and optionally a CMemoryView imperative call.
 */
export function decomposeInstruction(
  instr: CInstruction,
  options?: DecomposeOptions,
): CSubStep[] {
  const getVarValue = options?.getVarValue;
  const getVarColor = options?.getVarColor;
  const getVarAddress = options?.getVarAddress;
  switch (instr.kind) {
    case 'declare': {
      const isPointer = instr.type === 'pointer';
      const typeLabel = isPointer ? `pointer-to-${instr.targetType ?? 'int'}` : instr.type;
      const sizeBytes = C_TYPE_SIZES[instr.type];
      return [{
        kind: 'declare',
        highlight: instr.code.replace(';', '').trim(),
        label: `Declare ${typeLabel} ${instr.varName} (${sizeBytes} byte${sizeBytes !== 1 ? 's' : ''})`,
        action: {
          kind: 'declareVar',
          typeName: instr.type,
          varName: instr.varName,
          ...(isPointer && instr.targetType ? { targetType: instr.targetType } : {}),
        },
      }];
    }

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

      // Compute expression (skip for simple variable-to-variable copies like "a = b")
      const exprParts = instr.code.slice(instr.code.indexOf('=') + 1).replace(';', '').trim();
      const isSimpleCopy = instr.sources.length === 1 && exprParts === instr.sources[0];
      if (!isSimpleCopy) {
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
      }

      // Assign result
      steps.push({
        kind: 'assign',
        highlight: `${instr.target.name} = ${exprParts}`,
        label: `Assign ${instr.target.name} = ${instr.value}`,
        action: { kind: 'assignVar', varName: instr.target.name, value: instr.value },
      });

      return steps;
    }

    case 'printf': {
      const steps: CSubStep[] = [];
      const segments = parseFormatString(instr.format);

      // Find where the format string starts in the code (after the opening quote)
      const fmtStart = instr.code.indexOf('"') + 1;

      // Walk format string to compute source-code offsets for each segment
      let fmtOffset = 0; // offset within the format string content
      let sourceIdx = 0; // index into instr.sources

      for (const seg of segments) {
        if (seg.kind === 'literal') {
          steps.push({
            kind: 'printf-literal',
            highlight: seg.text,
            highlightOffset: fmtStart + fmtOffset,
            label: `Output "${seg.text}"`,
            action: { kind: 'appendStdout', text: seg.text },
          });
          fmtOffset += seg.text.length;
        } else if (seg.kind === 'escape') {
          steps.push({
            kind: 'printf-literal',
            highlight: seg.raw,
            highlightOffset: fmtStart + fmtOffset,
            label: `Output ${seg.raw}`,
            action: { kind: 'appendStdout', text: seg.rendered, raw: seg.raw },
          });
          fmtOffset += seg.raw.length; // \n is 2 chars in source
        } else {
          // specifier
          const varName = instr.sources[sourceIdx];
          const val = getVarValue?.(varName);
          const formatted = val != null ? formatValue(val, seg.spec) : '?';

          steps.push({
            kind: 'printf-placeholder',
            highlight: seg.spec,
            highlightOffset: fmtStart + fmtOffset,
            label: val != null ? `${seg.spec} → ${varName} → ${formatted}` : `${seg.spec} → ${varName}`,
            action: { kind: 'appendStdout', text: formatted },
          });
          fmtOffset += seg.spec.length; // %d is 2 chars in source
          sourceIdx++;
        }
      }

      return steps;
    }

    case 'scanf': {
      const steps: CSubStep[] = [];
      const segments = parseFormatString(instr.format);

      // Pre-compute char counts by walking the input buffer
      let bufferPos = 0;
      let targetIndex = 0;

      // Find where the format string starts in code (after the opening quote)
      const fmtStart = instr.code.indexOf('"') + 1;
      let fmtOffset = 0;

      for (const seg of segments) {
        if (seg.kind === 'literal' && /^\s+$/.test(seg.text)) {
          // Whitespace in format string → scanf-skip
          const skipChars = countWhitespace(instr.inputBuffer, bufferPos);
          steps.push({
            kind: 'scanf-skip',
            highlight: seg.text,
            highlightOffset: fmtStart + fmtOffset,
            label: 'Skip whitespace',
            action: { kind: 'scanfSkip', chars: skipChars },
          });
          bufferPos += skipChars;
          fmtOffset += seg.text.length;
        } else if (seg.kind === 'specifier') {
          const name = instr.targets[targetIndex];
          const value = instr.inputValues[targetIndex];
          const address = getVarAddress?.(name);

          // 1. scanf-address sub-step
          const ampTarget = '&' + name;
          const ampOffset = instr.code.indexOf(ampTarget);
          steps.push({
            kind: 'scanf-address',
            highlight: ampTarget,
            highlightOffset: ampOffset >= 0 ? ampOffset : undefined,
            label: address ? `&${name} → ${address}` : `&${name}`,
            action: { kind: 'highlightVar', varName: name },
          });

          // 2. scanf-consume sub-step
          let chars: number;
          if (seg.spec === '%c') {
            chars = 1;
          } else {
            // %d: count consecutive digits
            chars = countDigits(instr.inputBuffer, bufferPos);
          }

          const valueLabel = formatScanfValue(value, seg.spec as '%d' | '%c');
          steps.push({
            kind: 'scanf-consume',
            highlight: seg.spec,
            highlightOffset: fmtStart + fmtOffset,
            label: valueLabel,
            action: { kind: 'scanfRead', varName: name, value, specifier: seg.spec as '%d' | '%c', chars },
          });

          bufferPos += chars;
          targetIndex++;
          fmtOffset += seg.spec.length;
        } else {
          // Non-whitespace literal or escape — advance fmtOffset only
          if (seg.kind === 'literal') fmtOffset += seg.text.length;
          else if (seg.kind === 'escape') fmtOffset += seg.raw.length;
        }
      }

      return steps;
    }

    case 'declare-pointer-assign': {
      // e.g. "int *p = &x;" → declare + read(&) + pointer-assign
      const addrHex = getVarAddress?.(instr.targetName);
      const addrNum = addrHex ? parseInt(addrHex, 16) : 0;
      const sizeBytes = C_TYPE_SIZES['pointer'];

      return [
        {
          kind: 'declare',
          highlight: instr.code.replace(';', '').trim(),
          label: `Declare pointer-to-${instr.targetType} ${instr.varName} (${sizeBytes} bytes)`,
          action: { kind: 'declareVar', typeName: 'pointer', varName: instr.varName, targetType: instr.targetType },
        },
        {
          kind: 'read',
          highlight: `&${instr.targetName}`,
          label: addrHex ? `&${instr.targetName} → ${addrHex}` : `&${instr.targetName}`,
          action: { kind: 'highlightVar', varName: instr.targetName },
        },
        {
          kind: 'pointer-assign',
          highlight: `= &${instr.targetName}`,
          label: addrHex ? `Store ${addrHex} in ${instr.varName}` : `Store address in ${instr.varName}`,
          action: { kind: 'assignVar', varName: instr.varName, value: addrNum },
        },
      ];
    }

    case 'pointer-assign': {
      // e.g. "p = &x;" → read(&) + pointer-assign
      const addrHex = getVarAddress?.(instr.targetName);
      const addrNum = addrHex ? parseInt(addrHex, 16) : 0;

      return [
        {
          kind: 'read',
          highlight: `&${instr.targetName}`,
          label: addrHex ? `&${instr.targetName} → ${addrHex}` : `&${instr.targetName}`,
          action: { kind: 'highlightVar', varName: instr.targetName },
        },
        {
          kind: 'pointer-assign',
          highlight: instr.code.replace(';', '').trim(),
          label: addrHex ? `Store ${addrHex} in ${instr.ptrName}` : `Store address in ${instr.ptrName}`,
          action: { kind: 'assignVar', varName: instr.ptrName, value: addrNum },
        },
      ];
    }

    case 'deref-write': {
      // e.g. "*p = 42;" → deref-read (follow pointer) + deref-write (write value)
      const addrHex = getVarAddress?.(instr.targetName);

      return [
        {
          kind: 'deref-read',
          highlight: `*${instr.ptrName}`,
          label: addrHex
            ? `* go to address in ${instr.ptrName} → ${addrHex}`
            : `* dereference ${instr.ptrName}`,
          action: { kind: 'highlightVar', varName: instr.targetName },
        },
        {
          kind: 'deref-write',
          highlight: instr.code.replace(';', '').trim(),
          label: addrHex
            ? `place: write ${instr.value} to ${addrHex}`
            : `place: write ${instr.value}`,
          action: { kind: 'assignVar', varName: instr.targetName, value: instr.value },
        },
      ];
    }

    case 'deref-read-assign': {
      // e.g. "int y = *p;" → declare + deref-read + assign
      const addrHex = getVarAddress?.(instr.targetName);
      const targetValue = getVarValue?.(instr.targetName);
      const sizeBytes = C_TYPE_SIZES[instr.type];

      return [
        {
          kind: 'declare',
          highlight: `${instr.type} ${instr.varName}`,
          label: `Declare ${instr.type} ${instr.varName} (${sizeBytes} byte${sizeBytes !== 1 ? 's' : ''})`,
          action: { kind: 'declareVar', typeName: instr.type, varName: instr.varName },
        },
        {
          kind: 'deref-read',
          highlight: `*${instr.ptrName}`,
          label: addrHex
            ? `* go to address in ${instr.ptrName} → read ${targetValue ?? '?'} from ${addrHex}`
            : `* dereference ${instr.ptrName}`,
          action: { kind: 'highlightVar', varName: instr.targetName },
        },
        {
          kind: 'assign',
          highlight: `${instr.varName} = *${instr.ptrName}`,
          label: `value: ${instr.varName} = ${targetValue ?? '?'}`,
          action: { kind: 'assignVar', varName: instr.varName, value: targetValue ?? 0 },
        },
      ];
    }

    case 'address-of': {
      // Standalone &x expression — highlight variable, show its address
      const address = getVarAddress?.(instr.varName);
      return [{
        kind: 'read',
        highlight: instr.code.replace(';', '').trim(),
        label: address ? `&${instr.varName} → ${address}` : `&${instr.varName}`,
        action: { kind: 'highlightVar', varName: instr.varName },
      }];
    }

    case 'comment': {
      // Pause step — no action, just a status label
      return [{
        kind: 'compute',
        highlight: instr.code,
        label: instr.label,
        action: null,
      }];
    }

    case 'declare-array': {
      const steps: CSubStep[] = [];
      // Step 1: declare the array
      steps.push({
        kind: 'declare',
        highlight: instr.code.replace(';', '').trim(),
        label: `Declare ${instr.elementType} ${instr.varName}[${instr.values.length}] (${instr.values.length * C_TYPE_SIZES[instr.elementType]} bytes)`,
        action: { kind: 'declareArray', elementType: instr.elementType, varName: instr.varName, count: instr.values.length },
      });
      // Steps 2..N+1: assign each element
      for (let i = 0; i < instr.values.length; i++) {
        steps.push({
          kind: 'assign',
          highlight: String(instr.values[i]),
          label: `${instr.varName}[${i}] = ${instr.values[i]}`,
          action: { kind: 'assignArrayElement', arrayName: instr.varName, index: i, value: instr.values[i] },
        });
      }
      return steps;
    }

    case 'array-index-read': {
      return [
        {
          kind: 'declare',
          highlight: `${instr.type} ${instr.varName}`,
          label: `Declare ${instr.type} ${instr.varName} (${C_TYPE_SIZES[instr.type]} byte${C_TYPE_SIZES[instr.type] !== 1 ? 's' : ''})`,
          action: { kind: 'declareVar', typeName: instr.type, varName: instr.varName },
        },
        {
          kind: 'read',
          highlight: `${instr.arrayName}[${instr.index}]`,
          label: `Read ${instr.arrayName}[${instr.index}]`,
          action: { kind: 'highlightArrayElement', arrayName: instr.arrayName, index: instr.index },
        },
        {
          kind: 'assign',
          highlight: `${instr.varName} = ${instr.arrayName}[${instr.index}]`,
          label: `Assign ${instr.varName} = ${instr.arrayName}[${instr.index}]`,
          action: { kind: 'assignVar', varName: instr.varName, value: 0 }, // value resolved at execute time by orchestrator
        },
      ];
    }

    case 'pointer-arith-deref': {
      return [
        {
          kind: 'declare',
          highlight: `${instr.type} ${instr.varName}`,
          label: `Declare ${instr.type} ${instr.varName} (${C_TYPE_SIZES[instr.type]} byte${C_TYPE_SIZES[instr.type] !== 1 ? 's' : ''})`,
          action: { kind: 'declareVar', typeName: instr.type, varName: instr.varName },
        },
        {
          kind: 'compute',
          highlight: instr.offset === 0 ? `*${instr.ptrName}` : `*(${instr.ptrName} + ${instr.offset})`,
          label: instr.offset === 0
            ? `Dereference ${instr.ptrName}`
            : `Compute ${instr.ptrName} + ${instr.offset} * sizeof(${instr.elementType})`,
          action: null, // orchestrator handles arrow slide + math display
        },
        {
          kind: 'read',
          highlight: instr.offset === 0 ? `*${instr.ptrName}` : `*(${instr.ptrName} + ${instr.offset})`,
          label: `Read from ${instr.arrayName}`,
          action: { kind: 'highlightArrayElement', arrayName: instr.arrayName, index: 0 }, // index resolved at execute time
        },
        {
          kind: 'assign',
          highlight: `${instr.varName} = ${instr.offset === 0 ? `*${instr.ptrName}` : `*(${instr.ptrName} + ${instr.offset})`}`,
          label: `Assign ${instr.varName}`,
          action: { kind: 'assignVar', varName: instr.varName, value: 0 }, // value resolved at execute time
        },
      ];
    }

    case 'call': {
      const steps: CSubStep[] = [];

      // Pre-compute highlight offsets for args (walk sequentially to avoid indexOf collisions)
      let argOffset = instr.code.indexOf('(') + 1;

      // 1. Read each arg source from caller scope
      for (const arg of instr.args) {
        if (arg.argSource) {
          const val = getVarValue?.(arg.argSource);
          const argStart = instr.code.indexOf(arg.argSource, argOffset);
          steps.push({
            kind: 'read',
            highlight: arg.argSource,
            highlightOffset: argStart >= 0 ? argStart : undefined,
            label: val != null ? `Read ${arg.argSource} → ${val}` : `Read ${arg.argSource}`,
            action: { kind: 'highlightVar', varName: arg.argSource },
          });
          if (argStart >= 0) argOffset = argStart + arg.argSource.length;
        }
      }

      // 2. Push frame
      const callExpr = `${instr.functionName}(`;
      const callStart = instr.code.indexOf(callExpr);
      steps.push({
        kind: 'push-frame',
        highlight: instr.code.slice(callStart >= 0 ? callStart : 0).replace(';', '').replace(/^\s*\w+\s+\w+\s*=\s*/, '').trim(),
        highlightOffset: callStart >= 0 ? callStart : undefined,
        label: `Call ${instr.functionName}()`,
        action: { kind: 'pushFrame', name: instr.functionName },
      });

      // 3. Copy args into callee scope (interleaved declare + assign)
      for (const arg of instr.args) {
        const sizeBytes = C_TYPE_SIZES[arg.paramType];
        const value = arg.argValue ?? (arg.argSource ? getVarValue?.(arg.argSource) ?? 0 : 0);

        steps.push({
          kind: 'copy-arg',
          highlight: arg.paramName,
          label: `Declare ${arg.paramType} ${arg.paramName} (${sizeBytes} byte${sizeBytes !== 1 ? 's' : ''})`,
          action: { kind: 'declareVar', typeName: arg.paramType, varName: arg.paramName },
        });
        steps.push({
          kind: 'copy-arg',
          highlight: arg.paramName,
          label: arg.argSource
            ? `Copy ${arg.argSource} → ${arg.paramName} = ${value}`
            : `Set ${arg.paramName} = ${value}`,
          action: { kind: 'assignVar', varName: arg.paramName, value },
        });
      }

      return steps;
    }

    case 'return': {
      const steps: CSubStep[] = [];

      // 1. Read return value source (if from a variable)
      if (instr.valueSource) {
        const val = getVarValue?.(instr.valueSource);
        steps.push({
          kind: 'read',
          highlight: instr.valueSource,
          label: val != null ? `Read ${instr.valueSource} → ${val}` : `Read ${instr.valueSource}`,
          action: { kind: 'highlightVar', varName: instr.valueSource },
        });
      }

      // 2. Pop frame
      steps.push({
        kind: 'pop-frame',
        highlight: instr.code.replace(';', '').trim(),
        label: 'Return — pop stack frame',
        action: { kind: 'popFrame' },
      });

      // 3. Assign return value to caller's variable (if applicable)
      if (instr.returnToVar) {
        steps.push({
          kind: 'assign-return',
          highlight: instr.returnToVar,
          label: `Assign ${instr.returnToVar} = ${instr.returnValue ?? '?'}`,
          action: { kind: 'assignVar', varName: instr.returnToVar, value: instr.returnValue ?? 0 },
          sourceLine: instr.returnSourceLine,
        });
      }

      return steps;
    }
  }
}

function countDigits(buf: string, pos: number): number {
  let i = pos;
  while (i < buf.length && /\d/.test(buf[i])) i++;
  return i - pos;
}

function countWhitespace(buf: string, pos: number): number {
  let i = pos;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  return i - pos;
}

function formatScanfValue(value: number, spec: '%d' | '%c'): string {
  switch (spec) {
    case '%d': return `Read int: ${value}`;
    case '%c': {
      if (value === 10) return `Read char: '\\n'`;
      if (value === 9) return `Read char: '\\t'`;
      return `Read char: '${String.fromCharCode(value)}'`;
    }
  }
}

// --- Byte encoding ---

/** Convert a value to big-endian byte array for a given type. */
export function valueToBytes(value: number, type: CTypeName): number[] {
  if (type === 'char') {
    return [value & 0xff];
  }

  if (type === 'int' || type === 'pointer') {
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
