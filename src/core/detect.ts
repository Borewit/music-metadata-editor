import type { ByteSource } from './source.js';

export type ContainerFormat = 'flac' | 'id3' | 'mp3' | 'unknown';

/**
 * Detect the container format from the first bytes of the input.
 *
 * FLAC files with a leading ID3v2 tag are reported as `flac`; the FLAC parser
 * preserves the prefix.
 */
export async function detectFormat(source: ByteSource): Promise<ContainerFormat> {
  if (source.size < 3) {
    return 'unknown';
  }

  const header = await source.read(0, Math.min(12, source.size));

  if (header[0] === 0x66 && header[1] === 0x4c && header[2] === 0x61 && header[3] === 0x43) {
    return 'flac';
  }

  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    if (header.length < 10) {
      return 'id3';
    }
    const size = readSyncSafeUInt32(header, 6);
    const hasFooter = header[3]! >= 4 && (header[5]! & 0x10) !== 0;
    const payloadOffset = 10 + size + (hasFooter ? 10 : 0);
    if (payloadOffset + 4 <= source.size) {
      const payload = await source.read(payloadOffset, 4);
      if (payload[0] === 0x66 && payload[1] === 0x4c && payload[2] === 0x61 && payload[3] === 0x43) {
        return 'flac';
      }
    }
    return 'id3';
  }

  if (header[0] === 0xff && (header[1]! & 0xe0) === 0xe0) {
    return 'mp3';
  }

  return 'unknown';
}

function readSyncSafeUInt32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! & 0x7f) << 21) |
    ((data[offset + 1]! & 0x7f) << 14) |
    ((data[offset + 2]! & 0x7f) << 7) |
    (data[offset + 3]! & 0x7f)
  );
}
