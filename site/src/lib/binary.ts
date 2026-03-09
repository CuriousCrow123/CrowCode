/**
 * Shared binary encoding/decoding utilities.
 *
 * Extracted from BitGridData; used by both BitGrid variants and
 * BitSequence variants (unsigned, ASCII, signed, float).
 * All functions are pure — no side effects, no DOM access.
 */

/** Write an unsigned integer to a bits array at a given offset (MSB-first). */
export function writeUint(bits: number[], offset: number, value: number, numBits: number): void {
  const clamped = Math.max(0, Math.min((1 << numBits) - 1, Math.round(value)));
  for (let i = 0; i < numBits; i++) {
    bits[offset + i] = (clamped >> (numBits - 1 - i)) & 1;
  }
}

/** Read an unsigned integer from a bits array at a given offset (MSB-first). */
export function readUint(bits: number[], offset: number, numBits: number): number {
  let val = 0;
  for (let i = 0; i < numBits; i++) {
    val = (val << 1) | (bits[offset + i] ?? 0);
  }
  return val;
}

/** Format an integer as a binary string, zero-padded to numBits. */
export function toBinary(value: number, numBits: number): string {
  return value.toString(2).padStart(numBits, '0');
}
