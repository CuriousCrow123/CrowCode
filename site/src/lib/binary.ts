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

/** Format an integer as a hex string, zero-padded to `digits` and prefixed with `0x`. */
export function toHex(value: number, digits: number): string {
  return '0x' + value.toString(16).toUpperCase().padStart(digits, '0');
}

/** Format an integer as a binary string, zero-padded to numBits. */
export function toBinary(value: number, numBits: number): string {
  return value.toString(2).padStart(numBits, '0');
}

/** Convert an unsigned integer to its two's complement signed value. */
export function toSigned(unsigned: number, numBits: number): number {
  const max = 1 << numBits;
  const half = max >> 1;
  return unsigned >= half ? unsigned - max : unsigned;
}

/** Convert a signed integer to its two's complement unsigned representation. */
export function fromSigned(signed: number, numBits: number): number {
  const max = 1 << numBits;
  return signed < 0 ? signed + max : signed;
}

// --- IEEE 754 half-precision (binary16) ---

/** Decode a 16-bit pattern to an IEEE 754 half-precision float. */
export function float16Decode(bits16: number): number {
  const sign = (bits16 >> 15) & 1;
  const exp = (bits16 >> 10) & 0x1f;
  const mant = bits16 & 0x3ff;
  const s = sign ? -1 : 1;

  if (exp === 0) {
    // Subnormal or zero
    return s * (2 ** -14) * (mant / 1024);
  } else if (exp === 31) {
    // Infinity or NaN
    return mant === 0 ? s * Infinity : NaN;
  } else {
    // Normal
    return s * (2 ** (exp - 15)) * (1 + mant / 1024);
  }
}

/** Encode a float value to a 16-bit IEEE 754 half-precision bit pattern. */
export function float16Encode(value: number): number {
  if (isNaN(value)) return 0x7e00; // canonical NaN
  if (!isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
  if (value === 0) return Object.is(value, -0) ? 0x8000 : 0;

  const sign = value < 0 ? 1 : 0;
  const abs = Math.abs(value);

  // Subnormal range
  if (abs < 2 ** -14) {
    const mant = Math.round(abs / (2 ** -14) * 1024);
    return (sign << 15) | mant;
  }

  // Normal range
  let exp = Math.floor(Math.log2(abs));
  let mant = Math.round((abs / (2 ** exp) - 1) * 1024);
  if (mant === 1024) { exp++; mant = 0; }
  const biasedExp = exp + 15;

  if (biasedExp >= 31) return (sign << 15) | 0x7c00; // overflow to Inf
  if (biasedExp <= 0) return (sign << 15); // underflow to zero

  return (sign << 15) | (biasedExp << 10) | mant;
}

/** Classify a 16-bit float pattern. */
export function float16Classify(bits16: number): 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan' {
  const exp = (bits16 >> 10) & 0x1f;
  const mant = bits16 & 0x3ff;
  if (exp === 0) return mant === 0 ? 'zero' : 'subnormal';
  if (exp === 31) return mant === 0 ? 'infinity' : 'nan';
  return 'normal';
}
