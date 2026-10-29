import { UINT16_BE, UINT32_LE } from 'token-types';
import { describe, expect, it } from 'vitest';

import {
  TokenWriter,
  concatBytes,
  decodeUtf8,
  encodeUtf8,
  readUInt16BE,
  readUInt24BE,
  readUInt32BE,
  readUInt32LE,
  readUInt64BE
} from '../src/core/bytes.js';
import { InvalidFileError } from '../src/core/errors.js';

describe('TokenWriter', () => {
  it('writes big- and little-endian integers', () => {
    const writer = new TokenWriter(2);
    writer.writeUInt8(0xab);
    writer.writeUInt16BE(0x1234);
    writer.writeUInt24BE(0x56789a);
    writer.writeUInt32BE(0xbcdef012);
    writer.writeUInt32LE(0x3456789a);

    const data = writer.toUint8Array();
    expect(Array.from(data)).toEqual([
      0xab, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x9a, 0x78, 0x56, 0x34
    ]);

    expect(readUInt16BE(data, 1)).toBe(0x1234);
    expect(readUInt24BE(data, 3)).toBe(0x56789a);
    expect(readUInt32BE(data, 6)).toBe(0xbcdef012);
    expect(readUInt32LE(data, 10)).toBe(0x3456789a);
  });

  it('serializes directly with token-types tokens', () => {
    const writer = new TokenWriter();
    writer.writeToken(UINT16_BE, 0x1234);
    writer.writeToken(UINT32_LE, 0x56789abc);

    const data = writer.toUint8Array();
    expect(Array.from(data)).toEqual([0x12, 0x34, 0xbc, 0x9a, 0x78, 0x56]);
    expect(readUInt16BE(data, 0)).toBe(0x1234);
    expect(readUInt32LE(data, 2)).toBe(0x56789abc);
  });

  it('patches previously written integers', () => {
    const writer = new TokenWriter();
    const offset = writer.reserve(4);
    writer.writeUInt24BE(0);
    writer.writeUInt32LE(0);

    writer.patchUInt32BE(offset, 0x01020304);
    writer.patchUInt24BE(offset + 4, 0xaabbcc);
    writer.patchUInt32LE(offset + 7, 0x11223344);

    const data = writer.toUint8Array();
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 0xaa, 0xbb, 0xcc, 0x44, 0x33, 0x22, 0x11]);
  });

  it('grows beyond the initial capacity', () => {
    const writer = new TokenWriter(1);
    writer.writeBytes(new Uint8Array(10_000).fill(7));
    expect(writer.length).toBe(10_000);
    expect(writer.toUint8Array()[9999]).toBe(7);
  });

  it('rejects out-of-range patches', () => {
    const writer = new TokenWriter();
    writer.writeUInt32BE(0);
    expect(() => writer.patchUInt32BE(1, 1)).toThrow(RangeError);
  });
});

describe('byte helpers', () => {
  it('concatenates and encodes UTF-8', () => {
    const text = 'héllo 世界';
    const encoded = encodeUtf8(text);
    expect(decodeUtf8(encoded)).toBe(text);

    const combined = concatBytes(Uint8Array.from([1, 2]), Uint8Array.from([3]), Uint8Array.from([4, 5]));
    expect(Array.from(combined)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reads 64-bit big-endian integers', () => {
    const data = Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 2]);
    expect(readUInt64BE(data, 0)).toBe(0x0000000100000002n);
  });

  it('throws on truncated reads', () => {
    expect(() => readUInt32BE(Uint8Array.from([1, 2, 3]), 0)).toThrow(InvalidFileError);
  });
});
