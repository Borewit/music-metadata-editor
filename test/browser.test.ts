import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { readTags, updateBuffer } from '../src/core/index.browser.js';
import { makeFlac } from './helpers/flac.js';

function toBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes] as any);
}

const mp3Fixture = 'test/fixtures/MusicBrainz - Beth Hart - Sinner\'s Prayer [id3v2.4].V2.mp3';

async function loadMp3(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(mp3Fixture));
}

describe('browser entry (index.browser)', () => {
  it('round-trips tags from a Blob input', async () => {
    const flac = makeFlac({ comments: [{ key: 'TITLE', value: 'Original' }] });
    const blob = toBlob(flac);

    const before = await readTags(blob);
    expect(before.common.title).toBe('Original');

    const updated = await updateBuffer(blob, { title: 'Updated' });
    expect(updated).toBeInstanceOf(Uint8Array);

    const after = await readTags(updated);
    expect(after.common.title).toBe('Updated');
  });

  it('round-trips tags from a Uint8Array input', async () => {
    const flac = makeFlac({ comments: [{ key: 'TITLE', value: 'Original' }] });

    const before = await readTags(flac);
    expect(before.common.title).toBe('Original');

    const updated = await updateBuffer(flac, { title: 'Updated' });
    expect(updated).toBeInstanceOf(Uint8Array);

    const after = await readTags(updated);
    expect(after.common.title).toBe('Updated');
  });

  it('reads MP3 tags from a Blob input', async () => {
    const mp3 = await loadMp3();
    const blob = toBlob(mp3);

    const tags = await readTags(blob);
    expect(tags.format).toBe('mp3');
    expect(tags.common.title).toBe("Sinner's Prayer");
    expect(tags.common.artists).toEqual(['Beth Hart', 'Joe Bonamassa']);
  });

  it('updates MP3 tags from a Uint8Array input', async () => {
    const mp3 = await loadMp3();

    const updated = await updateBuffer(mp3, { title: 'Browser Test' });
    const after = await readTags(updated);
    expect(after.common.title).toBe('Browser Test');
  });
});
