import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readTags, UnsupportedFormatError, updateBuffer, updateFile } from '../src/index.js';
import type { ReadResult } from '../src/index.js';
import { extractAudio, extractBlocks, makeAudio, makeFlac, makeId3Prefix } from './helpers/flac.js';

const temporaryDirectories: string[] = [];

function vorbisValues(result: ReadResult, id: string): string[] {
  return (result.native.vorbis ?? [])
    .filter(tag => tag.id === id && typeof tag.value === 'string')
    .map(tag => tag.value as string);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('FLAC reading', () => {
  it('reads Vorbis Comments and common tags', async () => {
    const input = makeFlac({
      comments: [
        { key: 'TITLE', value: 'Original title' },
        { key: 'ARTIST', value: 'First artist' },
        { key: 'ARTIST', value: 'Second artist' },
        { key: 'ALBUM', value: 'An album' },
        { key: 'DATE', value: '2024-01-02' },
        { key: 'TRACKNUMBER', value: '3' },
        { key: 'TRACKTOTAL', value: '12' },
        { key: 'DISCNUMBER', value: '1' },
        { key: 'DISCTOTAL', value: '2' },
        { key: 'GENRE', value: 'Rock' },
        { key: 'GENRE', value: 'Pop' },
        { key: 'MUSICBRAINZ_TRACKID', value: 'recording-id' },
        { key: 'MUSICBRAINZ_RELEASETRACKID', value: 'release-track-id' }
      ]
    });

    const result = await readTags(input);

    expect(result.format).toBe('flac');
    expect(result.common.title).toBe('Original title');
    expect(result.common.artist).toBe('First artist');
    expect(result.common.artists).toEqual(['First artist', 'Second artist']);
    expect(result.common.album).toBe('An album');
    expect(result.common.date).toBe('2024-01-02');
    expect(result.common.track).toEqual({ no: 3, of: 12 });
    expect(result.common.disk).toEqual({ no: 1, of: 2 });
    expect(result.common.genre).toEqual(['Rock', 'Pop']);
    expect(result.common.musicbrainz_recordingid).toBe('recording-id');
    expect(result.common.musicbrainz_trackid).toBe('release-track-id');
    expect(vorbisValues(result, 'TITLE')).toEqual(['Original title']);
    expect(vorbisValues(result, 'ARTIST')).toEqual(['First artist', 'Second artist']);
  });

  it('handles files without a Vorbis Comment block', async () => {
    const input = makeFlac({ comments: [] });
    const result = await readTags(input);
    expect(result.common.track).toEqual({ no: null, of: null });
    expect(result.common.disk).toEqual({ no: null, of: null });
  });

  it('adds a Vorbis Comment block when the file has none', async () => {
    const audio = makeAudio(2048);
    const input = makeFlac({ withVorbisComment: false, audio });

    const output = await updateBuffer(input, { title: 'Added', artist: 'Someone' });
    const result = await readTags(output);

    expect(result.common.title).toBe('Added');
    expect(result.common.artist).toBe('Someone');
    expect(extractAudio(output)).toEqual(audio);
  });

  it('reads native FLAC PICTURE blocks', async () => {
    const input = makeFlac({
      pictures: [
        {
          format: 'image/png',
          type: 'Cover (front)',
          description: 'front',
          data: Uint8Array.from([1, 2, 3, 4])
        }
      ]
    });

    const result = await readTags(input);
    expect(result.pictures).toHaveLength(1);
    expect(result.pictures[0]?.format).toBe('image/png');
    expect(result.pictures[0]?.type).toBe('Cover (front)');
    expect(result.pictures[0]?.description).toBe('front');
    expect(result.common.picture?.[0]?.data).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('preserves an ID3v2 prefix', async () => {
    const prefix = makeId3Prefix(7);
    const input = makeFlac({ id3Prefix: prefix, comments: [{ key: 'TITLE', value: 'Old' }] });

    const output = await updateBuffer(input, { title: 'New' });
    expect(output.subarray(0, prefix.length)).toEqual(prefix);

    const result = await readTags(output);
    expect(result.common.title).toBe('New');
  });
});

describe('FLAC writing', () => {
  it('sets, preserves, and deletes tags', async () => {
    const input = makeFlac({
      comments: [
        { key: 'TITLE', value: 'Old' },
        { key: 'ARTIST', value: 'Keep me' },
        { key: 'CUSTOM_FIELD', value: 'custom' }
      ]
    });

    const output = await updateBuffer(input, {
      title: 'New',
      album: 'Added',
      genre: ['Jazz', 'Blues'],
      track: { no: 4, of: 9 },
      disk: { no: 1 },
      native: { CUSTOM_FIELD: 'updated' }
    });

    const result = await readTags(output);
    expect(result.common.title).toBe('New');
    expect(result.common.artist).toBe('Keep me');
    expect(result.common.album).toBe('Added');
    expect(result.common.genre).toEqual(['Jazz', 'Blues']);
    expect(result.common.track).toEqual({ no: 4, of: 9 });
    expect(result.common.disk).toEqual({ no: 1, of: null });
    expect(vorbisValues(result, 'CUSTOM_FIELD')).toEqual(['updated']);

    const deleted = await updateBuffer(output, { title: null, album: null, genre: null });
    const deletedResult = await readTags(deleted);
    expect(deletedResult.common.title).toBeUndefined();
    expect(deletedResult.common.album).toBeUndefined();
    expect(deletedResult.common.genre).toBeUndefined();
    expect(deletedResult.common.artist).toBe('Keep me');
  });

  it('does not modify the input buffer', async () => {
    const input = makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }] });
    const before = input.slice();

    await updateBuffer(input, { title: 'New' });
    expect(input).toEqual(before);
  });

  it('preserves unknown metadata blocks and the audio payload', async () => {
    const audio = makeAudio(8192);
    const applicationData = Uint8Array.from([9, 8, 7, 6, 5]);
    const input = makeFlac({
      audio,
      comments: [{ key: 'TITLE', value: 'Old' }],
      extraBlocks: [{ type: 2, data: applicationData }]
    });

    const output = await updateBuffer(input, { title: 'New' });

    const blocks = extractBlocks(output);
    const application = blocks.find(block => block.type === 2);
    expect(application?.data).toEqual(applicationData);
    expect(extractAudio(output)).toEqual(audio);
  });

  it('writes multiple artists and album artists', async () => {
    const input = makeFlac();
    const output = await updateBuffer(input, {
      artists: ['Artist A', 'Artist B'],
      albumartists: ['Album Artist A', 'Album Artist B']
    });

    const result = await readTags(output);
    expect(result.common.artists).toEqual(['Artist A', 'Artist B']);
    expect(result.common.artist).toBe('Artist A');
    expect(result.common.albumartists).toEqual(['Album Artist A', 'Album Artist B']);
    expect(result.common.albumartist).toBe('Album Artist A');
  });

  it('writes and removes pictures', async () => {
    const picture = {
      format: 'image/jpeg',
      type: 'Cover (front)',
      description: 'front cover',
      data: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
    };

    const input = makeFlac();
    const withPicture = await updateBuffer(input, { picture: [picture] });
    const read = await readTags(withPicture);
    expect(read.pictures).toHaveLength(1);
    expect(read.pictures[0]?.format).toBe('image/jpeg');
    expect(read.pictures[0]?.type).toBe('Cover (front)');
    expect(read.pictures[0]?.data).toEqual(picture.data);

    const withoutPicture = await updateBuffer(withPicture, { picture: null });
    const removed = await readTags(withoutPicture);
    expect(removed.pictures).toHaveLength(0);
    expect(removed.common.picture).toBeUndefined();
  });

  it('is idempotent with a fixed padding policy', async () => {
    const input = makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }] });
    const options = { padding: 4096 };

    const once = await updateBuffer(input, { title: 'Same' }, options);
    const twice = await updateBuffer(once, { title: 'Same' }, options);

    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it('keeps audio offset stable when the new tag fits in existing padding', async () => {
    const input = makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }], padding: 8192 });
    const output = await updateBuffer(input, { title: 'A slightly longer title' }, { padding: 8192 });

    expect(extractAudio(input)).toEqual(extractAudio(output));
    const inputBlocks = extractBlocks(input);
    const outputBlocks = extractBlocks(output);
    expect(inputBlocks.length).toBe(outputBlocks.length);
  });

  it('removes padding when padding is zero', async () => {
    const input = makeFlac({ padding: 4096 });
    const output = await updateBuffer(input, { title: 'No padding' }, { padding: 0 });
    const blocks = extractBlocks(output);
    expect(blocks.some(block => block.type === 1)).toBe(false);
  });

  it('rejects invalid FLAC input', async () => {
    await expect(updateBuffer(Uint8Array.from([1, 2, 3, 4, 5]), { title: 'x' })).rejects.toThrow();
  });

  it('rejects MP3 input for now', async () => {
    const mp3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0]);
    await expect(updateBuffer(mp3, { title: 'x' })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});

