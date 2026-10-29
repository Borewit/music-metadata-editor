import { TokenWriter } from '../../src/core/bytes.js';
import type { Picture } from '../../src/core/types.js';
import { serializePicture } from '../../src/flac/picture.js';
import { serializeVorbisComment } from '../../src/flac/vorbis.js';
import type { VorbisComment } from '../../src/mapping/vorbis.js';

export interface TestBlock {
  type: number;
  data: Uint8Array;
}

export interface MakeFlacOptions {
  comments?: readonly VorbisComment[];
  vendor?: string;
  pictures?: readonly Picture[];
  extraBlocks?: readonly TestBlock[];
  audio?: Uint8Array;
  padding?: number;
  id3Prefix?: Uint8Array;
  withVorbisComment?: boolean;
}

export function makeStreamInfo(): Uint8Array {
  const writer = new TokenWriter(34);
  writer.writeUInt16BE(4096);
  writer.writeUInt16BE(4096);
  writer.writeUInt24BE(0);
  writer.writeUInt24BE(0);

  const sampleRate = 44100;
  const channelsMinus1 = 1;
  const bitsPerSampleMinus1 = 15;
  const totalSamples = 44100;
  const high = (sampleRate << 12) | (channelsMinus1 << 9) | (bitsPerSampleMinus1 << 4);
  writer.writeUInt32BE(high >>> 0);
  writer.writeUInt32BE(totalSamples >>> 0);
  writer.writeZeros(16);
  return writer.toUint8Array();
}

export function makeFlac(options: MakeFlacOptions = {}): Uint8Array {
  const blocks: TestBlock[] = [
    { type: 0, data: makeStreamInfo() },
    {
      type: 4,
      data: serializeVorbisComment({
        vendor: options.vendor ?? 'test-vendor',
        comments: [...(options.comments ?? [])]
      })
    }
  ];

  if (options.withVorbisComment === false) {
    blocks.pop();
  }

  for (const picture of options.pictures ?? []) {
    blocks.push({ type: 6, data: serializePicture(picture) });
  }

  blocks.push(...(options.extraBlocks ?? []));

  if (options.padding !== undefined && options.padding > 0) {
    blocks.push({ type: 1, data: new Uint8Array(options.padding) });
  }

  const writer = new TokenWriter();
  if (options.id3Prefix !== undefined) {
    writer.writeBytes(options.id3Prefix);
  }
  writer.writeAscii('fLaC');
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    writer.writeUInt8((index === blocks.length - 1 ? 0x80 : 0) | block.type);
    writer.writeUInt24BE(block.data.length);
    writer.writeBytes(block.data);
  }
  writer.writeBytes(options.audio ?? makeAudio());
  return writer.toUint8Array();
}

export function makeAudio(length = 4096): Uint8Array {
  const audio = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    audio[index] = (index * 31 + 7) & 0xff;
  }
  return audio;
}

export function makeId3Prefix(payloadLength = 0): Uint8Array {
  const size = payloadLength;
  return Uint8Array.from([
    0x49,
    0x44,
    0x33,
    0x04,
    0x00,
    0x00,
    (size >>> 21) & 0x7f,
    (size >>> 14) & 0x7f,
    (size >>> 7) & 0x7f,
    size & 0x7f,
    ...new Uint8Array(payloadLength)
  ]);
}

export function extractBlocks(flac: Uint8Array): TestBlock[] {
  const offset = flacOffset(flac);
  const blocks: TestBlock[] = [];
  let cursor = offset + 4;
  for (;;) {
    const header = flac.subarray(cursor, cursor + 4);
    if (header.length < 4) {
      throw new Error('Truncated FLAC block header in test fixture');
    }
    const last = (header[0]! & 0x80) !== 0;
    const type = header[0]! & 0x7f;
    const length = (header[1]! << 16) | (header[2]! << 8) | header[3]!;
    cursor += 4;
    blocks.push({ type, data: flac.subarray(cursor, cursor + length) });
    cursor += length;
    if (last) {
      return blocks;
    }
  }
}

export function extractAudio(flac: Uint8Array): Uint8Array {
  const offset = flacOffset(flac);
  let cursor = offset + 4;
  for (;;) {
    const header = flac.subarray(cursor, cursor + 4);
    if (header.length < 4) {
      throw new Error('Truncated FLAC block header in test fixture');
    }
    const last = (header[0]! & 0x80) !== 0;
    const length = (header[1]! << 16) | (header[2]! << 8) | header[3]!;
    cursor += 4 + length;
    if (last) {
      return flac.subarray(cursor);
    }
  }
}

export function flacOffset(flac: Uint8Array): number {
  if (flac[0] === 0x49 && flac[1] === 0x44 && flac[2] === 0x33) {
    const size =
      ((flac[6]! & 0x7f) << 21) |
      ((flac[7]! & 0x7f) << 14) |
      ((flac[8]! & 0x7f) << 7) |
      (flac[9]! & 0x7f);
    const footer = flac[3]! >= 4 && (flac[5]! & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
  }
  return 0;
}
