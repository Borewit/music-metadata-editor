import { textDecode, textEncode } from '@borewit/text-codec';
import { UINT8, UINT16_BE, UINT24_BE, UINT32_BE, UINT32_LE, UINT64_BE } from 'token-types';

import { InvalidFileError } from './errors.js';

export function readUInt8(data: Uint8Array, offset: number): number {
  ensureAvailable(data, offset, 1);
  return UINT8.get(data, offset);
}

export function readUInt16BE(data: Uint8Array, offset: number): number {
  ensureAvailable(data, offset, 2);
  return UINT16_BE.get(data, offset);
}

export function readUInt24BE(data: Uint8Array, offset: number): number {
  ensureAvailable(data, offset, 3);
  return UINT24_BE.get(data, offset);
}

export function readUInt32BE(data: Uint8Array, offset: number): number {
  ensureAvailable(data, offset, 4);
  return UINT32_BE.get(data, offset);
}

export function readUInt32LE(data: Uint8Array, offset: number): number {
  ensureAvailable(data, offset, 4);
  return UINT32_LE.get(data, offset);
}

export function readUInt64BE(data: Uint8Array, offset: number): bigint {
  ensureAvailable(data, offset, 8);
  return UINT64_BE.get(data, offset);
}

export function readBytes(data: Uint8Array, offset: number, length: number): Uint8Array {
  ensureAvailable(data, offset, length);
  return data.subarray(offset, offset + length);
}

export function decodeUtf8(data: Uint8Array): string {
  return textDecode(data, 'utf-8');
}

export function encodeUtf8(value: string): Uint8Array {
  return textEncode(value, 'utf-8');
}

export function encodeAscii(value: string): Uint8Array {
  return textEncode(value, 'ascii');
}

export function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) {
    length += chunk.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function ensureAvailable(data: Uint8Array, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new InvalidFileError(`Invalid read range: offset=${offset}, length=${length}`);
  }
  if (offset + length > data.length) {
    throw new InvalidFileError(
      `Unexpected end of data: need ${length} byte(s) at offset ${offset}, but only ${data.length - offset} available`
    );
  }
}

/**
 * Structural subset of `@tokenizer/token`'s `IToken`.
 *
 * Keeping the interface local avoids a direct dependency on
 * `@tokenizer/token`; every `token-types` token is compatible with it.
 */
export interface Token<T> {
  readonly len: number;
  put(array: Uint8Array, offset: number, value: T): number;
}

/**
 * Growable byte writer driven by `token-types` tokens.
 *
 * Numeric fields are serialized with the same tokens that decode them, so a
 * format module cannot accidentally use a different byte order for reading and
 * writing. Variable-length data (UTF-8 strings, block payloads) is written with
 * `writeBytes`.
 */
export class TokenWriter {
  private buffer: Uint8Array;
  private offset = 0;

  public constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(Math.max(16, initialCapacity));
  }

  public get length(): number {
    return this.offset;
  }

  public reserve(length: number): number {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError(`Invalid reserve length: ${length}`);
    }
    const start = this.offset;
    this.ensureCapacity(length);
    this.offset += length;
    return start;
  }

  /**
   * Encode `value` with a `token-types` token.
   */
  public writeToken<T>(token: Token<T>, value: T): void {
    const start = this.reserve(token.len);
    token.put(this.buffer, start, value);
  }

  public writeUInt8(value: number): void {
    this.writeToken(UINT8, value);
  }

  public writeUInt16BE(value: number): void {
    this.writeToken(UINT16_BE, value);
  }

  public writeUInt24BE(value: number): void {
    this.writeToken(UINT24_BE, value);
  }

  public writeUInt32BE(value: number): void {
    this.writeToken(UINT32_BE, value);
  }

  public writeUInt32LE(value: number): void {
    this.writeToken(UINT32_LE, value);
  }

  public writeBytes(value: Uint8Array): void {
    this.ensureCapacity(value.length);
    this.buffer.set(value, this.offset);
    this.offset += value.length;
  }

  public writeAscii(value: string): void {
    this.writeBytes(encodeAscii(value));
  }

  public writeUtf8(value: string): void {
    this.writeBytes(encodeUtf8(value));
  }

  public writeZeros(length: number): void {
    const start = this.reserve(length);
    this.buffer.fill(0, start, start + length);
  }

  /**
   * Overwrite an already reserved region with a token value.
   */
  public patchToken<T>(token: Token<T>, offset: number, value: T): void {
    this.ensurePatchRange(offset, token.len);
    token.put(this.buffer, offset, value);
  }

  public patchUInt8(offset: number, value: number): void {
    this.patchToken(UINT8, offset, value);
  }

  public patchUInt16BE(offset: number, value: number): void {
    this.patchToken(UINT16_BE, offset, value);
  }

  public patchUInt24BE(offset: number, value: number): void {
    this.patchToken(UINT24_BE, offset, value);
  }

  public patchUInt32BE(offset: number, value: number): void {
    this.patchToken(UINT32_BE, offset, value);
  }

  public patchUInt32LE(offset: number, value: number): void {
    this.patchToken(UINT32_LE, offset, value);
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  private ensureCapacity(extra: number): void {
    const required = this.offset + extra;
    if (required <= this.buffer.length) {
      return;
    }
    let capacity = this.buffer.length;
    while (capacity < required) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.offset));
    this.buffer = next;
  }

  private ensurePatchRange(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > this.offset) {
      throw new RangeError(`Invalid patch range: offset=${offset}, length=${length}, written=${this.offset}`);
    }
  }
}
