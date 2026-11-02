import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile, parseBuffer } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import { updateBuffer, updateFile } from '../src/index.js';
import type { TagPatch } from '../src/index.js';
import { syncSafe, encodeFrame } from '../src/id3v2/frames.js';
import { UINT32SYNCSAFE } from 'music-metadata/tokens/id3v2';

const sample = path.join(import.meta.dirname, 'fixtures', "MusicBrainz - Beth Hart - Sinner's Prayer [id3v2.4].V2.mp3");
const input = await readFile(sample);
const audioOffset = (data: Uint8Array) => (data[0] === 73 ? 10 + syncSafe(data, 6) : 0);
const payload = input.subarray(audioOffset(input));

async function withCopy(verify: (target: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'id3v24-'));
  try {
    const target = path.join(directory, 'output.mp3');
    await writeFile(target, payload);
    await verify(target);
    const output = await readFile(target);
    expect(output.subarray(audioOffset(output))).toEqual(payload);
    expect(await readFile(sample)).toEqual(input);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('ID3v2.4 metadata transfer', () => {
  it('writes all common tags to a new MP3', async () => {
    const { common } = await parseFile(sample);
    await withCopy(async target => {
      const result = await updateFile(target, common);
      expect(result.format).toBe('mp3');
      expect(result.atomic).toBe(true);
      const after = await parseFile(target);
      expect(after.common).toEqual(common);
    });
  });

  it('writes all native tags to a new MP3', async () => {
    const before = await parseFile(sample);
    const native: Record<string, unknown[]> = {};
    for (const tag of before.native['ID3v2.4']!) (native[tag.id] ??= []).push(tag.value);
    await withCopy(async target => {
      await updateFile(target, { native } as unknown as TagPatch);
      const after = await parseFile(target);
      expect(after.native).toEqual(before.native);
      expect(after.common).toEqual(before.common);
    });
  });

  it('preserves audio and side tags, leaves input owned, and is idempotent', async () => {
    const tail = Buffer.from('TAG' + 'side tag'.padEnd(125, ' '));
    const source = Buffer.concat([input, tail]);
    const original = Buffer.from(source);
    const output = await updateBuffer(source, { title: 'New title', artists: ['A', 'B'] });
    expect(source).toEqual(original);
    expect(Buffer.from(output.subarray(audioOffset(output)))).toEqual(source.subarray(audioOffset(source)));
    expect(await updateBuffer(output, { title: 'New title', artists: ['A', 'B'] })).toEqual(output);
    const metadata = await parseBuffer(output, { mimeType: 'audio/mpeg' });
    expect(metadata.common.title).toBe('New title');
    expect(metadata.common.artists).toEqual(['A', 'B']);
  });

  it('removes common fields and applies native fields last', async () => {
    const output = await updateBuffer(input, {
      picture: null,
      comment: null,
      rating: null,
      title: 'Common',
      native: { TIT2: 'Native' }
    });
    const metadata = await parseBuffer(output, { mimeType: 'audio/mpeg' });
    expect(metadata.common.picture).toBeUndefined();
    expect(metadata.common.comment).toBeUndefined();
    expect(metadata.common.rating).toBeUndefined();
    expect(metadata.common.title).toBe('Native');
    expect(metadata.common.album).toBe("Don't Explain");
  });

  it('retains unmodified unknown flagged frames byte for byte', async () => {
    const frame = encodeFrame({ id: 'XABC', flags: 0x0044, data: Uint8Array.of(2, 3, 4, 5) });
    const source = tag(frame);
    const output = await updateBuffer(source, { title: 'Title' }, { padding: 0 });
    expect(output.subarray(10, 10 + frame.length)).toEqual(frame);
  });

  it('rejects truncated sizes, invalid sync-safe sizes, and unsupported tag features', async () => {
    const truncated = input.subarray(0, 20);
    await expect(updateBuffer(truncated, {})).rejects.toThrow('exceeds file size');
    for (const flag of [0x80, 0x40, 0x10]) {
      const source = Buffer.from(input);
      source[5] = flag;
      await expect(updateBuffer(source, {})).rejects.toThrow('flags');
    }
    for (const version of [2, 3]) {
      const source = Buffer.from(input);
      source[3] = version;
      await expect(updateBuffer(source, {})).rejects.toThrow('Only ID3v2.4');
    }
    const bad = Buffer.from(input);
    bad[6] = 128;
    await expect(updateBuffer(bad, {})).rejects.toThrow('sync-safe');
    const badFrame = Buffer.from(input);
    badFrame[14] = 128;
    await expect(updateBuffer(badFrame, {})).rejects.toThrow('sync-safe');
  });

  it('accepts the experimental tag flag while preserving metadata', async () => {
    const flagged = Buffer.from(input);
    flagged[5] = 0x20;
    const output = await updateBuffer(flagged, { title: 'Experimental' });
    const metadata = await parseBuffer(output, { mimeType: 'audio/mpeg' });
    expect(metadata.common.title).toBe('Experimental');
    expect(metadata.common.artist).toBe((await parseBuffer(input, { mimeType: 'audio/mpeg' })).common.artist);
  });

  it('keeps track totals for a partial update and preserves other contributor roles', async () => {
    const output = await updateBuffer(input, { track: { no: 2 }, engineer: ['New engineer'] });
    const metadata = await parseBuffer(output, { mimeType: 'audio/mpeg' });
    expect(metadata.common.track).toEqual({ no: 2, of: 10 });
    expect(metadata.common.engineer).toEqual(['New engineer']);
    expect(metadata.common.producer).toEqual(['Roy Weisman']);
    expect(metadata.common.arranger).toEqual(['Jeff Bova']);
  });

  it('rejects malformed frames and invalid patches before modifying a file', async () => {
    await withCopy(async target => {
      const original = await readFile(target);
      await expect(updateFile(target, { rating: [{ rating: 2 }] })).rejects.toThrow();
      expect(await readFile(target)).toEqual(original);
    });
    const frame = encodeFrame({ id: 'TIT2', flags: 0, data: Uint8Array.of(3, 65) });
    const oversized = Buffer.from(frame);
    UINT32SYNCSAFE.put(oversized, 4, frame.length + 1);
    await expect(updateBuffer(tag(oversized), {})).rejects.toThrow('frame exceeds');
    const reserved = Buffer.from(frame);
    reserved[8] = 128;
    await expect(updateBuffer(tag(reserved), {})).rejects.toThrow('Reserved');
    await expect(updateBuffer(tag(Buffer.concat([Buffer.from([0]), frame])), {})).rejects.toThrow('padding');
    await expect(updateBuffer(input, { native: { BAD: 'value' } })).rejects.toThrow('frame ID');
    await expect(updateBuffer(input, {}, { padding: -1 })).rejects.toThrow('padding');
  });

  it('identifies existing UTF-16 user text while retaining unrelated user frames', async () => {
    const data = Buffer.concat([Buffer.from([1, 255, 254]), Buffer.from('ASIN\0Old', 'utf16le')]);
    const source = tag(encodeFrame({ id: 'TXXX', flags: 0, data }));
    const output = await updateBuffer(source, { asin: 'New', barcode: '123' });
    const metadata = await parseBuffer(output, { mimeType: 'audio/mpeg' });
    expect(metadata.common.asin).toBe('New');
    expect(metadata.common.barcode).toBe('123');
    expect(metadata.native['ID3v2.4']!.filter(t => t.id.toUpperCase() === 'TXXX:ASIN')).toHaveLength(1);
  });
});

function tag(body: Uint8Array): Uint8Array {
  const header = Uint8Array.of(73, 68, 51, 4, 0, 0, 0, 0, 0, 0);
  UINT32SYNCSAFE.put(header, 6, body.length);
  return Buffer.concat([header, body, payload]);
}

describe('explicit ID3 replacement', () => {
  const tail = Buffer.from('TAG' + 'old title'.padEnd(125, ' '));

  it('updates a valid ID3v2.3 MP3 file with ID3v2.4 tags', async () => {
    // v2.3 text uses UTF-16 with a BOM and ordinary uint32 frame sizes.
    // A body over 127 bytes distinguishes these sizes from v2.4 sync-safe sizes.
    const oldTitle = '旧标题 '.repeat(40);
    const frame = (id: string, text: string) => {
      const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
      const header = Buffer.alloc(10);
      header.write(id, 0, 'ascii');
      header.writeUInt32BE(body.length, 4);
      return Buffer.concat([header, body]);
    };
    const body = Buffer.concat([frame('TIT2', oldTitle), frame('TPE1', '原艺术家'), frame('TALB', 'Original album')]);
    const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]);
    UINT32SYNCSAFE.put(header, 6, body.length);
    const source = Buffer.concat([header, body, payload, tail]);
    const directory = await mkdtemp(path.join(tmpdir(), 'id3v23-to-v24-'));
    try {
      const target = path.join(directory, 'legacy.mp3');
      await writeFile(target, source);
      const before = await parseFile(target);
      expect(before.format.tagTypes).toContain('ID3v2.3');
      expect(before.native['ID3v2.3']).toEqual(
        expect.arrayContaining([
          { id: 'TIT2', value: oldTitle },
          { id: 'TPE1', value: '原艺术家' },
          { id: 'TALB', value: 'Original album' }
        ])
      );
      // Replacement is explicit; ordinary updates must not silently discard fields.
      await expect(updateFile(target, { title: 'Updated title' })).rejects.toThrow('Only ID3v2.4');
      expect(await readFile(target)).toEqual(source);

      const patch: TagPatch = {
        title: 'Updated title — 新标题',
        artist: before.common.artist!,
        album: before.common.album!
      };
      const result = await updateFile(target, patch, { replaceId3: true });
      expect(result.format).toBe('mp3');
      const output = await readFile(target);
      expect([...output.subarray(0, 6)]).toEqual([73, 68, 51, 4, 0, 0]);
      expect(output.subarray(audioOffset(output))).toEqual(payload);
      const after = await parseFile(target);
      expect(after.format.tagTypes).toEqual(['ID3v2.4']);
      expect(after.native['ID3v2.3']).toBeUndefined();
      expect(after.native.ID3v1).toBeUndefined();
      expect(after.common.title).toBe(patch.title);
      expect(after.common.artist).toBe(before.common.artist);
      expect(after.common.album).toBe(before.common.album);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([2, 3, 4])('discards v2.%i tags and ID3v1 while preserving audio', async version => {
    // Replacement must skip opaque old bodies without decoding their frames.
    const old = Buffer.from([73, 68, 51, version, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
    const source = Buffer.concat([old, payload, tail]);
    const original = Buffer.from(source);
    const result = await updateBuffer(source, { title: 'Replacement' }, { replaceId3: true, padding: 0 });
    expect(source).toEqual(original);
    expect(result[3]).toBe(4);
    expect(Buffer.from(result.subarray(audioOffset(result)))).toEqual(payload);
    const tags = await parseBuffer(result, { mimeType: 'audio/mpeg' });
    expect(tags.common.title).toBe('Replacement');
    expect(tags.native['ID3v1']).toBeUndefined();
    expect(await updateBuffer(result, { title: 'Replacement' }, { replaceId3: true, padding: 0 })).toEqual(result);
  });

  it('drops unspecified v2.4 fields and supports file writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'replace-id3-'));
    try {
      const target = path.join(directory, 'old.mp3');
      await writeFile(target, Buffer.concat([input, tail]));
      await updateFile(target, { title: 'Only title' }, { replaceId3: true });
      const result = await readFile(target);
      expect(result.subarray(audioOffset(result))).toEqual(payload);
      const tags = await parseFile(target);
      expect(tags.common.title).toBe('Only title');
      expect(tags.common.album).toBeUndefined();
      expect(tags.common.picture).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes ID3v1 without requiring a leading tag', async () => {
    const result = await updateBuffer(Buffer.concat([payload, tail]), {}, { replaceId3: true, padding: 0 });
    expect(Buffer.from(result.subarray(audioOffset(result)))).toEqual(payload);
  });

  it('rejects invalid sizes and leaves files untouched', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'invalid-id3-'));
    try {
      const target = path.join(directory, 'bad.mp3');
      for (const size of [
        [128, 0, 0, 0],
        [127, 127, 127, 127]
      ]) {
        const source = Buffer.from([73, 68, 51, 3, 0, 0, ...size]);
        await writeFile(target, source);
        await expect(updateFile(target, {}, { replaceId3: true })).rejects.toThrow();
        expect(await readFile(target)).toEqual(source);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('ID3 replacement boundaries', () => {
  it('skips flagged legacy bodies and validates v2.4 footers', async () => {
    for (const [version, flags] of [
      [2, 0xc0],
      [3, 0xe0],
      [4, 0xf0]
    ]) {
      const header = Buffer.from([73, 68, 51, version!, 0, flags!, 0, 0, 0, 4]);
      const footer = version === 4 ? Buffer.concat([Buffer.from('3DI'), header.subarray(3)]) : Buffer.alloc(0);
      const source = Buffer.concat([header, Buffer.from([1, 2, 3, 4]), footer, payload]);
      const result = await updateBuffer(source, {}, { replaceId3: true });
      expect(Buffer.from(result.subarray(audioOffset(result)))).toEqual(payload);
      if (version === 4) {
        source[14] = 0;
        await expect(updateBuffer(source, {}, { replaceId3: true })).rejects.toThrow('footer');
      }
    }
  });

  it('preserves non-ID3 trailers', async () => {
    const ape = Buffer.from('APETAGEX preserved opaque trailer');
    const source = Buffer.concat([payload, ape]);
    const result = await updateBuffer(source, {}, { replaceId3: true });
    expect(Buffer.from(result.subarray(audioOffset(result)))).toEqual(source);
  });

  it('rejects replacement on FLAC', async () => {
    await expect(updateBuffer(Buffer.from('fLaC'), {}, { replaceId3: true })).rejects.toThrow('only supported for MP3');
  });
});