describe('FLAC file updates', () => {
  it('updates a file atomically and leaves no temporary file behind', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'music-metadata-editor-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'sample.flac');
    await writeFile(filePath, makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }] }));

    const result = await updateFile(filePath, { title: 'New', artist: 'Someone' });

    expect(result.format).toBe('flac');
    expect(result.atomic).toBe(true);
    const metadata = await readTags(filePath);
    expect(metadata.common.title).toBe('New');
    expect(metadata.common.artist).toBe('Someone');

    const entries = await import('node:fs/promises').then(fs => fs.readdir(directory));
    expect(entries.filter(entry => entry.endsWith('.tmp'))).toHaveLength(0);
  });

  it('supports dry runs without touching the file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'music-metadata-editor-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'sample.flac');
    const original = makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }] });
    await writeFile(filePath, original);

    const result = await updateFile(filePath, { title: 'New' }, { dryRun: true });

    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(await readFile(filePath)).toEqual(Buffer.from(original));
  });

  it('supports non-atomic writes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'music-metadata-editor-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'sample.flac');
    const audio = makeAudio(4096);
    await writeFile(filePath, makeFlac({ audio, comments: [{ key: 'TITLE', value: 'Old' }] }));

    const result = await updateFile(filePath, { title: 'New' }, { atomic: false });

    expect(result.atomic).toBe(false);
    const metadata = await readTags(filePath);
    expect(metadata.common.title).toBe('New');
    expect(Buffer.from(extractAudio(await readFile(filePath))).equals(Buffer.from(audio))).toBe(true);
  });

  it('creates a backup when requested', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'music-metadata-editor-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'sample.flac');
    const original = makeFlac({ comments: [{ key: 'TITLE', value: 'Old' }] });
    await writeFile(filePath, original);

    await updateFile(filePath, { title: 'New' }, { backup: true });

    const backup = await readFile(`${filePath}.bak`);
    expect(backup).toEqual(Buffer.from(original));
    await stat(`${filePath}.bak`);
  });
});
